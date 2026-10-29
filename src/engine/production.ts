import type { CloudVideoCreateInput, CloudVideoTaskSnapshot } from './cloud-video'
import { getCloudVideoProvider, getCloudVideoModel, validateCloudVideoInput } from './cloud-video'
import type { ProjectDoc, Shot } from './types'
import { normalizeProjectRelativePath } from '../shared/portable-paths'
import { ASSET_MODELS, localQwenOptionsValid } from './production-assets'
import { validateAssetPlan } from './production-asset-plan'

export type MediaPurpose = 'character' | 'scene' | 'prop' | 'style' | 'first-frame' | 'last-frame' | 'action' | 'camera' | 'rhythm' | 'audio'
export interface ProductionMedia {
  id: string
  name: string
  kind: 'image' | 'video' | 'audio'
  path: string
  sha256: string
  sizeBytes: number
  createdAt: string
  width?: number
  height?: number
  duration?: number
  description?: string
  cloudSources?: Partial<Record<CloudVideoCreateInput['provider'], string>>
}
export interface ProductionReference { mediaId: string; purpose: MediaPurpose; assetNeedId?: string }
export interface GenerationInput {
  provider: CloudVideoCreateInput['provider']
  model: string
  prompt: string
  duration: number
  resolution: string
  ratio: string
  references: ProductionReference[]
  generateAudio: boolean
}
export interface GenerationSnapshot {
  input: GenerationInput
  media: ProductionMedia[]
}
export interface ProductionAttempt {
  id: string
  projectId: string
  shotId: string
  createdAt: string
  updatedAt: string
  status: CloudVideoTaskSnapshot['status'] | 'submitting' | 'unknown'
  taskId?: string
  snapshot: GenerationSnapshot
  outputUrl?: string
  localPath?: string
  error?: string
}
export const PURPOSE_LABELS: Record<MediaPurpose, string> = {
  character: '人物', scene: '场景', prop: '道具', style: '画风', 'first-frame': '首帧', 'last-frame': '尾帧', action: '动作', camera: '运镜', rhythm: '节奏', audio: '声音'
}
export function mediaPurposes(kind: ProductionMedia['kind']): MediaPurpose[] {
  return kind === 'image' ? ['character', 'scene', 'prop', 'style', 'first-frame', 'last-frame'] : kind === 'video' ? ['action', 'camera', 'rhythm'] : ['audio']
}
export function defaultGenerationInput(shot: Shot): GenerationInput {
  return { provider: 'minimax', model: 'MiniMax-H3', prompt: shot.h3Prompt?.draft || shot.storyboard?.content || shot.notes || '', duration: Math.min(15, Math.max(4, Math.round(shot.duration))), resolution: '768P', ratio: shot.aspect === '9:16' ? '9:16' : '16:9', references: [], generateAudio: false }
}
export function captureGenerationInput(doc: ProjectDoc, shot: Shot): GenerationSnapshot {
  const input = structuredClone(shot.generationInput ?? defaultGenerationInput(shot))
  const media = input.references.map((reference) => {
    const item = doc.productionMedia?.find((candidate) => candidate.id === reference.mediaId)
    if (!item) throw new Error('所选参考素材不存在，请重新选择。')
    if (!mediaPurposes(item.kind).includes(reference.purpose)) throw new Error('参考素材与用途不匹配。')
    return structuredClone(item)
  })
  return { input, media }
}
/** The endpoint and credential are deliberately outside the saved project. */
export function generationRequest(snapshot: GenerationSnapshot): CloudVideoCreateInput {
  const { input, media } = snapshot
  const references = input.references.map((reference, index) => {
    const item = media[index]
    if (!item || item.id !== reference.mediaId || !normalizeProjectRelativePath(item.path)) throw new Error('参考素材快照不完整。')
    const cloud = item.cloudSources?.[input.provider]?.trim()
    return { id: item.id, kind: item.kind, source: cloud ? cloud.startsWith('asset://') ? 'asset' as const : 'url' as const : 'file' as const, value: cloud || item.path, name: item.name, role: reference.purpose === 'first-frame' || reference.purpose === 'last-frame' ? reference.purpose : 'reference' as const }
  })
  const referenceNotes = input.references.map((reference, index) => `${media[index]!.name}：${PURPOSE_LABELS[reference.purpose]}参考`).join('；')
  return { provider: input.provider, model: input.model, baseUrl: getCloudVideoProvider(input.provider).defaultBaseUrl, prompt: input.prompt + (referenceNotes ? `\n参考用途：${referenceNotes}。` : ''), references, mode: references.some((item) => item.role !== 'reference') ? 'first-last-frame' : references.length ? 'reference' : 'text', duration: input.duration, resolution: input.resolution, ratio: input.ratio, generateAudio: input.generateAudio }
}
export function generationProblems(doc: ProjectDoc, shot: Shot): string[] {
  try { return validateCloudVideoInput(generationRequest(captureGenerationInput(doc, shot))) } catch (error) { return [String(error instanceof Error ? error.message : error)] }
}
export function mergeProductionAttempts(doc: ProjectDoc, attempts: ProductionAttempt[]): void {
  for (const attempt of attempts) {
    if (attempt.projectId !== doc.id) continue
    const shot = doc.scenes.flatMap((scene) => [...scene.shots, ...(scene.drafts ?? [])]).find((item) => item.id === attempt.shotId)
    if (!shot) continue
    const existing = (shot.productionAttempts ??= []).findIndex((item) => item.id === attempt.id)
    if (existing < 0) shot.productionAttempts.push(structuredClone(attempt))
    else if (attempt.updatedAt >= shot.productionAttempts[existing]!.updatedAt) shot.productionAttempts[existing] = structuredClone(attempt)
  }
}
/** Paragraph splitting is explicitly a manual aid, never presented as AI understanding. */
export function scriptParagraphs(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean)
}
export function selectedProductionClips(doc: ProjectDoc): { shotId: string; name: string; relativePath: string; trimHeadFrames: number; fps: number }[] {
  return doc.scenes.flatMap((scene) => scene.shots.map((shot) => {
    const candidate = shot.productionAttempts?.find((item) => item.id === shot.selectedProductionAttemptId)
    if (!candidate?.localPath || candidate.status !== 'complete') throw new Error(`${shot.name} 尚未采用已下载的视频。`)
    return { shotId: shot.id, name: shot.name, relativePath: candidate.localPath, trimHeadFrames: 0, fps: shot.fps }
  }))
}

