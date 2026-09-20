// Modified for Director Desk camera and exact motion export; see MODIFICATIONS.md.
import { assetSpec } from './assets'
import { ASPECT_RATIOS, SENSORS } from './camera'
import type { ActorMark, AspectId, CameraMark, Entity, Scene, Shot, V3 } from './types'

export type BlenderVec3 = [number, number, number]
export type BlenderGeometryKind = 'actor' | 'animal' | 'vehicle' | 'furniture' | 'prop' | 'environment' | 'primitive' | 'placeholder'

export interface BlenderPlanMark {
  frame: number
  position: BlenderVec3
  headingRadians: number
  gait?: ActorMark['gait']
  joints?: Record<string, number>
}

export interface BlenderPlanEntity {
  id: string
  name: string
  assetId: string
  geometry: BlenderGeometryKind
  dimensions: { height: number; footprint: number }
  transform: { position: BlenderVec3; rotationZ: number; scale: number }
  accent: string
  marks: BlenderPlanMark[]
  /** Optional exact viewport mesh animation, baked in Blender world coordinates. */
  motionMeshes?: {
    vertices: number[]
    triangles: number[]
    color: string
    /** One column-major world matrix per output frame, starting at frameStart. */
    matrices: number[][]
  }[]
}

export interface BlenderPlanCameraMark {
  frame: number
  position: BlenderVec3
  aimAt: BlenderVec3
  focalLengthMm: number
  rollRadians: number
  /** Optional sampled camera transform; camera local axes remain -Z forward / +Y up. */
  worldMatrix?: number[]
}

export interface BlenderPlan {
  spec: 'ailin-blender-plan'
  version: '1.0'
  coordinateSystem: 'blender-z-up'
  project: { name: string }
  shot: {
    id: string
    sourceShotId?: string
    name: string
    durationSeconds: number
    fps: number
    frameStart: 1
    frameEnd: number
    aspect: AspectId
    resolution: { width: number; height: number }
  }
  environment: { name: string; assetId: string; lighting: Scene['environment']['lighting'] }
  entities: BlenderPlanEntity[]
  camera: { rig: Shot['camera']['rig']; sensorWidthMm: number; sensorFit?: 'HORIZONTAL'; marks: BlenderPlanCameraMark[] }
  warnings: string[]
  outputs: {
    blend: string
    startFrame: string
    middleFrame: string
    endFrame: string
    video: string
    state: string
  }
}

function blenderPosition(position: V3): BlenderVec3 {
  return [position.x, -position.z, position.y]
}

function blenderHeading(heading: number): number {
  return heading + Math.PI
}

function frameAt(time: number, fps: number, frameEnd: number): number {
  return Math.min(frameEnd, Math.max(1, Math.round(time * fps) + 1))
}

function resolutionForAspect(aspect: AspectId): { width: number; height: number } {
  switch (aspect) {
    case '9:16': return { width: 540, height: 960 }
    case '1:1': return { width: 720, height: 720 }
    case '4:3': return { width: 720, height: 540 }
    case '2.39:1': return { width: 960, height: 402 }
    default: return { width: 960, height: 540 }
  }
}

function geometryFor(entity: Entity): BlenderGeometryKind {
  switch (assetSpec(entity.assetId).category) {
    case 'people': return 'actor'
    case 'animals': return 'animal'
    case 'vehicles': return 'vehicle'
    case 'furniture': return 'furniture'
    case 'props': return 'prop'
    case 'environment': return 'environment'
    case 'primitives': return 'primitive'
    default: return 'placeholder'
  }
}

function actorMarks(entity: Entity, marks: ActorMark[], fps: number, frameEnd: number): BlenderPlanMark[] {
  return marks.map((mark) => ({
    frame: frameAt(mark.time, fps, frameEnd),
    position: blenderPosition(mark.position),
    headingRadians: blenderHeading(mark.arriveHeading ?? entity.transform.rotationY),
    ...(mark.gait ? { gait: mark.gait } : {}),
    ...(mark.joints ? { joints: { ...mark.joints } } : {})
  }))
}

