/** Fresh project → editable stage → Blender MP4 → approved motion reference. */
import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('generates a Blender white-model video from editable staging', async () => {
  test.setTimeout(300_000)
  const smokeDir = mkdtempSync(join(tmpdir(), 'ailin-open-core-'))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('main', { name: '导演台首页' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('main', { name: '导演台首页' }).getByRole('button')).toHaveCount(3)
    await page.getByRole('button', { name: '手动搭建白模预演', exact: false }).click()
    await expect(page.getByRole('button', { name: 'STAGE', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'SHOOT', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const state = (window as any).__blockout.store.getState()
      state.mutate('short public smoke shot', (doc: any) => {
        const scene = doc.scenes[0]
        const shot = scene.shots[0]
        shot.duration = 1
        shot.fps = 12
        shot.aspect = '16:9'
        for (const track of scene.blocking[0].tracks) for (const mark of track.marks) mark.time /= 6
        for (const mark of shot.camera.marks) mark.time /= 6
      })
    })

    await page.getByRole('button', { name: 'DELIVER', exact: true }).click()
    await expect(page.locator('.white-model-workspace')).toBeVisible()
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
    const outputDir = join(result.projectFolder, ...result.record.packageRelativePath.split('/'))
    const video = join(result.projectFolder, ...result.record.relativePath.split('/'))
    expect(existsSync(video)).toBe(true)
    const names = readdirSync(outputDir)
    expect(names.some((name) => name.endsWith('-blender-blockout.blend'))).toBe(true)
    for (const suffix of ['-start.png', '-middle.png', '-end.png']) {
      expect(names.some((name) => name.endsWith(suffix))).toBe(true)
    }
    const probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height',
      '-show_entries', 'format=duration', '-of', 'json', video
    ], { encoding: 'utf8' }))
    expect(probe.streams?.[0]?.codec_name).toBe('h264')
    expect(probe.streams?.[0]?.width).toBe(960)
    expect(probe.streams?.[0]?.height).toBe(540)
    expect(Number(probe.format?.duration)).toBeGreaterThan(0.5)

    await page.locator('.engine-blender').getByRole('button', { name: '设为最终交付参考' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.engine-blender')).toContainText('交付使用中')
    const saved = JSON.parse(readFileSync(join(result.projectFolder, 'project.json'), 'utf8'))
    expect(saved.scenes[0].shots[0].approvedPrevisId).toBe(result.record.id)
  } finally {
    await app.close()
  }
})
