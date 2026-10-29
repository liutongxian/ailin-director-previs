import {
  buildMiniMaxH3ContextRequest,
  buildMiniMaxH3DeleteRequest,
  buildMiniMaxH3GenerationRequest,
  buildMiniMaxH3QueryRequest,
  parseMiniMaxH3CreateResponse,
  parseMiniMaxH3TaskResponse,
  validateMiniMaxH3Input,
  type MiniMaxH3Input,
  type MiniMaxH3Mode
} from './minimax-h3'

export type CloudVideoProviderId = 'byteplus-las' | 'minimax' | 'volcengine-ark'
export type CloudVideoReferenceKind = 'image' | 'video' | 'audio'
export type CloudVideoReferenceRole = 'reference' | 'first-frame' | 'last-frame'
export type CloudVideoReferenceSource = 'file' | 'url' | 'asset' | 'minimax-file'

export interface CloudVideoReference {
  id: string
  kind: CloudVideoReferenceKind
  role: CloudVideoReferenceRole
  source: CloudVideoReferenceSource
  value: string
  name?: string
}

export interface CloudVideoModelDefinition {
  id: string
  label: string
  provider: CloudVideoProviderId
  resolutions: string[]
  durations: number[] | { min: number; max: number }
  ratios: string[]
  supportsVideoReference: boolean
  supportsSubjectReference: boolean
  supportsAudioGeneration: boolean
  supportsSeed: boolean
  supportsPromptOptimizer: boolean
  requiresImage: boolean
  maxImages: number
  maxVideos: number
  maxAudios?: number
}

export interface CloudVideoProviderDefinition {
  id: CloudVideoProviderId
  label: string
  defaultBaseUrl: string
  apiKeyEnvironmentVariable: string
  models: CloudVideoModelDefinition[]
}

export interface CloudVideoCreateInput {
  provider: CloudVideoProviderId
  baseUrl?: string
  model: string
  mode?: MiniMaxH3Mode
  prompt: string
  negativePrompt?: string
  references: CloudVideoReference[]
  duration: number
  resolution: string
  ratio: string
  seed?: number
  generateAudio?: boolean
  watermark?: boolean
  returnLastFrame?: boolean
  promptOptimizer?: boolean
  fastPretreatment?: boolean
  callbackUrl?: string
  executionExpiresAfter?: number
}

export interface CloudVideoTaskSnapshot {
  taskId: string
  status: 'queued' | 'running' | 'complete' | 'failed' | 'expired' | 'cancelled'
  outputUrl?: string
  lastFrameUrl?: string
  fileId?: string
  taskType?: string
  enhancedPrompt?: string
  error?: string
}

export interface CloudHttpRequest {
  url: string
  method: 'GET' | 'POST' | 'DELETE'
  body?: Record<string, unknown>
}

const SEEDANCE_RATIOS = ['adaptive', '16:9', '9:16', '4:3', '3:4', '1:1', '21:9']

