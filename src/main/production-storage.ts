import { readFile, stat, realpath, mkdir, readdir, access, rm } from 'fs/promises'
import { basename, extname, join, resolve, sep } from 'path'
import { createHash, randomUUID } from 'crypto'
import type { ProductionAttempt, ProductionMedia } from '../engine/production'
import { captureGenerationInput, generationRequest, validateProductionFields } from '../engine/production'
import { parseProject } from '../engine/schema'
import { getCloudVideoProvider, validateCloudVideoInput } from '../engine/cloud-video'
import { normalizeProjectRelativePath } from '../shared/portable-paths'
import { createCloudVideoTask, queryCloudVideoTask, downloadCloudVideoResult, redactCloudVideoError } from './cloud-video-client'
import { writeAtomic } from './atomic-file'

const MEDIA: Record<string, ProductionMedia['kind']> = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio' }
const inFlight = new Map<string, Promise<ProductionAttempt>>()
const locks = new Map<string, Promise<ProductionAttempt>>()
const submittingShots = new Set<string>()
const idCheck = (id: string): void => { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('任务ID无效。') }
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const journalPath = (folder: string, id: string): string => { idCheck(id); return join(folder, '.production', 'tasks', `${id}.json`) }
async function existingFile(folder: string, relative: string): Promise<string> {
  const portable = normalizeProjectRelativePath(relative)
  if (!portable) throw new Error('素材必须位于项目内。')
  const root = await realpath(folder)
  const full = await realpath(resolve(root, ...portable.split('/')))
  if (!full.toLowerCase().startsWith((root + sep).toLowerCase())) throw new Error('素材链接指向项目外。')
  return full
}
export const productionExistingFile = existingFile
export async function importProductionMedia(folder: string, source: string, probe: (file: string, kind: ProductionMedia['kind']) => Promise<Partial<Pick<ProductionMedia, 'width' | 'height' | 'duration'>>>): Promise<ProductionMedia> {
  const extension = extname(source).toLowerCase()
  const kind = MEDIA[extension]
  if (!kind) throw new Error('请选择 PNG/JPG/WEBP 图片，MP4/MOV/WEBM 视频或 MP3/WAV/M4A/AAC 音频。')
  const info = await stat(source)
  if (!info.isFile() || !info.size || info.size > 200 * 1024 * 1024) throw new Error('请选择非空且不超过200 MB的素材。')
  const bytes = await readFile(source)
  const digest = hash(bytes)
  const id = `media-${randomUUID()}`
  const relative = `media/${id}${extension}`
  await mkdir(join(folder, 'media'), { recursive: true })
  const root = await realpath(folder)
  if (!(await realpath(join(folder, 'media'))).toLowerCase().startsWith((root + sep).toLowerCase())) throw new Error('项目素材目录不可链接到外部。')
  await writeAtomic(join(folder, relative), bytes)
  // Probe the immutable copied bytes, not a source file which may have changed.
  let metadata: Awaited<ReturnType<typeof probe>>
  try { metadata = await probe(join(folder, relative), kind) } catch (error) { await rm(join(folder, relative), { force: true }); throw error }
  return { id, name: basename(source), kind, path: relative, sha256: digest, sizeBytes: bytes.length, createdAt: new Date().toISOString(), ...metadata }
}
async function writeAttempt(folder: string, attempt: ProductionAttempt): Promise<void> {
  await mkdir(join(folder, '.production', 'tasks'), { recursive: true })
  const root = await realpath(folder)
  if (!(await realpath(join(folder, '.production', 'tasks'))).toLowerCase().startsWith((root + sep).toLowerCase())) throw new Error('任务目录不可链接到项目外。')
  await writeAtomic(journalPath(folder, attempt.id), JSON.stringify(attempt, null, 2))
}
async function readAttempt(folder: string, id: string): Promise<ProductionAttempt> {
  idCheck(id)
  const full = await existingFile(folder, `.production/tasks/${id}.json`)
  const attempt = JSON.parse(await readFile(full, 'utf8')) as ProductionAttempt
  const errors = validateProductionFields({ scenes: [{ shots: [{ productionAttempts: [attempt] }] }] })
  if (attempt.id !== id || errors.length) throw new Error(`任务记录无效：${id}`)
  return attempt
}
export async function listProductionAttempts(folder: string, projectId: string): Promise<ProductionAttempt[]> {
  let names: string[]
  try { names = await readdir(join(folder, '.production', 'tasks')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const attempts: ProductionAttempt[] = []
  for (const name of names.filter((name) => name.endsWith('.json'))) {
    const attempt = await readAttempt(folder, name.slice(0, -5))
    if (attempt.projectId !== projectId) continue
    if (attempt.status === 'submitting' && !inFlight.has(journalPath(folder, attempt.id))) {
      attempt.status = 'unknown'; attempt.error = '上次提交未取得回执。请在供应商后台核对，并填入任务ID恢复查询，避免重复扣费。'
      attempt.updatedAt = new Date().toISOString(); await writeAttempt(folder, attempt)
    }
    attempts.push(attempt)
  }
  return attempts.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
export function submitProductionAttempt(folder: string, projectId: string, shotId: string, id: string, apiKey?: string): Promise<ProductionAttempt> {
  idCheck(id)
  const taskPath = journalPath(folder, id)
  const existing = inFlight.get(taskPath)
  if (existing) return existing
  const shotKey = `${resolve(folder).toLowerCase()}:${shotId}`
  if (submittingShots.has(shotKey)) return Promise.reject(new Error('此镜头正在提交，请稍候。'))
  submittingShots.add(shotKey)
  const run = (async () => {
    try { await access(taskPath); return await readAttempt(folder, id) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parsed = parseProject(await readFile(join(folder, 'project.json'), 'utf8'))
    const doc = parsed.doc
    if (!doc) throw new Error('项目文件校验失败。')
    if (doc.id !== projectId) throw new Error('项目已切换，请重试。')
    const shot = doc.scenes.flatMap((scene) => scene.shots).find((item) => item.id === shotId)
    if (!shot) throw new Error('镜头不存在。')
    const pending = (await listProductionAttempts(folder, projectId)).find((item) => item.shotId === shotId && ['submitting', 'unknown', 'queued', 'running'].includes(item.status))
    if (pending) throw new Error('此镜头还有未结束的任务，请先查询或核对原任务。')
    const snapshot = captureGenerationInput(doc, shot)
    const input = generationRequest(snapshot)
    const errors = validateCloudVideoInput(input)
    if (errors.length) throw new Error(errors.join('\n'))
    const definition = getCloudVideoProvider(input.provider)
    const key = apiKey?.trim() || process.env[definition.apiKeyEnvironmentVariable]?.trim()
    if (!key) throw new Error('请先填写所选供应商的 API 密钥。')
    for (let i = 0; i < snapshot.media.length; i++) {
      const media = snapshot.media[i]!
      const full = await existingFile(folder, media.path)
      const info = await stat(full)
      if (info.size !== media.sizeBytes || input.references[i]!.source === 'file' && info.size >= 45 * 1024 * 1024) throw new Error(`${media.name} 已改变或超过云端45 MB限制。`)
      if (hash(await readFile(full)) !== media.sha256) throw new Error(`${media.name} 文件已改变，请重新导入。`)
      if (input.references[i]!.source === 'file') input.references[i]!.value = full
    }
    const attempt: ProductionAttempt = { id, projectId, shotId, snapshot, status: 'submitting', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await writeAttempt(folder, attempt)
    try {
      const result = await createCloudVideoTask(input, { apiKey: key })
      Object.assign(attempt, result, { updatedAt: new Date().toISOString() })
    } catch (error) {
      attempt.status = 'unknown'
      attempt.error = redactCloudVideoError(String(error instanceof Error ? error.message : error), [key]) + '；未自动重试，请先核对供应商后台。'
      attempt.updatedAt = new Date().toISOString()
    }
    await writeAttempt(folder, attempt)
    return attempt
  })()
  inFlight.set(taskPath, run)
  void run.finally(() => { inFlight.delete(taskPath); submittingShots.delete(shotKey) }).catch(() => {})
  return run
}
export function updateProductionAttempt(folder: string, id: string, action: 'query' | 'download' | 'recover' | 'dismiss', apiKey?: string, recoveredTaskId?: string): Promise<ProductionAttempt> {
  const path = journalPath(folder, id)
  if (locks.has(path)) return locks.get(path)!
  const run = (async () => {
    const attempt = await readAttempt(folder, id)
    if (action === 'recover') {
      if (attempt.status !== 'unknown' || !recoveredTaskId?.trim()) throw new Error('请填写供应商后台的任务ID。')
      attempt.taskId = recoveredTaskId.trim(); attempt.status = 'queued'; delete attempt.error
    } else if (action === 'dismiss') {
      if (attempt.status !== 'unknown') throw new Error('仅可关闭已核对的未知任务。')
      attempt.status = 'failed'; attempt.error = '用户在供应商后台核对后关闭此记录。'
    } else if (action === 'query') {
      if (!attempt.taskId) throw new Error('没有任务ID，请先恢复任务。')
      const result = await queryCloudVideoTask({ provider: attempt.snapshot.input.provider, taskId: attempt.taskId, apiKey })
      Object.assign(attempt, result)
      if (!result.error) delete attempt.error
    } else {
      if (attempt.status !== 'complete' || !attempt.outputUrl) throw new Error('任务尚无可下载的视频。')
      if (attempt.localPath) { await existingFile(folder, attempt.localPath); return attempt }
      const relative = `generated/production/${attempt.id}.mp4`
      await downloadCloudVideoResult(folder, attempt.outputUrl, relative)
      attempt.localPath = relative
    }
    attempt.updatedAt = new Date().toISOString()
    await writeAttempt(folder, attempt)
    return attempt
  })()
  locks.set(path, run)
  void run.finally(() => locks.delete(path)).catch(() => {})
  return run
}
