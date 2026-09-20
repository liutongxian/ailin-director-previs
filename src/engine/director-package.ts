import type { StoryboardShotCard } from './director'
import type { RequirementSlotType, RequirementSlotView } from './asset-requirement-ir'
import type { AspectId, GaitId, LightingPresetId, RigId, V3 } from './types'
import { parsePrevisIR, previsIRToStoryboardCards, type PrevisIR } from './previs-ir'
import { headingOf } from './path'

export type DirectorPlanBasis = 'explicit' | 'spatial-rule' | 'preset' | 'agent-proposal' | 'manual'

export interface DirectorPackageMark {
  time: number
  position: V3
  gait: GaitId
  joints?: Record<string, number>
}

export interface DirectorPackageEntityPlan {
  refId: string
  position: V3
  rotationY: number
  scale?: number
  marks: DirectorPackageMark[]
  basis: DirectorPlanBasis
  reason: string
  confidence: number
}

export interface DirectorPackageCameraMark {
  time: number
  position: V3
  aimAt?: V3
  pan?: number
  tilt?: number
  focalLength: number
  basis: DirectorPlanBasis
  reason: string
  confidence: number
}

export interface DirectorPackageStagePlan {
  shotId: string
  coordinateSystem: 'director-desk-y-up'
  duration: number
  aspect: AspectId
  lighting: LightingPresetId
  entities: DirectorPackageEntityPlan[]
  camera: {
    rig: RigId
    marks: DirectorPackageCameraMark[]
  }
  review: {
    start: string
    middle: string
    end: string
  }
  /** Optional production prompt for this existing shot; it does not change staging facts. */
  generationPrompt?: string
  unresolved?: { field: string; reason: string }[]
}

export interface DirectorPackageAssetSlotBinding {
  slotId: string
  label: string
  type: RequirementSlotType
  view: RequirementSlotView
  required: boolean
  relativePath: string
  sha256?: string
  description?: string
  cameraId?: string
}

export interface DirectorPackageModelBinding {
  relativePath: string
  sha256?: string
}

export interface DirectorPackageAssetBinding {
  targetRefId: string
  assetId: string
  kind: 'character' | 'scene' | 'prop'
  stateId: string
  stateName: string
  appliesTo?: string[]
  slots: DirectorPackageAssetSlotBinding[]
  model?: DirectorPackageModelBinding
}

export interface AilinDirectorPackage {
  spec: 'ailin-director-package'
  version: '1.0'
  source?: {
    name: string
    text: string
  }
  previsIR: PrevisIR
  stagePlans: DirectorPackageStagePlan[]
  assetBindings?: DirectorPackageAssetBinding[]
  unresolved?: { field: string; reason: string }[]
}

export interface DirectorPackageValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export type DirectorPackageParseResult =
  | { ok: true; package: AilinDirectorPackage; validation: DirectorPackageValidation }
  | { ok: false; error: string; validation: DirectorPackageValidation }

const ASPECTS = new Set<AspectId>(['16:9', '9:16', '2.39:1', '4:3', '1:1'])
const GAITS = new Set<GaitId>(['stand', 'walk', 'jog', 'run', 'sit', 'lie', 'crouch', 'gesture', 'fall'])
const RIGS = new Set<RigId>(['sticks', 'dolly', 'steadicam', 'handheld', 'crane', 'drone', 'carMount'])
const LIGHTING = new Set<LightingPresetId>(['day', 'goldenHour', 'night', 'interiorWarm', 'interiorCool', 'club', 'middaySky', 'goldenHourSky', 'blueHourSky'])
const BASES = new Set<DirectorPlanBasis>(['explicit', 'spatial-rule', 'preset', 'agent-proposal', 'manual'])
const ASSET_KINDS = new Set<DirectorPackageAssetBinding['kind']>(['character', 'scene', 'prop'])
const SLOT_TYPES = new Set<RequirementSlotType>(['identity', 'costume', 'geometry', 'camera_view', 'lighting_state', 'standard_view', 'detail', 'scale_reference', 'custom'])
const SLOT_VIEWS = new Set<RequirementSlotView>(['front', 'back', 'left_profile', 'right_profile', 'left_three_quarter', 'right_three_quarter', 'full_body', 'top_down', 'wide', 'detail', 'custom'])
const SAFE_EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHA256 = /^[a-fA-F0-9]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isSafeDirectorPackRelativePath(value: string): boolean {
  if (!value || value.includes('\\') || value.includes('://') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)) return false
  const parts = value.split('/')
  return parts.every((part) => Boolean(part) && part !== '.' && part !== '..')
}

function readSha256(value: unknown, path: string, errors: string[]): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !SHA256.test(value)) {
    errors.push(`${path} 必须是 64 位十六进制 SHA-256。`)
    return undefined
  }
  return value.toLowerCase()
}

