/** Smoke-check the packaged Electron executable and its bundled Blender script. */
import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packagedExe = resolve(process.env.AILIN_PACKAGED_EXE ?? 'release-open-core/win-unpacked/艾琳导演台-开源核心.exe')
test.skip(!existsSync(packagedExe), 'Build the Windows executable with npm run package:win first.')

test('opens the real packaged UI and generates a Blender video', async () => {
  test.setTimeout(300_000)
  const smokeDir = mkdtempSync(join(tmpdir(), 'ailin-packaged-'))
  const app = await electron.launch({
    executablePath: packagedExe,
    env: {
      ...process.env,
      BLOCKOUT_SMOKE_DIR: smokeDir,
      BLOCKOUT_DIRECTOR_PACK_PATH: resolve('examples/双人调度.ailin.json')
    }
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: 'DIRECTOR', exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: '导入艾琳导演包…' }).click()
    await expect(page.locator('.director-shot-card')).toHaveCount(1)
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: '一键生成全部可编辑 3D 预演' }).click()
    await page.evaluate(() => {
      const state = (window as any).__blockout.store.getState()
      state.mutate('shorten packaged smoke render', (doc: any) => {
        const scene = doc.scenes[0]
        const shot = scene.shots[0]
        shot.duration = 1
        shot.fps = 12
        for (const block of scene.blocking) for (const track of block.tracks) for (const mark of track.marks) mark.time /= 3
        for (const mark of shot.camera.marks) mark.time /= 3
      })
    })
    await page.getByRole('button', { name: 'DELIVER', exact: true }).click()
    await page.getByRole('button', { name: '高级白模 Blender' }).click()
    await page.getByRole('button', { name: '生成当前Blender高级白模' }).click()
    await page.waitForFunction(() => {
      const status = document.querySelector('.white-model-job')?.textContent ?? ''
      return status.includes('Blender生成完成') || status.includes('Blender生成失败')
    }, undefined, { timeout: 240_000 })
    await expect(page.locator('.white-model-job')).toContainText('Blender生成完成')
    const video = await page.evaluate(() => {
      const state = (window as any).__blockout.store.getState()
      const record = state.shot().previsExports.find((item: any) => item.engine === 'blender')
      return { folder: state.projectFolder as string, path: record?.relativePath as string | undefined }
    })
    expect(video.path).toBeTruthy()
    expect(existsSync(join(video.folder, ...video.path!.split('/')))).toBe(true)
  } finally {
    await app.close()
  }
})
