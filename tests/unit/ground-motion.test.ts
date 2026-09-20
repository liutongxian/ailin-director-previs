import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MOTION_PRESETS } from '@engine/motions'
import { mirrorJoints } from '@engine/choreography'
import { buildAsset } from '../../src/renderer/viewport/builders'
import { createProject, createEntity, createActorMark } from '@engine/schema'
import { ShotEvaluator } from '@engine/evaluate'

// CPU-only procedural mesh checks: no renderer, DOM, screenshots or GPU.
const ids = ['lie-down-sleep', 'fall-backwards', 'knocked-down', 'stumble-back-fall',
  'crawl', 'crawl-fast-military', 'push-ups', 'sit-ups', 'roll-dodge', 'dive-roll',
  'dive-dodge', 'stumble-trip', 'breakdance-freeze']

describe('ground motion support and full-body orientation', () => {
  it('seated thighs and feet point forward (-Z), not through the chair back', () => {
    const built = buildAsset('person.man')
    built.animate!({ gait: 'sit', phase: 0, speed: 0, distance: 0, time: 0 })
    const bounds = new THREE.Box3().setFromObject(built.group, true)
    expect(bounds.min.z).toBeLessThan(-0.35)
    expect(bounds.max.z).toBeLessThan(0.25)
  })
  it.each(ids)('%s stays on its authored support plane through interpolation', (id) => {
    const preset = MOTION_PRESETS.find(p => p.id === id)!
    for (const assetId of ['person.man', 'person.woman', 'person.child']) {
      const built = buildAsset(assetId)
      for (let i = 0; i <= 30; i++) {
        const t = preset.duration * i / 30
        const next = preset.keyframes.findIndex(k => k.t >= t)
        const b = preset.keyframes[Math.max(0, next)]!
        const a = preset.keyframes[Math.max(0, next - 1)]!
        const alpha = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
        const overrides = Object.fromEntries([...new Set([...Object.keys(a.joints), ...Object.keys(b.joints)])]
          .map(key => [key, (a.joints[key] ?? 0) * (1 - alpha) + (b.joints[key] ?? 0) * alpha]))
        built.animate!({ gait: 'stand', phase: 0, speed: 0, distance: 0, time: t, overrides })
        const bounds = new THREE.Box3().setFromObject(built.group, true)
        expect(bounds.min.y, `${id}/${assetId} @${t} penetrates floor`).toBeGreaterThanOrEqual(-0.0001)
        expect(bounds.min.y, `${id}/${assetId} @${t} floats`).toBeLessThan(0.015)
      }
    }
  })

  it.each(['crawl', 'crawl-fast-military', 'push-ups', 'lie-down-sleep', 'fall-backwards'])('%s actually lies low rather than only bending at the waist', id => {
    const preset = MOTION_PRESETS.find(p => p.id === id)!
    const built = buildAsset('person.man')
    const k = preset.keyframes.at(-1)!
    built.animate!({ gait: 'stand', phase: 0, speed: 0, distance: 0, time: k.t, overrides: k.joints })
    const bounds = new THREE.Box3().setFromObject(built.group, true)
    expect(bounds.max.y).toBeLessThan(id === 'push-ups' ? 1 : 0.8)
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(1.2)
  })

  it('mirrors root roll but keeps pitch and support unchanged', () => {
    const pose = { rootPitch: -1.5, rootRoll: 0.7, grounded: 1 }
    expect(mirrorJoints(pose)).toEqual({ rootPitch: -1.5, rootRoll: -0.7, grounded: 1 })
  })

  it('a moving crawl does not acquire walking swings', () => {
    const doc = createProject('Crawl')
    const sc = doc.scenes[0]!, sh = sc.shots[0]!
    const e = createEntity('person.man', 'Crawler', { x: 0, y: 0, z: 0 })
    sc.entities.push(e)
    const marks = [createActorMark({ x: 0, y: 0, z: 0 }, 0, 'stand'), createActorMark({ x: 0, y: 0, z: -1 }, 2, 'stand')]
    for (const m of marks) m.joints = { grounded: 1, rootPitch: -1.48 }
    sc.blocking.find(t => t.id === sh.blockingTakeId)!.tracks.push({ entityId: e.id, marks })
    expect(new ShotEvaluator(sc, sh).evaluate(1).entities.find(s => s.entityId === e.id)!.gait).toBe('stand')
  })

  it('support follows raised and scaled model coordinates and stays deterministic', () => {
    const built = buildAsset('person.woman', { height: 1.1 })
    built.group.position.set(2, 1.2, -3)
    built.group.scale.setScalar(1.4)
    built.group.rotation.y = 1.1
    const input = { gait: 'stand' as const, phase: 0, speed: 0, distance: 0, time: 0.7, overrides: { grounded: 1, rootPitch: -1.48 } }
    built.animate!(input)
    const first = new THREE.Box3().setFromObject(built.group, true)
    expect(first.min.y).toBeGreaterThanOrEqual(1.2)
    expect(first.min.y).toBeLessThan(1.215)
    built.animate!({ ...input, time: 2, overrides: { grounded: 1, rootPitch: 1.4 } })
    built.animate!(input)
    expect(new THREE.Box3().setFromObject(built.group, true)).toEqual(first)
  })

  it('all corrected presets retain the complete editable channels at every keyframe', () => {
    for (const id of ids) {
      const p = MOTION_PRESETS.find(preset => preset.id === id)!
      for (const k of p.keyframes) {
        expect(k.joints.grounded).toBe(1)
        expect(k.move?.up ?? 0).toBe(0)
        expect(Object.keys(k.joints).sort()).toEqual(Object.keys(p.keyframes[0]!.joints).sort())
      }
    }
  })
})
