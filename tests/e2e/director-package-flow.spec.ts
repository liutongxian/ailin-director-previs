/** External-Agent package → import → one-click editable previs → real Blender MP4. */
import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('takes a director package all the way to a Blender white-model video', async () => {
  test.setTimeout(300_000)
  const smokeDir = mkdtempSync(join(tmpdir(), 'ailin-package-flow-'))
  const packagePath = resolve('examples/双人调度.ailin.json')
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir, BLOCKOUT_DIRECTOR_PACK_PATH: packagePath }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('main', { name: '导演台首页' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('main', { name: '导演台首页' }).getByRole('button')).toHaveCount(3)
    await page.screenshot({ path: 'media/showcase/home-ui.png' })
    await page.getByRole('button', { name: '导演包一键生成白模预演', exact: false }).click()
    await expect(page.getByRole('button', { name: 'DIRECTOR', exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: '？帮助' }).click()
    await expect(page.locator('.help-modal')).toContainText('导入导演包')
    await expect(page.locator('.help-modal')).toContainText('生成白模 MP4')
    await expect(page.locator('.help-modal')).not.toContainText('ComfyUI')
    await page.getByRole('button', { name: '常见问题' }).click()
    await expect(page.locator('.help-modal')).toContainText('导出成片')
    await page.getByRole('button', { name: '完成' }).click()
    await page.getByRole('button', { name: '项目与说明' }).click()
    await page.getByRole('button', { name: 'Switch to English' }).click()
    await page.getByRole('button', { name: '完成' }).click()
    await page.getByRole('button', { name: '? Help' }).click()
    await page.getByRole('button', { name: 'How do I…?' }).click()
    await expect(page.locator('.help-modal')).not.toContainText('Populate from reference')
    await expect(page.locator('.help-modal')).not.toContainText('Claude API key')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: '项目与说明' }).click()
    await page.getByRole('button', { name: '切换到中文' }).click()
    await page.getByRole('button', { name: '完成' }).click()
    await page.getByRole('button', { name: '导入艾琳导演包…' }).click()
    await expect(page.locator('.director-package-valid')).toContainText('双人调度.ailin.json')
    await expect(page.locator('.director-shot-card')).toHaveCount(1)
    await expect(page.locator('.director-package-review')).toContainText('人物A从左侧进入')
    await page.screenshot({ path: 'media/showcase/director-ui.png' })
    await page.getByRole('button', { name: '返回首页' }).click()
    await expect(page.getByRole('main', { name: '导演台首页' })).toBeVisible()
    await page.getByRole('button', { name: '手动搭建白模预演', exact: false }).click()
    await expect(page.getByRole('button', { name: 'STAGE', exact: true })).toHaveClass(/active/)
    await page.getByRole('button', { name: '返回首页' }).click()
    await page.getByRole('button', { name: '导演包一键生成白模预演', exact: false }).click()
    await expect(page.locator('.director-shot-card')).toHaveCount(1)
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: '一键生成全部可编辑 3D 预演' }).click()
    await expect(page.getByRole('button', { name: 'STAGE', exact: true })).toHaveClass(/active/)
    await page.evaluate(() => {
      const state = (window as any).__blockout.store.getState()
      state.mutate('shorten E2E render only', (doc: any) => {
        const scene = doc.scenes[0]
        const shot = scene.shots[0]
        shot.duration = 1
        shot.fps = 12
        for (const block of scene.blocking) for (const track of block.tracks) for (const mark of track.marks) mark.time /= 3
        for (const mark of shot.camera.marks) mark.time /= 3
      })
    })
    await page.getByRole('button', { name: 'DELIVER', exact: true }).click()
    await expect(page.locator('.core-delivery-content')).toBeVisible()
    await page.getByRole('button', { name: '高级白模 Blender' }).click()
    await page.getByRole('button', { name: '生成当前Blender高级白模' }).click()
    await page.waitForFunction(() => {
      const status = document.querySelector('.white-model-job')?.textContent ?? ''
      return status.includes('Blender生成完成') || status.includes('Blender生成失败')
    }, undefined, { timeout: 240_000 })
    await expect(page.locator('.white-model-job')).toContainText('Blender生成完成')

    const result = await page.evaluate(() => {
      const state = (window as any).__blockout.store.getState()
      const record = state.shot().previsExports.find((item: any) => item.engine === 'blender')
      return { projectFolder: state.projectFolder as string, record }
    })
    expect(result.record).toBeTruthy()
    const video = join(result.projectFolder, ...result.record.relativePath.split('/'))
    const outputDir = join(result.projectFolder, ...result.record.packageRelativePath.split('/'))
    expect(existsSync(video)).toBe(true)
    expect(readdirSync(outputDir).some((name) => name.endsWith('-blender-blockout.blend'))).toBe(true)
    const probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height',
      '-of', 'json', video
    ], { encoding: 'utf8' }))
    expect(probe.streams?.[0]?.codec_name).toBe('h264')
  } finally {
    await app.close()
  }
})
