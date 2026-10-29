import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDirectorCredential,
  directorCredentialPath,
  readDirectorCredential,
  saveDirectorCredential,
  type CredentialCipher
} from '../../src/main/director-credential'

const temporaryFolders: string[] = []

const cipher: CredentialCipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decrypt: (value) => value.toString('utf8').replace(/^protected:/, '')
}

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

async function temporaryCredentialPath(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'director-credential-'))
  temporaryFolders.push(folder)
  return directorCredentialPath(folder)
}

describe('director API credential storage', () => {
  it('stores an encrypted value and reads it back without writing plaintext', async () => {
    const path = await temporaryCredentialPath()

    await saveDirectorCredential(path, '  secret-key  ', cipher)

    expect(await readDirectorCredential(path, cipher)).toBe('secret-key')
    expect(await readFile(path, 'utf8')).not.toContain('secret-key')
  })

  it('clears the saved key and tolerates corrupt local data', async () => {
    const path = await temporaryCredentialPath()
    await saveDirectorCredential(path, 'secret-key', cipher)
    await clearDirectorCredential(path)
    expect(await readDirectorCredential(path, cipher)).toBeNull()

    await writeFile(path, '{broken', 'utf8').catch(() => undefined)
    expect(await readDirectorCredential(path, cipher)).toBeNull()
  })

  it('does not read or save a key when secure storage is unavailable', async () => {
    const path = await temporaryCredentialPath()
    const unavailable: CredentialCipher = { ...cipher, available: () => false }

    await expect(saveDirectorCredential(path, 'secret-key', unavailable)).rejects.toThrow('安全密钥存储')
    expect(await readDirectorCredential(path, unavailable)).toBeNull()
  })
})
