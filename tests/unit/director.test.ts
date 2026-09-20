import { describe, expect, it } from 'vitest'
import { analyzeStoryboard, applyStoryboardPlan, buildStoryboardScenes, splitStoryboardDocument } from '@engine/director'
import { createEntity, createProject } from '@engine/schema'

describe('director storyboard staging', () => {
  it('turns a short storyboard into editable stage and camera plans', () => {
    const plan = analyzeStoryboard('咖啡馆日景。林夏从门口走到桌边。摄影机缓慢推近，6秒，中景。')
    expect(plan.environmentAssetId).toBe('env.coffeeShop')
    expect(plan.duration).toBe(6)
    expect(plan.entities.some((item) => item.name === '林夏')).toBe(true)
    expect(plan.camera.marks).toHaveLength(2)
  })

  it('preserves manually staged objects when applying a storyboard plan', () => {
    const doc = createProject('示例项目')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const manual = createEntity('prop.lantern', '手动放置的灯笼', { x: 4, y: 0, z: 1 })
    scene.entities.push(manual)
    const plan = analyzeStoryboard('庭院。林夏站在树旁。近景，5秒。')
    const result = applyStoryboardPlan(scene, shot, plan, { replacePreviousAutoStage: true })
    expect(scene.entities.some((item) => item.id === manual.id)).toBe(true)
    expect(result.addedEntities).toBeGreaterThan(0)
    expect(shot.camera.marks.length).toBeGreaterThan(0)
  })

  it('splits numbered shots into independent playable scenes', () => {
    const parsed = splitStoryboardDocument(`
第1镜 咖啡馆，日。林夏从门口走到桌边。全景，6秒。
第2镜 咖啡馆，日。门卫坐在桌旁。近景固定机位，5秒。
`)
    const scenes = buildStoryboardScenes(parsed.shots)
    expect(scenes).toHaveLength(2)
    expect(scenes[0]?.shots[0]?.storyboard?.content).toContain('林夏')
    expect(scenes.every((scene) => scene.shots[0]!.camera.marks.length > 0)).toBe(true)
  })
})