function readAssetBindings(raw: unknown, previs: PrevisIR, errors: string[]): DirectorPackageAssetBinding[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    errors.push('assetBindings 必须是数组。')
    return undefined
  }
  const targetKinds = new Map<string, DirectorPackageAssetBinding['kind']>([
    ...previs.assets.map((asset) => [asset.id, asset.type === 'character' ? 'character' : 'prop'] as const),
    ...(previs.locations ?? []).map((location) => [location.id, 'scene'] as const)
  ])
  const targetIds = new Set<string>()
  const bindings: DirectorPackageAssetBinding[] = []
  raw.forEach((item, index) => {
    const path = `assetBindings[${index}]`
    if (!isRecord(item)) {
      errors.push(`${path} 必须是对象。`)
      return
    }
    const targetRefId = typeof item.targetRefId === 'string' ? item.targetRefId.trim() : ''
    const assetId = typeof item.assetId === 'string' ? item.assetId.trim() : ''
    const stateId = typeof item.stateId === 'string' ? item.stateId.trim() : ''
    const stateName = typeof item.stateName === 'string' ? item.stateName.trim() : ''
    const kind = typeof item.kind === 'string' && ASSET_KINDS.has(item.kind as DirectorPackageAssetBinding['kind'])
      ? item.kind as DirectorPackageAssetBinding['kind']
      : null
    if (!targetRefId || !targetKinds.has(targetRefId)) errors.push(`${path}.targetRefId “${targetRefId || '(empty)'}” 不存在于内嵌 Previs IR。`)
    else if (targetIds.has(targetRefId)) errors.push(`assetBindings 不得重复绑定 ${targetRefId}。`)
    else targetIds.add(targetRefId)
    if (!assetId || !SAFE_EXTERNAL_ID.test(assetId)) errors.push(`${path}.assetId 必须是稳定的英文数字 ID。`)
    if (!stateId || !SAFE_EXTERNAL_ID.test(stateId)) errors.push(`${path}.stateId 必须是稳定的英文数字 ID。`)
    if (!stateName) errors.push(`${path}.stateName 不能为空。`)
    if (!kind) errors.push(`${path}.kind 必须是 character、scene 或 prop。`)
    else if (targetRefId && targetKinds.has(targetRefId) && targetKinds.get(targetRefId) !== kind) {
      errors.push(`${path}.kind 与 Previs IR 中 ${targetRefId} 的类型不一致。`)
    }
    if (!Array.isArray(item.slots)) errors.push(`${path}.slots 必须是数组。`)
    const slotIds = new Set<string>()
    const slots: DirectorPackageAssetSlotBinding[] = []
    for (const [slotIndex, slotRaw] of (Array.isArray(item.slots) ? item.slots : []).entries()) {
      const slotPath = `${path}.slots[${slotIndex}]`
      if (!isRecord(slotRaw)) {
        errors.push(`${slotPath} 必须是对象。`)
        continue
      }
      const slotId = typeof slotRaw.slotId === 'string' ? slotRaw.slotId.trim() : ''
      const label = typeof slotRaw.label === 'string' ? slotRaw.label.trim() : ''
      const type = typeof slotRaw.type === 'string' && SLOT_TYPES.has(slotRaw.type as RequirementSlotType) ? slotRaw.type as RequirementSlotType : null
      const view = typeof slotRaw.view === 'string' && SLOT_VIEWS.has(slotRaw.view as RequirementSlotView) ? slotRaw.view as RequirementSlotView : null
      const relativePath = typeof slotRaw.relativePath === 'string' ? slotRaw.relativePath.trim() : ''
      if (!slotId || !SAFE_EXTERNAL_ID.test(slotId)) errors.push(`${slotPath}.slotId 必须是稳定的英文数字 ID。`)
      else if (slotIds.has(slotId)) errors.push(`${path}.slots 不得重复包含 ${slotId}。`)
      else slotIds.add(slotId)
      if (!label) errors.push(`${slotPath}.label 不能为空。`)
      if (!type) errors.push(`${slotPath}.type 不是允许的槽位类型。`)
      if (!view) errors.push(`${slotPath}.view 不是允许的视角。`)
      if (typeof slotRaw.required !== 'boolean') errors.push(`${slotPath}.required 必须是布尔值。`)
      if (!isSafeDirectorPackRelativePath(relativePath)) errors.push(`${slotPath}.relativePath “${relativePath}” 不是安全的包内相对路径，不能包含 ..、盘符、URL 或反斜杠。`)
      const sha256 = readSha256(slotRaw.sha256, `${slotPath}.sha256`, errors)
      if (slotId && label && type && view && typeof slotRaw.required === 'boolean' && isSafeDirectorPackRelativePath(relativePath)) {
        slots.push({
          slotId, label, type, view, required: slotRaw.required, relativePath,
          ...(sha256 ? { sha256 } : {}),
          ...(typeof slotRaw.description === 'string' ? { description: slotRaw.description } : {}),
          ...(typeof slotRaw.cameraId === 'string' ? { cameraId: slotRaw.cameraId } : {})
        })
      }
    }
    let model: DirectorPackageModelBinding | undefined
    if (item.model !== undefined) {
      if (!isRecord(item.model) || typeof item.model.relativePath !== 'string' || !isSafeDirectorPackRelativePath(item.model.relativePath.trim())) {
        errors.push(`${path}.model.relativePath 不是安全的包内相对路径。`)
      } else {
        const sha256 = readSha256(item.model.sha256, `${path}.model.sha256`, errors)
        model = { relativePath: item.model.relativePath.trim(), ...(sha256 ? { sha256 } : {}) }
      }
    }
    const appliesTo = Array.isArray(item.appliesTo) && item.appliesTo.every((value) => typeof value === 'string')
      ? item.appliesTo as string[]
      : undefined
    if (targetRefId && targetKinds.has(targetRefId) && assetId && stateId && stateName && kind) {
      bindings.push({ targetRefId, assetId, kind, stateId, stateName, ...(appliesTo ? { appliesTo } : {}), slots, ...(model ? { model } : {}) })
    }
  })
  return bindings
}

