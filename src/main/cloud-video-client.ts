import { mkdir, open, readFile, rename, stat, unlink, type FileHandle } from 'fs/promises'
import { dirname, extname, resolve, sep } from 'path'
import {
  buildCloudCreateRequest,
  buildCloudContextRequest,
  buildCloudCancelRequest,
  buildCloudQueryRequest,
  getCloudVideoProvider,
  parseCloudCreateResponse,
  parseCloudTaskResponse,
  validateCloudVideoInput,
  type CloudHttpRequest,
  type CloudVideoCreateInput,
  type CloudVideoProviderId,
  type CloudVideoTaskSnapshot
} from '../engine/cloud-video'
import { normalizeProjectRelativePath } from '../shared/portable-paths'

export interface CloudVideoAuth {
  apiKey?: string
}

export interface CloudVideoQueryInput extends CloudVideoAuth {
  provider: CloudVideoProviderId
  baseUrl?: string
  taskId: string
}

export interface CloudVideoCancelInput extends CloudVideoQueryInput {
  status: CloudVideoTaskSnapshot['status']
}

async function writeBufferFully(handle: FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0
  while (offset < buffer.byteLength) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.byteLength - offset, null)
    if (bytesWritten <= 0) throw new Error('写入生成结果时没有取得进展。')
    offset += bytesWritten
  }
}

const MEDIA_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac'
}

function apiKeyFor(provider: CloudVideoProviderId, supplied?: string): string {
  const definition = getCloudVideoProvider(provider)
  const key = supplied?.trim() || process.env[definition.apiKeyEnvironmentVariable]?.trim()
  if (!key) throw new Error(`缺少 API Key。请填写密钥，或设置环境变量 ${definition.apiKeyEnvironmentVariable}。`)
  return key
}

function assertProviderUrl(provider: CloudVideoProviderId, rawUrl: string): void {
  const url = new URL(rawUrl)
  const testHostAllowed = process.env.BLOCKOUT_ALLOW_CLOUD_VIDEO_LOCALHOST === '1' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (testHostAllowed) return
  if (url.protocol !== 'https:') throw new Error('云端 API 地址必须使用 HTTPS。')
  if (provider === 'byteplus-las' && (url.hostname === 'bytepluses.com' || url.hostname.endsWith('.bytepluses.com'))) return
  if (provider === 'minimax' && ['api.minimaxi.com', 'api.minimax.cn'].includes(url.hostname)) return
  if (provider === 'volcengine-ark' && url.hostname === 'ark.cn-beijing.volces.com') return
  throw new Error(`该地址不属于所选供应商：${url.hostname}`)
}

async function referenceFileAsDataUrl(path: string, expectedKind: 'image' | 'video' | 'audio'): Promise<string> {
  const extension = extname(path).toLowerCase()
  const mime = MEDIA_MIME[extension]
  if (!mime) throw new Error(`不支持的本地参考素材格式：${extension || '无扩展名'}`)
  if (!mime.startsWith(`${expectedKind}/`)) throw new Error(`参考素材“${path}”的文件类型与 ${expectedKind} 角色不一致。`)
  const info = await stat(path)
  if (!info.isFile()) throw new Error('本地参考素材不是文件。')
  if (info.size >= 45 * 1024 * 1024) throw new Error('单个本地参考素材必须小于 45 MB。')
  const bytes = await readFile(path)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

async function resolveReferences(input: CloudVideoCreateInput): Promise<CloudVideoCreateInput> {
  let localBytes = 0
  for (const reference of input.references) {
    if (reference.source !== 'file') continue
    const info = await stat(reference.value)
    if (!info.isFile()) throw new Error('本地参考素材不是文件。')
    localBytes += info.size
  }
  if (localBytes > 46 * 1024 * 1024) throw new Error('本地参考素材合计过大；转为 Data URI 后会超过 64 MB 请求上限。')
  const references = []
  for (const reference of input.references) {
    references.push({
      ...reference,
      value: reference.source === 'file' ? await referenceFileAsDataUrl(reference.value, reference.kind) : reference.value
    })
  }
  return {
    ...input,
    references
  }
}

export function redactCloudVideoError(value: string, secrets: string[]): string {
  let redacted = value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
  for (const secret of secrets) if (secret) redacted = redacted.split(secret).join('[REDACTED]')
  return redacted
}

async function readLimitedText(response: Response, maxCharacters: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (text.length < maxCharacters) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return text.slice(0, maxCharacters)
}

async function responseError(response: Response, secrets: string[]): Promise<string> {
  const text = await readLimitedText(response, 2000)
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    const nested = typeof value.error === 'object' && value.error !== null
      ? value.error as Record<string, unknown>
      : undefined
    const message = nested?.message ?? value.error_message ?? value.message ?? value.base_resp
    if (typeof message === 'string') return redactCloudVideoError(message, secrets)
  } catch {}
  return redactCloudVideoError(text, secrets) || `HTTP ${response.status}`
}

async function requestJson(
  provider: CloudVideoProviderId,
  request: CloudHttpRequest,
  apiKey: string
): Promise<unknown> {
  assertProviderUrl(provider, request.url)
  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(request.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(60_000)
  })
  if (!response.ok) throw new Error(`云端接口返回 ${response.status}：${await responseError(response, [apiKey])}`)
  if (response.status === 204) return {}
  const text = await readLimitedText(response, 1_000_000)
  return text ? JSON.parse(text) : {}
}

