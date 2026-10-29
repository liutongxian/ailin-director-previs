export type MiniMaxH3Mode = 'text' | 'first-last-frame' | 'reference'
export type MiniMaxH3ReferenceKind = 'image' | 'video' | 'audio'
export type MiniMaxH3ReferenceRole = 'reference' | 'first-frame' | 'last-frame'
export type MiniMaxH3ReferenceSource = 'file' | 'url' | 'minimax-file'

export interface MiniMaxH3Reference {
  id: string
  kind: MiniMaxH3ReferenceKind
  role: MiniMaxH3ReferenceRole
  source: MiniMaxH3ReferenceSource
  value: string
  name?: string
}

export interface MiniMaxH3Input {
  baseUrl?: string
  model: 'MiniMax-H3'
  mode: MiniMaxH3Mode
  prompt: string
  references: MiniMaxH3Reference[]
  duration: number
  resolution: '768P' | '2K'
  ratio: 'adaptive' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  watermark?: boolean
  callbackUrl?: string
}

export interface MiniMaxH3HttpRequest {
  url: string
  method: 'GET' | 'POST' | 'DELETE'
  body?: Record<string, unknown>
}

export interface MiniMaxH3TaskSnapshot {
  taskId: string
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  taskType?: string
  outputUrl?: string
  enhancedPrompt?: string
  error?: string
}

