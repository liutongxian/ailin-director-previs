import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const cli = path.resolve('mcp/ailin-cli.mjs')

describe('Ai Lin command-line client', () => {
  it('documents the director-package and Blender commands without requiring the app', () => {
    const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('import-director-pack')
    expect(result.stdout).toContain('blender-render')
    expect(result.stdout).toContain('blender-cancel')
  })

  it('rejects unknown commands before attempting control discovery', () => {
    const result = spawnSync(process.execPath, [cli, 'not-a-command'], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unknown command')
  })

  it('discovers the current Windows namespace before the legacy blockout namespace', () => {
    const source = fs.readFileSync(cli, 'utf8')
    expect(source).toContain("process.env.BLOCKOUT_CONFIG_NAMESPACE || 'director-desk'")
    expect(source).toContain("configDir('blockout')")
  })
})
