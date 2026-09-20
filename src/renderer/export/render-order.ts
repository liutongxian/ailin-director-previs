// Modified for deterministic exports in 2026; see MODIFICATIONS.md.
import type { Object3D } from 'three'

interface OpaqueItem {
  groupOrder: number
  renderOrder: number
  z: number
  object: Object3D
}

/** Material IDs depend on allocation history, not saved project content. */
export function stableExportOpaqueSort(scene: Object3D): (a: OpaqueItem, b: OpaqueItem) => number {
  const order = new Map<Object3D, number>()
  scene.traverse(object => order.set(object, order.size))
  return (a, b) => a.groupOrder - b.groupOrder ||
    a.renderOrder - b.renderOrder || a.z - b.z ||
    (order.get(a.object) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.object) ?? Number.MAX_SAFE_INTEGER)
}