const DEFAULT_BASE_URL = 'https://api.minimax.cn'
const RATIOS = new Set(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
const MODES = new Set(['text', 'first-last-frame', 'reference'])
const KINDS = new Set(['image', 'video', 'audio'])
const ROLES = new Set(['reference', 'first-frame', 'last-frame'])
const SOURCES = new Set(['file', 'url', 'minimax-file'])

function baseUrl(value?: string): string {
  return (value?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function referenceValue(reference: MiniMaxH3Reference): string {
  const value = reference.value.trim()
  if (reference.source === 'minimax-file') return value.startsWith('mm_file://') ? value : `mm_file://${value}`
  return value
}

function referenceContent(reference: MiniMaxH3Reference): Record<string, unknown> {
  const url = referenceValue(reference)
  if (reference.kind === 'image') {
    const role = reference.role === 'first-frame' ? 'first_frame'
      : reference.role === 'last-frame' ? 'last_frame'
        : 'reference_image'
    return { type: 'image_url', image_url: { url }, role }
  }
  if (reference.kind === 'video') return { type: 'video_url', video_url: { url }, role: 'reference_video' }
  return { type: 'audio_url', audio_url: { url }, role: 'reference_audio' }
}

function requestBody(input: MiniMaxH3Input): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    content: [
      { type: 'text', text: input.prompt.trim() },
      ...input.references.map(referenceContent)
    ],
    resolution: input.resolution,
    duration: input.duration,
    ratio: input.ratio,
    aigc_watermark: input.watermark === true
  }
  if (input.callbackUrl?.trim()) body.callback_url = input.callbackUrl.trim()
  return body
}

export function validateMiniMaxH3Input(input: MiniMaxH3Input): string[] {
  const errors: string[] = []
  const raw = input as unknown as Record<string, unknown>
  const rawReferences = Array.isArray(raw.references) ? raw.references : []
  const references: MiniMaxH3Reference[] = []
  if (!Array.isArray(raw.references)) errors.push('MiniMax H3 references 必须是数组。')
  for (const [index, value] of rawReferences.entries()) {
    if (!isRecord(value)) {
      errors.push(`参考素材 ${index + 1} 必须是对象。`)
      continue
    }
    if (!KINDS.has(String(value.kind))) errors.push(`参考素材 ${index + 1} 的 kind 无效。`)
    if (!ROLES.has(String(value.role))) errors.push(`参考素材 ${index + 1} 的 role 无效。`)
    if (!SOURCES.has(String(value.source))) errors.push(`参考素材 ${index + 1} 的 source 无效。`)
    if (typeof value.id !== 'string' || typeof value.value !== 'string') errors.push(`参考素材 ${index + 1} 缺少字符串 id 或 value。`)
    if (KINDS.has(String(value.kind)) && ROLES.has(String(value.role)) && SOURCES.has(String(value.source)) &&
      typeof value.id === 'string' && typeof value.value === 'string') references.push(value as unknown as MiniMaxH3Reference)
  }
  if (input.model !== 'MiniMax-H3') errors.push('MiniMax H3 接口只允许模型 MiniMax-H3。')
  if (!MODES.has(String(raw.mode))) errors.push('MiniMax H3 mode 必须是 text、first-last-frame 或 reference。')
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) errors.push('提示词不能为空。')
  if (typeof raw.prompt === 'string' && raw.prompt.length > 7000) errors.push('MiniMax H3 提示词不能超过 7000 字符。')
  if (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > 15) {
    errors.push('MiniMax H3 时长必须是 4–15 秒之间的整数。')
  }
  if (input.resolution !== '768P' && input.resolution !== '2K') errors.push('MiniMax H3 分辨率只能是 768P 或 2K。')
  if (!RATIOS.has(input.ratio)) errors.push(`MiniMax H3 不支持画幅 ${input.ratio}。`)
  if (input.mode === 'text' && input.ratio === 'adaptive') errors.push('文生视频必须选择明确画幅，不能使用自适应。')

  const images = references.filter((item) => item.kind === 'image')
  const videos = references.filter((item) => item.kind === 'video')
  const audios = references.filter((item) => item.kind === 'audio')
  if (images.length > 9) errors.push('MiniMax H3 最多使用 9 张参考图。')
  if (videos.length > 3) errors.push('MiniMax H3 最多使用 3 个参考视频。')
  if (audios.length > 3) errors.push('MiniMax H3 最多使用 3 个参考音频。')
  if (references.length > 12) errors.push('MiniMax H3 图片、视频和音频合计最多 12 个。')

  if (input.mode === 'text' && references.length > 0) errors.push('文生视频模式不能携带参考素材。')
  if (input.mode === 'first-last-frame') {
    if (references.some((item) => item.kind !== 'image' || (item.role !== 'first-frame' && item.role !== 'last-frame'))) {
      errors.push('首尾帧模式只能使用首帧或尾帧图片。')
    }
    if (!images.some((item) => item.role === 'first-frame')) errors.push('首尾帧模式至少需要一张首帧图片。')
    if (images.filter((item) => item.role === 'first-frame').length > 1) errors.push('首帧图片只能有一张。')
    if (images.filter((item) => item.role === 'last-frame').length > 1) errors.push('尾帧图片只能有一张。')
  }
  if (input.mode === 'reference') {
    if (references.length === 0) errors.push('参考模式至少需要一个参考素材。')
    if (references.some((item) => item.role !== 'reference')) errors.push('参考模式只能使用普通参考素材。')
  }
  for (const reference of references) {
    if (!reference.value.trim()) errors.push(`参考素材“${reference.name ?? reference.id}”缺少地址或文件 ID。`)
    if (reference.value.trim().startsWith('asset://')) errors.push('MiniMax H3 不接受 BytePlus LAS asset:// 素材 ID。')
    if (reference.source === 'url' && reference.value.trim()) {
      try {
        const url = new URL(reference.value.trim())
        if (url.protocol !== 'https:' && url.protocol !== 'http:') errors.push(`参考素材网址无效：${reference.value}`)
      } catch {
        errors.push(`参考素材网址无效：${reference.value}`)
      }
    }
    if (reference.source === 'minimax-file' && !/^(?:mm_file:\/\/)?[A-Za-z0-9._-]+$/.test(reference.value.trim())) {
      errors.push(`MiniMax 文件 ID 无效：${reference.value}`)
    }
    if (reference.source === 'file' && reference.value.trim().startsWith('data:') &&
      !reference.value.trim().startsWith(`data:${reference.kind}/`)) {
      errors.push(`参考素材“${reference.name ?? reference.id}”的 Data URI 与 ${reference.kind} 类型不一致。`)
    }
  }
  if (typeof raw.callbackUrl === 'string' && raw.callbackUrl.trim()) {
    try {
      if (new URL(raw.callbackUrl).protocol !== 'https:') errors.push('回调地址必须使用 HTTPS。')
    } catch {
      errors.push('回调地址无效。')
    }
  }
  return errors
}

