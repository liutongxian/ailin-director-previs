// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Document creation, validation, and git-friendly serialization.
 * Projects are folders; this module owns the JSON shape. Serialization is
 * pretty-printed with stable key order so diffs stay reviewable.
 */

import { newId } from './ids'
import type {
  ActorMark,
  BlockingTake,
  CameraMark,
  Entity,
  GaitId,
  ProjectDoc,
  ReferenceAsset,
  ReferenceAssetSlot,
  ReferenceAssetState,
  ReferenceAssetStatus,
  ReferenceAssetVersion,
  Scene,
  ScanRef,
  Shot,
  V3
} from './types'
import { validateAssetRequirementIR } from './asset-requirement-ir'
import { normalizeProjectRelativePath } from '../shared/portable-paths'

export const SCHEMA_VERSION = 1 as const

export function createProject(name: string): ProjectDoc {
  const doc: ProjectDoc = {
    version: SCHEMA_VERSION,
    id: newId('proj'),
    name,
    settings: {
      defaultProfileId: 'minimax-h3-ref2va',
      comfyConnectionMode: 'local',
      comfyAutoUpload: true
    },
    referenceAssets: [],
    scenes: []
  }
  doc.scenes.push(createScene(1))
  return doc
}

/** A ready-to-edit Chinese previs scene used by the welcome-screen quick start. */
export function createDemoProject(name = '导演预演示例'): ProjectDoc {
  const doc = createProject(name)
  const scene = doc.scenes[0]!
  scene.name = '通用咖啡馆会面'
  scene.environment = { lighting: 'goldenHourSky', sunAzimuth: -0.65, sunElevation: 0.32, fog: 0.04 }

  const location = createEntity('env.coffeeShop', '咖啡馆场景', { x: 0, y: 0, z: 0 })
  const woman = createEntity('person.woman', '林夏', { x: -3, y: 0, z: 1.5 })
  woman.label = { text: '林夏', color: '#2fb8c6' }
  const man = createEntity('person.man', '陈舟', { x: 1.2, y: 0, z: -1 })
  man.label = { text: '陈舟', color: '#f0a52b' }
  const table = createEntity('furniture.diningTable', '会面桌', { x: 0, y: 0, z: -0.5 })
  const briefcase = createEntity('prop.briefcase', '文件包', { x: 0.35, y: 0.8, z: -0.5 })
  scene.entities = [location, woman, man, table, briefcase]

  const take = scene.blocking[0]!
  take.name = '主走位'
  take.tracks = [
    {
      entityId: woman.id,
      marks: [
        createActorMark({ x: -3, y: 0, z: 1.5 }, 0, 'walk'),
        createActorMark({ x: -1.1, y: 0, z: 0.2 }, 2.5, 'walk'),
        createActorMark({ x: -0.8, y: 0, z: -0.6 }, 5.5, 'walk')
      ]
    },
    {
      entityId: man.id,
      marks: [
        createActorMark({ x: 1.2, y: 0, z: -1 }, 0, 'walk'),
        createActorMark({ x: 0.9, y: 0, z: -0.8 }, 5.5, 'walk')
      ]
    }
  ]

  const wide = createShot(scene, '1A-全景建立')
  wide.duration = 6
  wide.notes = '林夏从画左进入，陈舟在桌边等待。'
  wide.camera.marks = [
    createCameraMark({ x: 0, y: 2.2, z: 7.5 }, 0, 0, -0.08, 28),
    createCameraMark({ x: 0.25, y: 1.9, z: 5.2 }, 5.5, 0.03, -0.04, 35)
  ]

  const overShoulder = createShot(scene, '1B-过肩跟拍')
  overShoulder.duration = 6
  overShoulder.notes = '从陈舟肩后观察林夏靠近桌边。'
  overShoulder.camera.marks = [
    createCameraMark({ x: 1.9, y: 1.75, z: 1.4 }, 0, 0.38, -0.03, 50),
    createCameraMark({ x: 1.45, y: 1.7, z: 0.7 }, 5.5, 0.46, -0.02, 58)
  ]

  const close = createShot(scene, '1C-林夏近景')
  close.duration = 6
  close.notes = '林夏停下，视线落到桌上的文件包。'
  close.camera.marks = [
    createCameraMark({ x: -1.7, y: 1.65, z: 1.4 }, 0, -0.08, -0.02, 70),
    createCameraMark({ x: -1.5, y: 1.62, z: 1.05 }, 5.5, -0.04, -0.04, 85)
  ]
  scene.shots = [wide, overShoulder, close]
  return doc
}

