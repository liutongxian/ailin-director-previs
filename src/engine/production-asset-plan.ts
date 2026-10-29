import type { ProjectDoc, Shot } from './types'
import { parsePrevisIR, type PrevisIR } from './previs-ir'
import { defaultGenerationInput } from './production'
import type { AssetCreationJob } from './production-assets'
import { newId } from './ids'

export type ProductionAssetKind = 'character' | 'scene' | 'prop'
export const ASSET_KIND_LABELS: Record<ProductionAssetKind, string> = { character: '人物', scene: '场景', prop: '道具' }
export interface ProductionAssetNeed {
  id: string
  sourceId: string
  sourceName: string
  kind: ProductionAssetKind
  name: string
  description: string
  prompt: string
  generatedPrompt: string
  sourceShotIds: string[]
  autoShotIds: string[]
  shotIds: string[]
  referenceIds: string[]
  mediaIds: string[]
  selectedMediaId?: string
}

const shotsOf = (doc: ProjectDoc): Shot[] => doc.scenes.flatMap((scene) => scene.shots)
const unique = (values: string[]): string[] => [...new Set(values)]
const normalize = (value: string): string => value.trim().replace(/\s+/gu, '').toLowerCase()

/** Only structural input changes trigger reconciliation, in the same undo transaction. */
export function assetPlanSource(doc: ProjectDoc): string {
  return JSON.stringify([doc.previsIR?.text, shotsOf(doc).map((shot) => [shot.id, shot.storyboard?.sourceShotId])])
}

function promptFor(kind: ProductionAssetKind, name: string, description: string, proposed?: string): string {
  const framing = kind === 'character'
    ? '单个人物设定参考图，全身，面部和服装清晰，简洁背景。'
    : kind === 'scene' ? '场景设定参考图，清晰交代空间布局、主要陈设和出入口，不加入人物。'
      : '单个道具设定参考图，造型、材质和细节清晰，简洁背景。'
  return [proposed?.trim() || `${name}。${description}\n${framing}`, '与所选参考图保持身份、造型和画风一致。单张完整画面，不拼图，不加标题、字幕或标注。'].join('\n')
}

/** Reuse validated model identities; never guess character names from paragraph boundaries. */
export function syncProductionAssetPlan(doc: ProjectDoc): void {
  if (!doc.previsIR) return
  const parsed = parsePrevisIR(doc.previsIR.text)
  if (!parsed.ok) return
  const ir: PrevisIR = parsed.ir
  const shots = shotsOf(doc), liveIds = new Set(shots.map((shot) => shot.id))
  const previous = doc.productionAssetPlan ?? []
  const claimed = new Set<string>()
  const candidates = [
    ...ir.assets.map((asset) => ({ ...asset, kind: (asset.type === 'character' || asset.type === 'animal' ? 'character' : 'prop') as ProductionAssetKind, uses: ir.shots.filter((shot) => shot.entities.some((entity) => entity.refId === asset.id)) })),
    ...(ir.locations ?? []).map((location) => ({ ...location, kind: 'scene' as const, uses: ir.shots.filter((shot) => shot.locationId === location.id) }))
  ].filter((asset) => asset.uses.length > 0)
  const next = candidates.map((asset): ProductionAssetNeed => {
    const matches = previous.filter((item) => item.kind === asset.kind && normalize(item.sourceName) === normalize(asset.name) && !claimed.has(item.id))
    const old = matches.find((item) => item.sourceId === asset.id) ?? (matches.length === 1 ? matches[0] : undefined)
    if (old) claimed.add(old.id)
    const sourceShotIds = asset.uses.map((shot) => shot.id)
    const autoShotIds = shots.filter((shot) => sourceShotIds.includes(shot.storyboard?.sourceShotId ?? '')).map((shot) => shot.id)
    const description = asset.visualDescription?.trim() || `${asset.name}${asset.semanticType ? `（${asset.semanticType}）` : ''}。\n分镜依据：${asset.uses.map((shot) => shot.sourceText).filter(Boolean).slice(0, 4).join('\n')}\n未明确的外貌、服装或材质请结合参考图检查。`
    const generatedPrompt = promptFor(asset.kind, asset.name, description, asset.imagePrompt)
    const additions = old?.shotIds.filter((id) => !old.autoShotIds.includes(id) && liveIds.has(id)) ?? []
    const exclusions = old?.autoShotIds.filter((id) => !old.shotIds.includes(id)) ?? []
    return {
      id: old?.id ?? newId('need'), sourceId: asset.id, sourceName: asset.name, kind: asset.kind,
      name: old && old.name !== old.sourceName ? old.name : asset.name, description,
      prompt: old && old.prompt !== old.generatedPrompt ? old.prompt : generatedPrompt, generatedPrompt,
      sourceShotIds, autoShotIds, shotIds: unique([...autoShotIds.filter((id) => !exclusions.includes(id)), ...additions]),
      referenceIds: old?.referenceIds ?? [], mediaIds: old?.mediaIds ?? [], ...(old?.selectedMediaId ? { selectedMediaId: old.selectedMediaId } : {})
    }
  })
  // Retain user work on assets removed from the latest breakdown, without stale automatic shot links.
  for (const old of previous.filter((item) => !claimed.has(item.id))) {
    next.push({ ...old, sourceShotIds: [], autoShotIds: [], shotIds: old.shotIds.filter((id) => liveIds.has(id) && !old.autoShotIds.includes(id)) })
  }
  if (next.length || doc.productionAssetPlan) doc.productionAssetPlan = next
  syncAssetReferences(doc)
}