/** Validate persisted additions without changing the established project schema. */
export function validateProductionFields(value: unknown): string[] {
  const errors: string[] = []
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const supportedModel = (v: Record<string, unknown>): boolean => { try { getCloudVideoModel(v.provider as CloudVideoCreateInput['provider'], String(v.model)); return true } catch { return false } }
  if (!object(value)) return ['项目格式无效']
  if (value.productionAssetPlan !== undefined && !validateAssetPlan(value.productionAssetPlan)) errors.push('资产清单格式无效')
  if (value.productionAssetDraft !== undefined) {
    const draft = value.productionAssetDraft
    if (object(draft) && draft.localQwen !== undefined && !localQwenOptionsValid(draft.localQwen)) errors.push('本地图片设置无效')
    if (object(draft) && draft.assetNeedId !== undefined && typeof draft.assetNeedId !== 'string') errors.push('素材关联资产ID无效')
    if (!object(draft) || typeof draft.name !== 'string' || typeof draft.prompt !== 'string' || !ASSET_MODELS.some((model) => model.id === draft.model) || !['2K', '4K'].includes(String(draft.size)) || !Array.isArray(draft.referenceIds) || draft.referenceIds.some((id) => typeof id !== 'string')) errors.push('素材制作草稿格式无效')
  }
  const mediaCheck = (v: unknown): boolean => object(v) && typeof v.id === 'string' && typeof v.name === 'string' && ['image', 'video', 'audio'].includes(String(v.kind)) && typeof v.path === 'string' && !!normalizeProjectRelativePath(v.path) && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256) && typeof v.sizeBytes === 'number' && v.sizeBytes > 0 && typeof v.createdAt === 'string'
  const inputCheck = (v: unknown): boolean => object(v) && supportedModel(v) && typeof v.prompt === 'string' && typeof v.duration === 'number' && Number.isFinite(v.duration) && v.duration > 0 && typeof v.resolution === 'string' && typeof v.ratio === 'string' && typeof v.generateAudio === 'boolean' && Array.isArray(v.references) && v.references.every((ref) => object(ref) && typeof ref.mediaId === 'string' && Object.hasOwn(PURPOSE_LABELS, String(ref.purpose)))
  if (value.productionMedia !== undefined && (!Array.isArray(value.productionMedia) || !value.productionMedia.every(mediaCheck))) errors.push('项目素材格式或相对路径无效')
  if (Array.isArray(value.productionMedia) && value.productionMedia.every(mediaCheck) && new Set(value.productionMedia.map((item: ProductionMedia) => item.id)).size !== value.productionMedia.length) errors.push('项目素材ID重复')
  if (value.productionExport !== undefined && (!object(value.productionExport) || !['16:9', '9:16', '1:1'].includes(String(value.productionExport.aspect)) || value.productionExport.musicMediaId !== undefined && typeof value.productionExport.musicMediaId !== 'string')) errors.push('成片设置无效')
  if (value.productionFilms !== undefined && (!Array.isArray(value.productionFilms) || !value.productionFilms.every((v) => object(v) && typeof v.path === 'string' && !!normalizeProjectRelativePath(v.path) && typeof v.subtitlePath === 'string' && !!normalizeProjectRelativePath(v.subtitlePath) && typeof v.duration === 'number' && Number.isFinite(v.duration) && v.duration > 0 && typeof v.createdAt === 'string'))) errors.push('成片记录或路径无效')
  if (value.scriptHistory !== undefined && (!Array.isArray(value.scriptHistory) || !value.scriptHistory.every((v) => object(v) && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.text === 'string' && typeof v.createdAt === 'string'))) errors.push('剧本版本格式无效')
  if (Array.isArray(value.scenes)) for (const scene of value.scenes) {
    if (!object(scene) || !Array.isArray(scene.shots)) continue
    for (const shot of [...scene.shots, ...(Array.isArray(scene.drafts) ? scene.drafts : [])]) {
      if (!object(shot)) continue
      if (shot.productionEdit !== undefined && (!object(shot.productionEdit) || ['trimStart', 'trimEnd'].some((key) => shot.productionEdit && object(shot.productionEdit) && shot.productionEdit[key] !== undefined && (typeof shot.productionEdit[key] !== 'number' || !Number.isFinite(shot.productionEdit[key]) || (shot.productionEdit[key] as number) < 0)) || shot.productionEdit.caption !== undefined && typeof shot.productionEdit.caption !== 'string')) errors.push('镜头裁剪或字幕格式无效')
      if (shot.generationInput !== undefined && !inputCheck(shot.generationInput)) errors.push('镜头生成输入格式无效')
      if (shot.selectedProductionAttemptId !== undefined && typeof shot.selectedProductionAttemptId !== 'string') errors.push('采用版本ID无效')
      if (shot.productionAttempts !== undefined && (!Array.isArray(shot.productionAttempts) || !shot.productionAttempts.every((v) => object(v) && typeof v.id === 'string' && typeof v.projectId === 'string' && typeof v.shotId === 'string' && typeof v.createdAt === 'string' && typeof v.updatedAt === 'string' && ['submitting', 'unknown', 'queued', 'running', 'complete', 'failed', 'expired', 'cancelled'].includes(String(v.status)) && object(v.snapshot) && inputCheck(v.snapshot.input) && Array.isArray(v.snapshot.media) && v.snapshot.media.every(mediaCheck) && (v.localPath === undefined || typeof v.localPath === 'string' && !!normalizeProjectRelativePath(v.localPath))))) errors.push('生成版本或输出路径无效')
    }
  }
  return errors
}
