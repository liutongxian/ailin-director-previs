import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeScriptWithModel, buildScriptModelUserContent, openAICompatibleEndpoint } from '../../src/main/script-model'

afterEach(() => vi.unstubAllGlobals())

describe('provider-neutral script model endpoint', () => {
  it('accepts base URLs and explicit chat-completion endpoints', () => {
    expect(openAICompatibleEndpoint('https://api.example.com')).toBe('https://api.example.com/v1/chat/completions')
    expect(openAICompatibleEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions')
    expect(openAICompatibleEndpoint('http://127.0.0.1:11434/v1/chat/completions')).toBe('http://127.0.0.1:11434/v1/chat/completions')
  })

  it('rejects non-http protocols', () => {
    expect(() => openAICompatibleEndpoint('file:///tmp/model')).toThrow(/http/)
  })

  it('sends the script to an OpenAI-compatible model and extracts fenced IR JSON', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '```json\n{"spec":"previs-ir","version":"1.0","assets":[],"shots":[]}\n```' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await analyzeScriptWithModel(
      { baseUrl: 'https://model.example.com', model: 'director-model', apiKey: 'secret' },
      '第1镜：陌生场景。'
    )

    expect(result).toEqual({ ok: true, text: '{"spec":"previs-ir","version":"1.0","assets":[],"shots":[]}' })
    const [, options] = fetchMock.mock.calls[0]!
    expect(String(options?.body)).toContain('第1镜：陌生场景。')
    expect((options?.headers as Record<string, string>).authorization).toBe('Bearer secret')
  })

  it('keeps text-only models on a plain text message', () => {
    expect(buildScriptModelUserContent('第1镜：室内。', [])).toBe('第1镜：室内。')
  })

  it('labels optional asset images without turning image perspective into plot facts', () => {
    const content = buildScriptModelUserContent('第1镜：叶清和进入。', [{
      assetId: 'CHAR-YQ',
      assetName: '叶清和',
      kind: 'character',
      mimeType: 'image/png',
      base64: 'AAAA'
    }])

    expect(Array.isArray(content)).toBe(true)
    expect(JSON.stringify(content)).toContain('CHAR-YQ')
    expect(JSON.stringify(content)).toContain('data:image/png;base64,AAAA')
    expect(JSON.stringify(content)).toContain('不要根据图片改写剧情')
  })

  it('sends optional images through the same OpenAI-compatible API request', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"spec":"previs-ir","version":"1.0","assets":[],"shots":[]}' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await analyzeScriptWithModel(
      { baseUrl: 'https://model.example.com', model: 'vision-director' },
      '第1镜：修复室。',
      [{ assetId: 'ROOM', assetName: '修复室', kind: 'scene', mimeType: 'image/jpeg', base64: 'BBBB' }]
    )

    const [, options] = fetchMock.mock.calls[0]!
    const body = JSON.parse(String(options?.body)) as { model: string; messages: { content: unknown }[] }
    expect(body.model).toBe('vision-director')
    expect(Array.isArray(body.messages[1]?.content)).toBe(true)
    expect(JSON.stringify(body.messages[1]?.content)).toContain('data:image/jpeg;base64,BBBB')
  })

  it('aborts the actual fetch when the caller cancels generation', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const pending = analyzeScriptWithModel(
      { baseUrl: 'https://model.example.com', model: 'director-model' },
      '第1镜：修复室。',
      [],
      controller.signal
    )
    controller.abort()

    await expect(pending).resolves.toEqual({ ok: false, error: '已取消大模型生成，请求连接已中止。' })
    expect((fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true)
  })
})