/** Only replace references owned by this checklist. Manual references and paid task snapshots stay intact. */
export function syncAssetReferences(doc: ProjectDoc): void {
  const needs = doc.productionAssetPlan ?? []
  for (const shot of shotsOf(doc)) {
    const managed = needs.filter((need) => need.shotIds.includes(shot.id) && need.selectedMediaId && doc.productionMedia?.some((media) => media.id === need.selectedMediaId && media.kind === 'image'))
    if (!managed.length && !shot.generationInput?.references.some((reference) => reference.assetNeedId)) continue
    const input = shot.generationInput ??= defaultGenerationInput(shot)
    input.references = input.references.filter((reference) => !reference.assetNeedId)
    for (const need of managed) if (!input.references.some((reference) => reference.mediaId === need.selectedMediaId)) {
      input.references.push({ mediaId: need.selectedMediaId!, purpose: need.kind, assetNeedId: need.id })
    }
  }
}

export function selectAssetMedia(doc: ProjectDoc, needId: string, mediaId: string): void {
  const need = doc.productionAssetPlan?.find((item) => item.id === needId)
  if (!need) throw new Error('资产清单项不存在。')
  if (!doc.productionMedia?.some((item) => item.id === mediaId && item.kind === 'image')) throw new Error('请选择项目内的图片。')
  need.mediaIds = unique([...need.mediaIds, mediaId])
  need.selectedMediaId = mediaId
  syncAssetReferences(doc)
}

/** Receipts bind to their saved asset ID, never to whichever card is currently open. */
export function hasUnreceivedAssetJobs(doc: ProjectDoc, jobs: AssetCreationJob[]): boolean {
  return jobs.some((job) => job.projectId === doc.id && job.status === 'complete' && job.media && (!doc.productionMedia?.some((media) => media.id === job.media!.id)
    || doc.productionAssetPlan?.some((need) => need.id === job.input.assetNeedId && !need.mediaIds.includes(job.media!.id))))
}

export function receiveAssetJobs(doc: ProjectDoc, jobs: AssetCreationJob[]): void {
  for (const job of jobs) {
    if (job.projectId !== doc.id || job.status !== 'complete' || !job.media) continue
    if (!doc.productionMedia?.some((item) => item.id === job.media!.id)) (doc.productionMedia ??= []).push(structuredClone(job.media))
    const need = doc.productionAssetPlan?.find((item) => item.id === job.input.assetNeedId)
    if (!need || need.mediaIds.includes(job.media.id)) continue
    need.mediaIds.push(job.media.id)
    // The first result is linked immediately; subsequent versions wait for explicit selection.
    if (!need.selectedMediaId) need.selectedMediaId = job.media.id
  }
  syncAssetReferences(doc)
}

export function validateAssetPlan(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((item) => typeof item === 'string') && new Set(v).size === v.length
  return new Set(value.map((item) => item?.id)).size === value.length && value.every((item) => item && typeof item === 'object'
    && ['id', 'sourceId', 'sourceName', 'name', 'description', 'prompt', 'generatedPrompt'].every((key) => typeof item[key] === 'string')
    && ['character', 'scene', 'prop'].includes(item.kind) && ['sourceShotIds', 'autoShotIds', 'shotIds', 'referenceIds', 'mediaIds'].every((key) => strings(item[key]))
    && item.referenceIds.length <= 14 && (item.selectedMediaId === undefined || typeof item.selectedMediaId === 'string'))
}
