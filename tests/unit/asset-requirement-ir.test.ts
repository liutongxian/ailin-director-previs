import { describe, expect, it } from 'vitest'
import {
  knownShotIdsForAssetRequirements,
  parseAssetRequirementIR,
  validateAssetRequirementIR,
  type AssetRequirementIR
} from '@engine/asset-requirement-ir'
import { createProject } from '@engine/schema'

function validIR(): AssetRequirementIR {
  return {
    spec: 'asset-requirement-ir',
    version: '1.0',
    project: { name: '测试短剧', source: '完整剧本' },
    assets: [{
      id: 'CHAR-HERO',
      name: '主角',
      type: 'character',
      aliases: ['她'],
      importance: 'principal',
      description: '成年女性调查员',
      semanticType: 'adult woman',
      firstAppearance: 'E01-S001',
      appearances: ['E01-S001', 'E01-S002'],
      states: [{
        id: 'CHAR-HERO-NORMAL',
        name: '常态',
        description: '深色外套，未受伤',
        appliesTo: ['E01-S001:E01-S002'],
        requiredSlots: [{
          id: 'identity-front',
          label: '正面身份',
          type: 'identity',
          view: 'front',
          required: true
        }]
      }],
      whiteModelHint: {
        semanticType: 'adult woman',
        approximateHeightMeters: 1.67
      }
    }],
    unresolved: []
  }
}

describe('Asset Requirement IR 1.0', () => {
  it('parses a valid external-agent response locally', () => {
    const parsed = parseAssetRequirementIR(JSON.stringify(validIR()), {
      knownShotIds: ['E01-S001', 'E01-S002']
    })

    expect(parsed.valid).toBe(true)
    expect(parsed.errors).toEqual([])
    expect(parsed.ir?.assets[0]?.states[0]?.requiredSlots[0]?.view).toBe('front')
  })

  it('rejects duplicate asset, state and slot ids with exact paths', () => {
    const ir = validIR()
    ir.assets.push(structuredClone(ir.assets[0]!))
    ir.assets[0]!.states.push(structuredClone(ir.assets[0]!.states[0]!))
    ir.assets[0]!.states[0]!.requiredSlots.push(
      structuredClone(ir.assets[0]!.states[0]!.requiredSlots[0]!)
    )

    const result = validateAssetRequirementIR(ir)

    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('assets[1].id') && error.includes('重复'))).toBe(true)
    expect(result.errors.some((error) => error.includes('assets[0].states[1].id') && error.includes('重复'))).toBe(true)
    expect(result.errors.some((error) => error.includes('requiredSlots[1].id') && error.includes('重复'))).toBe(true)
  })

  it('rejects unknown slot types and fields that could smuggle file paths', () => {
    const value = validIR() as unknown as Record<string, unknown>
    const asset = (value.assets as Array<Record<string, unknown>>)[0]!
    const state = (asset.states as Array<Record<string, unknown>>)[0]!
    const slot = (state.requiredSlots as Array<Record<string, unknown>>)[0]!
    slot.type = 'face_magic'
    slot.filePath = 'C:\\Users\\someone\\hero.png'

    const result = validateAssetRequirementIR(value)

    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('requiredSlots/0/type'))).toBe(true)
    expect(result.errors.some((error) => error.includes('filePath'))).toBe(true)
  })

  it('checks appearances and appliesTo ranges against known shots', () => {
    const ir = validIR()
    ir.assets[0]!.appearances!.push('E01-S099')
    ir.assets[0]!.states[0]!.appliesTo = ['E01-S001:E01-S099']

    const result = validateAssetRequirementIR(ir, {
      knownShotIds: ['E01-S001', 'E01-S002']
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('appearances[2]') && error.includes('E01-S099'))).toBe(true)
    expect(result.errors.some((error) => error.includes('appliesTo[0]') && error.includes('E01-S099'))).toBe(true)
  })

  it('can warn instead of blocking when a whole-series asset IR arrives before all shots', () => {
    const ir = validIR()
    const result = validateAssetRequirementIR(ir, {
      knownShotIds: ['E01-S001'],
      unknownShotReferences: 'warning'
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((warning) => warning.includes('E01-S002'))).toBe(true)
  })

  it('accepts stable external Previs IR shot ids preserved on project shots', () => {
    const doc = createProject('跨IR关联')
    doc.scenes[0]!.shots[0]!.storyboard = { content: '第二十四镜', sourceShotId: 'E01-S024' }
    const ir = validIR()
    ir.assets[0]!.firstAppearance = 'E01-S024'
    ir.assets[0]!.appearances = ['E01-S024']
    ir.assets[0]!.states[0]!.appliesTo = ['E01-S024']

    const result = validateAssetRequirementIR(ir, {
      knownShotIds: knownShotIdsForAssetRequirements(doc.scenes)
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('keeps unresolved questions visible instead of guessing answers', () => {
    const ir = validIR()
    ir.unresolved = [{
      field: 'assets[0].states',
      reason: '剧本没有说明第二故事日是否更换服装'
    }]

    const result = validateAssetRequirementIR(ir)

    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([
      'unresolved[0] assets[0].states：剧本没有说明第二故事日是否更换服装'
    ])
  })
})
