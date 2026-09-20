/**
 * Previs IR 1.0 — a model/provider agnostic contract between natural-language
 * script analysis and Blockout's deterministic 3D staging engine.
 */
import { ASSET_CATALOG } from './assets'
import type { AspectId, GaitId, LightingPresetId, V3 } from './types'
import type { PlannedEntity, StoryboardShotCard, StoryboardStagePlan } from './director'
import { headingOf } from './path'

export type ScreenSide = 'left' | 'center' | 'right'
export type DepthBand = 'foreground' | 'midground' | 'background'

export interface IRPlacement {
  screen?: ScreenSide
  depth?: DepthBand
  x?: number
  y?: number
  z?: number
}

export interface IRAsset {
  id: string
  name: string
  type: 'character' | 'prop' | 'furniture' | 'vehicle' | 'animal'
  semanticType?: string
  assetId?: string
  aliases?: string[]
}

export interface IRLocation {
  id: string
  name: string
  semanticType?: string
  assetId?: string
}

export interface IRShotEntity {
  refId: string
  placement?: IRPlacement
  facingId?: string
  scale?: number
  pose?: string
}

export interface IRAction {
  actorId: string
  type: 'move' | 'enter' | 'exit' | 'stand' | 'sit' | 'crouch' | 'lie' | 'gesture' | 'wait' | string
  targetId?: string
  startTime?: number
  endTime?: number
  from?: IRPlacement
  to?: IRPlacement
}

export interface IRSpatialRelation {
  subjectId: string
  relation: 'left_of' | 'right_of' | 'in_front_of' | 'behind' | 'near' | 'on' | 'facing' | string
  objectId?: string
}

export interface IRShot {
  id: string
  name?: string
  sourceText?: string
  locationId?: string
  duration?: number
  aspect?: AspectId
  entities: IRShotEntity[]
  actions?: IRAction[]
  spatialRelations?: IRSpatialRelation[]
  camera?: {
    shotSize?: 'extreme_close_up' | 'close_up' | 'medium_close_up' | 'medium' | 'wide' | 'extreme_wide' | string
    movement?: 'locked' | 'dolly_in' | 'dolly_out' | 'truck_left' | 'truck_right' | 'handheld' | 'tracking' | string
    subjects?: string[]
    focalLength?: number
    startTime?: number
    endTime?: number
    distanceMeters?: number
    heightDeltaMeters?: number
    verticalMovement?: string
    /** Exact world-space camera coordinates in meters (+X right, +Y up, -Z forward). */
    startPosition?: V3
    endPosition?: V3
    /** Exact world-space look targets. Per-end targets override this shared target. */
    aimAt?: V3
    startAimAt?: V3
    endAimAt?: V3
  }
  lighting?: {
    preset?: 'day' | 'night' | 'golden_hour' | 'interior_warm' | 'interior_cool' | 'club' | string
    keyDirection?: string
    source?: string
    timeOfDay?: string
    description?: string
    [key: string]: unknown
  }
}

export interface PrevisIR {
  spec: 'previs-ir'
  version: '1.0'
  project?: { name?: string; aspect?: AspectId; fps?: number }
  assets: IRAsset[]
  locations?: IRLocation[]
  shots: IRShot[]
  unresolved?: { field: string; reason: string; suggestedDefault?: string }[]
}