export function createScene(number: number): Scene {
  const take: BlockingTake = { id: newId('take'), name: 'Master', tracks: [] }
  const scene: Scene = {
    id: newId('scene'),
    name: `Scene ${number}`,
    number,
    environment: { lighting: 'day', sunAzimuth: 0.8, sunElevation: 0.9, fog: 0 },
    entities: [],
    blocking: [take],
    shots: [],
    scans: []
  }
  scene.shots.push(createShot(scene, `${number}A`))
  return scene
}

export function createShot(scene: Scene, name: string): Shot {
  return {
    id: newId('shot'),
    name,
    duration: 5,
    fps: 24,
    aspect: '9:16',
    blockingTakeId: scene.blocking[0]!.id,
    camera: {
      sensorId: 'super35',
      rig: 'sticks',
      rigIntensity: 0.5,
      seed: Math.floor(Math.random() * 1e9),
      marks: []
    },
    continuity: { overlapFramesToNext: 8 }
  }
}

export function createScan(name: string, file: string, position: V3): ScanRef {
  return {
    id: newId('scan'),
    name,
    file,
    position,
    rotationY: 0,
    scale: 1,
    visible: true
  }
}

export function createEntity(assetId: string, name: string, position: V3): Entity {
  return {
    id: newId('ent'),
    assetId,
    name,
    transform: { position, rotationY: 0, scale: 1 }
  }
}

export function createActorMark(position: V3, time: number, gait: GaitId = 'walk'): ActorMark {
  return { id: newId('mark'), time, hold: 0, easeIn: 0.25, easeOut: 0.25, position, gait }
}

export function createCameraMark(
  position: V3,
  time: number,
  pan: number,
  tilt: number,
  focalLength: number
): CameraMark {
  return {
    id: newId('cmark'),
    time,
    hold: 0,
    easeIn: 0.3,
    easeOut: 0.3,
    position,
    pan,
    tilt,
    roll: 0,
    focalLength
  }
}

/* ------------------------------ validation ------------------------------ */

export interface ValidationIssue {
  path: string
  message: string
}

