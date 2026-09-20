import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { portableModelBytes } from '../../src/main/import-model'

describe('portable model import', () => {
  it('embeds local buffers and images without changing source files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'director-model-qa-'))
    const file = join(root, 'model.gltf')
    const source = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }], images: [{ uri: 'texture.png' }] })
    await writeFile(file, source)
    await writeFile(join(root, 'mesh.bin'), Buffer.from([1, 2, 3]))
    await writeFile(join(root, 'texture.png'), Buffer.from([4, 5]))
    const result = JSON.parse((await portableModelBytes(file)).toString())
    expect(result.buffers[0].uri).toBe('data:application/octet-stream;base64,AQID')
    expect(result.images[0].uri).toBe('data:image/png;base64,BAU=')
    expect(await readFile(file, 'utf8')).toBe(source)
  })

  for (const uri of ['../outside.bin', '%2e%2e/outside.bin', 'https://example.com/a.bin', 'file:///private.bin']) {
    it(`rejects escaping or remote dependency ${uri}`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'director-model-qa-'))
      await mkdir(join(root, 'model'))
      await writeFile(join(root, 'outside.bin'), 'private fixture')
      const file = join(root, 'model', 'model.gltf')
      await writeFile(file, JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri }] }))
      await expect(portableModelBytes(file)).rejects.toThrow(/文件夹/)
    })
  }

  it('accepts OBJ geometry and rejects damaged GLB before import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'director-model-qa-'))
    const obj = join(root, 'triangle.obj')
    await writeFile(obj, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')
    expect((await portableModelBytes(obj)).length).toBeGreaterThan(0)
    const glb = join(root, 'broken.glb')
    await writeFile(glb, 'INVALID')
    await expect(portableModelBytes(glb)).rejects.toThrow(/GLB/)
  })
})