export interface PrevisIRTextRevision {
  ir: PrevisIR
  changedFields: string[]
  warnings: string[]
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function lastScreenSide(text: string, labels: string[]): ScreenSide | undefined {
  let found: { index: number; side: ScreenSide } | undefined
  for (const label of labels) {
    const pattern = new RegExp(`${escapePattern(label)}[^。；;\\n]{0,18}?(?:画面)?(左侧|左边|左|正中|中央|中间|中|右侧|右边|右)`, 'gu')
    for (const match of text.matchAll(pattern)) {
      const raw = match[1]!
      const side: ScreenSide = raw.startsWith('左') ? 'left' : raw.startsWith('右') ? 'right' : 'center'
      if (!found || match.index >= found.index) found = { index: match.index, side }
    }
  }
  return found?.side
}

function shotSizeFromText(text: string): NonNullable<IRShot['camera']>['shotSize'] {
  if (/大特写|extreme\s*close|\becu\b/iu.test(text)) return 'extreme_close_up'
  if (/中近景|medium\s*close|\bmcu\b/iu.test(text)) return 'medium_close_up'
  if (/特写|近景|close[- ]?up|\bcu\b/iu.test(text)) return 'close_up'
  if (/大远景|极远景|extreme\s*wide|\bews\b/iu.test(text)) return 'extreme_wide'
  if (/全景|远景|wide|\bws\b/iu.test(text)) return 'wide'
  if (/中景|medium|\bms\b/iu.test(text)) return 'medium'
  return undefined
}

function cameraMovementFromText(text: string): string | undefined {
  if (/固定机位|固定镜头|锁定机位|locked|static/iu.test(text)) return 'locked'
  if (/后拉|拉远|拉开|dolly\s*out|pull\s*back/iu.test(text)) return 'dolly_out'
  if (/推近|推进|前推|dolly\s*in|push\s*in/iu.test(text)) return 'dolly_in'
  if (/向左横移|左移|truck\s*left/iu.test(text)) return 'truck_left'
  if (/向右横移|右移|truck\s*right/iu.test(text)) return 'truck_right'
  if (/手持|handheld/iu.test(text)) return 'handheld'
  if (/跟拍|跟随|tracking/iu.test(text)) return 'tracking'
  return undefined
}

/**
 * Apply common, explicit natural-language corrections to one existing IR shot.
 * This is deliberately deterministic and local: it preserves model-recognised
 * asset identities while letting users revise framing without another API call.
 */
export function revisePrevisIRShotText(ir: PrevisIR, shotIdOrName: string, sourceText: string): PrevisIRTextRevision {
  const revised = structuredClone(ir)
  const shot = revised.shots.find((item) => item.id === shotIdOrName || item.name === shotIdOrName)
  if (!shot) return { ir: revised, changedFields: [], warnings: [`没有找到镜头“${shotIdOrName}”。`] }
  const changedFields = ['sourceText']
  const warnings: string[] = []
  shot.sourceText = sourceText.trim()

  const duration = sourceText.match(/(\d+(?:\.\d+)?)\s*(?:秒|s\b)/iu)?.[1]
  if (duration) {
    shot.duration = Math.min(30, Math.max(1, Number(duration)))
    changedFields.push('duration')
  }
  if (/9\s*:\s*16|竖屏/iu.test(sourceText)) { shot.aspect = '9:16'; changedFields.push('aspect') }
  else if (/16\s*:\s*9|横屏/iu.test(sourceText)) { shot.aspect = '16:9'; changedFields.push('aspect') }

  const size = shotSizeFromText(sourceText)
  const movement = cameraMovementFromText(sourceText)
  if (size || movement) shot.camera = { ...(shot.camera ?? {}), ...(size ? { shotSize: size } : {}), ...(movement ? { movement } : {}) }
  if (size) changedFields.push('camera.shotSize')
  if (movement) changedFields.push('camera.movement')
  const cameraDistance = sourceText.match(/(?:后拉|拉远|拉开|推近|推进|前推|横移)[^\d]{0,5}(\d+(?:\.\d+)?)\s*米/iu)?.[1]
  if (cameraDistance && shot.camera) {
    shot.camera.distanceMeters = Number(cameraDistance)
    changedFields.push('camera.distanceMeters')
  }

  if (/夜|冷光|冷色/iu.test(sourceText)) { shot.lighting = { ...(shot.lighting ?? {}), preset: 'interior_cool' }; changedFields.push('lighting') }
  else if (/暖光|暖色|烛光/iu.test(sourceText)) { shot.lighting = { ...(shot.lighting ?? {}), preset: 'interior_warm' }; changedFields.push('lighting') }
  else if (/日景|白天|日光/iu.test(sourceText)) { shot.lighting = { ...(shot.lighting ?? {}), preset: 'day' }; changedFields.push('lighting') }

  const assets = new Map(revised.assets.map((asset) => [asset.id, asset]))
  const firstLabelCounts = new Map<string, number>()
  for (const entry of shot.entities) {
    const label = assets.get(entry.refId)?.name.trim().slice(0, 1)
    if (label) firstLabelCounts.set(label, (firstLabelCounts.get(label) ?? 0) + 1)
  }
  let placementChanges = 0
  const explicitlyPlaced = new Set<string>()
  for (const entry of shot.entities) {
    const asset = assets.get(entry.refId)
    if (!asset) continue
    const first = asset.name.trim().slice(0, 1)
    const labels = [asset.name, ...(first && firstLabelCounts.get(first) === 1 ? [first] : [])]
    const side = lastScreenSide(sourceText, labels)
    if (!side) continue
    entry.placement = { ...(entry.placement ?? {}), screen: side }
    explicitlyPlaced.add(entry.refId)
    placementChanges++
    changedFields.push(`entities.${entry.refId}.placement.screen`)
    for (const action of shot.actions ?? []) {
      if (action.actorId === entry.refId && action.to) action.to = { ...action.to, screen: side }
    }
  }
  if (explicitlyPlaced.size > 0 && shot.spatialRelations) {
    const previousCount = shot.spatialRelations.length
    shot.spatialRelations = shot.spatialRelations.filter((relation) =>
      !(['left_of', 'right_of'].includes(relation.relation) &&
        (explicitlyPlaced.has(relation.subjectId) || (relation.objectId ? explicitlyPlaced.has(relation.objectId) : false)))
    )
    if (shot.spatialRelations.length !== previousCount) changedFields.push('spatialRelations.leftRight')
  }
  if (placementChanges === 0) warnings.push('没有识别到“人物名+左／中／右”形式的站位修改；原站位保持不变。')
  if (!duration) warnings.push('没有识别到新时长，沿用原镜头时长。')
  if (!size && !movement) warnings.push('没有识别到新的景别或运镜词，沿用原摄影机方案。')
  return { ir: revised, changedFields, warnings }
}

export function blockingIssuesFromPrevisIR(ir: PrevisIR): string[] {
  // `unresolved` preserves source ambiguity; it is advisory, not structural.
  // The compiler has deterministic fallbacks for omitted coordinates, timing,
  // camera and lighting. Broken references and malformed fields are already
  // reported as validation errors and remain the only import blockers.
  void ir
  return []
}

export const PREVIS_AGENT_INSTRUCTIONS = `请把我提供的剧本或分镜转换成 Previs IR 1.0 JSON。

规则：
1. 不修改剧情事实，不确定的信息写入 unresolved，不要擅自猜测。
2. 为人物、地点和核心道具建立跨镜头稳定的唯一 ID。
3. 每个镜头必须包含 id、sourceText、duration、entities、camera 和 lighting。
4. 画面位置使用 screen: left | center | right；景深使用 depth: foreground | midground | background。
5. 相对关系使用 left_of、right_of、in_front_of、behind、near、on、facing。
6. 动作用 actions 表达，移动动作尽量提供 from、to、startTime、endTime。
7. 未知资产可以填写通用 semanticType；不要虚构本软件的 assetId。
8. 只有输入明确给出米制坐标时才填写人物/道具 x、y、z 和摄影机坐标；普通文字分镜优先使用 screen、depth 和相对关系，省略坐标，由导演台确定性适配。
9. unresolved 只记录会改变剧情、人物身份、关键空间关系或动作含义且必须由人确认的歧义；不要把缺少焦距、米制坐标、精确时间点、灯光数值等常规技术参数逐项列为未决。
10. 输出 spec="previs-ir"、version="1.0"，只输出 JSON，不要附加解释。`

const TEMPLATE_OBJECT: PrevisIR = {
  spec: 'previs-ir',
  version: '1.0',
  project: { name: '示例项目', aspect: '16:9', fps: 24 },
  assets: [
    { id: 'character-a', name: '人物A', type: 'character', semanticType: 'woman' },
    { id: 'table-01', name: '桌子', type: 'furniture', semanticType: 'table' }
  ],
  locations: [{ id: 'room-01', name: '普通房间', semanticType: 'interior room' }],
  shots: [{
    id: 'shot-001',
    name: '第1镜',
    sourceText: '人物A从画面左侧走到桌子右侧，中景，6秒。',
    locationId: 'room-01',
    duration: 6,
    aspect: '16:9',
    entities: [
      { refId: 'character-a', placement: { screen: 'left', depth: 'midground' } },
      { refId: 'table-01', placement: { screen: 'center', depth: 'midground' } }
    ],
    actions: [{
      actorId: 'character-a', type: 'move', startTime: 0, endTime: 4,
      from: { screen: 'left', depth: 'midground' },
      to: { screen: 'right', depth: 'midground' }
    }],
    spatialRelations: [{ subjectId: 'character-a', relation: 'right_of', objectId: 'table-01' }],
    camera: {
      shotSize: 'medium', movement: 'locked', subjects: ['character-a'], focalLength: 50,
      startPosition: { x: 0, y: 1.6, z: 5.5 }, aimAt: { x: 0, y: 1.2, z: 0 }
    },
    lighting: { preset: 'day', keyDirection: 'screen_right' }
  }],
  unresolved: []
}

export const PREVIS_IR_TEMPLATE = JSON.stringify(TEMPLATE_OBJECT, null, 2)

export const PREVIS_IR_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Previs IR 1.0',
  type: 'object',
  required: ['spec', 'version', 'assets', 'shots'],
  properties: {
    spec: { const: 'previs-ir' },
    version: { const: '1.0' },
    project: {
      type: 'object',
      properties: { name: { type: 'string' }, aspect: { enum: ['16:9', '9:16', '2.39:1', '4:3', '1:1'] }, fps: { type: 'number' } }
    },
    assets: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'name', 'type'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' },
          type: { enum: ['character', 'prop', 'furniture', 'vehicle', 'animal'] },
          semanticType: { type: 'string' }, assetId: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    locations: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' }, semanticType: { type: 'string' }, assetId: { type: 'string' } }
      }
    },
    shots: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', required: ['id', 'entities'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, sourceText: { type: 'string' }, locationId: { type: 'string' },
          duration: { type: 'number' }, aspect: { enum: ['16:9', '9:16', '2.39:1', '4:3', '1:1'] },
          entities: {
            type: 'array', items: {
              type: 'object', required: ['refId'],
              properties: { refId: { type: 'string' }, placement: { $ref: '#/$defs/placement' }, facingId: { type: 'string' }, scale: { type: 'number' }, pose: { type: 'string' } }
            }
          },
          actions: {
            type: 'array', items: {
              type: 'object', required: ['actorId', 'type'],
              properties: { actorId: { type: 'string' }, type: { type: 'string' }, targetId: { type: 'string' }, startTime: { type: 'number' }, endTime: { type: 'number' }, from: { $ref: '#/$defs/placement' }, to: { $ref: '#/$defs/placement' } }
            }
          },
          spatialRelations: {
            type: 'array', items: {
              type: 'object', required: ['subjectId', 'relation'],
              properties: { subjectId: { type: 'string' }, relation: { type: 'string' }, objectId: { type: 'string' } }
            }
          },
          camera: {
            type: 'object',
            properties: {
              shotSize: { type: 'string' }, movement: { type: 'string' }, subjects: { type: 'array', items: { type: 'string' } },
              focalLength: { type: 'number' }, startTime: { type: 'number' }, endTime: { type: 'number' },
              distanceMeters: { type: 'number' }, heightDeltaMeters: { type: 'number' }, verticalMovement: { type: 'string' },
              startPosition: { $ref: '#/$defs/v3' }, endPosition: { $ref: '#/$defs/v3' }, aimAt: { $ref: '#/$defs/v3' },
              startAimAt: { $ref: '#/$defs/v3' }, endAimAt: { $ref: '#/$defs/v3' }
            }
          }, lighting: { type: 'object' }
        }
      }
    },
    unresolved: {
      type: 'array', items: {
        type: 'object', required: ['field', 'reason'],
        properties: { field: { type: 'string' }, reason: { type: 'string' }, suggestedDefault: { type: 'string' } }
      }
    }
  },
  $defs: {
    v3: {
      type: 'object', required: ['x', 'y', 'z'],
      properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }
    },
    placement: {
      type: 'object',
      properties: {
        screen: { enum: ['left', 'center', 'right'] }, depth: { enum: ['foreground', 'midground', 'background'] },
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }
      }
    }
  }
} as const

