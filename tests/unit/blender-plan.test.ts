import { describe, expect, it } from 'vitest'
import { compileBlenderPlan } from '@engine/blender-plan'
import { ASPECT_RATIOS, SENSORS, horizontalFov } from '@engine/camera'
import { createDemoProject, createEntity } from '@engine/schema'
import type { AspectId, SensorId } from '@engine/types'

function editableDemo() {
  const doc = createDemoProject('Open-core white model')
  const scene = doc.scenes[0]!
  return { scene, shot: scene.shots[0]! }
}

describe('generic Blender plan compiler', () => {
  it('matches the editable viewport horizontal FOV for every sensor and aspect', () => {
    const { scene, shot } = editableDemo()
    for (const sensorId of Object.keys(SENSORS) as SensorId[]) {
      for (const aspect of Object.keys(ASPECT_RATIOS) as AspectId[]) {
        shot.camera.sensorId = sensorId
        shot.aspect = aspect
        const plan = compileBlenderPlan({ projectName: 'Optics QA', scene, shot })
        expect(plan.camera.sensorFit).toBe('HORIZONTAL')
        expect(2 * Math.atan(plan.camera.sensorWidthMm / (2 * 35))).toBeCloseTo(horizontalFov(sensorId, 35, aspect), 10)
      }
    }
  })

  it('compiles edited staging, actor marks, camera marks, and MP4 outputs', () => {
    const { scene, shot } = editableDemo()
    const actor = scene.entities.find((entity) => entity.assetId === 'person.woman')!
    actor.transform.position.x = -2.25
    shot.fps = 24
    shot.aspect = '9:16'
    const plan = compileBlenderPlan({ projectName: 'Open-core white model', scene, shot })

    expect(plan.spec).toBe('ailin-blender-plan')
    expect(plan.shot.frameEnd).toBe(144)
    expect(plan.shot.resolution).toEqual({ width: 540, height: 960 })
    expect(plan.entities.find((entity) => entity.id === actor.id)?.transform.position).toEqual([-2.25, -1.5, 0])
    expect(plan.entities.find((entity) => entity.id === actor.id)?.marks).toHaveLength(3)
    expect(plan.camera.marks).toHaveLength(2)
    expect(plan.outputs.video).toMatch(/-blender-blockout\.mp4$/u)
    expect(plan.outputs.blend).toMatch(/-blender-blockout\.blend$/u)
  })

  it('warns when a simplified Blender actor has an unsupported grounded pose', () => {
    const { scene, shot } = editableDemo()
    scene.blocking[0]!.tracks[0]!.marks[0]!.joints = { grounded: 1, rootPitch: -1.2 }
    expect(compileBlenderPlan({ projectName: 'Ground QA', scene, shot }).warnings.join(' ')).toContain('完整地面姿态')
  })

  it('preserves unknown objects as labelled placeholders', () => {
    const { scene, shot } = editableDemo()
    const unknown = createEntity('custom.unknown-machine', 'Unknown machine', { x: 2, y: 0.4, z: -2 })
    scene.entities.push(unknown)
    const plan = compileBlenderPlan({ projectName: 'Placeholder QA', scene, shot })
    expect(plan.entities.find((entity) => entity.id === unknown.id)?.geometry).toBe('placeholder')
    expect(plan.entities.find((entity) => entity.id === unknown.id)?.transform.position).toEqual([2, 2, 0.4])
    expect(plan.warnings.join(' ')).toContain('Unknown machine')
  })
})
