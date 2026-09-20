/**
 * Asset Requirement IR 1.0
 *
 * Pure, deterministic contract for importing an asset list prepared by any
 * external Agent. This module never calls a model, reads files, or inspects
 * images. It only validates JSON structure and cross-field references.
 */
import schema from '../../asset-requirement-ir/asset-requirement-ir.schema.json'
import type { Scene } from './types'

export const ASSET_REQUIREMENT_IR_SCHEMA = schema

export const ASSET_REQUIREMENT_AGENT_INSTRUCTIONS = `请把我提供的剧本、分镜或资产清单转换成 Asset Requirement IR 1.0 JSON。

规则：
1. 只整理人物、场景、道具、剧情状态、适用镜头和需要准备的图片槽位，不设计3D坐标、人物走位或摄影机。
2. 不修改剧情事实。无法确定的信息写入顶层 unresolved，不要猜测。
3. 为每个资产和剧情状态建立跨镜头稳定、唯一的英文数字ID。
4. 资产类型只使用 character、scene、prop。
5. 图片槽位类型和视角必须使用 Schema 中允许的枚举值。
6. appliesTo 可以填写单个镜头ID或“起始镜头:结束镜头”。
7. 只填写 semanticType 作为白模提示，不要虚构导演台内部 assetId。
8. 不要填写图片路径、文件名、哈希、批准状态或锁定状态。
9. 输出 spec="asset-requirement-ir"、version="1.0"。
10. 最终只输出一个JSON对象，不要附加Markdown代码围栏或解释。`

export type AssetRequirementKind = 'character' | 'scene' | 'prop'
export type AssetImportance = 'principal' | 'supporting' | 'background' | 'hero' | 'standard'
export type RequirementSlotType =
  | 'identity'
  | 'costume'
  | 'geometry'
  | 'camera_view'
  | 'lighting_state'
  | 'standard_view'
  | 'detail'
  | 'scale_reference'
  | 'custom'

export type RequirementSlotView =
  | 'front'
  | 'back'
  | 'left_profile'
  | 'right_profile'
  | 'left_three_quarter'
  | 'right_three_quarter'
  | 'full_body'
  | 'top_down'
  | 'wide'
  | 'detail'
  | 'custom'

export interface AssetRequirementSlot {
  id: string
  label: string
  type: RequirementSlotType
  view: RequirementSlotView
  required: boolean
  description?: string
  cameraId?: string
}

export interface AssetRequirementState {
  id: string
  name: string
  description?: string
  appliesTo: string[]
  requiredSlots: AssetRequirementSlot[]
}

export interface AssetRequirement {
  id: string
  name: string
  type: AssetRequirementKind
  aliases?: string[]
  importance?: AssetImportance
  description?: string
  semanticType?: string
  firstAppearance?: string
  appearances?: string[]
  states: AssetRequirementState[]
  whiteModelHint?: {
    semanticType: string
    approximateHeightMeters?: number
  }
}

export interface AssetRequirementIR {
  spec: 'asset-requirement-ir'
  version: '1.0'
  project: {
    name: string
    source?: string
  }
  assets: AssetRequirement[]
  unresolved: Array<{
    field: string
    reason: string
    suggestedDefault?: string
  }>
}

export interface AssetRequirementValidationOptions {
  /** When supplied, every shot reference and range endpoint must exist here. */
  knownShotIds?: readonly string[]
  /** Whole-series requirements may arrive before all project shots exist. */
  unknownShotReferences?: 'error' | 'warning'
}

export interface AssetRequirementValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface ParsedAssetRequirementIR extends AssetRequirementValidationResult {
  ir?: AssetRequirementIR
}

/** All identifiers an imported asset IR may use to refer to a project shot. */
export function knownShotIdsForAssetRequirements(scenes: readonly Scene[]): string[] {
  return scenes.flatMap((scene) => scene.shots.flatMap((shot) => [
    shot.id,
    shot.name,
    shot.storyboard?.sourceShotId
  ].filter((id): id is string => Boolean(id))))
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ASSET_KINDS: readonly unknown[] = ['character', 'scene', 'prop']
const IMPORTANCE_VALUES: readonly unknown[] = ['principal', 'supporting', 'background', 'hero', 'standard']
const SLOT_TYPE_VALUES: readonly unknown[] = [
  'identity', 'costume', 'geometry', 'camera_view', 'lighting_state',
  'standard_view', 'detail', 'scale_reference', 'custom'
]
const SLOT_VIEW_VALUES: readonly unknown[] = [
  'front', 'back', 'left_profile', 'right_profile', 'left_three_quarter',
  'right_three_quarter', 'full_body', 'top_down', 'wide', 'detail', 'custom'
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path || '/'} 不允许字段 ${key}。`)
  }
}

function requireString(value: Record<string, unknown>, key: string, path: string, errors: string[], id = false): void {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0) {
    errors.push(`${path || '/'} 缺少必填字符串字段 ${key}。`)
  } else if (id && !ID_PATTERN.test(field)) {
    errors.push(`${path}/${key} 只能包含英文字母、数字、点、下划线和连字符。`)
  }
}

function optionalString(value: Record<string, unknown>, key: string, path: string, errors: string[], id = false): void {
  const field = value[key]
  if (field === undefined) return
  if (typeof field !== 'string') errors.push(`${path}/${key} 必须是字符串。`)
  else if (id && !ID_PATTERN.test(field)) errors.push(`${path}/${key} ID 格式不正确。`)
}

function stringArray(value: unknown, path: string, errors: string[], ids = false): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组。`)
    return
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) errors.push(`${path}/${index} 必须是非空字符串。`)
    else if (ids && !ID_PATTERN.test(entry)) errors.push(`${path}/${index} ID 格式不正确。`)
  })
}