export interface IRValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validatePrevisIR(value: unknown): IRValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!value || typeof value !== 'object') return { valid: false, errors: ['文件根节点必须是JSON对象。'], warnings }
  const ir = value as Partial<PrevisIR>
  if (ir.spec !== 'previs-ir') errors.push('spec 必须是 "previs-ir"。')
  if (ir.version !== '1.0') errors.push('version 必须是 "1.0"。')
  if (!Array.isArray(ir.assets)) errors.push('assets 必须是数组。')
  if (!Array.isArray(ir.shots) || ir.shots.length === 0) errors.push('shots 至少需要一个镜头。')
  if (errors.length > 0) return { valid: false, errors, warnings }

  const ids = new Set<string>()
  for (const [index, asset] of ir.assets!.entries()) {
    if (!asset?.id || !asset.name || !asset.type) errors.push(`assets[${index}] 缺少 id、name 或 type。`)
    else if (ids.has(asset.id)) errors.push(`资产ID重复：${asset.id}。`)
    else ids.add(asset.id)
  }
  const locationIds = new Set((ir.locations ?? []).map((item) => item.id))
  const validPlacement = (placement: IRPlacement | undefined, path: string): void => {
    if (!placement) return
    if (placement.screen && !['left', 'center', 'right'].includes(placement.screen)) errors.push(`${path}.screen 只能是 left、center 或 right。`)
    if (placement.depth && !['foreground', 'midground', 'background'].includes(placement.depth)) errors.push(`${path}.depth 只能是 foreground、midground 或 background。`)
  }
  for (const [index, shot] of ir.shots!.entries()) {
    if (!shot?.id) errors.push(`shots[${index}] 缺少 id。`)
    if (!Array.isArray(shot?.entities)) errors.push(`镜头 ${shot?.id ?? index} 缺少 entities 数组。`)
    const visibleIds = new Set((shot?.entities ?? []).map((entity) => entity.refId))
    for (const [entityIndex, entity] of (shot?.entities ?? []).entries()) {
      if (!ids.has(entity.refId)) errors.push(`镜头 ${shot.id} 引用了不存在的资产 ${entity.refId}。`)
      if (entity.facingId && !visibleIds.has(entity.facingId)) errors.push(`镜头 ${shot.id} 的 ${entity.refId} 面向了未入镜实体 ${entity.facingId}。`)
      validPlacement(entity.placement, `shots[${index}].entities[${entityIndex}].placement`)
    }
    for (const [actionIndex, action] of (shot?.actions ?? []).entries()) {
      if (!ids.has(action.actorId)) errors.push(`镜头 ${shot.id} 的动作引用了不存在的人物 ${action.actorId}。`)
      if (!visibleIds.has(action.actorId)) errors.push(`镜头 ${shot.id} 的动作人物 ${action.actorId} 没有列入本镜 entities。`)
      if (action.targetId && !visibleIds.has(action.targetId)) errors.push(`镜头 ${shot.id} 的动作目标 ${action.targetId} 没有入镜。`)
      validPlacement(action.from, `shots[${index}].actions[${actionIndex}].from`)
      validPlacement(action.to, `shots[${index}].actions[${actionIndex}].to`)
    }
    for (const relation of shot?.spatialRelations ?? []) {
      if (!visibleIds.has(relation.subjectId)) errors.push(`镜头 ${shot.id} 的空间关系主体 ${relation.subjectId} 没有入镜。`)
      if (relation.objectId && !visibleIds.has(relation.objectId)) errors.push(`镜头 ${shot.id} 的空间关系目标 ${relation.objectId} 没有入镜。`)
    }
    for (const subject of shot?.camera?.subjects ?? []) if (!visibleIds.has(subject)) errors.push(`镜头 ${shot.id} 的摄影机目标 ${subject} 没有入镜。`)
    if (shot?.locationId && !locationIds.has(shot.locationId)) errors.push(`镜头 ${shot.id} 引用了不存在的地点 ${shot.locationId}。`)
    if (!shot?.duration) warnings.push(`镜头 ${shot?.id ?? index} 没有时长，将使用6秒。`)
    if (!shot?.camera) warnings.push(`镜头 ${shot?.id ?? index} 没有摄影机方案，将使用中景固定机位。`)
  }
  for (const item of ir.unresolved ?? []) warnings.push(`${item.field}：${item.reason}`)
  return { valid: errors.length === 0, errors, warnings }
}