function readV3(value: unknown, path: string, errors: string[]): V3 | null {
  if (!isRecord(value) || !finite(value.x) || !finite(value.y) || !finite(value.z)) {
    errors.push(`${path} 必须包含有限数字 x/y/z。`)
    return null
  }
  return { x: value.x, y: value.y, z: value.z }
}

function readBasis(value: unknown, path: string, errors: string[]): DirectorPlanBasis | null {
  if (typeof value !== 'string' || !BASES.has(value as DirectorPlanBasis)) {
    errors.push(`${path} 必须是 explicit、spatial-rule、preset、agent-proposal 或 manual。`)
    return null
  }
  return value as DirectorPlanBasis
}

function readConfidence(value: unknown, path: string, errors: string[]): number | null {
  if (!finite(value) || value < 0 || value > 1) {
    errors.push(`${path} 必须是 0 到 1 之间的有限数字。`)
    return null
  }
  return value
}

function validateOrderedTimes(times: number[], duration: number, path: string, errors: string[]): void {
  let previous = -Infinity
  times.forEach((time, index) => {
    if (time < 0 || time > duration) errors.push(`${path}[${index}].time 必须位于镜头时长 0–${duration} 秒内。`)
    if (time < previous) errors.push(`${path} 的时间必须单调递增。`)
    previous = time
  })
}

function readEntityPlan(
  raw: unknown,
  index: number,
  duration: number,
  allowedRefs: Set<string>,
  errors: string[]
): DirectorPackageEntityPlan | null {
  const path = `stagePlans.entities[${index}]`
  if (!isRecord(raw)) {
    errors.push(`${path} 必须是对象。`)
    return null
  }
  const refId = typeof raw.refId === 'string' ? raw.refId.trim() : ''
  if (!refId) errors.push(`${path}.refId 不能为空。`)
  else if (!allowedRefs.has(refId)) errors.push(`${path}.refId “${refId}” 不存在于当前镜头的 Previs IR entities。`)
  const position = readV3(raw.position, `${path}.position`, errors)
  const rotationY = finite(raw.rotationY) ? raw.rotationY : null
  if (rotationY === null) errors.push(`${path}.rotationY 必须是有限弧度值。`)
  const scale = raw.scale === undefined ? undefined : finite(raw.scale) && raw.scale > 0 ? raw.scale : null
  if (scale === null) errors.push(`${path}.scale 必须大于 0。`)
  const basis = readBasis(raw.basis, `${path}.basis`, errors)
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
  if (!reason) errors.push(`${path}.reason 不能为空。`)
  const confidence = readConfidence(raw.confidence, `${path}.confidence`, errors)
  if (!Array.isArray(raw.marks)) errors.push(`${path}.marks 必须是数组。`)
  const marks: DirectorPackageMark[] = []
  for (const [markIndex, markRaw] of (Array.isArray(raw.marks) ? raw.marks : []).entries()) {
    const markPath = `${path}.marks[${markIndex}]`
    if (!isRecord(markRaw)) {
      errors.push(`${markPath} 必须是对象。`)
      continue
    }
    const time = finite(markRaw.time) ? markRaw.time : null
    if (time === null) errors.push(`${markPath}.time 必须是有限数字。`)
    const markPosition = readV3(markRaw.position, `${markPath}.position`, errors)
    const gait = typeof markRaw.gait === 'string' && GAITS.has(markRaw.gait as GaitId) ? markRaw.gait as GaitId : null
    if (!gait) errors.push(`${markPath}.gait 不是允许的动作枚举。`)
    let joints: Record<string, number> | undefined
    if (markRaw.joints !== undefined) {
      if (!isRecord(markRaw.joints) || Object.values(markRaw.joints).some((item) => !finite(item))) {
        errors.push(`${markPath}.joints 的值必须全部是有限数字。`)
      } else {
        joints = Object.fromEntries(Object.entries(markRaw.joints).map(([key, value]) => [key, value as number]))
      }
    }
    if (time !== null && markPosition && gait) marks.push({ time, position: markPosition, gait, ...(joints ? { joints } : {}) })
  }
  validateOrderedTimes(marks.map((mark) => mark.time), duration, `${path}.marks`, errors)
  if (!refId || !position || rotationY === null || scale === null || !basis || confidence === null) return null
  return {
    refId,
    position,
    rotationY,
    ...(scale === undefined ? {} : { scale }),
    marks,
    basis,
    reason,
    confidence
  }
}

