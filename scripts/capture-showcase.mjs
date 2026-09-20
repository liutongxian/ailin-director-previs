/** Capture public-core UI only; never use screenshots from private productions. */
import { _electron as electron, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'media', 'showcase')
mkdirSync(output, { recursive: true })
const smokeDir = mkdtempSync(join(tmpdir(), 'ailin-public-showcase-'))
const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  cwd: root,
  env: {
    ...process.env,
    BLOCKOUT_SMOKE_DIR: smokeDir,
    BLOCKOUT_DIRECTOR_PACK_PATH: join(root, 'examples', '双人调度.ailin.json')
  }
})

try {
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: 'DIRECTOR', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '导入艾琳导演包…' }).click()
  await expect(page.locator('.director-shot-card')).toHaveCount(1)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: '一键生成全部可编辑 3D 预演' }).click()
  await expect(page.getByRole('button', { name: 'STAGE', exact: true })).toHaveClass(/active/)
  await page.waitForTimeout(750)
  await page.evaluate(() => {
    const state = window.__blockout.store.getState()
    for (const toast of state.toasts) state.dismissToast(toast.id)
  })
  await page.screenshot({ path: join(output, 'stage-ui.png') })

  await page.getByRole('button', { name: 'DIRECTOR', exact: true }).click()
  await page.locator('.director-panel').evaluate((panel) => { panel.scrollTop = 0 })
  await page.waitForTimeout(750)
  await page.screenshot({ path: join(output, 'director-ui.png') })
} finally {
  await app.close()
}
