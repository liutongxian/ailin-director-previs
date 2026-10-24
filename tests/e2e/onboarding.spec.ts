import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const guide = (page: Page) => page.getByTestId('previs-guide')
const next = (page: Page) => guide(page).getByRole('button', { name: '下一步', exact: true })
async function launch(packagePath?: string, env: Record<string, string> = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'ailin-guide-'))
  const app = await electron.launch({
    ...(process.env.BLOCKOUT_ONBOARDING_EXE ? { executablePath: process.env.BLOCKOUT_ONBOARDING_EXE } : {}),
    args: process.env.BLOCKOUT_ONBOARDING_EXE ? [] : ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: folder, ...(packagePath ? { BLOCKOUT_DIRECTOR_PACK_PATH: packagePath } : {}), ...env }
  })
  const page = await app.firstWindow()
  await expect(page.getByRole('main', { name: '导演台首页' })).toBeVisible({ timeout: 30_000 })
  await expect(guide(page)).toBeVisible()
  return { app, page, folder }
}

test('the built-in sample guide produces, validates and saves a real MP4', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launch()
  try {
    await expect(page.getByRole('main', { name: '导演台首页' }).getByRole('button')).toHaveCount(2)
    mkdirSync('tmp/onboarding', { recursive: true })
    await page.screenshot({ path: 'tmp/onboarding/welcome.png' })
    const oldFolder = await page.evaluate(() => (window as any).__blockout.store.getState().projectFolder)
    await guide(page).getByRole('button', { name: /1\. 先跑一遍示例/ }).click()
    await expect.poll(() => page.evaluate(() => (window as any).__blockout.store.getState().projectFolder)).not.toBe(oldFolder)
    await expect(next(page)).toBeDisabled()
    await page.getByRole('button', { name: '载入入门导演包' }).click()
    await expect(page.locator('.director-package-valid')).toContainText('内置双人调度')
    await expect(next(page)).toBeEnabled()
    await page.screenshot({ path: 'tmp/onboarding/sample-loaded.png' })
    await next(page).click() // Review.
    await expect(guide(page)).toContainText('先看首、中、尾')
    await next(page).click() // Build.
    await expect(next(page)).toBeDisabled()
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: '一键生成全部可编辑 3D 预演' }).click()
    await expect(page.getByRole('button', { name: 'STAGE', exact: true })).toHaveClass(/active/)
    await expect(next(page)).toBeEnabled()
    await next(page).click() // Stage.
    await next(page).click() // Shoot.
    await page.getByRole('button', { name: '▶ Play shot', exact: true }).click()
    await expect(next(page)).toBeEnabled()
    await next(page).click() // Select shot.
    await next(page).click() // Select engine.
    await page.getByRole('button', { name: '快速白模 Three.js', exact: true }).click()
    await next(page).click() // Render.
    await expect(next(page)).toBeDisabled()
    await page.getByRole('button', { name: '生成当前Three.js快速白模', exact: true }).click()
    await expect(page.locator('.engine-threejs video')).toBeVisible({ timeout: 90_000 })
    await expect(next(page)).toBeEnabled()
    await next(page).click() // Preview.
    await expect(guide(page)).toContainText('播放检查，再取出 MP4')
    await page.screenshot({ path: 'tmp/onboarding/video-ready.png' })
    await next(page).click() // Save.
    await expect(guide(page).getByRole('button', { name: '完成这条引导' })).toBeDisabled()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await guide(page).getByRole('button', { name: '完成这条引导' }).click()
    await expect(guide(page)).toContainText('已看完这条引导')
    const result = await page.evaluate(() => {
      const s = (window as any).__blockout.store.getState()
      return { folder: s.projectFolder as string, record: s.shot().previsExports[0] }
    })
    const video = join(result.folder, ...result.record.relativePath.split('/'))
    expect(existsSync(video)).toBe(true)
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', video], { encoding: 'utf8' }))
    expect(probe.streams[0]).toMatchObject({ codec_name: 'h264' })
    const saved = JSON.parse(readFileSync(join(result.folder, 'project.json'), 'utf8'))
    expect(saved.scenes[0].shots[0].previsExports[0].relativePath).toBe(result.record.relativePath)
  } finally { await app.close() }
})