function readCameraMark(raw: unknown, index: number, errors: string[]): DirectorPackageCameraMark | null {
  const path = `stagePlans.camera.marks[${index}]`
  if (!isRecord(raw)) {
    errors.push(`${path} 必须是对象。`)
    return null
  }
  const time = finite(raw.time) ? raw.time : null
  if (time === null) errors.push(`${path}.time 必须是有限数字。`)
  const position = readV3(raw.position, `${path}.position`, errors)
  const aimAt = raw.aimAt === undefined ? undefined : readV3(raw.aimAt, `${path}.aimAt`, errors) ?? undefined
  const pan = raw.pan === undefined ? undefined : finite(raw.pan) ? raw.pan : null
  const tilt = raw.tilt === undefined ? undefined : finite(raw.tilt) ? raw.tilt : null
  if (pan === null) errors.push(`${path}.pan 必须是有限弧度值。`)
  if (tilt === null) errors.push(`${path}.tilt 必须是有限弧度值。`)
  if (!aimAt && (pan === undefined || tilt === undefined)) errors.push(`${path} 必须提供 aimAt，或同时提供 pan 和 tilt。`)
  const focalLength = finite(raw.focalLength) && raw.focalLength >= 8 && raw.focalLength <= 300 ? raw.focalLength : null
  if (focalLength === null) errors.push(`${path}.focalLength 必须位于 8–300 mm。`)
  const basis = readBasis(raw.basis, `${path}.basis`, errors)
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
  if (!reason) errors.push(`${path}.reason 不能为空。`)
  const confidence = readConfidence(raw.confidence, `${path}.confidence`, errors)
  if (time === null || !position || focalLength === null || !basis || confidence === null) return null
  return {
    time,
    position,
    ...(aimAt ? { aimAt } : {}),
    ...(pan === undefined || pan === null ? {} : { pan }),
    ...(tilt === undefined || tilt === null ? {} : { tilt }),
    focalLength,
    basis,
    reason,
    confidence
  }
}

function readStagePlan(
  raw: unknown,
  shotMap: Map<string, PrevisIR['shots'][number]>,
  errors: string[],
  warnings: string[]
): DirectorPackageStagePlan | null {
  if (!isRecord(raw)) {
    errors.push('stagePlans 中的每一项必须是对象。')
    return null
  }
  const shotId = typeof raw.shotId === 'string' ? raw.shotId.trim() : ''
  const shot = shotMap.get(shotId)
  if (!shotId || !shot) {
    errors.push(`stagePlans.shotId “${shotId || '(empty)'}” 不存在于内嵌 Previs IR。`)
    return null
  }
  if (raw.coordinateSystem !== 'director-desk-y-up') errors.push(`stagePlans[${shotId}].coordinateSystem 必须是 director-desk-y-up。`)
  const duration = finite(raw.duration) && raw.duration > 0 && raw.duration <= 30 ? raw.duration : null
  if (duration === null) errors.push(`stagePlans[${shotId}].duration 必须位于 0–30 秒。`)
  if (duration !== null && shot.duration !== undefined && Math.abs(duration - shot.duration) > 0.001) {
    errors.push(`stagePlans[${shotId}].duration 不得修改 Previs IR 中的镜头时长 ${shot.duration}。`)
  }
  const aspect = typeof raw.aspect === 'string' && ASPECTS.has(raw.aspect as AspectId) ? raw.aspect as AspectId : null
  if (!aspect) errors.push(`stagePlans[${shotId}].aspect 不是允许的画幅。`)
  if (aspect && shot.aspect && aspect !== shot.aspect) errors.push(`stagePlans[${shotId}].aspect 不得修改 Previs IR 中的画幅 ${shot.aspect}。`)
  const lighting = typeof raw.lighting === 'string' && LIGHTING.has(raw.lighting as LightingPresetId) ? raw.lighting as LightingPresetId : null
  if (!lighting) errors.push(`stagePlans[${shotId}].lighting 不是允许的灯光预设。`)
  const allowedRefs = new Set(shot.entities.map((entity) => entity.refId))
  const entities = Array.isArray(raw.entities) && duration !== null
    ? raw.entities.map((entity, index) => readEntityPlan(entity, index, duration, allowedRefs, errors)).filter((entity): entity is DirectorPackageEntityPlan => Boolean(entity))
    : []
  if (!Array.isArray(raw.entities)) errors.push(`stagePlans[${shotId}].entities 必须是数组。`)
  const stagedRefs = new Set<string>()
  for (const entity of entities) {
    if (stagedRefs.has(entity.refId)) errors.push(`stagePlans[${shotId}].entities 不得重复引用 ${entity.refId}。`)
    stagedRefs.add(entity.refId)
  }
  for (const refId of allowedRefs) {
    if (!stagedRefs.has(refId)) warnings.push(`镜头 ${shotId} 的 ${refId} 没有精确调度，将使用 Previs IR 默认位置。`)
  }
  if (!isRecord(raw.camera)) errors.push(`stagePlans[${shotId}].camera 必须是对象。`)
  const cameraRaw = isRecord(raw.camera) ? raw.camera : {}
  const rig = typeof cameraRaw.rig === 'string' && RIGS.has(cameraRaw.rig as RigId) ? cameraRaw.rig as RigId : null
  if (!rig) errors.push(`stagePlans[${shotId}].camera.rig 不是允许的摄影机承托方式。`)
  const cameraMarks = Array.isArray(cameraRaw.marks)
    ? cameraRaw.marks.map((mark, index) => readCameraMark(mark, index, errors)).filter((mark): mark is DirectorPackageCameraMark => Boolean(mark))
    : []
  if (!Array.isArray(cameraRaw.marks) || cameraMarks.length === 0) errors.push(`stagePlans[${shotId}].camera.marks 至少需要一个关键点。`)
  if (duration !== null) validateOrderedTimes(cameraMarks.map((mark) => mark.time), duration, `stagePlans[${shotId}].camera.marks`, errors)
  if (!isRecord(raw.review) || typeof raw.review.start !== 'string' || typeof raw.review.middle !== 'string' || typeof raw.review.end !== 'string') {
    errors.push(`stagePlans[${shotId}].review 必须包含 start、middle、end 三段文字。`)
  }
  const review = isRecord(raw.review) && typeof raw.review.start === 'string' && typeof raw.review.middle === 'string' && typeof raw.review.end === 'string'
    ? { start: raw.review.start, middle: raw.review.middle, end: raw.review.end }
    : { start: '', middle: '', end: '' }
  let generationPrompt: string | undefined
  if (raw.generationPrompt !== undefined) {
    if (typeof raw.generationPrompt !== 'string' || !raw.generationPrompt.trim()) {
      errors.push(`stagePlans[${shotId}].generationPrompt 必须是非空字符串。`)
    } else generationPrompt = raw.generationPrompt.trim()
  }
  const unresolved = Array.isArray(raw.unresolved)
    ? raw.unresolved.flatMap((item) => isRecord(item) && typeof item.field === 'string' && typeof item.reason === 'string'
        ? [{ field: item.field, reason: item.reason }]
        : [])
    : undefined
  if (unresolved && unresolved.length > 0) warnings.push(...unresolved.map((item) => `${shotId} · ${item.field}: ${item.reason}`))
  if (duration === null || !aspect || !lighting || !rig) return null
  return {
    shotId,
    coordinateSystem: 'director-desk-y-up',
    duration,
    aspect,
    lighting,
    entities,
    camera: { rig, marks: cameraMarks },
    review,
    ...(generationPrompt ? { generationPrompt } : {}),
    ...(unresolved ? { unresolved } : {})
  }
}

