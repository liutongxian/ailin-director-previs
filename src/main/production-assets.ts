import { readFile, readdir, mkdir, realpath, stat } from 'fs/promises'
import { join, sep, extname } from 'path'
import { createHash } from 'crypto'
import { parseProject } from '../engine/schema'
import { assetDraftErrors, DEFAULT_LOCAL_QWEN, type AssetCreationJob, type AssetCreationDraft } from '../engine/production-assets'
import { connectLocalQwen, generateLocalQwen } from './local-qwen'
import type { ProductionMedia } from '../engine/production'
import { validateProductionFields } from '../engine/production'
import { productionExistingFile } from './production-storage'
import { writeAtomic } from './atomic-file'
import { redactCloudVideoError } from './cloud-video-client'

const active = new Set<string>()
const validId = (id: string): void => { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('素材任务ID无效。') }
const jobPath = (folder: string, id: string): string => { validId(id); return join(folder, '.production', 'asset-jobs', `${id}.json`) }
function checkedJob(raw: string): AssetCreationJob {
  const job = JSON.parse(raw) as AssetCreationJob
  if (!job || typeof job.id !== 'string' || typeof job.projectId !== 'string' || typeof job.createdAt !== 'string' || !['submitting', 'complete', 'unknown', 'dismissed'].includes(job.status) || !Array.isArray(job.references)) throw new Error('素材任务记录无效。')
  validId(job.id)
  const errors = validateProductionFields({ productionAssetDraft: job.input, productionMedia: [...job.references, ...(job.media ? [job.media] : [])] })
  if (errors.length) throw new Error(`素材任务记录无效：${errors.join('；')}`)
  return job
}
async function safeDirectory(folder: string, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  if (!(await realpath(directory)).toLowerCase().startsWith(((await realpath(folder)) + sep).toLowerCase())) throw new Error('素材目录必须位于项目内。')
}
export async function assetCreationJobs(folder: string, projectId: string): Promise<AssetCreationJob[]> {
  let files: string[]
  try { files = await readdir(join(folder, '.production', 'asset-jobs')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const jobs: AssetCreationJob[] = []
  for (const file of files.filter((file) => file.endsWith('.json'))) {
    const path = await productionExistingFile(folder, `.production/asset-jobs/${file}`)
    const job = checkedJob(await readFile(path, 'utf8'))
    if (job.projectId !== projectId) continue
    if (job.status === 'submitting' && !active.has(folder)) { job.status = 'unknown'; job.error = '上次请求未取得结果，请先核对供应商后台。'; await writeAtomic(path, JSON.stringify(job, null, 2)) }
    jobs.push(job)
  }
  return jobs
}
export async function dismissAssetCreation(folder: string, id: string): Promise<void> {
  validId(id)
  const path = await productionExistingFile(folder, `.production/asset-jobs/${id}.json`)
  const job = checkedJob(await readFile(path, 'utf8'))
  if (job.status !== 'unknown') throw new Error('只能关闭已核对的待确认记录。')
  job.status = 'dismissed'; await writeAtomic(path, JSON.stringify(job, null, 2))
}
export async function generateProductionAsset(folder: string, projectId: string, id: string, apiKey: string | undefined, probe: (path: string, kind: ProductionMedia['kind']) => Promise<Partial<ProductionMedia>>, requestedInput?: AssetCreationDraft): Promise<AssetCreationJob> {
  validId(id)
  if (active.has(folder)) throw new Error('正在生成素材，请稍候。')
  active.add(folder)
  try {
    try { const existing = checkedJob(await readFile(await productionExistingFile(folder, `.production/asset-jobs/${id}.json`), 'utf8')); if (existing.projectId !== projectId) throw new Error('素材任务不属于当前项目。'); return existing } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if ((await assetCreationJobs(folder, projectId)).some((job) => ['submitting', 'unknown'].includes(job.status))) throw new Error('请先核对下方未结束的素材任务。')
    const doc = parseProject(await readFile(join(folder, 'project.json'), 'utf8')).doc
    if (!doc || doc.id !== projectId || !doc.productionAssetDraft) throw new Error('请先保存素材制作描述。')
    const input = requestedInput ? structuredClone(requestedInput) : doc.productionAssetDraft
    if (input.assetNeedId && !doc.productionAssetPlan?.some((item) => item.id === input.assetNeedId)) throw new Error('关联的资产清单项不存在，请重新选择。')
    const errors = assetDraftErrors(input)
    if (errors.length) throw new Error(errors.join('\n'))
    const minimax = input.model === 'image-01'
    const local = input.model === 'qwen-image-2.1-local'
    const key = apiKey?.trim() || process.env[minimax ? 'MINIMAX_API_KEY' : 'ARK_API_KEY']?.trim()
    if (!local && !key) throw new Error(`请填写${minimax ? 'MiniMax' : '火山方舟'} API 密钥。`)
    const localSession = local ? await connectLocalQwen((input.localQwen ?? DEFAULT_LOCAL_QWEN).baseUrl, apiKey) : undefined
    if (localSession && !localSession.ready) throw new Error('服务已连接，请先在 Unsloth 中加载 Qwen-Image 2.1。')
    const references: ProductionMedia[] = []
    const images: string[] = []
    for (const id of input.referenceIds) {
      const media = doc.productionMedia?.find((item) => item.id === id)
      if (!media || media.kind !== 'image') throw new Error('参考图片不存在。')
      const full = await productionExistingFile(folder, media.path)
      if ((await stat(full)).size > 10 * 1024 * 1024) throw new Error('当前直传参考图每张最多10 MB，请压缩后重试。')
      const bytes = await readFile(full)
      if (createHash('sha256').update(bytes).digest('hex') !== media.sha256) throw new Error('参考图内容已改变，请重新导入。')
      images.push(`data:image/${extname(full).toLowerCase() === '.png' ? 'png' : extname(full).toLowerCase() === '.webp' ? 'webp' : 'jpeg'};base64,${bytes.toString('base64')}`)
      references.push(media)
    }
    const body = JSON.stringify(minimax
      ? { model: input.model, prompt: input.prompt, width: 2048, height: 2048, response_format: 'base64', n: 1, prompt_optimizer: false, aigc_watermark: true }
      : { model: input.model, prompt: input.prompt, size: input.size, response_format: 'b64_json', sequential_image_generation: 'disabled', watermark: true, ...(images.length ? { image: images } : {}) })
    if (Buffer.byteLength(body) > 48 * 1024 * 1024) throw new Error('参考图片合计过大，请减少图片。')
    const job: AssetCreationJob = { id, projectId, input, references, status: 'submitting', createdAt: new Date().toISOString() }
    await safeDirectory(folder, join(folder, '.production', 'asset-jobs'))
    await safeDirectory(folder, join(folder, 'media'))
    await writeAtomic(jobPath(folder, id), JSON.stringify(job, null, 2))
    try {
      let bytes: Buffer
      if (localSession) bytes = await generateLocalQwen(localSession, input, images)
      else {
      const response = await fetch(minimax ? 'https://api.minimax.cn/v1/image_generation' : 'https://ark.cn-beijing.volces.com/api/v3/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(300000), redirect: 'error' })
      if (!response.body) throw new Error('图片服务返回空响应。')
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let length = 0
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 100 * 1024 * 1024) { await reader.cancel(); throw new Error('图片服务返回内容过大。') } chunks.push(value) }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: { b64_json?: string }[] | { image_base64?: string[] }; error?: { message?: string }; base_resp?: { status_code?: number; status_msg?: string } }
      const encoded = Array.isArray(data.data) ? data.data[0]?.b64_json : data.data?.image_base64?.[0]
      if (!response.ok || data.base_resp?.status_code || !encoded) throw new Error(data.error?.message || data.base_resp?.status_msg || `图片服务返回 ${response.status}，没有图片结果。`)
      bytes = Buffer.from(encoded.replace(/^data:image\/[^;]+;base64,/, ''), 'base64')
      }
      const extension = bytes[0] === 137 && bytes[1] === 80 ? '.png' : '.jpg'
      const path = `media/${id}${extension}`
      await writeAtomic(join(folder, path), bytes)
      const metadata = await probe(join(folder, path), 'image')
      job.media = { ...metadata, id: `media-${id}`, name: `${input.name.trim() || '生成素材'}${extension}`, kind: 'image', path, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, createdAt: new Date().toISOString(), description: input.prompt }
      job.status = 'complete'
    } catch (error) { job.status = 'unknown'; job.error = redactCloudVideoError(String(error instanceof Error ? error.message : error), [key ?? '', localSession?.password ?? '', localSession?.token ?? '']) + (local ? '；请核对 Unsloth 图库，本软件没有自动重试。' : '；请核对后台，本软件没有自动重试。') }
    await writeAtomic(jobPath(folder, id), JSON.stringify(job, null, 2))
    return job
  } finally { active.delete(folder) }
}
