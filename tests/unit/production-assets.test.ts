import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createProject, serializeProject } from '../../src/engine/schema'
import { assetDraftErrors, defaultAssetDraft } from '../../src/engine/production-assets'
import { generateProductionAsset, assetCreationJobs, dismissAssetCreation } from '../../src/main/production-assets'
import { applyProductionBreakdown } from '../../src/engine/production-storyboard'
let folder: string
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'director-asset-test-')) })
afterEach(async () => { vi.unstubAllGlobals(); await rm(folder, { recursive: true, force: true }) })
describe('asset generation persistence', () => {
  it('imports a local Qwen result without persisting its login or token', async () => {
    const doc = createProject('本地图片'); doc.productionAssetDraft = { ...defaultAssetDraft(), model: 'qwen-image-2.1-local', prompt: 'red umbrella' }
    await writeFile(join(folder, 'project.json'), serializeProject(doc))
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const p = new URL(url).pathname
      if (p.endsWith('/login')) return Response.json({ access_token: 'local-secret-token' })
      if (p.endsWith('/status')) return Response.json({ loaded: true, repo_id: 'unsloth/Qwen-Image-2.1-GGUF' })
      if (p.endsWith('/generate')) return Response.json({ images: [{ url: '/api/inference/images/gallery/q1/file' }] })
      return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    }))
    const job = await generateProductionAsset(folder, doc.id, 'qwen-1', 'local-secret-password', async () => ({ width: 768, height: 768 }))
    expect(job.status).toBe('complete'); expect(job.media?.path).toBe('media/qwen-1.png')
    expect(JSON.stringify(await assetCreationJobs(folder, doc.id))).not.toContain('local-secret-')
  })
  it('does not leave a blocking generation record when the local model is not loaded', async () => {
    const doc = createProject('本地图片'); doc.productionAssetDraft = { ...defaultAssetDraft(), model: 'qwen-image-2.1-local', prompt: 'red umbrella' }
    await writeFile(join(folder, 'project.json'), serializeProject(doc))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/login') ? { access_token: 'token' } : { loaded: false })))
    await expect(generateProductionAsset(folder, doc.id, 'qwen-2', 'password', async () => ({}))).rejects.toThrow('加载')
    expect(await assetCreationJobs(folder, doc.id)).toEqual([])
  })
  it('uses MiniMax image credentials and decodes its base64 response without exposing secrets', async () => {
    const doc = createProject('MiniMax图片测试'); doc.productionAssetDraft = { ...defaultAssetDraft(), model: 'image-01', prompt: '红色雨伞' }
    await writeFile(join(folder, 'project.json'), serializeProject(doc))
    vi.stubEnv('MINIMAX_API_KEY', 'minimax-test-secret'); vi.stubEnv('ARK_API_KEY', 'ark-test-secret')
    try {
      vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.minimax.cn/v1/image_generation')
        expect(init.headers).toMatchObject({ Authorization: 'Bearer minimax-test-secret' })
        expect(JSON.parse(String(init.body))).toMatchObject({ model: 'image-01', width: 2048, height: 2048, response_format: 'base64', n: 1 })
        return new Response(JSON.stringify({ base_resp: { status_code: 0 }, data: { image_base64: [Buffer.from('image-result').toString('base64')] } }))
      }))
      const job = await generateProductionAsset(folder, doc.id, 'minimax-image', undefined, async () => ({ width: 2048, height: 2048 }))
      expect(job.status).toBe('complete'); expect(job.media?.width).toBe(2048)
      expect(await readFile(join(folder, job.media!.path), 'utf8')).toBe('image-result')
      expect(JSON.stringify(await assetCreationJobs(folder, doc.id))).not.toContain('test-secret')
    } finally { vi.unstubAllEnvs() }
  })
  it('rejects unsupported MiniMax sizes and references before spending', () => {
    const draft = { ...defaultAssetDraft(), model: 'image-01', prompt: '雨伞' }
    expect(assetDraftErrors(draft)).toEqual([])
    expect(assetDraftErrors({ ...draft, size: '4K' })).toContain('MiniMax Image-01 当前使用 2048×2048 图片。')
    expect(assetDraftErrors({ ...draft, referenceIds: ['image'] })).toContain('MiniMax 当前提供文生图；使用参考图片请切换 Seedream。')
  })
  it('binds the explicit submission snapshot even if the editor has switched to another asset', async () => {
    const doc = createProject('关联测试')
    applyProductionBreakdown(doc, JSON.stringify({ spec: 'previs-ir', version: '1.0', assets: [{ id: 'cube', name: '测试方块', type: 'prop' }], shots: [{ id: 's1', entities: [{ refId: 'cube' }] }] }))
    const submitted = { ...defaultAssetDraft(), assetNeedId: doc.productionAssetPlan![0]!.id, prompt: '提交时的方块描述' }
    doc.productionAssetDraft = { ...defaultAssetDraft(), prompt: '编辑器当前的另一个描述' }
    await writeFile(join(folder, 'project.json'), serializeProject(doc))
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).prompt).toBe('提交时的方块描述')
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('fixture').toString('base64') }] }))
    }))
    const job = await generateProductionAsset(folder, doc.id, 'snapshot-1', 'fixture-key', async () => ({}), submitted)
    expect(job.input).toEqual(submitted)
    expect((await assetCreationJobs(folder, doc.id))[0]!.input.assetNeedId).toBe(submitted.assetNeedId)
  })
  it('records inputs before the mocked request, returns a project image and never duplicates an ID', async () => {
    const doc = createProject('素材测试'); doc.productionAssetDraft = { ...defaultAssetDraft(), prompt: '单色测试图' }
    await writeFile(join(folder, 'project.json'), serializeProject(doc))
    const fake = vi.fn(async (_url: string, init: RequestInit) => {
      const intent = JSON.parse(await readFile(join(folder, '.production/asset-jobs/job-1.json'), 'utf8'))
      expect(intent.status).toBe('submitting'); expect(JSON.stringify(intent)).not.toContain('test-secret')
      expect(JSON.parse(String(init.body))).toMatchObject({ prompt: '单色测试图', response_format: 'b64_json', sequential_image_generation: 'disabled' })
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('fake-fixture-image').toString('base64') }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fake)
    const probe = async () => ({ width: 640, height: 360 })
    const result = await generateProductionAsset(folder, doc.id, 'job-1', 'test-secret', probe)
    expect(result.status).toBe('complete'); expect(result.media?.path).toBe('media/job-1.jpg')
    expect(await readFile(join(folder, result.media!.path), 'utf8')).toBe('fake-fixture-image')
    await generateProductionAsset(folder, doc.id, 'job-1', 'test-secret', probe)
    expect(fake).toHaveBeenCalledTimes(1)
    expect((await assetCreationJobs(folder, doc.id))[0]!.media?.sha256).toHaveLength(64)
  })
  it('blocks duplicate spending after a lost response and allows explicitly dismissing a checked task', async () => {
    const doc = createProject('素材测试'); doc.productionAssetDraft = { ...defaultAssetDraft(), prompt: '单色测试图' }
    await writeFile(join(folder, 'project.json'), serializeProject(doc))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network test-secret')))
    const result = await generateProductionAsset(folder, doc.id, 'job-1', 'test-secret', async () => ({}))
    expect(result.status).toBe('unknown'); expect(result.error).not.toContain('test-secret')
    await expect(generateProductionAsset(folder, doc.id, 'job-2', 'test-secret', async () => ({}))).rejects.toThrow('未结束')
    await dismissAssetCreation(folder, 'job-1')
    expect((await assetCreationJobs(folder, doc.id))[0]!.status).toBe('dismissed')
  })
})