export function parsePrevisIR(text: string): { ok: true; ir: PrevisIR; validation: IRValidationResult } | { ok: false; error: string; validation?: IRValidationResult } {
  try {
    const value = JSON.parse(text) as unknown
    const validation = validatePrevisIR(value)
    if (!validation.valid) return { ok: false, error: validation.errors[0] ?? 'Previs IR校验失败。', validation }
    return { ok: true, ir: value as PrevisIR, validation }
  } catch (error) {
    return { ok: false, error: `JSON无法解析：${error instanceof Error ? error.message : String(error)}` }
  }
}

const SCREEN_X: Record<ScreenSide, number> = { left: -2.4, center: 0, right: 2.4 }
const DEPTH_Z: Record<DepthBand, number> = { foreground: 1.4, midground: 0, background: -2.6 }

function placementPosition(placement?: IRPlacement, fallbackIndex = 0): V3 {
  return {
    x: placement?.x ?? (placement?.screen ? SCREEN_X[placement.screen] : (fallbackIndex % 3 - 1) * 1.6),
    y: placement?.y ?? 0,
    z: placement?.z ?? (placement?.depth ? DEPTH_Z[placement.depth] : -Math.floor(fallbackIndex / 3) * 1.2)
  }
}

function initialEntityPositions(entries: IRShotEntity[]): Map<string, V3> {
  const groupSizes = new Map<string, number>()
  for (const entry of entries) {
    if (entry.placement?.x !== undefined || entry.placement?.z !== undefined) continue
    const key = `${entry.placement?.screen ?? 'auto'}:${entry.placement?.depth ?? 'auto'}`
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1)
  }
  const groupIndexes = new Map<string, number>()
  const positions = new Map<string, V3>()
  entries.forEach((entry, index) => {
    const position = placementPosition(entry.placement, index)
    if (entry.placement?.x === undefined && entry.placement?.z === undefined) {
      const key = `${entry.placement?.screen ?? 'auto'}:${entry.placement?.depth ?? 'auto'}`
      const count = groupSizes.get(key) ?? 1
      const groupIndex = groupIndexes.get(key) ?? 0
      groupIndexes.set(key, groupIndex + 1)
      if (count > 1) position.x += (groupIndex - (count - 1) / 2) * 0.7
    }
    positions.set(entry.refId, position)
  })
  return positions
}