export const CLOUD_VIDEO_PROVIDERS: CloudVideoProviderDefinition[] = [
  {
    id: 'volcengine-ark', label: '火山方舟 · Seedance', defaultBaseUrl: 'https://ark.cn-beijing.volces.com', apiKeyEnvironmentVariable: 'ARK_API_KEY',
    models: [{ id: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5 · 火山方舟', provider: 'volcengine-ark', resolutions: ['720p', '1080p', '480p'], durations: { min: 4, max: 30 }, ratios: SEEDANCE_RATIOS, supportsVideoReference: true, supportsSubjectReference: false, supportsAudioGeneration: true, supportsSeed: true, supportsPromptOptimizer: false, requiresImage: false, maxImages: 30, maxVideos: 10, maxAudios: 10 }]
  },
  {
    id: 'byteplus-las',
    label: 'BytePlus LAS · Seedance',
    defaultBaseUrl: 'https://operator.las.ap-southeast-1.bytepluses.com',
    apiKeyEnvironmentVariable: 'BYTEPLUS_LAS_API_KEY',
    models: [
      {
        id: 'dreamina-seedance-2-5-260628',
        label: 'Seedance 2.5',
        provider: 'byteplus-las',
        resolutions: ['720p', '480p'],
        durations: { min: 4, max: 30 },
        ratios: SEEDANCE_RATIOS,
        supportsVideoReference: true,
        supportsSubjectReference: false,
        supportsAudioGeneration: true,
        supportsSeed: true,
        supportsPromptOptimizer: false,
        requiresImage: false,
        maxImages: 30,
        maxVideos: 3
      },
      {
        id: 'dreamina-seedance-2-0-260128',
        label: 'Seedance 2.0',
        provider: 'byteplus-las',
        resolutions: ['720p', '480p', '1080p', '4k'],
        durations: { min: 4, max: 15 },
        ratios: SEEDANCE_RATIOS,
        supportsVideoReference: true,
        supportsSubjectReference: false,
        supportsAudioGeneration: true,
        supportsSeed: true,
        supportsPromptOptimizer: false,
        requiresImage: false,
        maxImages: 9,
        maxVideos: 3
      },
      {
        id: 'dreamina-seedance-2-0-fast-260128',
        label: 'Seedance 2.0 Fast',
        provider: 'byteplus-las',
        resolutions: ['720p', '480p'],
        durations: { min: 4, max: 15 },
        ratios: SEEDANCE_RATIOS,
        supportsVideoReference: true,
        supportsSubjectReference: false,
        supportsAudioGeneration: true,
        supportsSeed: true,
        supportsPromptOptimizer: false,
        requiresImage: false,
        maxImages: 9,
        maxVideos: 3
      },
      {
        id: 'dreamina-seedance-2-0-mini-260615',
        label: 'Seedance 2.0 Mini',
        provider: 'byteplus-las',
        resolutions: ['720p', '480p'],
        durations: { min: 4, max: 15 },
        ratios: SEEDANCE_RATIOS,
        supportsVideoReference: true,
        supportsSubjectReference: false,
        supportsAudioGeneration: true,
        supportsSeed: true,
        supportsPromptOptimizer: false,
        requiresImage: false,
        maxImages: 9,
        maxVideos: 3
      }
    ]
  },
  {
    id: 'minimax',
    label: 'MiniMax 开放平台 · H3',
    defaultBaseUrl: 'https://api.minimax.cn',
    apiKeyEnvironmentVariable: 'MINIMAX_API_KEY',
    models: [
      {
        id: 'MiniMax-H3',
        label: 'MiniMax H3',
        provider: 'minimax',
        resolutions: ['768P', '2K'],
        durations: { min: 4, max: 15 },
        ratios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
        supportsVideoReference: true,
        supportsSubjectReference: false,
        supportsAudioGeneration: false,
        supportsSeed: false,
        supportsPromptOptimizer: false,
        requiresImage: false,
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3
      }
    ]
  }
]

export function getCloudVideoProvider(id: CloudVideoProviderId): CloudVideoProviderDefinition {
  const provider = CLOUD_VIDEO_PROVIDERS.find((item) => item.id === id)
  if (!provider) throw new Error(`不支持的云端供应商：${id}`)
  return provider
}

export function getCloudVideoModel(providerId: CloudVideoProviderId, modelId: string): CloudVideoModelDefinition {
  const model = getCloudVideoProvider(providerId).models.find((item) => item.id === modelId)
  if (!model) throw new Error(`供应商 ${providerId} 不支持模型 ${modelId}`)
  return model
}

export function cloudVideoDurationOptions(model: CloudVideoModelDefinition): number[] {
  if (Array.isArray(model.durations)) return model.durations
  const range = model.durations
  return Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index)
}

export function normalizeCloudReferenceValue(reference: CloudVideoReference): string {
  const value = reference.value.trim()
  if (reference.source === 'asset') return value.startsWith('asset://') ? value : `asset://${value}`
  return value
}

export function validateCloudVideoInput(input: CloudVideoCreateInput): string[] {
  const errors: string[] = []
  if (typeof input?.prompt !== 'string') return ['提示词必须是字符串。']
  if (!Array.isArray(input?.references)) return ['参考素材必须是数组。']
  if (input.references.some((reference) => typeof reference !== 'object' || reference === null)) {
    return ['每个参考素材都必须是对象。']
  }
  const model = getCloudVideoModel(input.provider, input.model)
  if (input.provider === 'minimax') {
    const h3Input = toMiniMaxH3Input(input)
    const h3Errors = [
      ...(input.references.some((reference) => reference.source === 'asset')
        ? ['MiniMax H3 不接受 BytePlus LAS asset:// 素材 ID。']
        : []),
      ...validateMiniMaxH3Input(h3Input)
    ]
    return h3Errors.map((message) => {
      if (message.includes('时长必须')) return `${model.label} 不支持 ${input.duration} 秒；时长必须是 4–15 秒之间的整数。`
      if (message.includes('分辨率只能')) return `${model.label} 不支持分辨率 ${input.resolution}；只能选择 768P 或 2K。`
      return message
    })
  }
  if (!input.prompt.trim()) errors.push('提示词不能为空。')
  const durations = cloudVideoDurationOptions(model)
  if (!durations.includes(input.duration)) errors.push(`${model.label} 不支持 ${input.duration} 秒。`)
  if (!model.resolutions.includes(input.resolution)) errors.push(`${model.label} 不支持分辨率 ${input.resolution}。`)
  if (model.ratios.length > 0 && !model.ratios.includes(input.ratio)) errors.push(`${model.label} 不支持画幅 ${input.ratio}。`)
  if (model.supportsSeed && input.seed !== undefined && !Number.isFinite(input.seed)) errors.push('Seed 必须是有效整数。')
  if (input.provider === 'byteplus-las' && input.executionExpiresAfter !== undefined &&
    (input.executionExpiresAfter < 3600 || input.executionExpiresAfter > 259200)) {
    errors.push('任务过期时间必须在 3600–259200 秒之间。')
  }

  const images = input.references.filter((item) => item.kind === 'image')
  const videos = input.references.filter((item) => item.kind === 'video')
  const audios = input.references.filter((item) => item.kind === 'audio')
  if (images.length > model.maxImages) errors.push(`${model.label} 最多使用 ${model.maxImages} 张参考图。`)
  if (videos.length > model.maxVideos) errors.push(`${model.label} 最多使用 ${model.maxVideos} 个参考视频。`)
  if (videos.length > 0 && !model.supportsVideoReference) errors.push(`${model.label} 的当前官方视频生成接口不支持参考视频。`)
  if (audios.length > (model.maxAudios ?? 0)) errors.push(`${model.label} 最多支持 ${model.maxAudios ?? 0} 个参考音频。`)
  if (model.requiresImage && images.length === 0) errors.push(`${model.label} 至少需要一张参考图。`)
  if (images.filter((item) => item.role === 'first-frame').length > 1) errors.push('首帧参考图只能有一张。')
  if (images.filter((item) => item.role === 'last-frame').length > 1) errors.push('尾帧参考图只能有一张。')
  for (const reference of input.references) {
    if (!reference.value.trim()) errors.push(`参考素材“${reference.name ?? reference.id}”缺少地址或素材 ID。`)
    if (reference.source === 'asset' && input.provider !== 'byteplus-las' && input.provider !== 'volcengine-ark') {
      errors.push('素材库 asset:// ID 目前仅适用于 BytePlus LAS。')
    }
    if (reference.source === 'url' && reference.value.trim()) {
      try {
        const url = new URL(reference.value.trim())
        if (url.protocol !== 'https:' && url.protocol !== 'http:') errors.push('参考素材网址必须使用 HTTP 或 HTTPS。')
      } catch {
        errors.push(`参考素材网址无效：${reference.value}`)
      }
    }
    if (reference.kind === 'video' && reference.source === 'file') {
      errors.push('云端接口不接受本地视频直传；请填写公开 URL，或在 BytePlus 使用 asset:// 素材 ID。')
    }
  }
  if (input.provider === 'volcengine-ark' && images.some((item) => item.role !== 'reference')) {
    if (!images.some((item) => item.role === 'first-frame')) errors.push('首尾帧模式必须选择首帧图片。')
    if (input.references.some((item) => item.kind !== 'image' || item.role === 'reference')) errors.push('首尾帧与普通参考不能混用，请选择一种方式。')
    if (input.ratio !== 'adaptive') errors.push('Seedance 2.5 首尾帧模式请将画幅设为“随首帧”。')
  }
  if (input.callbackUrl?.trim()) {
    try {
      if (new URL(input.callbackUrl).protocol !== 'https:') errors.push('回调地址必须使用 HTTPS。')
    } catch {
      errors.push('回调地址无效。')
    }
  }
  return errors
}

function toMiniMaxH3Input(input: CloudVideoCreateInput): MiniMaxH3Input {
  return {
    baseUrl: input.baseUrl,
    model: 'MiniMax-H3',
    mode: input.mode ?? (input.references.length > 0 ? 'reference' : 'text'),
    prompt: combinedPrompt(input),
    references: input.references.map((reference) => ({
      id: reference.id,
      kind: reference.kind,
      role: reference.role,
      source: reference.source === 'asset' ? 'url' : reference.source,
      value: reference.value,
      name: reference.name
    })),
    duration: input.duration,
    resolution: input.resolution as MiniMaxH3Input['resolution'],
    ratio: input.ratio as MiniMaxH3Input['ratio'],
    watermark: input.watermark,
    callbackUrl: input.callbackUrl
  }
}

function combinedPrompt(input: CloudVideoCreateInput): string {
  const negative = input.negativePrompt?.trim()
  return negative ? `${input.prompt.trim()}\n\n必须避免：${negative}` : input.prompt.trim()
}

export function buildCloudCreateRequest(input: CloudVideoCreateInput): CloudHttpRequest {
  const errors = validateCloudVideoInput(input)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  const provider = getCloudVideoProvider(input.provider)
  const baseUrl = (input.baseUrl?.trim() || provider.defaultBaseUrl).replace(/\/+$/, '')
  const prompt = combinedPrompt(input)

  if (input.provider === 'byteplus-las' || input.provider === 'volcengine-ark') {
    const content: Record<string, unknown>[] = [{ type: 'text', text: prompt }]
    for (const reference of input.references) {
      const value = normalizeCloudReferenceValue(reference)
      if (reference.kind === 'image') {
        content.push({ type: 'image_url', image_url: { url: value }, role: reference.role === 'first-frame' ? 'first_frame' : reference.role === 'last-frame' ? 'last_frame' : 'reference_image' })
      } else if (reference.kind === 'video') {
        content.push({ type: 'video_url', video_url: { url: value }, role: 'reference_video' })
      } else if (reference.kind === 'audio') {
        content.push({ type: 'audio_url', audio_url: { url: value }, role: 'reference_audio' })
      }
    }
    const body: Record<string, unknown> = {
      model: input.model,
      content,
      duration: input.duration,
      resolution: input.resolution,
      ratio: input.ratio,
      generate_audio: input.generateAudio !== false,
      watermark: input.watermark === true,
      return_last_frame: input.returnLastFrame === true
    }
    if (input.seed !== undefined && Number.isFinite(input.seed)) body.seed = Math.round(input.seed)
    if (input.callbackUrl?.trim()) body.callback_url = input.callbackUrl.trim()
    if (input.executionExpiresAfter !== undefined) body.execution_expires_after = input.executionExpiresAfter
    if (input.provider === 'volcengine-ark' && input.references.some((item) => item.kind === 'video')) body.omni_reference_task_type = 'reference'
    return { url: `${baseUrl}/api/${input.provider === 'volcengine-ark' ? 'v3' : 'v1'}/contents/generations/tasks`, method: 'POST', body }
  }

  return buildMiniMaxH3GenerationRequest({ ...toMiniMaxH3Input(input), baseUrl })
}

export function buildCloudContextRequest(input: CloudVideoCreateInput): CloudHttpRequest {
  if (input.provider !== 'minimax') throw new Error('H3 Context-IR 仅适用于 MiniMax H3。')
  return buildMiniMaxH3ContextRequest(toMiniMaxH3Input(input))
}

export function buildCloudCancelRequest(
  providerId: CloudVideoProviderId,
  taskId: string,
  baseUrl?: string
): CloudHttpRequest {
  if (providerId !== 'minimax') throw new Error('当前只支持取消 MiniMax H3 云端任务。')
  return buildMiniMaxH3DeleteRequest(taskId, baseUrl)
}

export function buildCloudQueryRequest(
  providerId: CloudVideoProviderId,
  taskId: string,
  baseUrl?: string
): CloudHttpRequest {
  const provider = getCloudVideoProvider(providerId)
  const root = (baseUrl?.trim() || provider.defaultBaseUrl).replace(/\/+$/, '')
  if (providerId === 'byteplus-las' || providerId === 'volcengine-ark') {
    return { url: `${root}/api/${providerId === 'volcengine-ark' ? 'v3' : 'v1'}/contents/generations/tasks/${encodeURIComponent(taskId)}`, method: 'GET' }
  }
  return buildMiniMaxH3QueryRequest(taskId, root)
}

export function parseCloudCreateResponse(provider: CloudVideoProviderId, value: unknown): string {
  if (provider === 'minimax') return parseMiniMaxH3CreateResponse(value)
  const body = asRecord(value)
  const taskId = body.id
  if (typeof taskId !== 'string' || !taskId) throw new Error('云端接口未返回任务 ID。')
  return taskId
}

export function parseCloudTaskResponse(provider: CloudVideoProviderId, value: unknown): CloudVideoTaskSnapshot {
  if (provider === 'minimax') return parseMiniMaxH3TaskResponse(value)
  const body = asRecord(value)
  if (provider === 'byteplus-las' || provider === 'volcengine-ark') {
    const status = String(body.status ?? '')
    const normalized = status === 'succeeded' ? 'complete'
      : status === 'queued' ? 'queued'
        : status === 'running' ? 'running'
          : status === 'expired' ? 'expired'
            : status === 'failed' || status === 'cancelled' ? 'failed' : 'running'
    const content = asRecord(body.content)
    const error = asRecord(body.error)
    return {
      taskId: String(body.id ?? ''),
      status: normalized,
      outputUrl: stringValue(content.video_url),
      lastFrameUrl: stringValue(content.last_frame_url),
      error: stringValue(error.message) ?? stringValue(body.error)
    }
  }
  throw new Error('不支持的云端供应商。')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