export function parseDirectorPackage(text: string): DirectorPackageParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const validation = { valid: false, errors: [`JSON 无法解析：${message}`], warnings }
    return { ok: false, error: validation.errors[0]!, validation }
  }
  if (!isRecord(raw)) errors.push('导演包顶层必须是对象。')
  const record = isRecord(raw) ? raw : {}
  if (record.spec !== 'ailin-director-package') errors.push('spec 必须是 "ailin-director-package"。')
  if (record.version !== '1.0') errors.push('version 必须是 "1.0"。')
  if (!isRecord(record.previsIR)) errors.push('previsIR 必须是内嵌 Previs IR 对象。')
  const previs = isRecord(record.previsIR) ? parsePrevisIR(JSON.stringify(record.previsIR)) : null
  if (previs && !previs.ok) errors.push(...(previs.validation?.errors ?? [previs.error]).map((message) => `previsIR: ${message}`))
  if (previs?.ok) warnings.push(...previs.validation.warnings.map((message) => `previsIR: ${message}`))

  let source: AilinDirectorPackage['source']
  if (record.source !== undefined) {
    if (!isRecord(record.source) || typeof record.source.name !== 'string' || typeof record.source.text !== 'string') {
      errors.push('source 必须包含字符串 name 和 text。')
    } else source = { name: record.source.name, text: record.source.text }
  }

  const shotMap = previs?.ok ? new Map(previs.ir.shots.map((shot) => [shot.id, shot])) : new Map<string, PrevisIR['shots'][number]>()
  const stagePlans = Array.isArray(record.stagePlans)
    ? record.stagePlans.map((plan) => readStagePlan(plan, shotMap, errors, warnings)).filter((plan): plan is DirectorPackageStagePlan => Boolean(plan))
    : []
  if (!Array.isArray(record.stagePlans) || record.stagePlans.length === 0) errors.push('stagePlans 至少需要一个镜头调度。')
  const stagePlanIds = new Set<string>()
  for (const stage of stagePlans) {
    if (stagePlanIds.has(stage.shotId)) errors.push(`stagePlans 不得重复包含镜头 ${stage.shotId}。`)
    stagePlanIds.add(stage.shotId)
  }
  if (previs?.ok) {
    const stageIds = new Set(stagePlans.map((plan) => plan.shotId))
    for (const shot of previs.ir.shots) {
      if (!stageIds.has(shot.id)) warnings.push(`镜头 ${shot.id} 没有 Stage Plan，将使用 Previs IR 的确定性默认值。`)
    }
  }
  const assetBindings = previs?.ok ? readAssetBindings(record.assetBindings, previs.ir, errors) : undefined
  const unresolved = Array.isArray(record.unresolved)
    ? record.unresolved.flatMap((item) => isRecord(item) && typeof item.field === 'string' && typeof item.reason === 'string'
        ? [{ field: item.field, reason: item.reason }]
        : [])
    : undefined
  if (unresolved) warnings.push(...unresolved.map((item) => `${item.field}: ${item.reason}`))

  const validation = { valid: errors.length === 0, errors, warnings }
  if (!validation.valid || !previs?.ok) return { ok: false, error: errors[0] ?? '导演包校验失败。', validation }
  return {
    ok: true,
    package: {
      spec: 'ailin-director-package',
      version: '1.0',
      ...(source ? { source } : {}),
      previsIR: previs.ir,
      stagePlans,
      ...(assetBindings ? { assetBindings } : {}),
      ...(unresolved ? { unresolved } : {})
    },
    validation
  }
}