function catalogMatch(words: string): string | undefined {
  const query = words.toLowerCase().trim()
  if (!query) return undefined
  const exact = ASSET_CATALOG.find((item) => item.id.toLowerCase() === query)
  if (exact) return exact.id
  return ASSET_CATALOG.find((item) => {
    const haystack = `${item.id} ${item.name} ${item.promptNoun}`.toLowerCase()
    return query.split(/[\s,，/]+/u).filter((word) => word.length > 2).some((word) => haystack.includes(word))
  })?.id
}

function resolveEntityAsset(asset: IRAsset): { assetId: string; placeholder: boolean } {
  if (asset.assetId && ASSET_CATALOG.some((item) => item.id === asset.assetId)) return { assetId: asset.assetId, placeholder: false }
  const semantic = `${asset.semanticType ?? ''} ${asset.name} ${(asset.aliases ?? []).join(' ')}`.toLowerCase()
  const aliases: [RegExp, string][] = [
    [/\bwoman\b|\bfemale\b|女人|女性|女孩/u, 'person.woman'],
    [/\bman\b|\bmale\b|男人|男性|男孩/u, 'person.man'],
    [/child|儿童|孩子/u, 'person.child'],
    [/elder|老人/u, 'person.elderly'],
    [/tree|树|槐/u, 'prop.tree'],
    [/statue|idol|神像|雕像/u, 'prop.statue'],
    [/open book|open booklet|打开的.*(?:本子|守则|册)|摊开的.*(?:书|册)/u, 'prop.openBook'],
    [/restoration platform|conservation platform|修复平台/u, 'furniture.restorationPlatform'],
    [/table|桌/u, 'furniture.diningTable'],
    [/chair|椅/u, 'furniture.chair'],
    [/door|门/u, 'furniture.doorOpen'],
    [/book|册|书/u, 'prop.book'],
    [/phone|手机|电话/u, 'prop.phone'],
    [/car|汽车|轿车/u, 'vehicle.sedan'],
    [/dog|狗/u, 'animal.dog'],
    [/cat|猫/u, 'animal.cat']
  ]
  const alias = aliases.find(([pattern]) => pattern.test(semantic))?.[1]
  const matched = alias ?? catalogMatch(semantic)
  if (matched) return { assetId: matched, placeholder: false }
  return { assetId: asset.type === 'character' ? 'person.man' : 'prim.cube', placeholder: true }
}

