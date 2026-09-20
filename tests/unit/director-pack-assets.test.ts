import { describe, expect, it } from 'vitest'
import { AILIN_DIRECTOR_PACKAGE_TEMPLATE, directorPackageToStoryboardCards, parseDirectorPackage } from '@engine/director-package'
import { mergeDirectorPackAssets } from '@engine/director-pack-assets'
import { buildStoryboardScenes } from '@engine/director'
import type { ImportedDirectorPackAsset } from '../../src/shared/director-pack'

function packageWithBindings() {
  const raw = JSON.parse(AILIN_DIRECTOR_PACKAGE_TEMPLATE) as Record<string, any>
  const personId = raw.previsIR.assets[0].id as string
  const locationId = raw.previsIR.locations[0].id as string
  raw.assetBindings = [
    {
      targetRefId: personId, assetId: 'CHAR-PERSON-A', kind: 'character',
      stateId: 'CHAR-PERSON-A-DAY1', stateName: '第一日', appliesTo: ['SHOT-001'],
      slots: [
        { slotId: 'front', label: '正面', type: 'identity', view: 'front', required: true, relativePath: 'assets/person/front.png' },
        { slotId: 'profile', label: '左侧面', type: 'identity', view: 'left_profile', required: true, relativePath: 'assets/person/profile.png' }
      ]
    },
    {
      targetRefId: locationId, assetId: 'SCENE-ROOM-A', kind: 'scene',
      stateId: 'SCENE-ROOM-A-DAY', stateName: '日景', appliesTo: ['SHOT-001'],
      slots: [{ slotId: 'wide', label: '广角', type: 'camera_view', view: 'wide', required: true, relativePath: 'assets/room/wide.png' }]
    }
  ]
  const parsed = parseDirectorPackage(JSON.stringify(raw))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.package
}

const imported: ImportedDirectorPackAsset[] = [
  {
    targetRefId: 'CHAR-A', assetId: 'CHAR-PERSON-A', kind: 'character', stateId: 'CHAR-PERSON-A-DAY1', stateName: '第一日', appliesTo: ['SHOT-001'],
    slots: [
      {
        slotId: 'front', label: '正面', type: 'identity', view: 'front', required: true,
        version: { id: 'sha-aaa', path: 'assets/director-packages/pkg/assets/person/front.png', sha256: 'a'.repeat(64), sizeBytes: 10, sourceName: 'front.png' }
      },
      {
        slotId: 'profile', label: '左侧面', type: 'identity', view: 'left_profile', required: true,
        version: { id: 'sha-bbb', path: 'assets/director-packages/pkg/assets/person/profile.png', sha256: 'b'.repeat(64), sizeBytes: 11, sourceName: 'profile.png' }
      }
    ]
  },
  {
    targetRefId: 'LOC-A', assetId: 'SCENE-ROOM-A', kind: 'scene', stateId: 'SCENE-ROOM-A-DAY', stateName: '日景', appliesTo: ['SHOT-001'],
    slots: [{
      slotId: 'wide', label: '广角', type: 'camera_view', view: 'wide', required: true,
      version: { id: 'sha-ccc', path: 'assets/director-packages/pkg/assets/room/wide.png', sha256: 'c'.repeat(64), sizeBytes: 12, sourceName: 'wide.png' }
    }]
  }
]

describe('director pack assets', () => {
  it('fills missing same-hash dimensions without replacing locked version data or mutating the input', () => {
    const pkg = packageWithBindings()
    const original = mergeDirectorPackAssets([], pkg, imported)
    original[0]!.status = 'locked'
    const before = structuredClone(original)
    const measured = structuredClone(imported)
    measured[0]!.slots[0]!.version.width = 768
    measured[0]!.slots[0]!.version.height = 1344
    const result = mergeDirectorPackAssets(original, pkg, measured)
    const slot = result[0]!.states![0]!.slots[0]!
    expect(slot.currentVersionId).toBe(before[0]!.states![0]!.slots[0]!.currentVersionId)
    expect(slot.versions).toHaveLength(1)
    expect(slot.versions[0]).toEqual({ ...before[0]!.states![0]!.slots[0]!.versions[0], width: 768, height: 1344 })
    expect(result[0]!.status).toBe('locked')
    expect(original).toEqual(before)
  })
  it('puts imported files directly into current asset-center slots and marks complete assets ready', () => {
    const pkg = packageWithBindings()
    const assets = mergeDirectorPackAssets([], pkg, imported)
    const person = assets.find((asset) => asset.id === 'CHAR-PERSON-A')!
    expect(person.name).toBe('人物A')
    expect(person.status).toBe('ready')
    expect(person.states?.[0]?.slots[0]?.currentVersionId).toBe('sha-aaa')
    expect(person.states?.[0]?.slots[0]?.versions[0]?.path).toContain('front.png')
    expect(assets.find((asset) => asset.id === 'SCENE-ROOM-A')?.status).toBe('ready')
  })

  it('does not duplicate an identical hash and appends a changed version as the current image', () => {
    const pkg = packageWithBindings()
    const first = mergeDirectorPackAssets([], pkg, imported)
    const repeated = mergeDirectorPackAssets(first, pkg, imported)
    expect(repeated[0]?.states?.[0]?.slots[0]?.versions).toHaveLength(1)

    const changed = structuredClone(imported)
    changed[0]!.slots[0]!.version = {
      ...changed[0]!.slots[0]!.version,
      id: 'sha-new', sha256: 'd'.repeat(64), path: 'assets/director-packages/pkg2/assets/person/front.png'
    }
    const updated = mergeDirectorPackAssets(repeated, pkg, changed)
    const slot = updated.find((asset) => asset.id === 'CHAR-PERSON-A')!.states![0]!.slots[0]!
    expect(slot.versions).toHaveLength(2)
    expect(slot.currentVersionId).toBe('sha-new')
  })

  it('marks an asset partial when a required package slot was not imported', () => {
    const pkg = packageWithBindings()
    const partial = structuredClone(imported)
    partial[0]!.slots = partial[0]!.slots.slice(0, 1)
    const assets = mergeDirectorPackAssets([], pkg, partial)
    expect(assets.find((asset) => asset.id === 'CHAR-PERSON-A')?.status).toBe('partial')
  })

  it('binds generated people to production assets and the generated scene to its scene asset', () => {
    const pkg = packageWithBindings()
    const cards = directorPackageToStoryboardCards(pkg)
    const scenes = buildStoryboardScenes(cards, 'director-package')
    const person = scenes[0]!.entities.find((entity) => entity.name === '人物A')
    expect(person?.referenceAssetId).toBe('CHAR-PERSON-A')
    expect(scenes[0]!.referenceAssetId).toBe('SCENE-ROOM-A')
  })
})
