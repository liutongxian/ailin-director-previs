/**
 * Blockout document model.
 *
 * A Project owns Scenes. A Scene owns the stage (entities), master blocking
 * takes, and Shots. A Shot owns a camera (marks + rig) and references a
 * blocking take — this is the coverage model: the action stays put, the
 * camera moves between shots.
 *
 * Everything here is plain serializable data. Time is in seconds, distance
 * in meters, angles in radians unless suffixed Deg.
 */


export interface V3 {
  x: number
  y: number
  z: number
}

export type EntityCategory =
  | 'people'
  | 'animals'
  | 'vehicles'
  | 'furniture'
  | 'props'
  | 'environment'
  | 'primitives'
  | 'custom'

export type GaitId =
  | 'stand'
  | 'walk'
  | 'jog'
  | 'run'
  | 'sit'
  | 'lie'
  | 'crouch'
  | 'gesture'
  | 'fall'

export type LightingPresetId =
  | 'day'
  | 'goldenHour'
  | 'night'
  | 'interiorWarm'
  | 'interiorCool'
  | 'club'
  // Physical-sky presets: a real atmospheric-scattering sky dome lit from the
  // scene's sunAzimuth/sunElevation. Fully deterministic (fixed turbidity /
  // rayleigh per preset) so they render byte-identically in clean exports.
  | 'middaySky'
  | 'goldenHourSky'
  | 'blueHourSky'

export type RigId =
  | 'sticks'
  | 'dolly'
  | 'steadicam'
  | 'handheld'
  | 'crane'
  | 'drone'
  | 'carMount'

export type SensorId = 'super16' | 'super35' | 'fullFrame' | 'imax65'

export type ShotSizeId = 'EWS' | 'WS' | 'FS' | 'MS' | 'MCU' | 'CU' | 'ECU'

export type AspectId = '16:9' | '9:16' | '2.39:1' | '4:3' | '1:1'

export interface Label {
  text: string
  /** Hex color like '#e5484d'; tints the model and colors marks/labels. */
  color: string
}

export interface Transform {
  position: V3
  /** Yaw around +Y. Entities are upright; full rotation lives on marks/camera. */
  rotationY: number
  scale: number
}

export interface Entity {
  id: string
  /** Catalog asset id, e.g. 'person.man', 'vehicle.suv', or 'custom.<uuid>'. */
  assetId: string
  name: string
  label?: Label
  transform: Transform
  /** Per-asset parameters (height/build sliders, color variants). */
  params?: Record<string, number | string>
  /** For custom imports: path relative to project assets/ dir. */
  sourceFile?: string
  /**
   * Marriage: when set, this entity rides the named entity — it follows the
   * parent's motion (blocking marks, gizmo drags) at a fixed local offset.
   * A married entity with its own marks ignores the marriage while tracked.
   */
  attachedTo?: string
  /** Local offset in the parent's frame (position + yaw), captured at marry time. */
  attachedLocal?: { x: number; y: number; z: number; rotY: number }
  /** Hide this entity in every export pass (still visible in the editor). */
  excludeFromExport?: boolean
  /** Stable approved reference asset used by downstream video generation. */
  referenceAssetId?: string
  /** Created by the director desk from storyboard text; manual entities omit this. */
  storyboardGenerated?: boolean
  /** Human-readable role detected from the storyboard (character / prop / environment). */
  storyboardRole?: string
}

export type ReferenceAssetKind = 'character' | 'scene' | 'prop'

export type ReferenceAssetStatus =
  | 'needed'
  | 'partial'
  | 'ready'
  | 'approved'
  | 'locked'
  | 'superseded'

export interface ReferenceAssetVersion {
  id: string
  /** Project-relative immutable file path. */
  path: string
  /** Missing only on files migrated from the old flat reference format. */
  sha256?: string
  sizeBytes?: number
  width?: number
  height?: number
  createdAt?: string
  sourceName?: string
  archived?: boolean
}

export interface ReferenceAssetSlot {
  id: string
  label: string
  type: RequirementSlotType
  view: RequirementSlotView
  required: boolean
  description?: string
  /** Used by scene camera-view slots; never inferred from the image. */
  cameraId?: string
  currentVersionId?: string
  versions: ReferenceAssetVersion[]
}

