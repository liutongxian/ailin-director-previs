import { describe, expect, it } from 'vitest'
import { Group, Mesh, MeshBasicMaterial, Scene } from 'three'
import { stableExportOpaqueSort } from '../../src/renderer/export/render-order'

function fixture(reverseAllocation: boolean) {
  const scene = new Scene(), parent = new Group()
  const first = new Mesh(), second = new Mesh()
  const materials = [new MeshBasicMaterial(), new MeshBasicMaterial()]
  first.material = materials[reverseAllocation ? 1 : 0]!
  second.material = materials[reverseAllocation ? 0 : 1]!
  scene.add(parent)
  parent.add(first, second)
  const items = [first, second].map(object => ({ object, material: object.material as MeshBasicMaterial, groupOrder: 0, renderOrder: 0, z: 1 }))
  return { scene, first, second, items }
}

describe('deterministic opaque export order', () => {
  it('uses saved traversal order for equal-depth surfaces, not material allocation IDs', () => {
    for (const reverse of [false, true]) {
      const { scene, first, second, items } = fixture(reverse)
      expect([...items].reverse().sort(stableExportOpaqueSort(scene)).map(i => i.object)).toEqual([first, second])
    }
  })
  it('keeps near objects ahead of farther ones regardless of material IDs', () => {
    const { scene, items } = fixture(false)
    items[0]!.z = 2
    expect([...items].sort(stableExportOpaqueSort(scene))).toEqual([items[1], items[0]])
  })
  it('preserves explicit renderOrder and groupOrder priority', () => {
    const { scene, items } = fixture(false)
    const compare = stableExportOpaqueSort(scene)
    items[0]!.renderOrder = 1
    expect([...items].sort(compare)).toEqual([items[1], items[0]])
    items[1]!.groupOrder = 1
    expect([...items].reverse().sort(compare)).toEqual(items)
  })
  it('does not mutate scene order, material IDs or authored render order', () => {
    const { scene, items } = fixture(true)
    const before = items.map(item => [item.material.id, item.object.renderOrder])
    const children = [...scene.children[0]!.children]
    const compare = stableExportOpaqueSort(scene)
    for (let n = 0; n < 10; n++) [...items].reverse().sort(compare)
    expect(scene.children[0]!.children).toEqual(children)
    expect(items.map(item => [item.material.id, item.object.renderOrder])).toEqual(before)
  })
})
