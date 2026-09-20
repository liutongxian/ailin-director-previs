// Modified for Director Desk exact motion handoff; see MODIFICATIONS.md.
import { compileBlenderPlan } from '@engine/blender-plan'
import * as THREE from 'three'
import { ShotEvaluator } from '@engine/evaluate'
import { GAITS } from '@engine/gaits'
import { buildAsset } from '../viewport/builders'

export function compileEditableBlenderPlan(input: Parameters<typeof compileBlenderPlan>[0]) {
  const plan = compileBlenderPlan(input)
  const selected = plan.entities.filter(e => e.geometry === 'actor' && (
    e.marks.some(m => m.joints?.grounded || m.joints?.rootPitch || m.joints?.rootRoll) ||
    ['grounded', 'rootPitch', 'rootRoll'].some(key => input.scene.entities.find(s => s.id === e.id)?.params?.[`joint_${key}`])
  ))
  if (!selected.length) return plan
  // Reuse the viewport's real skeleton and geometry; never maintain a second
  // set of joint signs/proportions in Python. Only affected actors are baked.
  const assets = selected.map(e => {
    const source = input.scene.entities.find(s => s.id === e.id)!
    const built = buildAsset(source.assetId, source.params), meshes: THREE.Mesh[] = []
    built.group.scale.setScalar(source.transform.scale)
    built.setTint(source.label?.color ?? null)
    built.group.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o) })
    return { entity: e, source, built, meshes }
  })
  try {
    if (assets.reduce((sum, a) => sum + a.meshes.length, 0) * plan.shot.frameEnd > 100_000) {
      throw new Error('当前 Blender 地面动作导出数据过多，请缩短镜头或减少同时执行地面动作的人物。')
    }
    const convert = new THREE.Matrix4().makeRotationX(Math.PI / 2), inverse = convert.clone().invert()
    const vertex = new THREE.Vector3(), matrix = new THREE.Matrix4(), camera = new THREE.Object3D()
    for (const a of assets) {
      a.entity.motionMeshes = a.meshes.map(mesh => {
        const positions = mesh.geometry.getAttribute('position'), vertices: number[] = []
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(convert)
          vertices.push(vertex.x, vertex.y, vertex.z)
        }
        const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshLambertMaterial
        return { vertices, triangles: mesh.geometry.index ? Array.from(mesh.geometry.index.array) : Array.from({ length: positions.count }, (_, i) => i),
          color: `#${material.color.getHexString()}`, matrices: [] }
      })
      plan.warnings = plan.warnings.filter(w => w !== `“${a.entity.name}”含完整地面姿态；当前 Blender 简化骨架不能还原此类动作，请使用交付页 Three.js 白模预演。`)
    }
    const evaluator = new ShotEvaluator(input.scene, input.shot)
    const take = input.scene.blocking.find(t => t.id === input.shot.blockingTakeId) ?? input.scene.blocking[0]
    plan.camera.marks = []
    for (let f = 0; f < plan.shot.frameEnd; f++) {
      const time = f / plan.shot.fps, state = evaluator.evaluate(time)
      for (const a of assets) {
        const es = state.entities.find(e => e.entityId === a.entity.id)!
        const tracked = !!take?.tracks.find(t => t.entityId === es.entityId)?.marks.length
        a.built.group.position.set(es.position.x, !tracked && !a.source.attachedTo ? a.source.transform.position.y : es.position.y, es.position.z)
        a.built.group.rotation.y = es.heading
        const gait = !tracked && typeof a.source.params?.pose === 'string' ? a.source.params.pose as typeof es.gait : es.gait
        const overrides: Record<string, number> = {}
        for (const [key, value] of Object.entries(a.source.params ?? {})) {
          if (key.startsWith('joint_') && typeof value === 'number') overrides[key.slice(6)] = value
        }
        for (const [key, value] of Object.entries(es.joints ?? {})) overrides[key] = (overrides[key] ?? 0) + value
        const stride = GAITS[gait].strideLength * Math.max(a.source.transform.scale, 0.2)
        a.built.animate?.({ gait, phase: stride > 0 ? (es.distanceTravelled / stride) % 1 : 0,
          speed: es.speed, distance: es.distanceTravelled, time, overrides })
        a.built.group.updateMatrixWorld(true)
        a.meshes.forEach((mesh, i) => {
          matrix.multiplyMatrices(convert, mesh.matrixWorld).multiply(inverse)
          a.entity.motionMeshes![i]!.matrices.push(matrix.toArray())
        })
      }
      const c = state.camera, horizontal = Math.cos(c.tilt) * 10
      camera.position.set(c.position.x, c.position.y, c.position.z)
      camera.rotation.set(c.tilt, c.pan, c.roll, 'YXZ')
      camera.updateMatrix()
      plan.camera.marks.push({ frame: f + 1, position: [c.position.x, -c.position.z, c.position.y],
        aimAt: [c.position.x - Math.sin(c.pan) * horizontal, -c.position.z + Math.cos(c.pan) * horizontal, c.position.y + Math.sin(c.tilt) * 10],
        focalLengthMm: c.focalLength, rollRadians: c.roll, worldMatrix: matrix.multiplyMatrices(convert, camera.matrix).toArray() })
    }
    return plan
  } finally {
    for (const a of assets) for (const mesh of a.meshes) {
      mesh.geometry.dispose()
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
    }
  }
}