function resolveEnvironment(location?: IRLocation): { assetId: string; placeholder: boolean } {
  if (location?.assetId && ASSET_CATALOG.some((item) => item.id === location.assetId)) return { assetId: location.assetId, placeholder: false }
  const semantic = `${location?.semanticType ?? ''} ${location?.name ?? ''}`.toLowerCase()
  const aliases: [RegExp, string][] = [
    [/courtyard|yard|院/u, 'env.backyard'],
    [/forest|树林|森林/u, 'env.forest'],
    [/street|街|道路/u, 'env.cityStreet'],
    [/office|办公室/u, 'env.office'],
    [/hospital|医院|病房/u, 'env.hospitalRoom'],
    [/restoration room|conservation room|修复室/u, 'env.restorationRoom'],
    [/warehouse|仓库|工作间/u, 'env.warehouse'],
    [/cafe|coffee|咖啡/u, 'env.coffeeShop'],
    [/restaurant|餐厅/u, 'env.restaurant'],
    [/park|公园/u, 'env.park'],
    [/car interior|车内/u, 'env.carInterior'],
    [/interior|room|室内|房间/u, 'env.houseInterior']
  ]
  const alias = aliases.find(([pattern]) => pattern.test(semantic))?.[1]
  return { assetId: alias ?? catalogMatch(semantic) ?? 'env.houseInterior', placeholder: !alias && !catalogMatch(semantic) }
}

function lightingPreset(value?: unknown): LightingPresetId {
  if (!value) return 'day'
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).toLowerCase()
  if (text.includes('night') || text.includes('夜') || text.includes('cool')) return 'interiorCool'
  if (text.includes('warm') || text.includes('暖')) return 'interiorWarm'
  if (text.includes('golden') || text.includes('黄昏')) return 'goldenHourSky'
  if (text.includes('club') || text.includes('霓虹')) return 'club'
  return 'middaySky'
}

function normalizeGait(value?: string): GaitId {
  const text = value?.toLowerCase() ?? ''
  if (/run|sprint|跑/u.test(text)) return 'run'
  if (/jog|慢跑/u.test(text)) return 'jog'
  if (/walk|walking|move|approach|enter|走|行走|靠近|进入/u.test(text)) return 'walk'
  if (/sit|seated|坐/u.test(text)) return 'sit'
  if (/lie|lying|躺/u.test(text)) return 'lie'
  if (/crouch|squat|kneel|蹲|跪/u.test(text)) return 'crouch'
  if (/gesture|手势/u.test(text)) return 'gesture'
  if (/fall|倒下|摔倒/u.test(text)) return 'fall'
  return 'stand'
}

function normalizedActionType(action: IRAction): string {
  return action.type.toLowerCase().trim().replace(/[\s-]+/g, '_')
}

function isMovementAction(action: IRAction): boolean {
  return /^(move|walk|approach|enter|exit|cross)|move_into_frame|walk_into_frame|走|行走|靠近|进入|离开/u.test(normalizedActionType(action))
}

function isEntryAction(action: IRAction): boolean {
  return /enter|into_frame|进入|入画/u.test(normalizedActionType(action))
}

function actionGait(action?: IRAction, pose?: string): GaitId {
  if (pose) return normalizeGait(pose)
  if (!action) return 'stand'
  return normalizeGait(action.type)
}

const CROUCH_JOINTS: Record<string, number> = {
  rootY: -0.46,
  hipLX: 0.9,
  hipRX: 0.9,
  kneeL: 1.4,
  kneeR: 1.4,
  torsoX: 0.3
}

const STAND_JOINTS: Record<string, number> = {
  rootY: 0,
  hipLX: 0,
  hipRX: 0,
  kneeL: 0,
  kneeR: 0,
  torsoX: 0
}

function poseTransitionMarks(
  actions: IRAction[],
  position: V3,
  initialPose: string | undefined,
  duration: number
): PlannedEntity['marks'] | null {
  const rise = actions.find((item) => ['stand_up_from_crouch', 'rise_from_crouch'].includes(item.type))
  if (!rise) return null
  const startTime = Math.min(duration, Math.max(0, rise.startTime ?? 0))
  const endTime = Math.min(duration, Math.max(startTime + 0.1, rise.endTime ?? duration))
  const crouch = normalizeGait(initialPose) === 'crouch' || rise.type.includes('crouch')
  if (!crouch) return null
  const marks: PlannedEntity['marks'] = [{ position: { ...position }, time: 0, gait: 'stand', joints: { ...CROUCH_JOINTS } }]
  if (startTime > 0) marks.push({ position: { ...position }, time: startTime, gait: 'stand', joints: { ...CROUCH_JOINTS } })
  marks.push({ position: { ...position }, time: endTime, gait: 'stand', joints: { ...STAND_JOINTS } })
  return marks
}

