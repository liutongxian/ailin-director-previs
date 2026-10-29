import { describe, expect, it } from 'vitest'
import {
  CLOUD_VIDEO_PROVIDERS,
  buildCloudCreateRequest,
  buildCloudQueryRequest,
  parseCloudCreateResponse,
  parseCloudTaskResponse,
  validateCloudVideoInput,
  type CloudVideoCreateInput
} from '../../src/engine/cloud-video'

function seedanceInput(): CloudVideoCreateInput {
  return {
    provider: 'byteplus-las',
    model: 'dreamina-seedance-2-5-260628',
    prompt: '人物从门口走入，镜头缓慢跟随。',
    negativePrompt: '身份漂移',
    references: [
      { id: 'image-1', kind: 'image', role: 'reference', source: 'url', value: 'https://example.com/hero.png' },
      { id: 'video-1', kind: 'video', role: 'reference', source: 'asset', value: 'video-asset-42' }
    ],
    duration: 12,
    resolution: '720p',
    ratio: '9:16',
    seed: 42,
    generateAudio: true,
    watermark: false,
    returnLastFrame: true,
    executionExpiresAfter: 172800
  }
}

describe('cloud video adapters', () => {
  it('exposes multiple official providers and model choices', () => {
    expect(CLOUD_VIDEO_PROVIDERS.map((provider) => provider.id)).toEqual(['volcengine-ark', 'byteplus-las', 'minimax'])
    expect(CLOUD_VIDEO_PROVIDERS.find((provider) => provider.id === 'byteplus-las')!.models.some((model) => model.label === 'Seedance 2.5')).toBe(true)
    expect(CLOUD_VIDEO_PROVIDERS.find((provider) => provider.id === 'minimax')!.models.map((model) => model.id)).toEqual(['MiniMax-H3'])
  })

  it('uses the official Ark protocol and preserves media roles, audio, and reference task type', () => {
    const input: CloudVideoCreateInput = { ...seedanceInput(), provider: 'volcengine-ark', model: 'doubao-seedance-2-5-260628' }
    input.references.push({ id: 'sound', kind: 'audio', role: 'reference', source: 'url', value: 'https://example.com/voice.wav' })
    const request = buildCloudCreateRequest(input)
    expect(request.url).toBe('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks')
    expect(request.body?.omni_reference_task_type).toBe('reference')
    expect(request.body?.content).toContainEqual({ type: 'audio_url', audio_url: { url: 'https://example.com/voice.wav' }, role: 'reference_audio' })
    expect(buildCloudQueryRequest('volcengine-ark', 'task-1').url).toContain('/api/v3/contents/generations/tasks/task-1')
    expect(parseCloudTaskResponse('volcengine-ark', { id: 'task-1', status: 'succeeded', content: { video_url: 'https://example.com/result.mp4' } }).status).toBe('complete')
    input.references = [{ id: 'first', kind: 'image', role: 'first-frame', source: 'file', value: 'media/first.png' }]
    expect(validateCloudVideoInput(input).join()).toContain('首尾帧模式')
    input.ratio = 'adaptive'
    expect(buildCloudCreateRequest(input).body?.content).toContainEqual({ type: 'image_url', image_url: { url: 'media/first.png' }, role: 'first_frame' })
  })

  it('builds the BytePlus Seedance multimodal request without inventing unsupported fields', () => {
    const request = buildCloudCreateRequest(seedanceInput())
    expect(request.url).toBe('https://operator.las.ap-southeast-1.bytepluses.com/api/v1/contents/generations/tasks')
    expect(request.body).toMatchObject({
      model: 'dreamina-seedance-2-5-260628',
      duration: 12,
      resolution: '720p',
      ratio: '9:16',
      seed: 42,
      generate_audio: true,
      watermark: false,
      return_last_frame: true
    })
    expect(request.body?.content).toEqual([
      { type: 'text', text: '人物从门口走入，镜头缓慢跟随。\n\n必须避免：身份漂移' },
      { type: 'image_url', image_url: { url: 'https://example.com/hero.png' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'asset://video-asset-42' }, role: 'reference_video' }
    ])
  })

  it('builds the MiniMax H3 V2 first/last-frame request', () => {
    const request = buildCloudCreateRequest({
      provider: 'minimax',
      model: 'MiniMax-H3',
      mode: 'first-last-frame',
      prompt: '女孩回头看向镜头。[固定]',
      references: [
        { id: 'first', kind: 'image', role: 'first-frame', source: 'url', value: 'https://example.com/first.jpg' },
        { id: 'last', kind: 'image', role: 'last-frame', source: 'url', value: 'https://example.com/last.jpg' }
      ],
      duration: 6,
      resolution: '2K',
      ratio: 'adaptive',
      watermark: false
    })
    expect(request.url).toBe('https://api.minimax.cn/v2/video_generation')
    expect(request.body).toEqual({
      model: 'MiniMax-H3',
      content: [
        { type: 'text', text: '女孩回头看向镜头。[固定]' },
        { type: 'image_url', image_url: { url: 'https://example.com/first.jpg' }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: 'https://example.com/last.jpg' }, role: 'last_frame' }
      ],
      duration: 6,
      resolution: '2K',
      ratio: 'adaptive',
      aigc_watermark: false
    })
  })

  it('enforces model-specific video, duration, resolution, and seed limits', () => {
    const invalid = seedanceInput()
    invalid.duration = 31
    invalid.resolution = '1080p'
    invalid.seed = Number.NaN
    expect(validateCloudVideoInput(invalid)).toEqual(expect.arrayContaining([
      expect.stringContaining('31 秒'),
      expect.stringContaining('1080p'),
      expect.stringContaining('Seed')
    ]))

    const minimax: CloudVideoCreateInput = {
      provider: 'minimax',
      model: 'MiniMax-H3',
      mode: 'first-last-frame',
      prompt: '测试',
      references: [{ id: 'video', kind: 'video', role: 'reference', source: 'url', value: 'https://example.com/ref.mp4' }],
      duration: 16,
      resolution: '1080P',
      ratio: 'adaptive'
    }
    expect(validateCloudVideoInput(minimax)).toEqual(expect.arrayContaining([
      expect.stringContaining('16 秒'),
      expect.stringContaining('1080P'),
      expect.stringContaining('首尾帧模式')
    ]))
    expect(validateCloudVideoInput({
      ...minimax,
      mode: 'reference',
      duration: 4,
      resolution: '768P',
      references: [{ id: 'las-only', kind: 'image', role: 'reference', source: 'asset', value: 'asset-42' }]
    })).toContain('MiniMax H3 不接受 BytePlus LAS asset:// 素材 ID。')
  })

  it('normalizes create, query, and result responses for both providers', () => {
    expect(parseCloudCreateResponse('byteplus-las', { id: 'lsd-1' })).toBe('lsd-1')
    expect(parseCloudCreateResponse('minimax', { task_id: 'mm-1' })).toBe('mm-1')
    expect(parseCloudTaskResponse('byteplus-las', {
      id: 'lsd-1', status: 'succeeded', content: { video_url: 'https://cdn.example/video.mp4' }
    })).toMatchObject({ taskId: 'lsd-1', status: 'complete', outputUrl: 'https://cdn.example/video.mp4' })
    expect(parseCloudTaskResponse('minimax', {
      task: { id: 'mm-1', status: 'succeeded', task_type: 'generation', content: { url: 'https://cdn.example/mm.mp4' } }
    })).toMatchObject({ taskId: 'mm-1', status: 'complete', outputUrl: 'https://cdn.example/mm.mp4', taskType: 'generation' })
    expect(buildCloudQueryRequest('minimax', 'task 1').url).toBe('https://api.minimax.cn/v2/query/video_generation/task%201')
  })
})