export function validateProject(doc: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const err = (path: string, message: string) => issues.push({ path, message })
  if (typeof doc !== 'object' || doc === null) {
    err('$', 'project is not an object')
    return issues
  }
  const p = doc as Record<string, unknown>
  if (p.version !== 1) err('version', `unsupported schema version ${String(p.version)}`)
  if (typeof p.name !== 'string') err('name', 'missing project name')
  const settings = p.settings as Record<string, unknown> | undefined
  if (settings?.comfyConnectionMode !== undefined &&
    settings.comfyConnectionMode !== 'local' && settings.comfyConnectionMode !== 'trusted-network') {
    err('settings.comfyConnectionMode', 'must be local or trusted-network')
  }
  if (settings?.comfyAutoUpload !== undefined && typeof settings.comfyAutoUpload !== 'boolean') {
    err('settings.comfyAutoUpload', 'must be a boolean')
  }
  if (settings?.comfyWorkflowPath !== undefined &&
    (typeof settings.comfyWorkflowPath !== 'string' || normalizeProjectRelativePath(settings.comfyWorkflowPath) === null)) {
    err('settings.comfyWorkflowPath', 'must be a relative path inside the project')
  }
  if (p.referenceAssets !== undefined && !Array.isArray(p.referenceAssets)) {
    err('referenceAssets', 'must be an array')
  } else if (Array.isArray(p.referenceAssets)) {
    p.referenceAssets.forEach((asset: unknown, i: number) => {
      if (typeof asset !== 'object' || asset === null) return err(`referenceAssets[${i}]`, 'not an object')
      const ref = asset as Record<string, unknown>
      if (!Array.isArray(ref.files)) return err(`referenceAssets[${i}].files`, 'must be an array')
      for (const [j, file] of (ref.files as unknown[]).entries()) {
        if (typeof file !== 'string' || normalizeProjectRelativePath(file) === null) {
          err(`referenceAssets[${i}].files[${j}]`, 'must be a relative path inside the project')
        }
      }
      if (ref.states !== undefined && !Array.isArray(ref.states)) {
        err(`referenceAssets[${i}].states`, 'must be an array')
      } else if (Array.isArray(ref.states)) {
        ref.states.forEach((state: unknown, stateIndex: number) => {
          if (typeof state !== 'object' || state === null) {
            err(`referenceAssets[${i}].states[${stateIndex}]`, 'not an object')
            return
          }
          const rawState = state as Record<string, unknown>
          if (!Array.isArray(rawState.slots)) {
            err(`referenceAssets[${i}].states[${stateIndex}].slots`, 'must be an array')
            return
          }
          rawState.slots.forEach((slot: unknown, slotIndex: number) => {
            if (typeof slot !== 'object' || slot === null) return
            const rawSlot = slot as Record<string, unknown>
            if (!Array.isArray(rawSlot.versions)) {
              err(`referenceAssets[${i}].states[${stateIndex}].slots[${slotIndex}].versions`, 'must be an array')
              return
            }
            rawSlot.versions.forEach((version: unknown, versionIndex: number) => {
              const path = typeof version === 'object' && version !== null
                ? (version as Record<string, unknown>).path
                : undefined
              if (typeof path !== 'string' || normalizeProjectRelativePath(path) === null) {
                err(
                  `referenceAssets[${i}].states[${stateIndex}].slots[${slotIndex}].versions[${versionIndex}].path`,
                  'must be a relative path inside the project'
                )
              }
            })
          })
        })
      }
    })
  }
  if (p.assetRequirementIR !== undefined) {
    const result = validateAssetRequirementIR(p.assetRequirementIR)
    for (const message of result.errors) err('assetRequirementIR', message)
  }
  if (p.sourceScript !== undefined) {
    const source = p.sourceScript as Record<string, unknown>
    if (typeof source !== 'object' || source === null || typeof source.name !== 'string' || typeof source.text !== 'string') {
      err('sourceScript', 'must contain string name and text fields')
    }
  }
  if (p.previsIR !== undefined) {
    const previs = p.previsIR as Record<string, unknown>
    if (typeof previs !== 'object' || previs === null || typeof previs.name !== 'string' || typeof previs.text !== 'string' || !['previs-ir', 'model-ir'].includes(String(previs.engine))) {
      err('previsIR', 'must contain name, text and a valid engine')
    }
  }
  if (p.directorPackage !== undefined) {
    const directorPackage = p.directorPackage as Record<string, unknown>
    if (typeof directorPackage !== 'object' || directorPackage === null || typeof directorPackage.name !== 'string' || typeof directorPackage.text !== 'string') {
      err('directorPackage', 'must contain string name and text fields')
    } else {
      if (directorPackage.packageId !== undefined && typeof directorPackage.packageId !== 'string') err('directorPackage.packageId', 'must be a string')
      if (directorPackage.imageCount !== undefined && typeof directorPackage.imageCount !== 'number') err('directorPackage.imageCount', 'must be a number')
      if (directorPackage.modelCount !== undefined && typeof directorPackage.modelCount !== 'number') err('directorPackage.modelCount', 'must be a number')
      if (directorPackage.blenderManifestPath !== undefined && typeof directorPackage.blenderManifestPath !== 'string') err('directorPackage.blenderManifestPath', 'must be a string')
      if (directorPackage.generationPrompts !== undefined) {
        const prompts = directorPackage.generationPrompts as Record<string, unknown>
        if (typeof prompts !== 'object' || prompts === null || typeof prompts.baselines !== 'object' || prompts.baselines === null || Array.isArray(prompts.baselines)) {
          err('directorPackage.generationPrompts.baselines', 'must be an object')
        } else if (typeof prompts.drafts !== 'object' || prompts.drafts === null || Array.isArray(prompts.drafts)) {
          err('directorPackage.generationPrompts.drafts', 'must be an object')
        }
      }
    }
  }
  if (!Array.isArray(p.scenes)) {
    err('scenes', 'missing scenes array')
    return issues
  }
  const validatePrevisDelivery = (previsValue: unknown, approvedValue: unknown, basePath: string): void => {
    if (previsValue === undefined) {
      if (approvedValue !== undefined) err(`${basePath}.approvedPrevisId`, 'cannot exist without previs exports')
      return
    }
    if (!Array.isArray(previsValue)) {
      err(`${basePath}.previsExports`, 'must be an array')
      return
    }
    const ids = new Set<string>()
    for (const [exportIndex, item] of previsValue.entries()) {
      const itemPath = `${basePath}.previsExports[${exportIndex}]`
      const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : null
      if (!record) {
        err(itemPath, 'must be an object')
        continue
      }
      if (typeof record.id !== 'string' || !record.id.trim()) err(`${itemPath}.id`, 'must be a non-empty string')
      else if (ids.has(record.id)) err(`${itemPath}.id`, 'must be unique within the shot')
      else ids.add(record.id)
      for (const field of ['relativePath', 'packageRelativePath'] as const) {
        if (typeof record[field] !== 'string' || normalizeProjectRelativePath(record[field]) === null) {
          err(`${itemPath}.${field}`, 'must be a relative path inside the project')
        }
      }
      if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) {
        err(`${itemPath}.createdAt`, 'must be an ISO date string')
      }
      for (const field of ['duration', 'fps', 'width', 'height'] as const) {
        if (typeof record[field] !== 'number' || !Number.isFinite(record[field]) || record[field] <= 0) {
          err(`${itemPath}.${field}`, 'must be a finite number > 0')
        }
      }
      if (!['16:9', '9:16', '2.39:1', '4:3', '1:1'].includes(String(record.aspect))) {
        err(`${itemPath}.aspect`, 'must be a supported aspect ratio')
      }
      if (record.engine !== undefined && record.engine !== 'threejs' && record.engine !== 'blender') {
        err(`${itemPath}.engine`, 'must be threejs or blender')
      }
      if (record.status !== 'draft' && record.status !== 'approved') {
        err(`${itemPath}.status`, 'must be draft or approved')
      }
      if (record.approvedAt !== undefined &&
        (typeof record.approvedAt !== 'string' || !Number.isFinite(Date.parse(record.approvedAt)))) {
        err(`${itemPath}.approvedAt`, 'must be an ISO date string')
      } else if (record.status === 'approved' && record.approvedAt === undefined) {
        err(`${itemPath}.approvedAt`, 'is required for an approved record')
      }
    }
    if (approvedValue !== undefined) {
      if (typeof approvedValue !== 'string') {
        err(`${basePath}.approvedPrevisId`, 'must be a string')
      } else if (!previsValue.some((item) => {
        const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : null
        return Boolean(record && record.id === approvedValue && record.status === 'approved')
      })) {
        err(`${basePath}.approvedPrevisId`, 'must reference an approved previs export')
      }
    }
  }
  p.scenes.forEach((s: unknown, i: number) => {
    if (typeof s !== 'object' || s === null) return err(`scenes[${i}]`, 'scene is not an object')
    const scene = s as Record<string, unknown>
    if (typeof scene.id !== 'string') err(`scenes[${i}].id`, 'missing id')
    if (!Array.isArray(scene.entities)) err(`scenes[${i}].entities`, 'missing entities')
    else {
      ;(scene.entities as unknown[]).forEach((entity: unknown, j: number) => {
        if (typeof entity !== 'object' || entity === null) return
        const sourceFile = (entity as Record<string, unknown>).sourceFile
        if (sourceFile !== undefined &&
          (typeof sourceFile !== 'string' || normalizeProjectRelativePath(sourceFile) === null)) {
          err(`scenes[${i}].entities[${j}].sourceFile`, 'must be a relative path inside the project')
        }
      })
    }
    if (!Array.isArray(scene.blocking) || (scene.blocking as unknown[]).length === 0)
      err(`scenes[${i}].blocking`, 'scene needs at least one blocking take')
    if (!Array.isArray(scene.shots)) err(`scenes[${i}].shots`, 'missing shots')
    else {
      const takeIds = new Set(
        (Array.isArray(scene.blocking) ? (scene.blocking as { id?: unknown }[]) : [])
          .map((b) => b.id)
          .filter((x): x is string => typeof x === 'string')
      )
      ;(scene.shots as unknown[]).forEach((sh: unknown, j: number) => {
        if (typeof sh !== 'object' || sh === null) return err(`scenes[${i}].shots[${j}]`, 'not an object')
        const shot = sh as Record<string, unknown>
        if (shot.whiteModelEngine !== undefined && shot.whiteModelEngine !== 'threejs' && shot.whiteModelEngine !== 'blender') {
          err(`scenes[${i}].shots[${j}].whiteModelEngine`, 'must be threejs or blender')
        }
        if (typeof shot.duration !== 'number' || shot.duration <= 0)
          err(`scenes[${i}].shots[${j}].duration`, 'duration must be > 0')
        if (typeof shot.blockingTakeId !== 'string' || !takeIds.has(shot.blockingTakeId))
          err(`scenes[${i}].shots[${j}].blockingTakeId`, 'references a missing blocking take')
        const storyboard = shot.storyboard as Record<string, unknown> | undefined
        if (storyboard !== undefined &&
          (typeof storyboard !== 'object' || storyboard === null || typeof storyboard.content !== 'string')) {
          err(`scenes[${i}].shots[${j}].storyboard`, 'must contain string content')
        } else if (storyboard?.sourceShotId !== undefined && typeof storyboard.sourceShotId !== 'string') {
          err(`scenes[${i}].shots[${j}].storyboard.sourceShotId`, 'must be a string')
        }
        const camera = shot.camera as Record<string, unknown> | undefined
        if (!camera || !Array.isArray(camera.marks)) err(`scenes[${i}].shots[${j}].camera`, 'missing camera')
        const continuity = shot.continuity as Record<string, unknown> | undefined
        if (continuity &&
          (typeof continuity.overlapFramesToNext !== 'number' || continuity.overlapFramesToNext < 0)) {
          err(`scenes[${i}].shots[${j}].continuity.overlapFramesToNext`, 'must be >= 0')
        }
        const generation = shot.generation as Record<string, unknown> | undefined
        if (generation?.workflowPath !== undefined &&
          (typeof generation.workflowPath !== 'string' || normalizeProjectRelativePath(generation.workflowPath) === null)) {
          err(`scenes[${i}].shots[${j}].generation.workflowPath`, 'must be a relative path inside the project')
        }
        if (generation?.outputs !== undefined) {
          if (!Array.isArray(generation.outputs)) {
            err(`scenes[${i}].shots[${j}].generation.outputs`, 'must be an array')
          } else {
            for (const [outputIndex, output] of generation.outputs.entries()) {
              if (typeof output !== 'string' || normalizeProjectRelativePath(output) === null) {
                err(`scenes[${i}].shots[${j}].generation.outputs[${outputIndex}]`, 'must be a relative path inside the project')
              }
            }
          }
        }
        const cloudGeneration = shot.cloudGeneration as Record<string, unknown> | undefined
        if (cloudGeneration?.outputs !== undefined) {
          if (!Array.isArray(cloudGeneration.outputs)) {
            err(`scenes[${i}].shots[${j}].cloudGeneration.outputs`, 'must be an array')
          } else {
            for (const [outputIndex, output] of cloudGeneration.outputs.entries()) {
              if (typeof output !== 'string' || normalizeProjectRelativePath(output) === null) {
                err(`scenes[${i}].shots[${j}].cloudGeneration.outputs[${outputIndex}]`, 'must be a relative path inside the project')
              }
            }
          }
        }
        const reference = shot.referenceVideo as Record<string, unknown> | undefined
        if (reference &&
          (typeof reference.path !== 'string' || normalizeProjectRelativePath(reference.path) === null)) {
          err(`scenes[${i}].shots[${j}].referenceVideo.path`, 'must be a relative path inside the project')
        }
        validatePrevisDelivery(shot.previsExports, shot.approvedPrevisId, `scenes[${i}].shots[${j}]`)
      })
    }
    if (Array.isArray(scene.drafts)) {
      ;(scene.drafts as unknown[]).forEach((draft: unknown, j: number) => {
        if (typeof draft !== 'object' || draft === null) return
        const reference = (draft as Record<string, unknown>).referenceVideo as
          | Record<string, unknown>
          | undefined
        if (reference &&
          (typeof reference.path !== 'string' || normalizeProjectRelativePath(reference.path) === null)) {
          err(`scenes[${i}].drafts[${j}].referenceVideo.path`, 'must be a relative path inside the project')
        }
        validatePrevisDelivery(
          (draft as Record<string, unknown>).previsExports,
          (draft as Record<string, unknown>).approvedPrevisId,
          `scenes[${i}].drafts[${j}]`
        )
        const whiteModelEngine = (draft as Record<string, unknown>).whiteModelEngine
        if (whiteModelEngine !== undefined && whiteModelEngine !== 'threejs' && whiteModelEngine !== 'blender') {
          err(`scenes[${i}].drafts[${j}].whiteModelEngine`, 'must be threejs or blender')
        }
        const generation = (draft as Record<string, unknown>).generation as Record<string, unknown> | undefined
        if (generation?.workflowPath !== undefined &&
          (typeof generation.workflowPath !== 'string' || normalizeProjectRelativePath(generation.workflowPath) === null)) {
          err(`scenes[${i}].drafts[${j}].generation.workflowPath`, 'must be a relative path inside the project')
        }
        if (generation?.outputs !== undefined && !Array.isArray(generation.outputs)) {
          err(`scenes[${i}].drafts[${j}].generation.outputs`, 'must be an array')
        } else if (Array.isArray(generation?.outputs)) {
          for (const [outputIndex, output] of generation.outputs.entries()) {
            if (typeof output !== 'string' || normalizeProjectRelativePath(output) === null) {
              err(`scenes[${i}].drafts[${j}].generation.outputs[${outputIndex}]`, 'must be a relative path inside the project')
            }
          }
        }
        const cloudGeneration = (draft as Record<string, unknown>).cloudGeneration as Record<string, unknown> | undefined
        if (cloudGeneration?.outputs !== undefined && !Array.isArray(cloudGeneration.outputs)) {
          err(`scenes[${i}].drafts[${j}].cloudGeneration.outputs`, 'must be an array')
        } else if (Array.isArray(cloudGeneration?.outputs)) {
          for (const [outputIndex, output] of cloudGeneration.outputs.entries()) {
            if (typeof output !== 'string' || normalizeProjectRelativePath(output) === null) {
              err(`scenes[${i}].drafts[${j}].cloudGeneration.outputs[${outputIndex}]`, 'must be a relative path inside the project')
            }
          }
        }
      })
    }
  })
  return issues
}

