import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, cpSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('mocked script model to asset checklist, image receipts, exact shot references and portable reopen', async () => {
  const root = mkdtempSync(join(tmpdir(), 'director-asset-flow-'))
  const image = join(root, 'fixture.png')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=teal:s=640x360', '-frames:v', '1', image], { windowsHide: true, stdio: 'ignore' })
  const ir = { spec: 'previs-ir', version: '1.0', assets: [
    { id: 'person', name: '测试人物', type: 'character', visualDescription: '测试用灰衣人物。', imagePrompt: '灰衣人物设定图，单人全身。' },
    { id: 'cube', name: '测试方块', type: 'prop', visualDescription: '蓝色立方体。', imagePrompt: '蓝色立方体，白色背景。' }
  ], locations: [{ id: 'space', name: '测试空间', visualDescription: '白色测试空间。' }], shots: [
    { id: 'one', name: '技术镜头一', sourceText: '人物站在白色空间。', locationId: 'space', duration: 4, entities: [{ refId: 'person' }] },
    { id: 'two', name: '技术镜头二', sourceText: '人物和方块。', locationId: 'space', duration: 4, entities: [{ refId: 'person' }, { refId: 'cube' }] }
  ] }
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, BLOCKOUT_SMOKE_DIR: root, ARK_API_KEY: '' } })
  try {
    // The real IPC, request builder, file persistence and image decoder run; all cloud traffic is replaced.
    await app.evaluate((_electron, fixture) => {
      ;(globalThis as any).__imageCalls = 0
      globalThis.fetch = async (url: any) => {
        if (String(url) === 'https://technical-fixture.invalid/v1/chat/completions') return new Response(JSON.stringify({ choices: [{ message: { content: fixture.ir } }] }))
        if (String(url) === 'https://ark.cn-beijing.volces.com/api/v3/images/generations') {
          ;(globalThis as any).__imageCalls++
          await new Promise((resolve) => setTimeout(resolve, 450))
          return new Response(JSON.stringify({ data: [{ b64_json: fixture.png }] }))
        }
        throw new Error('Network disabled in technical asset-flow test')
      }
    }, { ir: JSON.stringify(ir), png: readFileSync(image).toString('base64') })
    const page = await app.firstWindow()
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: '开始全流程制作', exact: false }).click()
    expect(await page.evaluate(() => (window as any).__blockout.store.getState().doc.scenes.flatMap((scene: any) => scene.entities))).toEqual([])
    await page.getByLabel('完整剧本', { exact: true }).fill('软件连接测试，只包含测试人物、空间和方块。')
    await page.getByRole('button', { name: '2 拆分镜', exact: true }).click()
    const settings = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^拆镜模型设置$/ }) })
    await settings.evaluate((element) => { (element as HTMLDetailsElement).open = true })
    await page.getByLabel('拆镜服务地址').fill('https://technical-fixture.invalid')
    await page.getByLabel('拆镜文字模型').fill('fixture-text-model')
    await page.getByLabel('拆镜API密钥').fill('fixture-key')
    await page.getByRole('button', { name: '智能拆镜并整理素材', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已整理 3 项资产' })).toBeVisible()
    await page.getByRole('button', { name: '检查资产清单 →' }).click()
    const checklist = page.getByRole('region', { name: '资产清单' })
    await expect(checklist.getByLabel('素材生成描述')).toHaveValue(/灰衣人物/)
    await checklist.getByLabel('素材生成描述').fill('我修改的资产提示词，仅技术测试。')
    await checklist.getByLabel('素材制作API密钥').fill('fixture-image-key')
    await page.getByRole('button', { name: '生成一张素材', exact: true }).click()
    // Switch the selected card while the first asset is in flight.
    await page.locator('.pf-asset-list').getByRole('button', { name: /测试方块/ }).click()
    await expect.poll(() => page.evaluate(() => (window as any).__blockout.store.getState().doc.productionAssetPlan.find((item: any) => item.name === '测试人物').selectedMediaId)).toBeTruthy()
    await expect(checklist.getByLabel('素材生成描述')).toHaveValue(/蓝色立方体/)
    await expect(page.getByLabel('选择已有资产图片')).toHaveValue('')
    await page.locator('.pf-asset-list').getByRole('button', { name: /测试人物/ }).click()
    await expect(checklist.getByLabel('素材生成描述')).toHaveValue('我修改的资产提示词，仅技术测试。')
    const firstMedia = await page.getByLabel('选择已有资产图片').inputValue()
    await page.getByRole('button', { name: '生成一张素材', exact: true }).click()
    await expect(page.getByRole('button', { name: '使用这张并关联', exact: true })).toBeVisible()
    await expect(page.getByLabel('选择已有资产图片')).toHaveValue(firstMedia)
    await page.getByRole('button', { name: '使用这张并关联', exact: true }).click()
    const adopted = await page.getByLabel('选择已有资产图片').inputValue()
    expect(adopted).not.toBe(firstMedia)
    await page.locator('.pf-asset-list').getByRole('button', { name: /测试方块/ }).click()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, image)
    await page.getByRole('button', { name: '导入图片并关联', exact: true }).click()
    await expect(page.getByRole('button', { name: '✓ 当前使用', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '2 拆分镜', exact: true }).click()
    await page.getByRole('button', { name: '智能拆镜并整理素材', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已整理 3 项资产' })).toBeVisible()
    const state = await page.evaluate(() => (window as any).__blockout.store.getState().doc)
    expect(state.productionAssetPlan).toHaveLength(3)
    expect(state.productionAssetPlan[0].prompt).toBe('我修改的资产提示词，仅技术测试。')
    const shots = state.scenes.flatMap((scene: any) => scene.shots).filter((shot: any) => shot.storyboard?.sourceShotId)
    expect(shots).toHaveLength(2)
    expect(state.scenes.flatMap((scene: any) => scene.shots)).toHaveLength(2)
    expect(shots[0].generationInput.references).toHaveLength(1)
    expect(shots[1].generationInput.references).toHaveLength(2)
    expect(shots[0].generationInput.references[0].mediaId).toBe(adopted)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const folder = await page.evaluate(() => (window as any).__blockout.store.getState().projectFolder as string)
    await expect.poll(() => JSON.parse(readFileSync(join(folder, 'project.json'), 'utf8')).productionAssetPlan?.[1].selectedMediaId).toBeTruthy()
    const moved = join(root, 'moved-project'); cpSync(folder, moved, { recursive: true })
    await page.evaluate(async (target) => {
      const result = await (window as any).blockout.loadProject(target)
      if (!(window as any).__blockout.store.getState().loadFromJson(target, result.json)) throw new Error('Failed to reopen')
      ;(window as any).__blockout.store.getState().setMode('production')
    }, moved)
    await page.getByRole('button', { name: '3 做素材', exact: true }).click()
    await expect(checklist.getByLabel('素材生成描述')).toHaveValue('我修改的资产提示词，仅技术测试。')
    await expect(page.getByLabel('选择已有资产图片')).toHaveValue(adopted)
    mkdirSync('media/showcase', { recursive: true }); await page.screenshot({ path: 'media/showcase/fullflow-asset-checklist.png' })
    await page.locator('summary').filter({ hasText: /^对应镜头/ }).click()
    await page.getByLabel('关联技术镜头一', { exact: true }).uncheck()
    await page.getByRole('button', { name: '从分镜更新清单' }).click()
    await expect(page.getByLabel('关联技术镜头一', { exact: true })).not.toBeChecked()
    expect(await app.evaluate(() => (globalThis as any).__imageCalls)).toBe(2)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
