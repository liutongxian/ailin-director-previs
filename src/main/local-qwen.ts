import { DEFAULT_LOCAL_QWEN, type AssetCreationDraft } from '../engine/production-assets'
import { redactCloudVideoError } from './cloud-video-client'

export function localQwenOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('请填写本地 Unsloth 服务地址，例如 http://127.0.0.1:8888。') }
  const h = url.hostname, parts = h.split('.').map(Number)
  const privateHost = h === 'localhost' || h === '[::1]' || parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && (parts[0] === 127 || parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31 || parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127)
  if (!privateHost || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('本地服务请使用本机、局域网或 Tailscale 的 IP 地址，不要在地址中填写密码或接口路径。')
  return url.origin
}
async function limitedBody(response: Response, max: number): Promise<Buffer> {
  if (!response.body) throw new Error('本地图片服务返回空响应。')
  const chunks: Uint8Array[] = [], reader = response.body.getReader()
  let length = 0
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new Error('本地图片响应过大。') } chunks.push(value) }
  return Buffer.concat(chunks)
}
interface QwenSession { origin: string; token: string; password: string; model: string; ready: boolean }
export async function connectLocalQwen(baseUrl: string, suppliedPassword?: string): Promise<QwenSession> {
  const origin = localQwenOrigin(baseUrl)
  const password = suppliedPassword?.trim() || process.env.LOCAL_QWEN_PASSWORD?.trim() || ''
  if (!password) throw new Error('请填写 Unsloth 登录密码（只在本次打开期间使用）。')
  let token = ''
  try {
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'unsloth', password }), signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (!login.ok) throw new Error(`Unsloth 登录失败（${login.status}），请检查密码。`)
    const auth = JSON.parse((await limitedBody(login, 65536)).toString()) as { access_token?: string }
    if (!auth.access_token || typeof auth.access_token !== 'string') throw new Error('Unsloth 未返回登录凭据。')
    token = auth.access_token
    const response = await fetch(`${origin}/api/inference/images/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (!response.ok) throw new Error(`无法读取本地模型状态（${response.status}）。`)
    const status = JSON.parse((await limitedBody(response, 1048576)).toString()) as { loaded?: boolean; repo_id?: string; base_repo?: string; family?: string }
    const model = status.repo_id || status.base_repo || status.family || ''
    return { origin, token, password, model, ready: status.loaded === true && /qwen[\s_-]*image[\s_-]*2[._-]?1/i.test([model, status.base_repo, status.family].join(' ')) }
  } catch (error) { throw new Error(redactCloudVideoError(String(error instanceof Error ? error.message : error), [password, token]) + '；请确认 Unsloth 已启动且地址可达。') }
}
export async function localQwenStatus(baseUrl: string, password?: string): Promise<{ ready: boolean; message: string }> {
  const session = await connectLocalQwen(baseUrl, password)
  return { ready: session.ready, message: session.ready ? `已连接 · ${session.model}` : '服务已连接，请在 Unsloth 中加载 Qwen-Image 2.1 后再生成。' }
}
export async function generateLocalQwen(session: QwenSession, input: AssetCreationDraft, images: string[]): Promise<Buffer> {
  if (!session.ready) throw new Error('请先在 Unsloth 中加载 Qwen-Image 2.1。')
  const options = input.localQwen ?? DEFAULT_LOCAL_QWEN
  try {
    const response = await fetch(`${session.origin}/api/inference/images/generate`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: input.prompt, width: options.width, height: options.height, steps: options.steps, guidance: 4, batch_size: 1, ...(images.length ? { workflow: 'reference', init_image: images[0], reference_images: images.slice(1), reference_resolution: 512 } : {}) }), signal: AbortSignal.timeout(1800000), redirect: 'error' })
    const data = JSON.parse((await limitedBody(response, 1048576)).toString()) as { images?: { url?: string; model?: string }[]; detail?: string }
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `本地生成失败（${response.status}）。`)
    const image = data.images?.[0]
    if (!image?.url) throw new Error('本地服务未返回生成图片。')
    if (image.model && !/qwen[\s_-]*image[\s_-]*2[._-]?1/i.test(image.model)) throw new Error('本地模型已切换，结果未作为 Qwen-Image 2.1 素材接收。')
    const url = new URL(image.url, session.origin)
    if (url.origin !== session.origin || url.username || url.password || !/^\/api\/inference\/images\/gallery\/[^/]+\/file$/.test(url.pathname) || url.search || url.hash) throw new Error('本地服务返回的图片地址不属于当前图库。')
    const download = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(120000), redirect: 'error' })
    if (!download.ok) throw new Error(`生成已返回，但图片下载失败（${download.status}）；请在 Unsloth 图库找回。`)
    const bytes = await limitedBody(download, 100 * 1024 * 1024)
    if (!(bytes[0] === 137 && bytes[1] === 80 || bytes[0] === 255 && bytes[1] === 216)) throw new Error('本地服务返回的文件不是 PNG 或 JPEG 图片。')
    return bytes
  } catch (error) { throw new Error(redactCloudVideoError(String(error instanceof Error ? error.message : error), [session.password, session.token])) }
}
