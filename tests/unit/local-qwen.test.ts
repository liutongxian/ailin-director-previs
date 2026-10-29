import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectLocalQwen, generateLocalQwen, localQwenOrigin, localQwenStatus } from '../../src/main/local-qwen'
import { assetDraftErrors, DEFAULT_LOCAL_QWEN, defaultAssetDraft } from '../../src/engine/production-assets'
import { createProject, parseProject, serializeProject } from '../../src/engine/schema'

afterEach(() => vi.unstubAllGlobals())
const draft = { ...defaultAssetDraft(), model: 'qwen-image-2.1-local', prompt: 'a red umbrella', localQwen: DEFAULT_LOCAL_QWEN }
describe('local Qwen adapter', () => {
  it('authenticates against Studio, sends references in order, downloads from the same gallery', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const fetcher = vi.fn(async (url: string | URL, init: RequestInit) => {
      const path = new URL(url).pathname
      if (path === '/api/auth/login') { expect(JSON.parse(String(init.body))).toEqual({ username: 'unsloth', password: 'local-test-password' }); return Response.json({ access_token: 'local-test-token' }) }
      expect(init.headers).toMatchObject({ Authorization: 'Bearer local-test-token' })
      if (path.endsWith('/status')) return Response.json({ loaded: true, repo_id: 'unsloth/Qwen-Image-2.1-GGUF' })
      if (path.endsWith('/generate')) { expect(JSON.parse(String(init.body))).toMatchObject({ workflow: 'reference', init_image: 'data:first', reference_images: ['data:second'], reference_resolution: 512, width: 768, height: 768, steps: 24, guidance: 4, batch_size: 1 }); return Response.json({ images: [{ url: '/api/inference/images/gallery/img-1/file', model: 'unsloth/Qwen-Image-2.1-GGUF' }] }) }
      return new Response(png)
    })
    vi.stubGlobal('fetch', fetcher)
    const session = await connectLocalQwen(DEFAULT_LOCAL_QWEN.baseUrl, 'local-test-password')
    expect(await generateLocalQwen(session, draft, ['data:first', 'data:second'])).toEqual(png)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('refuses an unloaded or different model and exposes no credentials in status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/login') ? { access_token: 'hidden-token' } : { loaded: true, repo_id: 'another/model' })))
    const status = await localQwenStatus(DEFAULT_LOCAL_QWEN.baseUrl, 'hidden-password')
    expect(status.ready).toBe(false); expect(JSON.stringify(status)).not.toContain('hidden-')
    const session = await connectLocalQwen(DEFAULT_LOCAL_QWEN.baseUrl, 'hidden-password')
    await expect(generateLocalQwen(session, draft, [])).rejects.toThrow('加载')
  })
  it('never forwards the token to an external output URL and redacts returned errors', async () => {
    const session = { origin: 'http://127.0.0.1:8888', token: 'hidden-token', password: 'hidden-password', model: 'Qwen-Image-2.1', ready: true }
    const fetcher = vi.fn(async () => Response.json({ images: [{ url: 'http://example.com/api/inference/images/gallery/a/file' }] }))
    vi.stubGlobal('fetch', fetcher)
    await expect(generateLocalQwen(session, draft, [])).rejects.toThrow('不属于')
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockImplementation(async () => Response.json({ detail: 'failure hidden-token hidden-password' }, { status: 500 }))
    try { await generateLocalQwen(session, draft, []) } catch (error) { expect(String(error)).not.toContain('hidden-') }
  })
  it('preserves local dimensions through project save and rejects excessive references and invalid settings', () => {
    const doc = createProject('local'); doc.productionAssetDraft = draft
    expect(parseProject(serializeProject(doc)).doc?.productionAssetDraft?.localQwen).toEqual(DEFAULT_LOCAL_QWEN)
    expect(assetDraftErrors({ ...draft, referenceIds: Array(11).fill('x') })).toContain('本地 Qwen-Image 2.1 最多使用10张参考图。')
    expect(assetDraftErrors({ ...draft, localQwen: { ...DEFAULT_LOCAL_QWEN, width: 777 } }).length).toBeGreaterThan(0)
    expect(parseProject(JSON.stringify({ ...doc, productionAssetDraft: { ...draft, localQwen: { ...DEFAULT_LOCAL_QWEN, steps: -1 } } })).doc).toBeNull()
  })
  it('accepts local and tailnet addresses, rejects credentials, remote hosts and API suffixes', () => {
    for (const url of ['http://127.0.0.1:8888', 'http://192.168.1.5:8888/', 'http://100.64.0.10:18888']) expect(localQwenOrigin(url)).toBe(url.replace(/\/$/, ''))
    for (const url of ['file:///D:/image', 'http://example.com', 'http://user:secret@127.0.0.1:8888', 'http://127.0.0.1:8888/api']) expect(() => localQwenOrigin(url)).toThrow()
  })
})