/** Static Schema-equivalent checks: no eval/new Function, safe under Electron CSP. */
function schemaShapeErrors(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) return ['/ 根节点必须是 JSON 对象。']
  rejectUnknownFields(value, ['spec', 'version', 'project', 'assets', 'unresolved'], '', errors)
  if (value.spec !== 'asset-requirement-ir') errors.push('/spec 必须是 asset-requirement-ir。')
  if (value.version !== '1.0') errors.push('/version 必须是 1.0。')

  if (!isRecord(value.project)) errors.push('/project 必须是对象。')
  else {
    rejectUnknownFields(value.project, ['name', 'source'], '/project', errors)
    requireString(value.project, 'name', '/project', errors)
    optionalString(value.project, 'source', '/project', errors)
  }

  if (!Array.isArray(value.assets)) errors.push('/assets 必须是数组。')
  else value.assets.forEach((entry, assetIndex) => {
    const path = `/assets/${assetIndex}`
    if (!isRecord(entry)) { errors.push(`${path} 必须是对象。`); return }
    rejectUnknownFields(entry, [
      'id', 'name', 'type', 'aliases', 'importance', 'description', 'semanticType',
      'firstAppearance', 'appearances', 'states', 'whiteModelHint'
    ], path, errors)
    requireString(entry, 'id', path, errors, true)
    requireString(entry, 'name', path, errors)
    if (!ASSET_KINDS.includes(entry.type)) errors.push(`${path}/type 必须是 character、scene 或 prop。`)
    if (entry.aliases !== undefined) stringArray(entry.aliases, `${path}/aliases`, errors)
    if (entry.importance !== undefined && !IMPORTANCE_VALUES.includes(entry.importance)) errors.push(`${path}/importance 值不受支持。`)
    optionalString(entry, 'description', path, errors)
    optionalString(entry, 'semanticType', path, errors)
    optionalString(entry, 'firstAppearance', path, errors, true)
    if (entry.appearances !== undefined) stringArray(entry.appearances, `${path}/appearances`, errors, true)
    if (entry.whiteModelHint !== undefined) {
      const hintPath = `${path}/whiteModelHint`
      if (!isRecord(entry.whiteModelHint)) errors.push(`${hintPath} 必须是对象。`)
      else {
        rejectUnknownFields(entry.whiteModelHint, ['semanticType', 'approximateHeightMeters'], hintPath, errors)
        requireString(entry.whiteModelHint, 'semanticType', hintPath, errors)
        const height = entry.whiteModelHint.approximateHeightMeters
        if (height !== undefined && (typeof height !== 'number' || height <= 0 || height > 10)) errors.push(`${hintPath}/approximateHeightMeters 必须是 0 到 10 米之间的数字。`)
      }
    }
    if (!Array.isArray(entry.states) || entry.states.length === 0) errors.push(`${path}/states 必须是非空数组。`)
    else entry.states.forEach((stateEntry, stateIndex) => {
      const statePath = `${path}/states/${stateIndex}`
      if (!isRecord(stateEntry)) { errors.push(`${statePath} 必须是对象。`); return }
      rejectUnknownFields(stateEntry, ['id', 'name', 'description', 'appliesTo', 'requiredSlots'], statePath, errors)
      requireString(stateEntry, 'id', statePath, errors, true)
      requireString(stateEntry, 'name', statePath, errors)
      optionalString(stateEntry, 'description', statePath, errors)
      stringArray(stateEntry.appliesTo, `${statePath}/appliesTo`, errors)
      if (!Array.isArray(stateEntry.requiredSlots) || stateEntry.requiredSlots.length === 0) errors.push(`${statePath}/requiredSlots 必须是非空数组。`)
      else stateEntry.requiredSlots.forEach((slotEntry, slotIndex) => {
        const slotPath = `${statePath}/requiredSlots/${slotIndex}`
        if (!isRecord(slotEntry)) { errors.push(`${slotPath} 必须是对象。`); return }
        rejectUnknownFields(slotEntry, ['id', 'label', 'type', 'view', 'required', 'description', 'cameraId'], slotPath, errors)
        requireString(slotEntry, 'id', slotPath, errors, true)
        requireString(slotEntry, 'label', slotPath, errors)
        if (!SLOT_TYPE_VALUES.includes(slotEntry.type)) errors.push(`${slotPath}/type 值不受支持。`)
        if (!SLOT_VIEW_VALUES.includes(slotEntry.view)) errors.push(`${slotPath}/view 值不受支持。`)
        if (typeof slotEntry.required !== 'boolean') errors.push(`${slotPath}/required 必须是布尔值。`)
        optionalString(slotEntry, 'description', slotPath, errors)
        optionalString(slotEntry, 'cameraId', slotPath, errors, true)
      })
    })
  })

  if (!Array.isArray(value.unresolved)) errors.push('/unresolved 必须是数组。')
  else value.unresolved.forEach((entry, index) => {
    const path = `/unresolved/${index}`
    if (!isRecord(entry)) { errors.push(`${path} 必须是对象。`); return }
    rejectUnknownFields(entry, ['field', 'reason', 'suggestedDefault'], path, errors)
    requireString(entry, 'field', path, errors)
    requireString(entry, 'reason', path, errors)
    optionalString(entry, 'suggestedDefault', path, errors)
  })
  return errors
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\//.test(value)
}

