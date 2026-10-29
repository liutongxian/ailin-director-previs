import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, cp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, serializeProject } from '../../src/engine/schema'
import { defaultGenerationInput } from '../../src/engine/production'
import { writeAtomic } from '../../src/main/atomic-file'
import { importProductionMedia, submitProductionAttempt, listProductionAttempts, updateProductionAttempt } from '../../src/main/production-storage'
import { createCloudVideoTask, queryCloudVideoTask } from '../../src/main/cloud-video-client'

vi.mock('../../src/main/cloud-video-client', () => ({
  createCloudVideoTask: vi.fn(), queryCloudVideoTask: vi.fn(), downloadCloudVideoResult: vi.fn(),
  redactCloudVideoError: (text: string, secrets: string[]) => secrets.reduce((value, secret) => value.split(secret).join('[REDACTED]'), text)
}))
let folder: string
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'director-production-')); vi.clearAllMocks() })
afterEach(async () => { await rm(folder, { recursive: true, force: true }) })
async function fixture() {
  await writeFile(join(folder, 'fixture.png'), Buffer.from('deterministic-media-fixture'))
  const media = await importProductionMedia(folder, join(folder, 'fixture.png'), async () => ({ width: 4, height: 4 }))
  const doc = createProject('测试')
  const shot = doc.scenes[0]!.shots[0]!
  doc.productionMedia = [media]
  shot.generationInput = { ...defaultGenerationInput(shot), prompt: '颜色测试', references: [{ mediaId: media.id, purpose: 'character' }] }
  await writeAtomic(join(folder, 'project.json'), serializeProject(doc))
  return { doc, shot, media }
}
describe('portable production storage', () => {
  it('copies media, preserves source, survives moving the project, and serializes overlapping saves', async () => {
    const { media } = await fixture()
    expect(await readFile(join(folder, media.path))).toEqual(await readFile(join(folder, 'fixture.png')))
    await cp(join(folder, 'media'), join(folder, 'moved/media'), { recursive: true })
    expect(await readFile(join(folder, 'moved', media.path))).toEqual(await readFile(join(folder, media.path)))
    await Promise.all([writeAtomic(join(folder, 'project.json'), '{"v":1}'), writeAtomic(join(folder, 'project.json'), '{"v":2}')])
    expect(JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'))).toEqual({ v: 2 })
  })
  it('stores the intent before submission and does not submit the same request twice', async () => {
    const { doc, shot } = await fixture()
    vi.mocked(createCloudVideoTask).mockImplementation(async () => {
      const journal = JSON.parse(await readFile(join(folder, '.production/tasks/request-1.json'), 'utf8'))
      expect(journal.status).toBe('submitting'); expect(JSON.stringify(journal)).not.toContain('test-secret')
      return { taskId: 'cloud-1', status: 'queued' }
    })
    const [a, b] = await Promise.all([submitProductionAttempt(folder, doc.id, shot.id, 'request-1', 'test-secret'), submitProductionAttempt(folder, doc.id, shot.id, 'request-1', 'test-secret')])
    expect(a.taskId).toBe('cloud-1'); expect(a).toEqual(b)
    await submitProductionAttempt(folder, doc.id, shot.id, 'request-1', 'test-secret')
    expect(createCloudVideoTask).toHaveBeenCalledTimes(1)
    expect((await listProductionAttempts(folder, doc.id))[0]!.taskId).toBe('cloud-1')
    await expect(submitProductionAttempt(folder, doc.id, shot.id, 'request-2', 'test-secret')).rejects.toThrow('未结束')
  })
  it('retains an uncertain outcome, redacts secrets, and recovers by task ID instead of resubmitting', async () => {
    const { doc, shot } = await fixture()
    vi.mocked(createCloudVideoTask).mockRejectedValue(new Error('network test-secret'))
    const result = await submitProductionAttempt(folder, doc.id, shot.id, 'request-1', 'test-secret')
    expect(result.status).toBe('unknown'); expect(result.error).not.toContain('test-secret')
    await updateProductionAttempt(folder, result.id, 'recover', 'test-secret', 'cloud-recovered')
    vi.mocked(queryCloudVideoTask).mockResolvedValue({ taskId: 'cloud-recovered', status: 'running' })
    expect((await updateProductionAttempt(folder, result.id, 'query', 'test-secret')).status).toBe('running')
    expect(createCloudVideoTask).toHaveBeenCalledTimes(1)
  })
  it('blocks altered files before network submission', async () => {
    const { doc, shot, media } = await fixture()
    await writeFile(join(folder, media.path), 'changed')
    await expect(submitProductionAttempt(folder, doc.id, shot.id, 'bad', 'test-secret')).rejects.toThrow('已改变')
    expect(createCloudVideoTask).not.toHaveBeenCalled()
  })
  it('recovers interrupted intent as unknown, and rejects path traversal task IDs', async () => {
    const { doc, shot } = await fixture()
    vi.mocked(createCloudVideoTask).mockResolvedValue({ taskId: 'cloud-1', status: 'queued' })
    const a = await submitProductionAttempt(folder, doc.id, shot.id, 'request-1', 'test-secret')
    a.status = 'submitting'; delete a.taskId
    await writeAtomic(join(folder, '.production/tasks/request-1.json'), JSON.stringify(a))
    expect((await listProductionAttempts(folder, doc.id))[0]!.status).toBe('unknown')
    expect(() => submitProductionAttempt(folder, doc.id, shot.id, '../escape', 'test-secret')).toThrow('ID无效')
  })
})
