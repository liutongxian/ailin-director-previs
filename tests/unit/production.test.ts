import { describe, expect, it } from 'vitest'
import { createProject, createShot, parseProject, serializeProject } from '../../src/engine/schema'
import { captureGenerationInput, defaultGenerationInput, generationProblems, generationRequest, mergeProductionAttempts, selectedProductionClips, scriptParagraphs, type ProductionAttempt, type ProductionMedia } from '../../src/engine/production'

const media: ProductionMedia = { id: 'image-1', name: '人物.png', kind: 'image', path: 'media/person.png', sha256: 'a'.repeat(64), sizeBytes: 100, createdAt: '2026-10-26T00:00:00Z' }
function fixture() {
  const doc = createProject('软件测试')
  const shot = doc.scenes[0]!.shots[0]!
  shot.generationInput = { ...defaultGenerationInput(shot), prompt: '固定构图的测试画面', references: [{ mediaId: media.id, purpose: 'character' }] }
  doc.productionMedia = [structuredClone(media)]
  return { doc, shot }
}
describe('production project', () => {
  it('round trips existing projects and new portable inputs without changing old scenes', () => {
    const old = createProject('旧项目')
    expect(parseProject(serializeProject(old)).doc).toEqual(old)
    const { doc } = fixture()
    expect(parseProject(serializeProject(doc)).doc).toEqual(doc)
  })
  it('rejects malformed additions and paths outside the project', () => {
    for (const path of ['../outside.png', 'E:/photo.png', '/etc/passwd']) {
      const { doc } = fixture(); doc.productionMedia![0]!.path = path
      expect(parseProject(JSON.stringify(doc)).doc).toBeNull()
    }
    const { doc } = fixture(); (doc as unknown as Record<string, unknown>).productionMedia = [null]
    expect(parseProject(JSON.stringify(doc)).doc).toBeNull()
  })
  it('freezes actual file versions and input without changing another shot', () => {
    const { doc, shot } = fixture()
    const second = createShot(doc.scenes[0]!, '第二镜'); doc.scenes[0]!.shots.push(second)
    const snapshot = captureGenerationInput(doc, shot)
    shot.generationInput!.prompt = '修改后的描述'; doc.productionMedia![0]!.sha256 = 'b'.repeat(64)
    expect(snapshot.input.prompt).toBe('固定构图的测试画面')
    expect(snapshot.media[0]!.sha256).toBe('a'.repeat(64))
    expect(second.generationInput).toBeUndefined()
    expect(generationRequest(snapshot).references[0]!.value).toBe('media/person.png')
    expect(generationRequest(snapshot).prompt).toContain('人物参考')
  })
  it('shows missing assets and invalid first frame combinations instead of dropping them', () => {
    const { doc, shot } = fixture()
    shot.generationInput!.references.push({ mediaId: 'missing', purpose: 'camera' })
    expect(generationProblems(doc, shot).join()).toContain('不存在')
    shot.generationInput!.references = [{ mediaId: media.id, purpose: 'last-frame' }]
    expect(generationProblems(doc, shot).join()).toContain('首帧')
  })
  it('recovers append-only candidates and exports the explicitly adopted version', () => {
    const { doc, shot } = fixture()
    const a: ProductionAttempt = { id: 'a', projectId: doc.id, shotId: shot.id, createdAt: '2026-10-26', updatedAt: '2026-10-26', status: 'complete', snapshot: captureGenerationInput(doc, shot), localPath: 'generated/a.mp4' }
    const b = { ...a, id: 'b', localPath: 'generated/b.mp4' }
    mergeProductionAttempts(doc, [a, b, a, { ...a, id: 'foreign', projectId: 'other' }])
    expect(shot.productionAttempts).toHaveLength(2)
    expect(() => selectedProductionClips(doc)).toThrow('尚未采用')
    shot.selectedProductionAttemptId = 'b'
    expect(selectedProductionClips(doc)[0]!.relativePath).toBe('generated/b.mp4')
    expect(parseProject(serializeProject(doc)).doc?.scenes[0]!.shots[0]!.productionAttempts).toHaveLength(2)
  })
  it('splits paragraphs without pretending line wraps are separate shots', () => {
    expect(scriptParagraphs('第一段\r\n继续第一段\r\n\r\n第二段')).toEqual(['第一段\n继续第一段', '第二段'])
  })
})