function cameraAngles(mark: DirectorPackageCameraMark): { pan: number; tilt: number } {
  if (mark.aimAt) {
    return {
      pan: headingOf({ x: mark.aimAt.x - mark.position.x, y: 0, z: mark.aimAt.z - mark.position.z }),
      tilt: Math.atan2(
        mark.aimAt.y - mark.position.y,
        Math.hypot(mark.aimAt.x - mark.position.x, mark.aimAt.z - mark.position.z)
      )
    }
  }
  return { pan: mark.pan ?? 0, tilt: mark.tilt ?? 0 }
}

export function directorPackageToStoryboardCards(pkg: AilinDirectorPackage): StoryboardShotCard[] {
  const cards = previsIRToStoryboardCards(pkg.previsIR)
  const stages = new Map(pkg.stagePlans.map((stage) => [stage.shotId, stage]))
  const productionAssets = new Map((pkg.assetBindings ?? []).map((binding) => [binding.targetRefId, binding.assetId]))
  return cards.map((card) => {
    const stage = card.sourceShotId ? stages.get(card.sourceShotId) : undefined
    const sourceShot = card.sourceShotId ? pkg.previsIR.shots.find((shot) => shot.id === card.sourceShotId) : undefined
    const sceneReferenceAssetId = sourceShot?.locationId ? productionAssets.get(sourceShot.locationId) : undefined
    if (!stage) return {
      ...card,
      engine: 'director-package' as const,
      plan: { ...card.plan, ...(sceneReferenceAssetId ? { sceneReferenceAssetId } : {}) }
    }
    const entities = card.plan.entities.map((entity) => {
      const staged = entity.sourceRefId ? stage.entities.find((item) => item.refId === entity.sourceRefId) : undefined
      const referenceAssetId = entity.sourceRefId ? productionAssets.get(entity.sourceRefId) : undefined
      if (!staged) return { ...entity, ...(referenceAssetId ? { referenceAssetId } : {}) }
      return {
        ...entity,
        ...(referenceAssetId ? { referenceAssetId } : {}),
        position: { ...staged.position },
        rotationY: staged.rotationY,
        ...(staged.scale === undefined ? {} : { scale: staged.scale }),
        marks: staged.marks.map((mark) => ({
          position: { ...mark.position },
          time: mark.time,
          gait: mark.gait,
          ...(mark.joints ? { joints: { ...mark.joints } } : {})
        }))
      }
    })
    const cameraMarks = stage.camera.marks.map((mark) => {
      const angles = cameraAngles(mark)
      return {
        position: { ...mark.position },
        time: mark.time,
        pan: angles.pan,
        tilt: angles.tilt,
        focalLength: mark.focalLength
      }
    })
    const confidenceValues = [
      ...stage.entities.map((entity) => entity.confidence),
      ...stage.camera.marks.map((mark) => mark.confidence)
    ]
    const confidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0
    return {
      ...card,
      engine: 'director-package' as const,
      plan: {
        ...card.plan,
        duration: stage.duration,
        aspect: stage.aspect,
        lighting: stage.lighting,
        ...(sceneReferenceAssetId ? { sceneReferenceAssetId } : {}),
        entities,
        camera: {
          rig: stage.camera.rig,
          focalLength: cameraMarks[0]?.focalLength ?? card.plan.camera.focalLength,
          marks: cameraMarks
        },
        summary: `导演包已校准 ${stage.entities.length} 个实体和 ${cameraMarks.length} 个摄影机关键点；平均可信度 ${Math.round(confidence * 100)}%。`,
        warnings: [
          ...card.plan.warnings,
          ...(stage.unresolved ?? []).map((item) => `${item.field}: ${item.reason}`)
        ]
      }
    }
  })
}

export function directorPackageReview(pkg: AilinDirectorPackage, shotId: string): DirectorPackageStagePlan['review'] | null {
  return pkg.stagePlans.find((stage) => stage.shotId === shotId)?.review ?? null
}

