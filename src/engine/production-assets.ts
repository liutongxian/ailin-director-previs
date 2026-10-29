import type { ProductionMedia } from './production'
export const ASSET_MODELS = [{ id: 'doubao-seedream-5-0-lite-260128', label: 'Seedream 5.0 Lite' }, { id: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' }, { id: 'image-01', label: 'MiniMax Image-01 · 文生图' }, { id: 'qwen-image-2.1-local', label: '本地 Qwen-Image 2.1' }]
export interface LocalQwenOptions { baseUrl: string; width: number; height: number; steps: number }
export const DEFAULT_LOCAL_QWEN: LocalQwenOptions = { baseUrl: 'http://127.0.0.1:8888', width: 768, height: 768, steps: 24 }
export interface AssetCreationDraft { name: string; prompt: string; model: string; size: '2K' | '4K'; referenceIds: string[]; assetNeedId?: string; localQwen?: LocalQwenOptions }
export function localQwenOptionsValid(value: unknown): value is LocalQwenOptions {
  if (!value || typeof value !== 'object') return false
  const v = value as LocalQwenOptions
  return typeof v.baseUrl === 'string' && v.baseUrl.length <= 500 && [v.width, v.height].every((n) => Number.isInteger(n) && n >= 256 && n <= 2048 && n % 16 === 0) && Number.isInteger(v.steps) && v.steps >= 1 && v.steps <= 50
}
export interface AssetCreationJob { id: string; projectId: string; input: AssetCreationDraft; references: ProductionMedia[]; status: 'submitting' | 'complete' | 'unknown' | 'dismissed'; createdAt: string; media?: ProductionMedia; error?: string }
export function defaultAssetDraft(): AssetCreationDraft { return { name: '新素材', prompt: '', model: ASSET_MODELS[0]!.id, size: '2K', referenceIds: [] } }
export function assetDraftErrors(input: AssetCreationDraft): string[] {
  const errors: string[] = []
  if (input?.assetNeedId !== undefined && typeof input.assetNeedId !== 'string') errors.push('关联资产ID无效。')
  if (!input || typeof input.name !== 'string' || typeof input.prompt !== 'string' || !input.prompt.trim()) errors.push('请填写素材描述。')
  if (!ASSET_MODELS.some((model) => model.id === input?.model)) errors.push('图片模型无效。')
  if (!['2K', '4K'].includes(input?.size)) errors.push('图片尺寸无效。')
  if (!Array.isArray(input?.referenceIds) || input.referenceIds.length > 14 || input.referenceIds.some((id) => typeof id !== 'string')) errors.push('最多选择14张图片参考。')
  if (input?.model === 'image-01') {
    if (input.size !== '2K') errors.push('MiniMax Image-01 当前使用 2048×2048 图片。')
    if (input.prompt?.length > 1500) errors.push('MiniMax 图片提示词最多1500字符。')
    if (input.referenceIds?.length) errors.push('MiniMax 当前提供文生图；使用参考图片请切换 Seedream。')
  }
  if (input?.localQwen !== undefined && !localQwenOptionsValid(input.localQwen)) errors.push('本地图片设置无效：宽高须为256–2048之间的16倍数，步数为1–50。')
  if (input?.model === 'qwen-image-2.1-local' && input.referenceIds?.length > 10) errors.push('本地 Qwen-Image 2.1 最多使用10张参考图。')
  return errors
}
