import { describe, expect, it } from 'vitest'
import { createDemoProject, parseProject, serializeProject } from '../../src/engine/schema'

describe('ready-to-edit demo project', () => {
  it('contains visible blocking, three cameras, and portable project data', () => {
    const doc = createDemoProject()
    const scene = doc.scenes[0]!

    expect(scene.name).toBe('通用咖啡馆会面')
    expect(scene.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(['林夏', '陈舟', '文件包']))
    expect(scene.entities.length).toBeGreaterThanOrEqual(5)
    expect(scene.blocking[0]!.tracks).toHaveLength(2)
    expect(scene.blocking[0]!.tracks.every((track) => track.marks.length >= 2)).toBe(true)
    expect(scene.shots).toHaveLength(3)
    expect(scene.shots.every((shot) => shot.camera.marks.length === 2)).toBe(true)
    expect(scene.shots.every((shot) => shot.continuity?.overlapFramesToNext === 8)).toBe(true)

    const parsed = parseProject(serializeProject(doc))
    expect(parsed.issues).toEqual([])
    expect(parsed.doc?.scenes[0]?.shots).toHaveLength(3)
  })
})