test('dismissal and resume survive reload; invalid imports do not advance the package guide', async () => {
  const importDir = mkdtempSync(join(tmpdir(), 'ailin-guide-import-'))
  const packagePath = join(importDir, 'my-package.ailin.json')
  writeFileSync(packagePath, '{"spec":"invalid"}')
  const { app, page } = await launch(packagePath)
  try {
    await guide(page).getByRole('button', { name: '稍后再看', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('main', { name: '导演台首页' })).toBeVisible()
    await expect(guide(page)).toHaveCount(0)
    await page.getByRole('button', { name: '新手引导', exact: true }).click()
    await guide(page).getByRole('button', { name: /2\. 制作自己的导演包/ }).click()
    await page.getByRole('button', { name: '复制导演包完整提示词' }).click()
    await expect(next(page)).toBeEnabled()
    await next(page).click()
    await expect(guide(page)).toContainText('把提示词和剧本一起交给外部 AI')
    await guide(page).getByRole('button', { name: '关闭新手引导' }).click()
    await page.reload()
    await expect(page.getByRole('main', { name: '导演台首页' })).toBeVisible()
    await expect(guide(page)).toHaveCount(0)
    await page.getByRole('button', { name: '新手引导', exact: true }).click()
    await guide(page).getByRole('button', { name: /继续上次/ }).click()
    await expect(guide(page)).toContainText('把提示词和剧本一起交给外部 AI')
    await next(page).click()
    await page.getByRole('button', { name: '导入艾琳导演包…' }).click()
    await expect(next(page)).toBeDisabled()
    writeFileSync(packagePath, readFileSync(resolve('examples/双人调度.ailin.json')))
    await page.getByRole('button', { name: '导入艾琳导演包…' }).click()
    await expect(page.locator('.director-shot-card')).toHaveCount(1)
    await expect(next(page)).toBeEnabled()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 720) })
    await expect.poll(() => guide(page).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
    })).toBe(true)
    await page.screenshot({ path: 'tmp/onboarding/resized.png' })
  } finally { await app.close() }
})

test('starting the sample never discards unsaved edits when the user declines', async () => {
  const { app, page } = await launch()
  try {
    await guide(page).getByRole('button', { name: '稍后再看', exact: true }).click()
    await page.getByRole('button', { name: /手动搭建白模预演/ }).click()
    const before = await page.evaluate(() => {
      const s = (window as any).__blockout.store.getState()
      s.mutate('keep my unsaved work', (doc: any) => { doc.name = '不要替换我的工程' })
      return { folder: s.projectFolder, entities: s.scene().entities.length }
    })
    await page.getByRole('button', { name: '新手引导', exact: true }).click()
    page.once('dialog', (dialog) => void dialog.dismiss())
    await guide(page).getByRole('button', { name: /1\. 先跑一遍示例/ }).click()
    await expect(guide(page)).toContainText('从第一条白模视频开始')
    const after = await page.evaluate(() => {
      const s = (window as any).__blockout.store.getState()
      return { folder: s.projectFolder, entities: s.scene().entities.length, name: s.doc.name, dirty: s.dirty }
    })
    expect(after).toMatchObject({ ...before, name: '不要替换我的工程', dirty: true })
  } finally { await app.close() }
})

