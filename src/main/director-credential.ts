import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

export interface CredentialCipher {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface StoredCredential {
  version: 1
  encrypted: string
}

export function directorCredentialPath(userDataFolder: string): string {
  return join(userDataFolder, 'credentials', 'director-model-api-key.json')
}

export async function readDirectorCredential(path: string, cipher: CredentialCipher): Promise<string | null> {
  if (!cipher.available()) return null
  try {
    const stored = JSON.parse(await readFile(path, 'utf8')) as StoredCredential
    if (stored.version !== 1 || typeof stored.encrypted !== 'string') return null
    const value = cipher.decrypt(Buffer.from(stored.encrypted, 'base64')).trim()
    return value || null
  } catch {
    return null
  }
}

export async function saveDirectorCredential(path: string, apiKey: string, cipher: CredentialCipher): Promise<void> {
  const value = apiKey.trim()
  if (!value) throw new Error('API 密钥不能为空。')
  if (!cipher.available()) throw new Error('当前系统无法使用安全密钥存储。')
  const stored: StoredCredential = {
    version: 1,
    encrypted: cipher.encrypt(value).toString('base64')
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
}

export async function clearDirectorCredential(path: string): Promise<void> {
  await rm(path, { force: true })
}
