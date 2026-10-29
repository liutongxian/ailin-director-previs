import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildMiniMaxH3ContextRequest,
  buildMiniMaxH3DeleteRequest,
  buildMiniMaxH3GenerationRequest,
  buildMiniMaxH3QueryRequest,
  parseMiniMaxH3CreateResponse,
  parseMiniMaxH3TaskResponse,
  validateMiniMaxH3Input,
  type MiniMaxH3Input
} from '../../src/engine/minimax-h3'

function input(overrides: Partial<MiniMaxH3Input> = {}): MiniMaxH3Input {
  return {
    baseUrl: 'https://api.minimaxi.com',
    model: 'MiniMax-H3',
    mode: 'text',
    prompt: '镜头提示词',
    references: [],
    duration: 4,
    resolution: '768P',
    ratio: '9:16',
    watermark: false,
    ...overrides
  }
}

describe('MiniMax H3 V2 adapter', () => {
  it('contains no legacy MiniMax model or V1 endpoint in production adapters', () => {
    const production = [
      'src/engine/cloud-video.ts',
      'src/main/cloud-video-client.ts',
      'src/renderer/panels/ProductionWorkspace.tsx'
    ].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n')
    for (const legacy of [
      'MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-02', 'S2V-01',
      '/v1/video_generation', '/v1/query/video_generation', '/v1/files/retrieve'
    ]) expect(production).not.toContain(legacy)
  })

  it('builds text-to-video with the official V2 content array', () => {
    expect(buildMiniMaxH3GenerationRequest(input())).toEqual({
      url: 'https://api.minimaxi.com/v2/video_generation',
      method: 'POST',
      body: {
        model: 'MiniMax-H3',
        content: [{ type: 'text', text: '镜头提示词' }],
        resolution: '768P',
        duration: 4,
        ratio: '9:16',
        aigc_watermark: false
      }
    })
  })

  it('builds first/last-frame and multimodal reference content', () => {
    const frames = buildMiniMaxH3GenerationRequest(input({
      mode: 'first-last-frame', ratio: 'adaptive',
      references: [
        { id: 'first', kind: 'image', role: 'first-frame', source: 'url', value: 'https://example.com/first.png' },
        { id: 'last', kind: 'image', role: 'last-frame', source: 'url', value: 'https://example.com/last.png' }
      ]
    }))
    expect(frames.body.content).toEqual([
      { type: 'text', text: '镜头提示词' },
      { type: 'image_url', image_url: { url: 'https://example.com/first.png' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'https://example.com/last.png' }, role: 'last_frame' }
    ])

    const references = buildMiniMaxH3GenerationRequest(input({
      mode: 'reference', ratio: 'adaptive',
      references: [
        { id: 'image', kind: 'image', role: 'reference', source: 'url', value: 'https://example.com/ref.png' },
        { id: 'video', kind: 'video', role: 'reference', source: 'url', value: 'https://example.com/ref.mp4' },
        { id: 'audio', kind: 'audio', role: 'reference', source: 'url', value: 'https://example.com/ref.mp3' }
      ]
    }))
    expect(references.body.content).toEqual([
      { type: 'text', text: '镜头提示词' },
      { type: 'image_url', image_url: { url: 'https://example.com/ref.png' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://example.com/ref.mp4' }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: 'https://example.com/ref.mp3' }, role: 'reference_audio' }
    ])
  })

  it('builds Context-IR, query, and delete endpoints', () => {
    expect(buildMiniMaxH3ContextRequest(input()).url).toBe('https://api.minimaxi.com/v2/h3_context_ir')
    expect(buildMiniMaxH3QueryRequest('task 1').url).toBe('https://api.minimax.cn/v2/query/video_generation/task%201')
    expect(buildMiniMaxH3DeleteRequest('task 1').url).toBe('https://api.minimax.cn/v2/video_generation/task%201')
    expect(buildMiniMaxH3DeleteRequest('task 1').method).toBe('DELETE')
  })

  it('validates modes and official limits', () => {
    expect(validateMiniMaxH3Input(input({ ratio: 'adaptive' }))).toContain('文生视频必须选择明确画幅，不能使用自适应。')
    expect(validateMiniMaxH3Input(input({ duration: 16, resolution: '1080P' as '768P' }))).toEqual(expect.arrayContaining([
      expect.stringContaining('4–15'), expect.stringContaining('768P 或 2K')
    ]))
    expect(validateMiniMaxH3Input(input({
      mode: 'first-last-frame', ratio: 'adaptive',
      references: [{ id: 'video', kind: 'video', role: 'reference', source: 'url', value: 'https://example.com/ref.mp4' }]
    }))).toContain('首尾帧模式只能使用首帧或尾帧图片。')
    expect(validateMiniMaxH3Input(input({
      mode: 'reference', ratio: 'adaptive',
      references: [{ id: 'bad', kind: 'image', role: 'reference', source: 'url', value: 'asset://las-only' }]
    }))).toContain('MiniMax H3 不接受 BytePlus LAS asset:// 素材 ID。')
    expect(validateMiniMaxH3Input({
      ...input(), mode: 'invented',
      references: [{ id: 'bad', kind: 'mesh', role: 'subject', source: 'url', value: 'https://' }]
    } as unknown as MiniMaxH3Input)).toEqual(expect.arrayContaining([
      expect.stringContaining('mode'), expect.stringContaining('kind'), expect.stringContaining('role')
    ]))
    expect(validateMiniMaxH3Input(input({
      mode: 'reference', ratio: 'adaptive',
      references: [{ id: 'data', kind: 'image', role: 'reference', source: 'url', value: 'data:image/png;base64,AAAA' }]
    }))).toContain('参考素材网址无效：data:image/png;base64,AAAA')
  })

  it('parses V2 create, generation, Context-IR, and failure responses', () => {
    expect(parseMiniMaxH3CreateResponse({ task_id: 'mm-1' })).toBe('mm-1')
    expect(parseMiniMaxH3TaskResponse({ task: {
      id: 'mm-1', status: 'succeeded', task_type: 'generation', content: { url: 'https://cdn.example/video.mp4' }
    } })).toMatchObject({ taskId: 'mm-1', status: 'complete', taskType: 'generation', outputUrl: 'https://cdn.example/video.mp4' })
    expect(parseMiniMaxH3TaskResponse({ task: {
      id: 'ir-1', status: 'succeeded', task_type: 'h3_context_ir', content: { prompt: '增强提示词' }
    } })).toMatchObject({ taskId: 'ir-1', status: 'complete', taskType: 'h3_context_ir', enhancedPrompt: '增强提示词' })
    expect(parseMiniMaxH3TaskResponse({ task: {
      id: 'mm-2', status: 'failed', task_type: 'generation', error: { code: '1026', message: 'sensitive' }
    } })).toMatchObject({ taskId: 'mm-2', status: 'failed', error: 'sensitive' })
    expect(parseMiniMaxH3TaskResponse({ base_resp: { status_code: 1004, status_msg: 'authentication failed' } }))
      .toMatchObject({ taskId: '', status: 'failed', error: 'authentication failed' })
  })
})
