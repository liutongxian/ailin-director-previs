import { describe, it, expect } from 'vitest'
import { createProject, createShot, parseProject, serializeProject } from '../../src/engine/schema'
import { applyProductionBreakdown } from '../../src/engine/production-storyboard'
import { receiveAssetJobs, selectAssetMedia, syncProductionAssetPlan, syncAssetReferences, validateAssetPlan } from '../../src/engine/production-asset-plan'
import { defaultAssetDraft, type AssetCreationJob } from '../../src/engine/production-assets'
import { defaultGenerationInput, type ProductionMedia } from '../../src/engine/production'
import type { PrevisIR } from '../../src/engine/previs-ir'

function fixture(): PrevisIR {
  return { spec: 'previs-ir', version: '1.0', assets: [
    { id: 'a', name: '测试人物A', type: 'character', visualDescription: '灰色测试服装。', imagePrompt: '测试人物A全身设定，灰衣。' },
    { id: 'b', name: '测试方块', type: 'prop', visualDescription: '蓝色立方体。' },
    { id: 'unused', name: '未入镜道具', type: 'prop' }
  ], locations: [{ id: 'room', name: '测试空间', visualDescription: '白色空房间。' }], shots: [
    { id: 's1', name: '测试镜头一', sourceText: '人物A站在测试空间中。', locationId: 'room', duration: 4, entities: [{ refId: 'a' }] },
    { id: 's2', name: '测试镜头二', sourceText: '人物A和蓝色方块。', locationId: 'room', duration: 5, entities: [{ refId: 'a' }, { refId: 'b' }] }
  ] }
}
const image = (id: string): ProductionMedia => ({ id, name: `${id}.png`, kind: 'image', path: `media/${id}.png`, sha256: 'a'.repeat(64), sizeBytes: 100, createdAt: '2026-10-27' })
function project() { const doc = createProject('软件测试'); applyProductionBreakdown(doc, JSON.stringify(fixture())); return doc }