export const DIRECTOR_PACKAGE_AGENT_INSTRUCTIONS = `请把我提供的剧本、分镜、场景图说明和资产文件整理成“艾琳导演包 1.0”。导演包文件扩展名为 .ailinpack，本质是 ZIP；包根目录必须包含 director.ailin.json，图片放入 assets/，可选3D模型放入 models/。

规则：
1. 不得修改剧情事实；事实只写入内嵌 Previs IR，无法确定的信息写入 unresolved。
2. stagePlans 只负责把已确定的镜头事实转换为可修改的米制坐标、时间点、人物路径和摄影机关键点。
3. 坐标系固定为 director-desk-y-up：+X 画面／世界右侧，+Y 向上，-Z 为默认朝前方向，单位为米，角度为弧度，时间为秒。
4. stagePlans 中的 shotId 和 refId 必须引用同一份内嵌 Previs IR 中已经存在的 ID，禁止新增剧情人物或道具。
5. 每个实体调度及每个摄影机关键点都必须填写 basis、reason、confidence。basis 只允许 explicit、spatial-rule、preset、agent-proposal、manual；confidence 范围 0–1。
6. 只有分镜或空间资料明确给出数值时才使用 explicit。根据相对关系计算使用 spatial-rule；标准人体、门高或安全距离使用 preset；需要导演确认的推测使用 agent-proposal。
7. 单张场景图不能确定隐藏空间或绝对比例；缺乏多角度图片或尺度参照时必须降低 confidence 并写入 unresolved，不得声称精确重建。
8. 人物和摄影机 marks 必须按时间单调递增，并位于 0 到镜头 duration 之间。
9. 摄影机每个 mark 必须填写 position、focalLength，以及 aimAt 或 pan+tilt。优先使用 aimAt，便于人工理解。
10. review 必须用简短文字说明首段、中段、尾段应看到什么，供用户快速确认；它不是渲染结果。
11. 用 assetBindings 把 Previs IR 的人物、场景、道具或地点 ID 绑定到稳定的英文数字 assetId、状态和图片槽位；targetRefId 必须引用内嵌 Previs IR，relativePath 必须指向包内实际文件。
12. assetBindings[].slots[].type 和 view 只能使用 Schema 枚举。每张图片填写 slotId、label、type、view、required、relativePath；已有3D文件可填写 model.relativePath。可填写 SHA-256，但不得伪造。
13. 不得写入绝对路径、盘符、URL、反斜杠或 ..；不得携带 API Key、令牌、密码等凭据。不要把电脑上的原始路径写入清单。
14. director.ailin.json 输出 spec="ailin-director-package"、version="1.0"。随包图片在导演台导入后成为项目参考素材，不需要用户二次上传；状态仅为待复核，不得伪造批准或锁定状态。
15. 可在每个现有 stagePlans 镜头中增加 generationPrompt，写入与该镜头剧情、调度和资产一致的视频生成提示词；不要新增 deliveryPlan、参考视频或重复的素材引用结构。
16. 白模预演由导演台根据 stagePlans 生成，不得把白模视频放进导演包。generationPrompt 只提供生成指令，不能改变 Previs IR 或 stagePlans 的剧情、站位、走位和摄影机事实。
17. 只有确实携带图片或3D模型、并提供有效 assetBindings 时才交付 .ailinpack；纯文本导演包交付单个 .ailin.json。若当前环境只能返回文本，最终只输出一个 JSON 对象，不要附加 Markdown 代码围栏或解释。`

export const AILIN_DIRECTOR_PACKAGE_TEMPLATE = JSON.stringify({
  spec: 'ailin-director-package',
  version: '1.0',
  source: {
    name: '示例分镜.txt',
    text: '人物A从画面左侧外进入，走到画面左侧；人物B站在画面右侧。摄影机平稳后拉，尾帧形成双人关系。6秒，9:16。'
  },
  previsIR: {
    spec: 'previs-ir',
    version: '1.0',
    project: { name: '示例项目', aspect: '9:16', fps: 24 },
    assets: [
      { id: 'CHAR-A', name: '人物A', type: 'character', semanticType: 'person' },
      { id: 'CHAR-B', name: '人物B', type: 'character', semanticType: 'person' }
    ],
    locations: [{ id: 'LOC-ROOM', name: '房间', semanticType: 'interior room' }],
    shots: [{
      id: 'SHOT-001',
      name: '第1镜',
      sourceText: '人物A从画面左侧外进入，走到人物B左侧；摄影机平稳后拉。',
      locationId: 'LOC-ROOM',
      duration: 6,
      aspect: '9:16',
      entities: [
        { refId: 'CHAR-A', placement: { screen: 'left', depth: 'midground' } },
        { refId: 'CHAR-B', placement: { screen: 'right', depth: 'midground' } }
      ],
      actions: [{ actorId: 'CHAR-A', type: 'enter', to: { screen: 'left', depth: 'midground' } }],
      spatialRelations: [{ subjectId: 'CHAR-A', relation: 'left_of', objectId: 'CHAR-B' }],
      camera: { movement: 'dolly_out', subjects: ['CHAR-A', 'CHAR-B'] },
      lighting: { preset: 'day' }
    }],
    unresolved: []
  },
  stagePlans: [{
    shotId: 'SHOT-001',
    coordinateSystem: 'director-desk-y-up',
    duration: 6,
    aspect: '9:16',
    lighting: 'day',
    entities: [
      {
        refId: 'CHAR-A',
        position: { x: -1.4, y: 0, z: 0.2 },
        rotationY: 0.25,
        marks: [
          { time: 0, position: { x: -4.8, y: 0, z: 2.8 }, gait: 'walk' },
          { time: 3.2, position: { x: -2.6, y: 0, z: 1.2 }, gait: 'walk' },
          { time: 4.5, position: { x: -1.4, y: 0, z: 0.2 }, gait: 'stand' }
        ],
        basis: 'agent-proposal',
        reason: '满足从画面左侧外进入并在人物B左侧停下，同时保留安全间距。',
        confidence: 0.78
      },
      {
        refId: 'CHAR-B',
        position: { x: 1.4, y: 0, z: 0 },
        rotationY: -0.2,
        marks: [{ time: 0, position: { x: 1.4, y: 0, z: 0 }, gait: 'stand' }],
        basis: 'spatial-rule',
        reason: '依据人物A在人物B左侧的锁定关系设置终态间距。',
        confidence: 0.9
      }
    ],
    camera: {
      rig: 'dolly',
      marks: [
        { time: 0, position: { x: 0.8, y: 1.7, z: 5.2 }, aimAt: { x: 1.4, y: 1.25, z: 0 }, focalLength: 40, basis: 'agent-proposal', reason: '首段以人物B为主要信息。', confidence: 0.76 },
        { time: 3, position: { x: -1.8, y: 2, z: 6.6 }, aimAt: { x: 0.2, y: 1.2, z: 0.2 }, focalLength: 40, basis: 'spatial-rule', reason: '后拉中段逐步容纳入场人物。', confidence: 0.82 },
        { time: 6, position: { x: -4.8, y: 2.3, z: 8.2 }, aimAt: { x: 0, y: 1.2, z: 0 }, focalLength: 40, basis: 'spatial-rule', reason: '尾段形成完整双人关系。', confidence: 0.84 }
      ]
    },
    review: {
      start: '人物B先在画面右侧，人物A尚未进入。',
      middle: '摄影机后拉，人物A从左侧进入。',
      end: '人物A在左、人物B在右，双人和房间关系完整。'
    },
    generationPrompt: '人物A从画面左侧进入并停在人物B左侧；摄影机平稳后拉，保持人物身份、场景和空间关系连续。',
    unresolved: [{ field: 'scene.absoluteDimensions', reason: '没有真实尺寸参照，使用标准室内比例。' }]
  }],
  unresolved: []
}, null, 2)