export interface ReferenceAssetState {
  id: string
  name: string
  description?: string
  /** Shot IDs or inclusive ranges written as START:END. */
  appliesTo: string[]
  slots: ReferenceAssetSlot[]
}


/**
 * A production reference asset. Files are copied into the project so the
 * mapping stays portable and every shot can hand the same identity forward.
 */

import type { AssetRequirementIR, RequirementSlotType, RequirementSlotView } from './asset-requirement-ir'
export interface ReferenceAsset {
  id: string
  kind: ReferenceAssetKind
  name: string
  /** Project-relative files: images, video, models, or an asset manifest. */
  files: string[]
  notes?: string
  status?: ReferenceAssetStatus
  aliases?: string[]
  importance?: string
  semanticType?: string
  firstAppearance?: string
  appearances?: string[]
  states?: ReferenceAssetState[]
  whiteModelHint?: {
    semanticType: string
    approximateHeightMeters?: number
  }
}

/** Shared mark fields. A mark = a position an entity/camera hits at a time. */
export interface MarkBase {
  id: string
  /** Arrival time in seconds from shot start. */
  time: number
  /** Seconds to remain at the mark after arrival. */
  hold: number
  /** 0..1 fraction of travel eased at departure / arrival. */
  easeIn: number
  easeOut: number
  position: V3
  /**
   * Optional waypoints shaping the path from the PREVIOUS mark to this one
   * (catmull-rom through prev → via… → this).
   */
  via?: V3[]
}

export interface ActorMark extends MarkBase {
  /** Gait adopted when travelling TOWARD this mark. */
  gait: GaitId
  /** If set, face this heading (yaw) on arrival; otherwise keep travel heading. */
  arriveHeading?: number
  /**
   * Per-joint pose offsets (radians) held AT this mark and interpolated
   * while travelling between marks — keyframed limb choreography for
   * fight/dance blocking. Keys match the renderer's joint override names
   * (shoulderLX, elbowR, torsoX, headY, …). Missing keys read as 0.
   */
  joints?: Record<string, number>
  /**
   * Boarding: on arriving at this mark, attach to the named entity for the
   * rest of the shot — walk to the bus door, then ride the bus. The offset
   * is captured from this mark's position relative to the vehicle at that
   * moment. Marks after a boarding mark are ignored while attached.
   */
  attachTo?: string
}

export interface CameraMark extends MarkBase {
  /** Orientation at this mark. */
  pan: number
  tilt: number
  roll: number
  focalLength: number
  /** Focus distance in meters; undefined = deep focus. */
  focusDistance?: number
}

export interface EntityTrack {
  entityId: string
  marks: ActorMark[]
}

/**
 * A blocking take: the choreography of every moving entity. Scene owns takes;
 * shots reference one, so coverage shares blocking. A shot that needs a
 * variant forks the take.
 */
export interface BlockingTake {
  id: string
  name: string
  tracks: EntityTrack[]
}

export interface ShotCamera {
  sensorId: SensorId
  rig: RigId
  /** 0..1, scales rig noise (handheld shake amount, steadicam drift). */
  rigIntensity: number
  /** Seed for rig noise — stored so exports are reproducible. */
  seed: number
  /** Entity to parent the camera to (carMount rig). */
  mountEntityId?: string
  /**
   * Aim lock: keep the camera pointed at this entity no matter how the
   * position moves (marks, recorded flights, presets). Pan/tilt from marks
   * are ignored while set; roll and lens still apply. Focus follows the
   * subject when no mark sets a focusDistance.
   */
  trackEntityId?: string
  marks: CameraMark[]
}

export interface ReferenceVideo {
  /** Path relative to project folder. */
  path: string
  opacity: number
  mode: 'ghost' | 'pip'
  /** Seconds added to shot time when sampling the video. */
  timeOffset: number
}

