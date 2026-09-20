import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AILIN_DIRECTOR_PACKAGE_TEMPLATE,
  AILIN_DIRECTOR_PACKAGE_ASSET_BINDINGS_EXAMPLE,
  AILIN_DIRECTOR_PACKAGE_SCHEMA,
  DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS,
  directorPackageToStoryboardCards,
  parseDirectorPackage
} from '@engine/director-package'

describe('Ai Lin Director Package 1.0', () => {
  it('keeps the public import sample valid and buildable', () => {
    const sample = readFileSync(resolve('examples/双人调度.ailin.json'), 'utf8')
    const parsed = parseDirectorPackage(sample)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const cards = directorPackageToStoryboardCards(parsed.package)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.plan.entities.filter((entity) => entity.name === '人物A' || entity.name === '人物B')).toHaveLength(2)
    expect(cards[0]?.plan.camera.marks).toHaveLength(2)
  })

  it('parses the complete example and preserves exact staging separately from Previs IR', () => {
    const parsed = parseDirectorPackage(AILIN_DIRECTOR_PACKAGE_TEMPLATE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.package.spec).toBe('ailin-director-package')
    expect(parsed.package.previsIR.spec).toBe('previs-ir')
    expect(parsed.package.source?.text).toContain('人物A从画面左侧外进入')

    const cards = directorPackageToStoryboardCards(parsed.package)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.engine).toBe('director-package')
    expect(cards[0]?.sourceShotId).toBe('SHOT-001')
    expect(cards[0]?.plan.entities.find((entity) => entity.name === '人物A')?.position).toEqual({ x: -1.4, y: 0, z: 0.2 })
    expect(cards[0]?.plan.entities.find((entity) => entity.name === '人物A')?.marks).toHaveLength(3)
    expect(cards[0]?.plan.camera.marks).toHaveLength(3)
    expect(cards[0]?.plan.camera.marks[2]?.position).toEqual({ x: -4.8, y: 2.3, z: 8.2 })
  })

  it('rejects stage entities that do not exist in the embedded Previs IR', () => {
    const raw = JSON.parse(AILIN_DIRECTOR_PACKAGE_TEMPLATE) as Record<string, unknown>
    const stagePlans = raw.stagePlans as Array<Record<string, unknown>>
    const entities = stagePlans[0]!.entities as Array<Record<string, unknown>>
    entities[0]!.refId = 'CHAR-NOT-IN-IR'

    const parsed = parseDirectorPackage(JSON.stringify(raw))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.validation.errors.join('\n')).toContain('CHAR-NOT-IN-IR')
  })

  it('rejects non-monotonic marks and times outside the shot duration', () => {
    const raw = JSON.parse(AILIN_DIRECTOR_PACKAGE_TEMPLATE) as Record<string, unknown>
    const stagePlans = raw.stagePlans as Array<Record<string, unknown>>
    const entities = stagePlans[0]!.entities as Array<Record<string, unknown>>
    const marks = entities[0]!.marks as Array<Record<string, unknown>>
    marks[1]!.time = 9
    marks[2]!.time = 2

    const parsed = parseDirectorPackage(JSON.stringify(raw))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.validation.errors.join('\n')).toMatch(/单调|时长/u)
  })

  it('provides an external-Agent prompt that forbids story changes and explanation outside JSON', () => {
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('不得修改剧情事实')
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('只输出一个 JSON 对象')
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('basis')
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('confidence')
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('.ailinpack')
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('assetBindings')
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('relativePath')
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('不得写入绝对路径')
    expect(DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS).toContain('导入后成为项目参考素材')
    expect(AILIN_DIRECTOR_PACKAGE_SCHEMA.properties).toHaveProperty('assetBindings')
    expect(AILIN_DIRECTOR_PACKAGE_ASSET_BINDINGS_EXAMPLE).toContain('assets/characters/person-a/front.png')
  })

  it('parses portable asset bindings for a Previs entity and location', () => {
    const raw = JSON.parse(AILIN_DIRECTOR_PACKAGE_TEMPLATE) as Record<string, unknown>
    const previs = raw.previsIR as Record<string, any>
    raw.assetBindings = [
      {
        targetRefId: previs.assets[0].id,
        assetId: 'CHAR-PERSON-A',
        kind: 'character',
        stateId: 'CHAR-PERSON-A-DAY1',
        stateName: '第一日',
        slots: [{
          slotId: 'identity-front', label: '正面身份照', type: 'identity', view: 'front', required: true,
          relativePath: 'assets/characters/person-a/front.png',
          sha256: 'a'.repeat(64)
        }]
      },
      {
        targetRefId: previs.locations[0].id,
        assetId: 'SCENE-ROOM-A',
        kind: 'scene',
        stateId: 'SCENE-ROOM-A-DAY',
        stateName: '日景',
        slots: [{
          slotId: 'camera-wide', label: '广角场景图', type: 'camera_view', view: 'wide', required: true,
          relativePath: 'assets/scenes/room-a/wide.webp'
        }],
        model: { relativePath: 'models/room-a.glb', sha256: 'b'.repeat(64) }
      }
    ]

    const parsed = parseDirectorPackage(JSON.stringify(raw))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const bindings = (parsed.package as any).assetBindings
    expect(bindings).toHaveLength(2)
    expect(bindings[0].slots[0].relativePath).toBe('assets/characters/person-a/front.png')
    expect(bindings[1].model.relativePath).toBe('models/room-a.glb')
  })

  it('keeps the existing director package shape and accepts one generation prompt per stage plan', () => {
    const raw = JSON.parse(AILIN_DIRECTOR_PACKAGE_TEMPLATE) as Record<string, any>
    raw.stagePlans[0].generationPrompt = '人物A进入房间，保持既有站位、走位、摄影机和场景连续。'

    const parsed = parseDirectorPackage(JSON.stringify(raw))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.package.stagePlans[0]?.generationPrompt).toBe('人物A进入房间，保持既有站位、走位、摄影机和场景连续。')
    expect('deliveryPlan' in parsed.package).toBe(false)
  })

  it('rejects a non-string generation prompt without changing stage-plan validation', () => {
    const raw = JSON.parse(AILIN_DIRECTOR_PACKAGE_TEMPLATE) as Record<string, any>
    raw.stagePlans[0].generationPrompt = { invalid: true }

    const parsed = parseDirectorPackage(JSON.stringify(raw))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.validation.errors.join('\n')).toMatch(/generationPrompt/u)
  })

  it('rejects asset bindings with missing targets, duplicate targets, or unsafe paths', () => {
    const raw = JSON.parse(AILIN_DIRECTOR_PACKAGE_TEMPLATE) as Record<string, unknown>
    const previs = raw.previsIR as Record<string, any>
    raw.assetBindings = [
      {
        targetRefId: previs.assets[0].id,
        assetId: 'CHAR-PERSON-A', kind: 'character', stateId: 'DAY1', stateName: '第一日',
        slots: [{ slotId: 'front', label: '正面', type: 'identity', view: 'front', required: true, relativePath: '../outside.png' }]
      },
      {
        targetRefId: previs.assets[0].id,
        assetId: 'CHAR-DUPLICATE', kind: 'character', stateId: 'DAY1', stateName: '第一日', slots: []
      },
      {
        targetRefId: 'NOT-IN-PREVIS',
        assetId: 'PROP-MISSING', kind: 'prop', stateId: 'DEFAULT', stateName: '默认', slots: []
      }
    ]

    const parsed = parseDirectorPackage(JSON.stringify(raw))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.validation.errors.join('\n')).toMatch(/\.\.|重复|NOT-IN-PREVIS/u)
  })

})