function solveRelations(positions: Map<string, V3>, relations: IRSpatialRelation[], entries: IRShotEntity[]): void {
  const placements = new Map(entries.map((entry) => [entry.refId, entry.placement]))
  const xRelations = new Set(relations.filter((item) => item.relation === 'left_of' || item.relation === 'right_of').map((item) => item.subjectId))
  const zRelations = new Set(relations.filter((item) => item.relation === 'in_front_of' || item.relation === 'behind').map((item) => item.subjectId))
  for (let pass = 0; pass < 3; pass++) {
    for (const relation of relations) {
      const subject = positions.get(relation.subjectId)
      const object = relation.objectId ? positions.get(relation.objectId) : undefined
      if (!subject || !object) continue
      const placement = placements.get(relation.subjectId)
      // left/center/right and depth bands are coarse framing hints. Exact metre
      // coordinates are the only locks; relations are allowed to refine bands.
      const xLocked = placement?.x !== undefined
      const yLocked = placement?.y !== undefined
      const zLocked = placement?.z !== undefined
      if (relation.relation === 'left_of' && !xLocked) subject.x = object.x - 2
      else if (relation.relation === 'right_of' && !xLocked) subject.x = object.x + 2
      else if (relation.relation === 'in_front_of' && !zLocked) subject.z = object.z + 1.5
      else if (relation.relation === 'behind' && !zLocked) subject.z = object.z - 1.5
      else if (relation.relation === 'near') {
        if (!xLocked && !xRelations.has(relation.subjectId)) subject.x = object.x + 0.8
        if (!zLocked && !zRelations.has(relation.subjectId)) subject.z = object.z + 0.3
      } else if (relation.relation === 'on') {
        if (!xLocked) subject.x = object.x
        if (!zLocked) subject.z = object.z
        if (!yLocked) subject.y = Math.max(subject.y, object.y + 0.82)
      }
    }
  }
}

function cameraPlan(shot: IRShot, positions: Map<string, V3>, duration: number): StoryboardStagePlan['camera'] {
  const subjectPositions = (shot.camera?.subjects ?? []).map((id) => positions.get(id)).filter((item): item is V3 => Boolean(item))
  const size = shot.camera?.shotSize ?? (subjectPositions.length >= 3 ? 'wide' : 'medium')
  const defaults: Record<string, { focal: number; distance: number }> = {
    extreme_close_up: { focal: 100, distance: 2.8 }, close_up: { focal: 75, distance: 3.8 },
    medium_close_up: { focal: 58, distance: 4.8 }, medium: { focal: 50, distance: 5.5 },
    wide: { focal: 28, distance: 8.5 }, extreme_wide: { focal: 24, distance: 11 }
  }
  const framing = defaults[size] ?? defaults.medium!
  const focalLength = shot.camera?.focalLength ?? framing.focal
  const all = subjectPositions.length > 0 ? subjectPositions : [...positions.values()]
  const target = all.length > 0 ? {
    x: all.reduce((sum, item) => sum + item.x, 0) / all.length,
    y: 1.2,
    z: all.reduce((sum, item) => sum + item.z, 0) / all.length
  } : { x: 0, y: 1.2, z: 0 }
  const portraitDistanceFactor = (shot.aspect === '9:16' && subjectPositions.length >= 2) ? 1.2 : 1
  const start = shot.camera?.startPosition
    ? { ...shot.camera.startPosition }
    : { x: target.x, y: 1.7, z: target.z + framing.distance * portraitDistanceFactor }
  const aim = (position: V3, aimTarget: V3): { pan: number; tilt: number } => ({
    pan: headingOf({ x: aimTarget.x - position.x, y: 0, z: aimTarget.z - position.z }),
    tilt: Math.atan2(aimTarget.y - position.y, Math.hypot(aimTarget.x - position.x, aimTarget.z - position.z))
  })
  const startTarget = shot.camera?.startAimAt ?? shot.camera?.aimAt ?? target
  const endTarget = shot.camera?.endAimAt ?? shot.camera?.aimAt ?? target
  const movement = shot.camera?.movement ?? 'locked'
  const marks = [{ position: start, time: 0, ...aim(start, startTarget), focalLength }]
  if (movement !== 'locked') {
    const startTime = Math.min(duration, Math.max(0, shot.camera?.startTime ?? 0))
    const endTime = Math.min(duration, Math.max(startTime + 0.1, shot.camera?.endTime ?? Math.max(1, duration - 0.2)))
    if (startTime > 0) marks.push({ position: { ...start }, time: startTime, ...aim(start, startTarget), focalLength })
    const end = shot.camera?.endPosition ? { ...shot.camera.endPosition } : { ...start }
    const distance = Math.max(0.05, shot.camera?.distanceMeters ?? (movement.startsWith('truck') ? 2 : movement === 'dolly_out' ? (subjectPositions.length >= 3 ? 2.6 : 1.8) : 1.5))
    if (!shot.camera?.endPosition) {
      if (movement === 'dolly_in' || movement === 'tracking') end.z -= distance
      else if (movement === 'dolly_out') end.z += distance
      else if (movement === 'truck_left') end.x -= distance
      else if (movement === 'truck_right') end.x += distance
    }
    const vertical = shot.camera?.heightDeltaMeters
      ?? (shot.camera?.verticalMovement?.toLowerCase().includes('up') ? 0.25
        : shot.camera?.verticalMovement?.toLowerCase().includes('down') ? -0.25 : 0)
    if (!shot.camera?.endPosition) end.y += vertical
    marks.push({ position: end, time: endTime, ...aim(end, endTarget), focalLength })
  }
  return { rig: movement === 'handheld' ? 'handheld' : movement === 'locked' ? 'sticks' : 'dolly', focalLength, marks }
}