function requirePortableProjectPath(value: string, location: string): string {
  const normalized = normalizeProjectRelativePath(value)
  if (!normalized) throw new Error(`${location}: must be a relative path inside the project`)
  return normalized
}

function normalizeProjectPaths(doc: ProjectDoc): ProjectDoc {
  if (doc.settings.comfyWorkflowPath !== undefined) {
    doc.settings.comfyWorkflowPath = requirePortableProjectPath(
      doc.settings.comfyWorkflowPath,
      'settings.comfyWorkflowPath'
    )
  }
  for (const [assetIndex, asset] of (doc.referenceAssets ?? []).entries()) {
    asset.files = asset.files.map((file, fileIndex) =>
      requirePortableProjectPath(file, `referenceAssets[${assetIndex}].files[${fileIndex}]`)
    )
    for (const [stateIndex, state] of (asset.states ?? []).entries()) {
      for (const [slotIndex, slot] of state.slots.entries()) {
        for (const [versionIndex, version] of slot.versions.entries()) {
          version.path = requirePortableProjectPath(
            version.path,
            `referenceAssets[${assetIndex}].states[${stateIndex}].slots[${slotIndex}].versions[${versionIndex}].path`
          )
        }
      }
    }
  }
  for (const [sceneIndex, scene] of doc.scenes.entries()) {
    for (const [entityIndex, entity] of scene.entities.entries()) {
      if (entity.sourceFile !== undefined) {
        entity.sourceFile = requirePortableProjectPath(
          entity.sourceFile,
          `scenes[${sceneIndex}].entities[${entityIndex}].sourceFile`
        )
      }
    }
    for (const [shotIndex, shot] of [...scene.shots, ...(scene.drafts ?? [])].entries()) {
      if (shot.referenceVideo) {
        shot.referenceVideo.path = requirePortableProjectPath(
          shot.referenceVideo.path,
          `scenes[${sceneIndex}].shotsOrDrafts[${shotIndex}].referenceVideo.path`
        )
      }
      if (shot.previsExports) {
        shot.previsExports = shot.previsExports.map((record, exportIndex) => ({
          ...record,
          relativePath: requirePortableProjectPath(
            record.relativePath,
            `scenes[${sceneIndex}].shotsOrDrafts[${shotIndex}].previsExports[${exportIndex}].relativePath`
          ),
          packageRelativePath: requirePortableProjectPath(
            record.packageRelativePath,
            `scenes[${sceneIndex}].shotsOrDrafts[${shotIndex}].previsExports[${exportIndex}].packageRelativePath`
          )
        }))
      }
      if (shot.generation) {
        shot.generation.workflowPath = requirePortableProjectPath(
          shot.generation.workflowPath,
          `scenes[${sceneIndex}].shotsOrDrafts[${shotIndex}].generation.workflowPath`
        )
        shot.generation.outputs = shot.generation.outputs?.map((output, outputIndex) =>
          requirePortableProjectPath(
            output,
            `scenes[${sceneIndex}].shotsOrDrafts[${shotIndex}].generation.outputs[${outputIndex}]`
          )
        )
      }
      if (shot.cloudGeneration) {
        shot.cloudGeneration.outputs = shot.cloudGeneration.outputs?.map((output, outputIndex) =>
          requirePortableProjectPath(
            output,
            `scenes[${sceneIndex}].shotsOrDrafts[${shotIndex}].cloudGeneration.outputs[${outputIndex}]`
          )
        )
      }
    }
  }
  return doc
}

