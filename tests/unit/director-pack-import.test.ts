import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AILIN_DIRECTOR_PACKAGE_TEMPLATE, parseDirectorPackage } from '@engine/director-package'
import { importExtractedDirectorPack, validateDirectorPackArchiveEntry } from '../../src/main/director-pack'

const roots: string[] = []
// Filesystem unit tests inject a decoder boundary; packaged QA uses nativeImage.
const inspectImage = async () => ({ width: 1, height: 1 })
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function createExtractedPack(options: { wrongHash?: boolean } = {}): Promise<{ extracted: string; project: string }> {
  const root = await tempRoot('ailinpack-import-')
  const extracted = join(root, 'extracted')
  const project = join(root, 'Test.blockout')
  await mkdir(join(extracted, 'assets', 'person'), { recursive: true })
  await mkdir(join(extracted, 'assets', 'room'), { recursive: true })
  await mkdir(join(extracted, 'models'), { recursive: true })
  await mkdir(project, { recursive: true })
  await writeFile(join(extracted, 'assets', 'person', 'front.png'), PNG_1X1)
  await writeFile(join(extracted, 'assets', 'room', 'wide.png'), PNG_1X1)
  await writeFile(join(extracted, 'models', 'room.glb'), Buffer.from('glTF-test'))

  const raw = JSON.parse(AILIN_DIRECTOR_PACKAGE_TEMPLATE) as Record<string, any>
  const personId = raw.previsIR.assets[0].id
  const locationId = raw.previsIR.locations[0].id
  const imageHash = createHash('sha256').update(PNG_1X1).digest('hex')
  raw.assetBindings = [
    {
      targetRefId: personId, assetId: 'CHAR-PERSON-A', kind: 'character', stateId: 'DAY1', stateName: '第一日',
      slots: [{
        slotId: 'front', label: '正面', type: 'identity', view: 'front', required: true,
        relativePath: 'assets/person/front.png', sha256: options.wrongHash ? '0'.repeat(64) : imageHash
      }]
    },
    {
      targetRefId: locationId, assetId: 'SCENE-ROOM-A', kind: 'scene', stateId: 'DAY', stateName: '日景',
      slots: [{ slotId: 'wide', label: '广角', type: 'camera_view', view: 'wide', required: true, relativePath: 'assets/room/wide.png' }],
      model: { relativePath: 'models/room.glb' }
    }
  ]
  raw.stagePlans[0].generationPrompt = 'Use the packaged shot prompt without rewriting it.'
  await writeFile(join(extracted, 'director.ailin.json'), JSON.stringify(raw, null, 2), 'utf8')
  return { extracted, project }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Ai Lin asset pack filesystem import', () => {
  it('copies validated files transactionally and writes a portable Blender manifest', async () => {
    const { extracted, project } = await createExtractedPack()
    const result = await importExtractedDirectorPack(project, extracted, '第十镜.ailinpack', inspectImage)

    expect(result.imageCount).toBe(2)
    expect(result.modelCount).toBe(1)
    expect(result.assets[0]!.slots[0]!.version).toMatchObject({ width: 1, height: 1 })
    expect(result.assets[1]!.model).not.toHaveProperty('width')
    expect(result.assets).toHaveLength(2)
    const personPath = result.assets[0]!.slots[0]!.version.path
    expect(personPath).toMatch(/^assets\/director-packages\//u)
    expect(existsSync(join(project, ...personPath.split('/')))).toBe(true)
    expect(existsSync(join(project, ...result.blenderManifestPath.split('/')))).toBe(true)
    const parsed = parseDirectorPackage(result.text)
    expect(parsed.ok && parsed.package.stagePlans[0]?.generationPrompt).toBe('Use the packaged shot prompt without rewriting it.')

    const manifest = await readFile(join(project, ...result.blenderManifestPath.split('/')), 'utf8')
    expect(manifest).toContain(personPath)
    expect(manifest).not.toContain(extracted)
    expect(manifest).not.toContain(project)
  })

  it('rejects a declared hash mismatch before writing any project assets', async () => {
    const { extracted, project } = await createExtractedPack({ wrongHash: true })
    await expect(importExtractedDirectorPack(project, extracted, '坏包.ailinpack', inspectImage)).rejects.toThrow(/SHA-256/u)
    expect(existsSync(join(project, 'assets', 'director-packages'))).toBe(false)
    expect(existsSync(join(project, 'generated', 'blender'))).toBe(false)
  })

  it('rejects archive traversal, absolute paths, backslashes, and unsupported payloads', () => {
    expect(() => validateDirectorPackArchiveEntry('../outside.png')).toThrow()
    expect(() => validateDirectorPackArchiveEntry('C:/outside.png')).toThrow()
    expect(() => validateDirectorPackArchiveEntry('assets\\outside.png')).toThrow()
    expect(() => validateDirectorPackArchiveEntry('assets/run.exe')).toThrow()
    expect(() => validateDirectorPackArchiveEntry('assets/person/front.png')).not.toThrow()
    expect(() => validateDirectorPackArchiveEntry('director.ailin.json')).not.toThrow()
  })

  it('does not write any project files when the second image cannot decode', async () => {
    const { extracted, project } = await createExtractedPack()
    const inspect = vi.fn().mockResolvedValueOnce({ width: 12, height: 20 })
      .mockRejectedValueOnce(new Error('无法解码图片'))
    await expect(importExtractedDirectorPack(project, extracted, '坏图.ailinpack', inspect)).rejects.toThrow('无法解码图片')
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(existsSync(join(project, 'assets'))).toBe(false)
    expect(existsSync(join(project, 'generated'))).toBe(false)
  })

  it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid decoded width %s before copying', async (width) => {
    const { extracted, project } = await createExtractedPack()
    await expect(importExtractedDirectorPack(project, extracted, '坏尺寸.ailinpack', async () => ({ width, height: 1 }))).rejects.toThrow('图片尺寸无效')
    expect(existsSync(join(project, 'assets'))).toBe(false)
  })

})