test('manual steps track real placement, actor marks, camera marks and saving', async () => {
  const { app, page } = await launch()
  try {
    await guide(page).getByRole('button', { name: /4\. 练习手动搭景与拍摄/ }).click()
    await expect(next(page)).toBeDisabled()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await expect(next(page)).toBeEnabled()
    await next(page).click() // Asset library.
    const picker = page.locator('select[title="Pick from the full list — then click the floor to place it"]')
    await picker.selectOption('person.man')
    await next(page).click() // Place.
    expect(await page.evaluate(() => (window as any).__blockout.store.getState().placingAssetId)).toBe('person.man')
    await expect(next(page)).toBeDisabled()
    const viewport = page.locator('.center-column canvas')
    await viewport.click({ position: { x: 340, y: 280 } })
    await expect(next(page)).toBeEnabled()
    await picker.selectOption('')
    await next(page).click() // Inspector.
    await next(page).click() // Actor marks.
    // Select the placed actor deterministically; then use the actual toolbar and floor.
    await page.evaluate(() => {
      const s = (window as any).__blockout.store.getState()
      s.setSelection({ kind: 'entity', entityId: s.scene().entities[0].id })
    })
    await page.locator('[data-guide="actor-mark"]').click()
    await viewport.click({ position: { x: 370, y: 300 } })
    await expect(next(page)).toBeEnabled()
    await page.keyboard.press('Escape') // Exit mark placement, not the guide.
    await expect(guide(page)).toBeVisible()
    await next(page).click() // Frame the actor before setting camera marks.
    await page.getByRole('button', { name: 'MS', exact: true }).click()
    await expect(next(page)).toBeEnabled()
    await next(page).click() // Camera marks.
    await page.locator('.timeline-ruler').click({ position: { x: 250, y: 10 } })
    await page.locator('[data-guide="camera-mark"]').click()
    await expect(next(page)).toBeEnabled()
    await next(page).click() // Playback.
    await page.getByRole('button', { name: '▶ Play shot', exact: true }).click()
    await expect(next(page)).toBeEnabled()
    await next(page).click() // Save.
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(next(page)).toBeEnabled()
    await page.screenshot({ path: 'tmp/onboarding/manual.png' })
  } finally { await app.close() }
})

test('a missing encoder keeps the generation step pending and allows retry', async () => {
  const { app, page } = await launch(undefined, { BLOCKOUT_FFMPEG: join(tmpdir(), 'no-such-guide-ffmpeg.exe') })
  try {
    await guide(page).getByRole('button', { name: /3\. 生成白模视频/ }).click()
    await next(page).click()
    await page.getByRole('button', { name: '快速白模 Three.js', exact: true }).click()
    await next(page).click()
    await page.getByRole('button', { name: '生成当前Three.js快速白模', exact: true }).click()
    await expect(page.getByRole('button', { name: '生成当前Three.js快速白模', exact: true })).toBeEnabled()
    await expect(next(page)).toBeDisabled()
    await expect(page.locator('.engine-threejs video')).toHaveCount(0)
    await expect(page.locator('.toast').filter({ hasText: /FFmpeg|ENOENT|ffmpeg exited/i })).toBeVisible()
    await guide(page).getByRole('button', { name: '跳过本步' }).click()
    await expect(guide(page)).toContainText('播放检查，再取出 MP4')
  } finally { await app.close() }
})

test('long director packages scroll the highlighted build button into view', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ailin-guide-many-shots-'))
  const packagePath = join(folder, 'many-shots.ailin.json')
  const pack = JSON.parse(readFileSync(resolve('examples/双人调度.ailin.json'), 'utf8'))
  const originalShot = pack.previsIR.shots[0]
  const originalPlan = pack.stagePlans[0]
  pack.previsIR.shots = Array.from({ length: 8 }, (_, index) => ({ ...originalShot, id: `SHOT-${index + 1}`, name: `练习镜头${index + 1}` }))
  pack.stagePlans = pack.previsIR.shots.map((shot: any) => ({ ...originalPlan, shotId: shot.id }))
  writeFileSync(packagePath, JSON.stringify(pack))
  const { app, page } = await launch(packagePath)
  try {
    await guide(page).getByRole('button', { name: /2\. 制作自己的导演包/ }).click()
    await page.getByRole('button', { name: '复制导演包完整提示词' }).click()
    await next(page).click()
    await next(page).click()
    await page.getByRole('button', { name: '导入艾琳导演包…' }).click()
    await expect(page.locator('.director-shot-card')).toHaveCount(8)
    await next(page).click()
    await next(page).click()
    await expect(guide(page)).toContainText('将自己的包变成 3D 场景')
    await expect(page.locator('[data-guide="build"]')).toBeInViewport()
    await expect(page.locator('.previs-guide-spotlight')).toBeVisible()
  } finally { await app.close() }
})
