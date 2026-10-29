import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeAtomic } from '../../src/main/atomic-file'

vi.mock('fs/promises', async (original) => {
  const fs = await original<typeof import('fs/promises')>()
  return { ...fs, rename: vi.fn(fs.rename) }
})
let folder: string
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'director-atomic-lock-')); vi.mocked(rename).mockClear() })
afterEach(async () => { await rm(folder, { recursive: true, force: true }) })

it('retries a brief Windows sharing violation and leaves a complete destination', async () => {
  const path = join(folder, 'project.json')
  await writeFile(path, 'previous')
  vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('temporary sharing violation'), { code: 'EPERM' }))
  await writeAtomic(path, 'updated')
  expect(await readFile(path, 'utf8')).toBe('updated')
  expect(rename).toHaveBeenCalledTimes(2)
  expect(await readdir(folder)).toEqual(['project.json'])
})

it('bounds retries, preserves the previous file after persistent denial and allows the next save', async () => {
  const path = join(folder, 'project.json')
  await writeFile(path, 'previous')
  for (let attempt = 0; attempt < 6; attempt++) vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EACCES' }))
  await expect(writeAtomic(path, 'failed')).rejects.toThrow('locked')
  expect(await readFile(path, 'utf8')).toBe('previous')
  expect(rename).toHaveBeenCalledTimes(6)
  expect(await readdir(folder)).toEqual(['project.json'])
  await writeAtomic(path, 'next successful save')
  expect(await readFile(path, 'utf8')).toBe('next successful save')
})
