import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createProject, createEntity, createActorMark, createCameraMark } from '@engine/schema'
import { MOTION_PRESETS } from '@engine/motions'
import { ShotEvaluator } from '@engine/evaluate'
import { compileEditableBlenderPlan } from '../../src/renderer/export/blender-plan'
import { buildAsset } from '../../src/renderer/viewport/builders'

const ids = ['lie-down-sleep', 'fall-backwards', 'knocked-down', 'stumble-back-fall',
  'crawl', 'crawl-fast-military', 'push-ups', 'sit-ups', 'roll-dodge', 'dive-roll',
  'dive-dodge', 'stumble-trip', 'breakdance-freeze']
function fixture(id = 'crawl') {
  const doc = createProject('Blender motion QA'), scene = doc.scenes[0]!, shot = scene.shots[0]!
  const entity = createEntity('person.woman', 'Motion QA', { x: 1, y: 0.4, z: -1 })
  entity.transform.scale = 1.2
  entity.params = { height: 1.1, build: 0.9, joint_headY: 0.2 }
  scene.entities = [entity]
  const p = MOTION_PRESETS.find(p => p.id === id)!
  shot.duration = p.duration
  shot.fps = 8
  scene.blocking.find(t => t.id === shot.blockingTakeId)!.tracks = [{ entityId: entity.id, marks: p.keyframes.map(k => {
    const mark = createActorMark({ x: 1, y: 0.4, z: -1 - (k.move?.forward ?? 0) }, k.t, 'stand')
    mark.joints = { ...k.joints }
    return mark
  }) }]
  return { projectName: doc.name, scene, shot, entity }
}

describe('Blender exact ground-motion handoff', () => {
  it.each(ids)('%s transfers the actual viewport vertices at every output frame', id => {
    const input = fixture(id), before = JSON.stringify(input)
    const plan = compileEditableBlenderPlan(input), meshes = plan.entities[0]!.motionMeshes
    expect(meshes?.length).toBeGreaterThan(10)
    expect(plan.warnings.join(' ')).not.toContain('不能还原')
    expect(JSON.stringify(input)).toBe(before)
    const built = buildAsset(input.entity.assetId, input.entity.params), originals: THREE.Mesh[] = []
    built.group.traverse(o => { if (o instanceof THREE.Mesh) originals.push(o) })
    built.group.scale.setScalar(input.entity.transform.scale)
    const evaluator = new ShotEvaluator(input.scene, input.shot)
    for (let f = 0; f < plan.shot.frameEnd; f++) {
      const t = f / input.shot.fps, state = evaluator.evaluate(t).entities[0]!
      built.group.position.set(state.position.x, state.position.y, state.position.z)
      built.group.rotation.y = state.heading
      built.animate!({ gait: state.gait, phase: 0, speed: state.speed, distance: state.distanceTravelled,
        time: t, overrides: { ...state.joints, headY: (state.joints?.headY ?? 0) + 0.2 } })
      built.group.updateMatrixWorld(true)
      for (let m = 0; m < originals.length; m++) {
        const mesh = meshes![m]!, source = originals[m]!, transform = new THREE.Matrix4().fromArray(mesh.matrices[f]!)
        expect(mesh.matrices).toHaveLength(plan.shot.frameEnd)
        const position = source.geometry.getAttribute('position')
        for (let v = 0; v < position.count; v++) {
          const expected = new THREE.Vector3().fromBufferAttribute(position, v).applyMatrix4(source.matrixWorld)
          const actual = new THREE.Vector3().fromArray(mesh.vertices, v * 3).applyMatrix4(transform)
          expect(actual.distanceTo(new THREE.Vector3(expected.x, -expected.z, expected.y))).toBeLessThan(1e-7)
        }
      }
    }
  })
  it('leaves legacy non-ground actors on the existing Blender path', () => {
    const input = fixture(); input.scene.blocking[0]!.tracks[0]!.marks.forEach(m => { delete m.joints })
    expect(compileEditableBlenderPlan(input).entities[0]!.motionMeshes).toBeUndefined()
  })
  it('serializes deterministically without Three.js objects or viewport labels', () => {
    const input = fixture()
    const plan = compileEditableBlenderPlan(input)
    expect(JSON.stringify(plan)).toBe(JSON.stringify(compileEditableBlenderPlan(input)))
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
    expect(plan.entities[0]!.motionMeshes?.length).toBe(14)
  })
  it('bakes tracked camera roll and lens at the same output times', () => {
    const input = fixture(), camera = input.shot.camera
    camera.marks = [createCameraMark({ x: 3, y: 2, z: 6 }, 0, 0.4, -0.2, 35)]
    camera.marks[0]!.roll = 0.35
    camera.trackEntityId = input.entity.id
    const plan = compileEditableBlenderPlan(input), evaluator = new ShotEvaluator(input.scene, input.shot)
    expect(plan.camera.marks).toHaveLength(plan.shot.frameEnd)
    for (const mark of plan.camera.marks) {
      const c = evaluator.evaluate((mark.frame - 1) / plan.shot.fps).camera
      const obj = new THREE.Object3D()
      obj.position.set(c.position.x, c.position.y, c.position.z)
      obj.rotation.set(c.tilt, c.pan, c.roll, 'YXZ'); obj.updateMatrix()
      expect(mark.worldMatrix).toEqual(new THREE.Matrix4().makeRotationX(Math.PI / 2).multiply(obj.matrix).toArray())
      expect(mark.focalLengthMm).toBe(c.focalLength)
    }
  })
  it('honors static ground overrides and does not include excluded actors', () => {
    const input = fixture()
    input.scene.blocking[0]!.tracks = []
    input.entity.params = { joint_rootPitch: -1.48, joint_grounded: 1 }
    expect(compileEditableBlenderPlan(input).entities[0]!.motionMeshes).toHaveLength(14)
    input.entity.excludeFromExport = true
    expect(compileEditableBlenderPlan(input).entities).toHaveLength(0)
  })
  it('refuses oversized motion bakes explicitly rather than silently dropping motion', () => {
    const input = fixture()
    input.shot.duration = 3600
    expect(() => compileEditableBlenderPlan(input)).toThrow('数据过多')
  })
})