/* ---------------------------- serialization ----------------------------- */

/** Recursively sort object keys so serialization is byte-stable. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = stable(v)
    }
    return out
  }
  return value
}

export function serializeProject(doc: ProjectDoc): string {
  const copy = JSON.parse(JSON.stringify(doc)) as ProjectDoc
  return JSON.stringify(stable(normalizeProjectPaths(copy)), null, 2) + '\n'
}

/**
 * Forward-migrate a validated document in place. Additive fields introduced
 * after v1 (like scene.scans) are normalized here so the rest of the app can
 * rely on their shape without version-gating. Never throws — an unrecognized
 * value is replaced with its safe default rather than rejected.
 */
const REFERENCE_STATUSES: readonly ReferenceAssetStatus[] = [
  'needed', 'partial', 'ready', 'approved', 'locked', 'superseded'
]

const SLOT_TYPES: readonly ReferenceAssetSlot['type'][] = [
  'identity', 'costume', 'geometry', 'camera_view', 'lighting_state',
  'standard_view', 'detail', 'scale_reference', 'custom'
]

const SLOT_VIEWS: readonly ReferenceAssetSlot['view'][] = [
  'front', 'back', 'left_profile', 'right_profile', 'left_three_quarter',
  'right_three_quarter', 'full_body', 'top_down', 'wide', 'detail', 'custom'
]