export async function createCloudVideoTask(
  input: CloudVideoCreateInput,
  auth: CloudVideoAuth
): Promise<CloudVideoTaskSnapshot> {
  const validation = validateCloudVideoInput(input)
  if (validation.length > 0) throw new Error(validation.join('\n'))
  const apiKey = apiKeyFor(input.provider, auth.apiKey)
  const resolved = await resolveReferences(input)
  const request = buildCloudCreateRequest(resolved)
  const serialized = request.body ? JSON.stringify(request.body) : ''
  if (Buffer.byteLength(serialized) > 64 * 1024 * 1024) throw new Error('请求体超过 64 MB，请减少或压缩参考图。')
  const response = await requestJson(input.provider, request, apiKey)
  return { taskId: parseCloudCreateResponse(input.provider, response), status: 'queued' }
}

export async function createMiniMaxH3ContextTask(
  input: CloudVideoCreateInput,
  auth: CloudVideoAuth
): Promise<CloudVideoTaskSnapshot> {
  if (input.provider !== 'minimax' || input.model !== 'MiniMax-H3') throw new Error('Context-IR 只支持 MiniMax-H3。')
  const validation = validateCloudVideoInput(input)
  if (validation.length > 0) throw new Error(validation.join('\n'))
  const apiKey = apiKeyFor('minimax', auth.apiKey)
  const resolved = await resolveReferences(input)
  const request = buildCloudContextRequest(resolved)
  const serialized = request.body ? JSON.stringify(request.body) : ''
  if (Buffer.byteLength(serialized) > 64 * 1024 * 1024) throw new Error('请求体超过 64 MB，请减少或压缩参考素材。')
  const response = await requestJson('minimax', request, apiKey)
  return { taskId: parseCloudCreateResponse('minimax', response), status: 'queued', taskType: 'h3_context_ir' }
}

export async function queryCloudVideoTask(input: CloudVideoQueryInput): Promise<CloudVideoTaskSnapshot> {
  const apiKey = apiKeyFor(input.provider, input.apiKey)
  const response = await requestJson(
    input.provider,
    buildCloudQueryRequest(input.provider, input.taskId, input.baseUrl),
    apiKey
  )
  return parseCloudTaskResponse(input.provider, response)
}

export async function cancelCloudVideoTask(
  input: CloudVideoCancelInput
): Promise<{ action: 'cancelled' | 'deleted' | 'not-cancellable' }> {
  if (input.provider !== 'minimax') throw new Error('当前只支持取消 MiniMax H3 云端任务。')
  if (input.status === 'running') return { action: 'not-cancellable' }
  if (input.status === 'queued') {
    const current = await queryCloudVideoTask(input)
    if (current.status !== 'queued') return { action: 'not-cancellable' }
  }
  const apiKey = apiKeyFor(input.provider, input.apiKey)
  await requestJson(input.provider, buildCloudCancelRequest(input.provider, input.taskId, input.baseUrl), apiKey)
  return { action: input.status === 'queued' ? 'cancelled' : 'deleted' }
}

export async function downloadCloudVideoResult(
  projectFolder: string,
  sourceUrl: string,
  relativePath: string
): Promise<{ relativePath: string; sizeBytes: number }> {
  const portablePath = normalizeProjectRelativePath(relativePath)
  if (!portablePath || !portablePath.startsWith('generated/')) {
    throw new Error('云端视频只能保存到项目 generated 目录。')
  }
  const source = new URL(sourceUrl)
  const localTest = process.env.BLOCKOUT_ALLOW_CLOUD_VIDEO_LOCALHOST === '1' &&
    (source.hostname === '127.0.0.1' || source.hostname === 'localhost')
  if (!localTest && source.protocol !== 'https:') throw new Error('生成结果下载地址必须使用 HTTPS。')
  const base = resolve(projectFolder)
  const output = resolve(base, ...portablePath.split('/'))
  if (!output.startsWith(base + sep)) throw new Error('输出路径超出项目目录。')
  const response = await fetch(source, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`下载生成结果失败：HTTP ${response.status}`)
  const finalSource = new URL(response.url)
  const finalLocalTest = process.env.BLOCKOUT_ALLOW_CLOUD_VIDEO_LOCALHOST === '1' &&
    (finalSource.hostname === '127.0.0.1' || finalSource.hostname === 'localhost')
  if (!finalLocalTest && finalSource.protocol !== 'https:') throw new Error('生成结果重定向到了非 HTTPS 地址。')
  const maxBytes = 2 * 1024 * 1024 * 1024
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new Error('生成结果超过 2 GB 下载上限。')
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
    throw new Error(`生成结果不是视频内容：${contentType}`)
  }
  if (!response.body) throw new Error('生成结果响应没有可读取的数据。')
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.partial-${process.pid}-${Date.now()}`
  const backup = `${output}.backup-${process.pid}-${Date.now()}`
  const handle = await open(temporary, 'wx')
  let sizeBytes = 0
  let backupCreated = false
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sizeBytes += value.byteLength
      if (sizeBytes > maxBytes) throw new Error('生成结果超过 2 GB 下载上限。')
      await writeBufferFully(handle, Buffer.from(value))
    }
    await handle.close()
    try {
      await rename(output, backup)
      backupCreated = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(temporary, output)
    } catch (error) {
      if (backupCreated) await rename(backup, output).catch(() => undefined)
      throw error
    }
    if (backupCreated) await unlink(backup).catch(() => undefined)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return { relativePath: portablePath, sizeBytes }
}