function cameraAimAt(mark: CameraMark): V3 {
  const horizontal = Math.cos(mark.tilt) * 10
  return {
    x: mark.position.x - Math.sin(mark.pan) * horizontal,
    y: mark.position.y + Math.sin(mark.tilt) * 10,
    z: mark.position.z - Math.cos(mark.pan) * horizontal
  }
}

export function compileBlenderPlan(input: { projectName: string; scene: Scene; shot: Shot }): BlenderPlan {
  const { projectName, scene, shot } = input
  const fps = Math.max(1, Math.round(shot.fps))
  const frameEnd = Math.max(1, Math.round(shot.duration * fps))
  const take = scene.blocking.find((item) => item.id === shot.blockingTakeId) ?? scene.blocking[0]
  const warnings: string[] = []
  const environmentEntity = scene.entities.find((entity) => assetSpec(entity.assetId).category === 'environment')

  const entities = scene.entities
    .filter((entity) => !entity.excludeFromExport)
    .map((entity): BlenderPlanEntity => {
      const spec = assetSpec(entity.assetId)
      const geometry = geometryFor(entity)
      if (geometry === 'placeholder') {
        warnings.push(`“${entity.name}” (${entity.assetId}) 没有 Blender 构件，已使用带标签占位体。`)
      }
      const track = take?.tracks.find((item) => item.entityId === entity.id)
      if (track?.marks.some(mark => mark.joints?.grounded || mark.joints?.rootPitch || mark.joints?.rootRoll)) {
        warnings.push(`“${entity.name}”含完整地面姿态；当前 Blender 简化骨架不能还原此类动作，请使用交付页 Three.js 白模预演。`)
      }
      return {
        id: entity.id,
        name: entity.name,
        assetId: entity.assetId,
        geometry,
        dimensions: {
          height: spec.height * entity.transform.scale,
          footprint: spec.footprint * entity.transform.scale
        },
        transform: {
          position: blenderPosition(entity.transform.position),
          rotationZ: blenderHeading(entity.transform.rotationY),
          scale: entity.transform.scale
        },
        accent: entity.label?.color ?? '#87939c',
        marks: actorMarks(entity, track?.marks ?? [], fps, frameEnd)
      }
    })

  const cameraMarks = shot.camera.marks.map((mark) => ({
    frame: frameAt(mark.time, fps, frameEnd),
    position: blenderPosition(mark.position),
    aimAt: blenderPosition(cameraAimAt(mark)),
    focalLengthMm: mark.focalLength,
    rollRadians: mark.roll
  }))

  if (cameraMarks.length === 0) warnings.push('当前镜头没有摄影机关键点，Blender 将使用安全默认机位。')

  const id = shot.storyboard?.sourceShotId ?? shot.id
  return {
    spec: 'ailin-blender-plan',
    version: '1.0',
    coordinateSystem: 'blender-z-up',
    project: { name: projectName },
    shot: {
      id,
      ...(shot.storyboard?.sourceShotId ? { sourceShotId: shot.storyboard.sourceShotId } : {}),
      name: shot.name,
      durationSeconds: shot.duration,
      fps,
      frameStart: 1,
      frameEnd,
      aspect: shot.aspect,
      resolution: resolutionForAspect(shot.aspect)
    },
    environment: {
      name: scene.name,
      assetId: environmentEntity?.assetId ?? 'env.houseInterior',
      lighting: scene.environment.lighting
    },
    entities,
    camera: {
      rig: shot.camera.rig,
      // Match Three.js crop-to-aspect optics. A portrait frame uses the
      // physical sensor height, not Blender's unrelated AUTO-fit defaults.
      sensorWidthMm: Math.min(SENSORS[shot.camera.sensorId].width, SENSORS[shot.camera.sensorId].height * ASPECT_RATIOS[shot.aspect]),
      sensorFit: 'HORIZONTAL',
      marks: cameraMarks
    },
    warnings,
    outputs: {
      blend: `${id}-blender-blockout.blend`,
      startFrame: `${id}-start.png`,
      middleFrame: `${id}-middle.png`,
      endFrame: `${id}-end.png`,
      video: `${id}-blender-blockout.mp4`,
      state: `${id}-blender-state.json`
    }
  }
}