export const AILIN_DIRECTOR_PACKAGE_ASSET_BINDINGS_EXAMPLE = JSON.stringify({
  assetBindings: [
    {
      targetRefId: 'CHAR-A',
      assetId: 'CHAR-PERSON-A',
      kind: 'character',
      stateId: 'CHAR-PERSON-A-DAY1',
      stateName: '第一故事日',
      appliesTo: ['SHOT-001'],
      slots: [
        {
          slotId: 'identity-front',
          label: '人物A正面身份',
          type: 'identity',
          view: 'front',
          required: true,
          relativePath: 'assets/characters/person-a/front.png'
        },
        {
          slotId: 'costume-full-body',
          label: '人物A全身服装',
          type: 'costume',
          view: 'full_body',
          required: true,
          relativePath: 'assets/characters/person-a/full-body.png'
        }
      ],
      model: { relativePath: 'models/characters/person-a.glb' }
    },
    {
      targetRefId: 'LOC-ROOM',
      assetId: 'SCENE-ROOM-A',
      kind: 'scene',
      stateId: 'SCENE-ROOM-A-DAY',
      stateName: '日景',
      appliesTo: ['SHOT-001'],
      slots: [
        {
          slotId: 'camera-wide',
          label: '房间广角参考',
          type: 'camera_view',
          view: 'wide',
          required: true,
          relativePath: 'assets/scenes/room-a/wide.png'
        }
      ]
    }
  ]
}, null, 2)

export const AILIN_DIRECTOR_PACKAGE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Ai Lin Director Package 1.0',
  type: 'object',
  additionalProperties: false,
  required: ['spec', 'version', 'previsIR', 'stagePlans'],
  properties: {
    spec: { const: 'ailin-director-package' },
    version: { const: '1.0' },
    source: {
      type: 'object', additionalProperties: false, required: ['name', 'text'],
      properties: { name: { type: 'string' }, text: { type: 'string' } }
    },
    previsIR: { type: 'object', description: 'A complete Previs IR 1.0 object.' },
    assetBindings: {
      type: 'array',
      description: 'Optional portable asset bindings. Paths are relative to the .ailinpack root.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['targetRefId', 'assetId', 'kind', 'stateId', 'stateName', 'slots'],
        properties: {
          targetRefId: { type: 'string' },
          assetId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
          kind: { enum: ['character', 'scene', 'prop'] },
          stateId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
          stateName: { type: 'string' },
          appliesTo: { type: 'array', items: { type: 'string' } },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['slotId', 'label', 'type', 'view', 'required', 'relativePath'],
              properties: {
                slotId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
                label: { type: 'string' },
                type: { enum: [...SLOT_TYPES] },
                view: { enum: [...SLOT_VIEWS] },
                required: { type: 'boolean' },
                relativePath: { type: 'string', description: 'Safe POSIX-style path inside the .ailinpack.' },
                sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
                description: { type: 'string' },
                cameraId: { type: 'string' }
              }
            }
          },
          model: {
            type: 'object', additionalProperties: false, required: ['relativePath'],
            properties: {
              relativePath: { type: 'string', description: 'Safe model path inside the .ailinpack.' },
              sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }
            }
          }
        }
      }
    },
    stagePlans: {
      type: 'array', minItems: 1, items: {
        type: 'object', additionalProperties: false,
        required: ['shotId', 'coordinateSystem', 'duration', 'aspect', 'lighting', 'entities', 'camera', 'review'],
        properties: {
          shotId: { type: 'string' },
          coordinateSystem: { const: 'director-desk-y-up' },
          duration: { type: 'number', exclusiveMinimum: 0, maximum: 30 },
          aspect: { enum: [...ASPECTS] },
          lighting: { enum: [...LIGHTING] },
          entities: { type: 'array' },
          camera: { type: 'object' },
          review: { type: 'object' },
          generationPrompt: { type: 'string', minLength: 1 },
          unresolved: { type: 'array' }
        }
      }
    },
    unresolved: { type: 'array' }
  }
} as const