function findAbsolutePaths(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') return isAbsolutePath(value) ? [`${path} 不允许包含本机绝对路径。`] : []
  if (Array.isArray(value)) return value.flatMap((entry, index) => findAbsolutePaths(entry, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, entry]) => findAbsolutePaths(entry, `${path}.${key}`))
}

function duplicateIdErrors(ir: AssetRequirementIR): string[] {
  const errors: string[] = []
  const assetIds = new Set<string>()
  const stateIds = new Set<string>()
  ir.assets.forEach((asset, assetIndex) => {
    if (assetIds.has(asset.id)) errors.push(`assets[${assetIndex}].id 重复：${asset.id}。`)
    assetIds.add(asset.id)
    asset.states.forEach((state, stateIndex) => {
      if (stateIds.has(state.id)) errors.push(`assets[${assetIndex}].states[${stateIndex}].id 重复：${state.id}。`)
      stateIds.add(state.id)
      const slotIds = new Set<string>()
      state.requiredSlots.forEach((slot, slotIndex) => {
        if (slotIds.has(slot.id)) {
          errors.push(`assets[${assetIndex}].states[${stateIndex}].requiredSlots[${slotIndex}].id 重复：${slot.id}。`)
        }
        slotIds.add(slot.id)
      })
    })
  })
  return errors
}

function shotReferenceErrors(ir: AssetRequirementIR, knownShotIds?: readonly string[]): string[] {
  if (!knownShotIds) return []
  const known = new Set(knownShotIds)
  const errors: string[] = []
  const checkShot = (shotId: string, path: string): void => {
    if (!known.has(shotId)) errors.push(`${path} 引用了不存在的镜头 ${shotId}。`)
  }
  ir.assets.forEach((asset, assetIndex) => {
    if (asset.firstAppearance) checkShot(asset.firstAppearance, `assets[${assetIndex}].firstAppearance`)
    asset.appearances?.forEach((shotId, appearanceIndex) => {
      checkShot(shotId, `assets[${assetIndex}].appearances[${appearanceIndex}]`)
    })
    asset.states.forEach((state, stateIndex) => {
      state.appliesTo.forEach((range, rangeIndex) => {
        const [start, end, ...extra] = range.split(':')
        const path = `assets[${assetIndex}].states[${stateIndex}].appliesTo[${rangeIndex}]`
        if (!start || extra.length > 0) {
          errors.push(`${path} 必须是镜头 ID 或“起始镜头:结束镜头”。`)
          return
        }
        checkShot(start, path)
        if (end) checkShot(end, path)
      })
    })
  })
  return errors
}

export function validateAssetRequirementIR(
  value: unknown,
  options: AssetRequirementValidationOptions = {}
): AssetRequirementValidationResult {
  const errors = schemaShapeErrors(value)
  const schemaValid = errors.length === 0
  errors.push(...findAbsolutePaths(value))
  const warnings = schemaValid
    ? (value as AssetRequirementIR).unresolved.map((item, index) => `unresolved[${index}] ${item.field}：${item.reason}`)
    : []
  if (schemaValid) {
    errors.push(...duplicateIdErrors(value as AssetRequirementIR))
    const shotIssues = shotReferenceErrors(value as AssetRequirementIR, options.knownShotIds)
    if (options.unknownShotReferences === 'warning' && shotIssues.length > 0) {
      const unknownShotIds = [...new Set(shotIssues.flatMap((issue) => {
        const match = issue.match(/镜头 ([^。]+)。$/)
        return match ? [match[1]] : []
      }))]
      warnings.push(
        `有 ${shotIssues.length} 处镜头或场次引用尚未存在于当前项目：${unknownShotIds.join('、')}。` +
        '可先导入全剧资产需求；对应正式分镜建立后再完成映射。'
      )
    }
    else errors.push(...shotIssues)
  }
  return { valid: errors.length === 0, errors, warnings }
}

export function parseAssetRequirementIR(
  text: string,
  options: AssetRequirementValidationOptions = {}
): ParsedAssetRequirementIR {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      valid: false,
      errors: [`JSON 语法错误：${error instanceof Error ? error.message : String(error)}`],
      warnings: []
    }
  }
  const result = validateAssetRequirementIR(value, options)
  return result.valid ? { ...result, ir: value as AssetRequirementIR } : result
}