/** One deterministic white-model reference export for a shot. */
export interface PrevisExportRecord {
  id: string
  /** MP4 path relative to the project folder. */
  relativePath: string
  /** Export-package directory relative to the project folder. */
  packageRelativePath: string
  createdAt: string
  duration: number
  fps: number
  width: number
  height: number
  aspect: AspectId
  /** Renderer that produced this reference. Missing on legacy records means Three.js. */
  engine?: 'threejs' | 'blender'
  status: 'draft' | 'approved'
  approvedAt?: string
}

export interface Shot {
  id: string
  /** Film-style name, e.g. '1A'. */
  name: string
  duration: number
  fps: number
  aspect: AspectId
  blockingTakeId: string
  /** The ACTIVE camera (playback + export always use this one). */
  camera: ShotCamera
  /** Name of the active camera: 'A', 'B', 'C'… (default 'A'). */
  cameraName?: string
  /** Inactive cameras — switch via the camera inspector (Cam A/B/C chips). */
  cameraBank?: { name: string; camera: ShotCamera }[]
  notes?: string
  /** Director-desk source text and the last deterministic auto-stage result. */
  storyboard?: {
    content: string
    sourceName?: string
    /** Stable external Previs IR shot id for cross-document references. */
    sourceShotId?: string
    autoStageSummary?: string
    /** The source that produced the currently staged geometry/camera. */
    autoStageEngine?: 'local-v1' | 'previs-ir' | 'model-ir' | 'director-package' | 'cloud'
    cameraGenerated?: boolean
  }
  referenceVideo?: ReferenceVideo
  /** White-model renderer selected for the next preview generation. */
  whiteModelEngine?: 'threejs' | 'blender'
  /** White-model videos exported for review and downstream motion reference. */
  previsExports?: PrevisExportRecord[]
  /** The one user-approved previs version used by delivery by default. */
  approvedPrevisId?: string
  /** MiniMax H3 production route. Ref2VA is the safe default for previs-driven shots. */
  h3Route?: 'ref2va' | 'fl2va'
  /** Approved production frames for FL2VA. White-model stills are never stored here. */
  h3Anchors?: {
    firstFrame?: string
    lastFrame?: string
  }
  /** Explicit per-shot reference choices when the ComfyUI workflow has a cap. */
  assetReferenceSelection?: string[]
  /** Set on shots living in scene.drafts: the main shot this is a version of. */
  draftOf?: string
  /** Frames intentionally repeated into the next generated segment. */
  continuity?: {
    overlapFramesToNext: number
  }
  generation?: {
    promptId: string
    status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
    workflowPath: string
    submittedAt: string
    outputs?: string[]
    error?: string
  }
  /** Editable MiniMax H3 prompt draft compiled from this shot. API keys are never stored here. */
  h3Prompt?: {
    baseline: string
    draft: string
    sourceFingerprint: string
    source: 'local' | 'context-ir' | 'manual'
    updatedAt: string
    stale?: boolean
    mode: 'text' | 'first-last-frame' | 'reference'
    duration: number
    resolution: '768P' | '2K'
    ratio: string
    watermark: boolean
    contextIR?: {
      taskId: string
      status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
      submittedAt: string
      updatedAt: string
      submittedDraft?: string
      submittedFingerprint?: string
      prompt?: string
      error?: string
      pollingStopped?: boolean
    }
  }
  /** Last cloud video generation task for this shot. API keys are never stored here. */
  cloudGeneration?: {
    provider: 'byteplus-las' | 'minimax'
    model: string
    baseUrl: string
    taskId: string
    status: 'queued' | 'running' | 'complete' | 'failed' | 'expired' | 'cancelled'
    submittedAt: string
    updatedAt: string
    prompt: string
    referenceCount: number
    duration: number
    resolution: string
    ratio: string
    outputUrl?: string
    lastFrameUrl?: string
    taskType?: string
    pollingStopped?: boolean
    remoteDeleted?: boolean
    outputs?: string[]
    error?: string
  }
}

export interface SceneEnvironment {
  lighting: LightingPresetId
  /** Sun/key direction. */
  sunAzimuth: number
  sunElevation: number
  /** 0..1 atmosphere density. */
  fog: number
}

