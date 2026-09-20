import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: process.env.BLOCKOUT_E2E_OUTPUT || 'test-results',
  timeout: 180_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