function migrateAssetVersion(raw: unknown): ReferenceAssetVersion | null {
  if (typeof raw !== 'object' || raw === null) return null
  const version = raw as Record<string, unknown>
  if (typeof version.path !== 'string') return null
  return {
    id: typeof version.id === 'string' ? version.id : newId('assetver'),
    path: version.path,
    ...(typeof version.sha256 === 'string' ? { sha256: version.sha256 } : {}),
    ...(typeof version.sizeBytes === 'number' ? { sizeBytes: version.sizeBytes } : {}),
    ...(typeof version.width === 'number' ? { width: version.width } : {}),
    ...(typeof version.height === 'number' ? { height: version.height } : {}),
    ...(typeof version.createdAt === 'string' ? { createdAt: version.createdAt } : {}),
    ...(typeof version.sourceName === 'string' ? { sourceName: version.sourceName } : {}),
    ...(version.archived === true ? { archived: true } : {})
  }
}

function migrateAssetStates(raw: unknown): ReferenceAssetState[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((state): state is Record<string, unknown> => typeof state === 'object' && state !== null)
    .map((state): ReferenceAssetState => ({
      id: typeof state.id === 'string' ? state.id : newId('assetstate'),
      name: typeof state.name === 'string' ? state.name : '资产状态',
      ...(typeof state.description === 'string' ? { description: state.description } : {}),
      appliesTo: Array.isArray(state.appliesTo)
        ? state.appliesTo.filter((shot): shot is string => typeof shot === 'string')
        : ['*'],
      slots: Array.isArray(state.slots)
        ? state.slots
            .filter((slot): slot is Record<string, unknown> => typeof slot === 'object' && slot !== null)
            .map((slot): ReferenceAssetSlot => {
              const versions = Array.isArray(slot.versions)
                ? slot.versions.map(migrateAssetVersion).filter((version): version is ReferenceAssetVersion => version !== null)
                : []
              const current = typeof slot.currentVersionId === 'string' &&
                versions.some((version) => version.id === slot.currentVersionId)
                ? slot.currentVersionId
                : undefined
              const type = SLOT_TYPES.includes(slot.type as ReferenceAssetSlot['type'])
                ? slot.type as ReferenceAssetSlot['type']
                : 'custom'
              const view = SLOT_VIEWS.includes(slot.view as ReferenceAssetSlot['view'])
                ? slot.view as ReferenceAssetSlot['view']
                : 'custom'
              return {
                id: typeof slot.id === 'string' ? slot.id : newId('assetslot'),
                label: typeof slot.label === 'string' ? slot.label : '参考图',
                type,
                view,
                required: slot.required === true,
                ...(typeof slot.description === 'string' ? { description: slot.description } : {}),
                ...(typeof slot.cameraId === 'string' ? { cameraId: slot.cameraId } : {}),
                ...(current ? { currentVersionId: current } : {}),
                versions
              }
            })
        : []
    }))
}