/**
 * A Gaussian-splat / photogrammetry scan of a real location, imported as a
 * blocking environment. Scan a place with a phone (Polycam/Luma/Scaniverse)
 * or any video-to-3D tool and block the action inside it. Editor-only: scans
 * are a staging aid and are hidden in every export pass so the deterministic
 * motion-reference package stays grey-box and byte-reproducible (they are
 * listed in metadata.json for the downstream generator's context).
 */
export interface ScanRef {
  id: string
  name: string
  /** Project-relative path, always 'scans/<file>' (.ply/.splat/.spz/.ksplat). */
  file: string
  /** World position of the scan's origin. */
  position: V3
  /** Yaw around +Y (radians). */
  rotationY: number
  /** Uniform scale. */
  scale: number
  /** Hidden in the editor viewport when false (still never exported). */
  visible: boolean
  /**
   * Pitch the scan 180° — many .splat exports (antimatter15-format tools)
   * are Y-down and load upside-down; this rights them without re-processing.
   */
  flipped?: boolean
  /**
   * Reserved for a future holdout/matte pass — when true the scan would be
   * treated as an occluder rather than visible geometry. Parsed and preserved
   * but not yet acted on.
   */
  holdout?: boolean
}

export interface Scene {
  id: string
  name: string
  number: number
  environment: SceneEnvironment
  entities: Entity[]
  /** Imported Gaussian-splat / photogrammetry environments (editor-only). */
  scans?: ScanRef[]
  blocking: BlockingTake[]
  shots: Shot[]
  /**
   * Draft versions of shots (experiments — "1A v1", "1A v2"). Full Shot
   * objects with draftOf pointing at the main shot; playable and exportable
   * like any shot, listed separately in the rail, promotable back.
   */
  drafts?: Shot[]
  /** Approved environment/location reference for this scene. */
  referenceAssetId?: string
}

export interface ProjectDoc {
  /** Schema version for forward migration. */
  version: 1
  id: string
  name: string
  settings: {
    defaultProfileId: string
    comfyBaseUrl?: string
    comfyWorkflowPath?: string
    /** Localhost is the safe default; trusted-network permits private LAN/Tailscale IPs. */
    comfyConnectionMode?: 'local' | 'trusted-network'
    /** Upload project inputs to ComfyUI before queueing. Defaults to true. */
    comfyAutoUpload?: boolean
  }
  /** Optional imported full script. Individual shots keep their own storyboard text. */
  sourceScript?: {
    name: string
    text: string
  }
  /** Last validated Previs IR. Kept separate so generated JSON never replaces the user's source text. */
  previsIR?: {
    name: string
    text: string
    engine: 'previs-ir' | 'model-ir'
  }
  /** Last validated one-file external-Agent package. Kept apart from source text and embedded Previs IR. */
  directorPackage?: {
    name: string
    text: string
    packageId?: string
    imageCount?: number
    modelCount?: number
    blenderManifestPath?: string
    generationPrompts?: {
      /** Imported stagePlans[].generationPrompt values, keyed by stable Previs IR shot ID. */
      baselines: Record<string, string>
      /** User-editable copies; the baseline remains immutable for restore. */
      drafts: Record<string, string>
      localDuration?: 5 | 10 | 15 | 30 | 60 | 90 | 120
    }
  }
  /** Approved production assets shared by every scene and shot. */
  referenceAssets?: ReferenceAsset[]
  /** Last validated external-Agent requirements used to create asset cards. */
  assetRequirementIR?: AssetRequirementIR
  scenes: Scene[]
}

/** Result of evaluating one entity at time t. */
export interface EntityState {
  entityId: string
  position: V3
  /** Travel heading (yaw). */
  heading: number
  gait: GaitId
  /** Meters travelled since shot start — drives gait cycle phase. */
  distanceTravelled: number
  /** Current speed m/s (0 when holding). */
  speed: number
  /** Interpolated per-joint pose offsets from the marks (radians). */
  joints?: Record<string, number>
}

/** Result of evaluating the camera at time t (rig noise already applied). */
export interface CameraState {
  position: V3
  pan: number
  tilt: number
  roll: number
  focalLength: number
  focusDistance?: number
  /** Vertical FOV in radians for the shot's sensor + aspect. */
  vfov: number
}

export interface ShotState {
  time: number
  camera: CameraState
  entities: EntityState[]
}