export function previsIRToStoryboardCards(ir: PrevisIR): StoryboardShotCard[] {
  const assets = new Map(ir.assets.map((item) => [item.id, item]))
  const locations = new Map((ir.locations ?? []).map((item) => [item.id, item]))
  return ir.shots.map((shot, shotIndex) => {
    const duration = Math.min(30, Math.max(1, shot.duration ?? 6))
    const location = shot.locationId ? locations.get(shot.locationId) : undefined
    const environment = resolveEnvironment(location)
    const positions = initialEntityPositions(shot.entities)
    solveRelations(positions, shot.spatialRelations ?? [], shot.entities)
    const warnings: string[] = []
    if (environment.placeholder) warnings.push(`地点“${location?.name ?? '未命名地点'}”没有专用资产，已使用通用室内白模。`)
    if (!shot.camera?.shotSize) warnings.push(`镜头“${shot.name ?? shot.id}”没有明确景别，已按${(shot.camera?.subjects?.length ?? 0) >= 3 ? '多人全景' : '中景'}确定性适配。`)
    if (shot.camera && shot.camera.movement && shot.camera.movement !== 'locked' && !shot.camera.endPosition && shot.camera.distanceMeters === undefined) {
      warnings.push(`镜头“${shot.name ?? shot.id}”没有摄影机终点或运动距离，已按运镜类型使用可编辑默认轨迹。`)
    }

    const entities: PlannedEntity[] = [{
      assetId: environment.assetId,
      name: `${location?.name ?? '通用场景'}白模`,
      role: 'environment',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      marks: []
    }]
    shot.entities.forEach((entry, index) => {
      const asset = assets.get(entry.refId)!
      const resolved = resolveEntityAsset(asset)
      if (resolved.placeholder) warnings.push(`资产“${asset.name}”未匹配到专用白模，已使用带标签基础几何体。`)
      const position = positions.get(entry.refId) ?? placementPosition(entry.placement, index)
      const actions = (shot.actions ?? []).filter((item) => item.actorId === entry.refId)
      const movement = actions.find(isMovementAction)
      const poseAction = actions.find((item) => /stand|sit|crouch|lie|gesture|站|坐|蹲|躺|手势/u.test(normalizedActionType(item)))
      const pose = actionGait(poseAction, entry.pose)
      const transitionMarks = poseTransitionMarks(actions, position, entry.pose, duration)
      const movementEnd = movement ? (movement.to ? placementPosition(movement.to, index) : { ...position }) : null
      const movementStart = movement
        ? (movement.from
            ? placementPosition(movement.from, index)
            : isEntryAction(movement)
              ? { ...movementEnd!, x: movementEnd!.x >= 2 ? 4.8 : -4.8 }
              : { ...position })
        : null
      const marks = movement ? [
        { position: movementStart!, time: Math.max(0, movement.startTime ?? 0), gait: 'walk' as GaitId },
        { position: movementEnd!, time: Math.min(duration, movement.endTime ?? Math.max(1, duration * 0.7)), gait: 'stand' as GaitId }
      ] : transitionMarks ?? (asset.type === 'character' ? [{ position: { ...position }, time: 0, gait: pose }] : [])
      const facing = entry.facingId ? positions.get(entry.facingId) : undefined
      entities.push({
        sourceRefId: entry.refId,
        assetId: resolved.assetId,
        name: asset.name,
        role: asset.type === 'character' ? 'character' : asset.type === 'furniture' ? 'furniture' : 'prop',
        position: { ...position },
        rotationY: facing ? headingOf({ x: facing.x - position.x, y: 0, z: facing.z - position.z }) : 0,
        ...(entry.scale ? { scale: entry.scale } : {}),
        ...(pose !== 'stand' ? { pose } : {}),
        marks
      })
    })
    const camera = cameraPlan(shot, positions, duration)
    const sceneName = location?.name ?? '通用场景'
    const summary = `IR已编译 ${sceneName}、${shot.entities.length} 个实体、${camera.marks.length > 1 ? '运动' : '固定'}机位。`
    return {
      name: shot.name ?? shot.id ?? `镜头${String(shotIndex + 1).padStart(2, '0')}`,
      content: shot.sourceText ?? summary,
      sourceShotId: shot.id,
      engine: 'previs-ir',
      plan: {
        sceneName,
        environmentAssetId: environment.assetId,
        lighting: lightingPreset(shot.lighting),
        duration,
        aspect: shot.aspect ?? ir.project?.aspect ?? '16:9',
        entities,
        camera,
        summary,
        warnings
      }
    }
  })
}