function legacyAssetState(assetId: string, files: string[]): ReferenceAssetState[] {
  if (files.length === 0) return []
  return [{
    id: `${assetId}-legacy`,
    name: '旧格式参考',
    description: '由旧版平铺参考文件迁移，请在资产中心手动整理并确认槽位。',
    appliesTo: ['*'],
    slots: files.map((path, index) => {
      const versionId = `${assetId}-legacy-v${index + 1}`
      return {
        id: `legacy-reference-${index + 1}`,
        label: `旧参考图 ${index + 1}`,
        type: 'custom',
        view: 'custom',
        required: false,
        currentVersionId: versionId,
        versions: [{ id: versionId, path }]
      }
    })
  }]
}

function migrateProject(doc: ProjectDoc): ProjectDoc {
  doc.settings.comfyConnectionMode = doc.settings.comfyConnectionMode === 'trusted-network'
    ? 'trusted-network'
    : 'local'
  doc.settings.comfyAutoUpload = doc.settings.comfyAutoUpload !== false
  const assets = (doc as { referenceAssets?: unknown }).referenceAssets
  doc.referenceAssets = Array.isArray(assets)
    ? assets
        .filter((asset): asset is Record<string, unknown> => typeof asset === 'object' && asset !== null)
        .map((asset): ReferenceAsset => {
          const id = typeof asset.id === 'string' ? asset.id : newId('refasset')
          const files = Array.isArray(asset.files)
            ? asset.files.filter((file): file is string => typeof file === 'string')
            : []
          const migratedStates = migrateAssetStates(asset.states)
          const status = REFERENCE_STATUSES.includes(asset.status as ReferenceAssetStatus)
            ? asset.status as ReferenceAssetStatus
            : files.length > 0 ? 'partial' : 'needed'
          const hint = typeof asset.whiteModelHint === 'object' && asset.whiteModelHint !== null
            ? asset.whiteModelHint as Record<string, unknown>
            : undefined
          return {
            id,
            kind: asset.kind === 'scene' || asset.kind === 'prop' ? asset.kind : 'character',
            name: typeof asset.name === 'string' ? asset.name : 'Reference asset',
            files,
            status,
            ...(typeof asset.notes === 'string' ? { notes: asset.notes } : {}),
            ...(Array.isArray(asset.aliases)
              ? { aliases: asset.aliases.filter((alias): alias is string => typeof alias === 'string') }
              : {}),
            ...(typeof asset.importance === 'string' ? { importance: asset.importance } : {}),
            ...(typeof asset.semanticType === 'string' ? { semanticType: asset.semanticType } : {}),
            ...(typeof asset.firstAppearance === 'string' ? { firstAppearance: asset.firstAppearance } : {}),
            ...(Array.isArray(asset.appearances)
              ? { appearances: asset.appearances.filter((shot): shot is string => typeof shot === 'string') }
              : {}),
            ...(hint && typeof hint.semanticType === 'string'
              ? {
                  whiteModelHint: {
                    semanticType: hint.semanticType,
                    ...(typeof hint.approximateHeightMeters === 'number'
                      ? { approximateHeightMeters: hint.approximateHeightMeters }
                      : {})
                  }
                }
              : {}),
            states: migratedStates.length > 0 ? migratedStates : legacyAssetState(id, files)
          }
        })
    : []
  for (const scene of doc.scenes) {
    for (const shot of [...scene.shots, ...(scene.drafts ?? [])]) {
      const frames = shot.continuity?.overlapFramesToNext
      shot.continuity = {
        overlapFramesToNext: typeof frames === 'number' && frames >= 0 ? Math.round(frames) : 8
      }
    }
    const raw = (scene as { scans?: unknown }).scans
    if (!Array.isArray(raw)) {
      scene.scans = []
      continue
    }
    // Keep only well-formed scan refs; fill missing transform fields.
    scene.scans = raw
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s): ScanRef => {
        const pos = (s.position ?? {}) as Partial<V3>
        // Normalize to a portable project-relative path (Windows docs may
        // carry backslashes); a scan that can't normalize is dropped below.
        const file = typeof s.file === 'string' ? (normalizeProjectRelativePath(s.file) ?? '') : ''
        return {
          id: typeof s.id === 'string' ? s.id : newId('scan'),
          name: typeof s.name === 'string' ? s.name : 'Scan',
          file,
          position: {
            x: typeof pos.x === 'number' ? pos.x : 0,
            y: typeof pos.y === 'number' ? pos.y : 0,
            z: typeof pos.z === 'number' ? pos.z : 0
          },
          rotationY: typeof s.rotationY === 'number' ? s.rotationY : 0,
          ...(s.flipped === true ? { flipped: true } : {}),
          scale: typeof s.scale === 'number' && s.scale > 0 ? s.scale : 1,
          visible: s.visible !== false,
          ...(s.holdout === true ? { holdout: true } : {})
        }
      })
      .filter((s) => s.file !== '')
  }
  return doc
}

export function parseProject(json: string): { doc: ProjectDoc | null; issues: ValidationIssue[] } {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    return { doc: null, issues: [{ path: '$', message: `invalid JSON: ${(e as Error).message}` }] }
  }
  const issues = validateProject(raw)
  if (issues.length > 0) return { doc: null, issues }
  // Order matters only by convention: migrate fills additive fields (scans),
  // then path normalization enforces portable project-relative paths.
  return { doc: normalizeProjectPaths(migrateProject(raw as ProjectDoc)), issues: [] }
}