describe('storyboard asset workflow', () => {
  it('deduplicates used identities and locations and maps exact shot IDs, with usable prompt drafts', () => {
    const doc = project()
    expect(doc.scenes.flatMap((scene) => scene.shots)).toHaveLength(2)
    expect(doc.scenes.every((scene) => scene.entities.length > 0)).toBe(true)
    expect(doc.productionAssetPlan).toHaveLength(3)
    const [person, prop, room] = doc.productionAssetPlan!
    expect(person!.shotIds).toHaveLength(2)
    expect(person!.prompt).toContain('灰衣')
    expect(prop!.shotIds).toEqual([doc.scenes[1]!.shots[0]!.id])
    expect(prop!.prompt).toContain('蓝色立方体')
    expect(room!.kind).toBe('scene')
    expect(room!.shotIds).toHaveLength(2)
  })
  it('preserves manually edited prompts, names, shot text and selection across repeated breakdown', () => {
    const doc = project(), person = doc.productionAssetPlan![0]!, first = doc.scenes[0]!.shots[0]!
    const ids = doc.scenes.flatMap((scene) => scene.shots).map((shot) => shot.id)
    person.prompt = '我修改过的提示词'; person.name = '我命名的人物'; first.storyboard!.content = '我的镜头修改'
    doc.productionMedia = [image('v1')]; selectAssetMedia(doc, person.id, 'v1')
    const ir = fixture(); ir.assets[0]!.imagePrompt = '新的建议提示词'
    applyProductionBreakdown(doc, JSON.stringify(ir))
    expect(doc.scenes.flatMap((scene) => scene.shots).map((shot) => shot.id)).toEqual(ids)
    expect(doc.productionAssetPlan![0]).toMatchObject({ id: person.id, prompt: '我修改过的提示词', name: '我命名的人物', selectedMediaId: 'v1' })
    expect(doc.productionAssetPlan![0]!.generatedPrompt).toContain('新的建议提示词')
    expect(first.storyboard!.content).toBe('我的镜头修改')
    expect(first.generationInput!.references).toHaveLength(1)
  })
  it('remaps assets after legacy shot rebuild and keeps manual references and historical input immutable', () => {
    const doc = project(), person = doc.productionAssetPlan![0]!, first = doc.scenes[0]!.shots[0]!
    doc.productionMedia = [image('v1'), image('manual'), image('v2')]
    first.generationInput = { ...defaultGenerationInput(first), references: [{ mediaId: 'manual', purpose: 'style' }] }
    selectAssetMedia(doc, person.id, 'v1')
    first.productionAttempts = [{ id: 'task', projectId: doc.id, shotId: first.id, status: 'complete', createdAt: 'x', updatedAt: 'x', snapshot: { input: structuredClone(first.generationInput), media: [image('manual'), image('v1')] } }]
    const history = JSON.stringify(first.productionAttempts)
    selectAssetMedia(doc, person.id, 'v2')
    expect(first.generationInput.references.map((ref) => ref.mediaId)).toEqual(['manual', 'v2'])
    expect(JSON.stringify(first.productionAttempts)).toBe(history)
    const replacement = createShot(doc.scenes[1]!, '重建镜头'); replacement.storyboard = { sourceShotId: 's2', content: '技术镜头' }
    doc.scenes[1]!.shots[0] = replacement
    syncProductionAssetPlan(doc)
    expect(doc.productionAssetPlan![0]!.shotIds).toContain(replacement.id)
    expect(replacement.generationInput?.references[0]?.mediaId).toBe('v2')
  })
  it('keeps manually excluded shots excluded when updating the checklist and prunes deleted shots', () => {
    const doc = project(), person = doc.productionAssetPlan![0]!, firstId = person.shotIds[0]!
    person.shotIds = person.shotIds.filter((id) => id !== firstId)
    syncProductionAssetPlan(doc)
    expect(doc.productionAssetPlan![0]!.shotIds).not.toContain(firstId)
    doc.scenes.pop(); syncProductionAssetPlan(doc)
    expect(doc.productionAssetPlan![0]!.shotIds).toEqual([])
  })
  it('retains removed assets and images, while clearing their obsolete automatic links', () => {
    const doc = project(), prop = doc.productionAssetPlan![1]!
    doc.productionMedia = [image('prop')]; selectAssetMedia(doc, prop.id, 'prop')
    const ir = fixture(); ir.shots[1]!.entities = [{ refId: 'a' }]
    doc.previsIR!.text = JSON.stringify(ir); syncProductionAssetPlan(doc)
    expect(doc.productionAssetPlan!.find((item) => item.id === prop.id)).toMatchObject({ shotIds: [], mediaIds: ['prop'], selectedMediaId: 'prop' })
    expect(doc.scenes[1]!.shots[0]!.generationInput!.references).toEqual([])
    expect(doc.productionMedia).toHaveLength(1)
  })
  it('receives delayed results for the original asset, selects only the first, and recovers idempotently', () => {
    const doc = project(), person = doc.productionAssetPlan![0]!, prop = doc.productionAssetPlan![1]!
    const receipt = (id: string): AssetCreationJob => ({ id, projectId: doc.id, status: 'complete', createdAt: '2026-10-27', references: [], input: { ...defaultAssetDraft(), assetNeedId: person.id, prompt: '当时的提示词' }, media: image(id) })
    doc.productionAssetDraft = { ...defaultAssetDraft(), assetNeedId: prop.id, prompt: '已切换到另一个资产' }
    receiveAssetJobs(doc, [receipt('v1'), receipt('v2')]); receiveAssetJobs(doc, [receipt('v1')])
    expect(person.mediaIds).toEqual(['v1', 'v2']); expect(person.selectedMediaId).toBe('v1')
    expect(prop.mediaIds).toEqual([]); expect(doc.productionMedia).toHaveLength(2)
    expect(doc.scenes.flatMap((scene) => scene.shots).every((shot) => shot.generationInput?.references.some((ref) => ref.mediaId === 'v1'))).toBe(true)
    const reopened = parseProject(serializeProject(doc)).doc!
    expect(reopened.productionAssetPlan).toEqual(doc.productionAssetPlan)
    expect(reopened.scenes[0]!.shots[0]!.generationInput?.references[0]?.assetNeedId).toBe(person.id)
  })
  it('does not attach another project receipt or accept a video as an asset image', () => {
    const doc = project()
    receiveAssetJobs(doc, [{ id: 'other', projectId: 'different', status: 'complete', createdAt: '', input: defaultAssetDraft(), references: [], media: image('other') }])
    expect(doc.productionMedia).toBeUndefined()
    doc.productionMedia = [{ ...image('video'), kind: 'video' }]
    expect(() => selectAssetMedia(doc, doc.productionAssetPlan![0]!.id, 'video')).toThrow('图片')
    syncAssetReferences(doc)
  })
  it('rejects malformed new fields and keeps older projects valid', () => {
    const doc = createProject('旧项目')
    expect(parseProject(serializeProject(doc)).doc).not.toBeNull()
    expect(validateAssetPlan([{ id: 'bad' }])).toBe(false)
    const ir = fixture(); ir.assets[0]!.imagePrompt = 2 as unknown as string
    expect(() => applyProductionBreakdown(doc, JSON.stringify(ir))).toThrow('imagePrompt')
    const duplicates = fixture(); duplicates.shots[1]!.id = 's1'
    expect(() => applyProductionBreakdown(doc, JSON.stringify(duplicates))).toThrow('镜头ID重复')
  })
})
