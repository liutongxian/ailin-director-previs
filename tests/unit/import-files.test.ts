import { describe, expect, it } from 'vitest'
import { isSupportedDirectorPackageImport, isSupportedTextImport } from '../../src/shared/import-files'

describe('text import allowlist', () => {
  it('accepts scripts and Previs IR while rejecting unrelated files', () => {
    expect(isSupportedTextImport('scene.txt')).toBe(true)
    expect(isSupportedTextImport('scene.fountain')).toBe(true)
    expect(isSupportedTextImport('shot.previs.json')).toBe(true)
    expect(isSupportedTextImport('shot.previs')).toBe(true)
    expect(isSupportedTextImport('shot.ailin')).toBe(true)
    expect(isSupportedTextImport('shot.ailinpack')).toBe(false)
    expect(isSupportedTextImport('installer.exe')).toBe(false)
  })

  it('recognizes both text director packages and portable asset packs', () => {
    expect(isSupportedDirectorPackageImport('shot.json')).toBe(true)
    expect(isSupportedDirectorPackageImport('shot.ailin')).toBe(true)
    expect(isSupportedDirectorPackageImport('shot.ailinpack')).toBe(true)
    expect(isSupportedDirectorPackageImport('shot.zip')).toBe(false)
  })
})