export function buildMiniMaxH3GenerationRequest(input: MiniMaxH3Input): MiniMaxH3HttpRequest & { body: Record<string, unknown> } {
  const errors = validateMiniMaxH3Input(input)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  return { url: `${baseUrl(input.baseUrl)}/v2/video_generation`, method: 'POST', body: requestBody(input) }
}

export function buildMiniMaxH3ContextRequest(input: MiniMaxH3Input): MiniMaxH3HttpRequest & { body: Record<string, unknown> } {
  const errors = validateMiniMaxH3Input(input)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  return { url: `${baseUrl(input.baseUrl)}/v2/h3_context_ir`, method: 'POST', body: requestBody(input) }
}

export function buildMiniMaxH3QueryRequest(taskId: string, root?: string): MiniMaxH3HttpRequest {
  return { url: `${baseUrl(root)}/v2/query/video_generation/${encodeURIComponent(taskId)}`, method: 'GET' }
}

export function buildMiniMaxH3DeleteRequest(taskId: string, root?: string): MiniMaxH3HttpRequest {
  return { url: `${baseUrl(root)}/v2/video_generation/${encodeURIComponent(taskId)}`, method: 'DELETE' }
}

export function parseMiniMaxH3CreateResponse(value: unknown): string {
  const body = asRecord(value)
  const taskId = stringValue(body.task_id) ?? stringValue(asRecord(body.task).id)
  if (!taskId) throw new Error(apiError(body) ?? 'MiniMax H3 接口未返回任务 ID。')
  return taskId
}

export function parseMiniMaxH3TaskResponse(value: unknown): MiniMaxH3TaskSnapshot {
  const body = asRecord(value)
  const nestedTask = asRecord(body.task)
  if (Object.keys(nestedTask).length === 0) {
    const error = apiError(body)
    if (error) return { taskId: String(body.task_id ?? ''), status: 'failed', error }
  }
  const task = Object.keys(nestedTask).length > 0 ? nestedTask : body
  const rawStatus = String(task.status ?? '').toLowerCase()
  const knownStatuses = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
  if (!knownStatuses.has(rawStatus)) {
    return {
      taskId: String(task.id ?? task.task_id ?? ''),
      status: 'failed',
      taskType: stringValue(task.task_type),
      error: `MiniMax H3 返回了未知任务状态：${rawStatus || '空状态'}`
    }
  }
  const status: MiniMaxH3TaskSnapshot['status'] = rawStatus === 'succeeded' ? 'complete'
    : rawStatus === 'failed' ? 'failed'
      : rawStatus === 'cancelled' ? 'cancelled'
        : rawStatus === 'queued' ? 'queued' : 'running'
  const content = asRecord(task.content)
  const error = asRecord(task.error)
  return {
    taskId: String(task.id ?? task.task_id ?? ''),
    status,
    taskType: stringValue(task.task_type),
    outputUrl: stringValue(content.url),
    enhancedPrompt: stringValue(content.prompt),
    error: status === 'failed'
      ? stringValue(error.message) ?? stringValue(task.error_message) ?? apiError(body) ?? 'MiniMax H3 任务失败。'
      : undefined
  }
}

function apiError(body: Record<string, unknown>): string | undefined {
  const error = asRecord(body.error)
  const baseResponse = asRecord(body.base_resp)
  const baseCode = Number(baseResponse.status_code ?? 0)
  return stringValue(error.message) ?? (baseCode !== 0 ? stringValue(baseResponse.status_msg) : undefined)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
