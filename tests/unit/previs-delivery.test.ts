import { describe, expect, it } from 'vitest'
import { createProject, parseProject, serializeProject } from '@engine/schema'

type DeliveryModule = {
  registerPrevisExport?: (...args: any[]) => any
  approvePrevisExport?: (...args: any[]) => void
  approvedPrevisExport?: (...args: any[]) => any
  selectedWhiteModelEngine?: (...args: any[]) => 'threejs' | 'blender'
  previsExportEngine?: (...args: any[]) => 'threejs' | 'blender'
  deliveryReferenceVideoPath?: (...args: any[]) => string
}

async function loadDelivery(): Promise<DeliveryModule> {
  return import('@engine/previs-delivery').catch(() => ({} as DeliveryModule))
}

describe('approved previs delivery records', () => {
  it('defaults old shots and exports to Three.js while preserving an explicit Blender choice', async () => {
    const delivery = await loadDelivery()
    expect(typeof delivery.selectedWhiteModelEngine).toBe('function')
    expect(typeof delivery.previsExportEngine).toBe('function')

    const shot = createProject('White model engines').scenes[0]!.shots[0]! as any
    expect(delivery.selectedWhiteModelEngine!(shot)).toBe('threejs')
    expect(delivery.previsExportEngine!({ id: 'legacy' })).toBe('threejs')

    shot.whiteModelEngine = 'blender'
    expect(delivery.selectedWhiteModelEngine!(shot)).toBe('blender')
    expect(delivery.previsExportEngine!({ id: 'advanced', engine: 'blender' })).toBe('blender')
  })

  it('routes local delivery through the approved white-model video and falls back when none is approved', async () => {
    const delivery = await loadDelivery()
    expect(typeof delivery.deliveryReferenceVideoPath).toBe('function')
    const shot = createProject('Local white-model routing').scenes[0]!.shots[0]! as any
    expect(delivery.deliveryReferenceVideoPath!(shot, 'D:/project', 'D:/fresh/reference.mp4')).toBe('D:/fresh/reference.mp4')
    shot.previsExports = [{
      id: 'blender-approved', relativePath: 'generated/blender/job/shot.mp4', packageRelativePath: 'generated/blender/job',
      createdAt: '2026-09-01T11:00:00.000Z', duration: 5, fps: 24, width: 540, height: 960,
      aspect: '9:16', engine: 'blender', status: 'approved', approvedAt: '2026-09-01T11:01:00.000Z'
    }]
    shot.approvedPrevisId = 'blender-approved'
    expect(delivery.deliveryReferenceVideoPath!(shot, 'D:/project', 'D:/fresh/reference.mp4'))
      .toBe('D:/project/generated/blender/job/shot.mp4')
  })

  it('registers an exported reference video as a draft, then approves it explicitly', async () => {
    const delivery = await loadDelivery()
    expect(typeof delivery.registerPrevisExport).toBe('function')
    expect(typeof delivery.approvePrevisExport).toBe('function')
    expect(typeof delivery.approvedPrevisExport).toBe('function')

    const doc = createProject('Previs approval')
    const shot = doc.scenes[0]!.shots[0]!
    const record = delivery.registerPrevisExport!(shot, {
      id: 'previs-001',
      relativePath: 'exports/Scene-1/Shot-1A/export-1/1A_reference.mp4',
      packageRelativePath: 'exports/Scene-1/Shot-1A/export-1',
      createdAt: '2026-08-27T10:00:00.000Z',
      duration: 5,
      fps: 24,
      width: 768,
      height: 1344,
      aspect: '9:16'
    })

    expect(record.status).toBe('draft')
    expect(shot.approvedPrevisId).toBeUndefined()
    expect(delivery.approvedPrevisExport!(shot)).toBeUndefined()

    delivery.approvePrevisExport!(shot, record.id, '2026-08-27T10:01:00.000Z')

    expect(shot.approvedPrevisId).toBe('previs-001')
    expect(delivery.approvedPrevisExport!(shot)).toMatchObject({
      id: 'previs-001',
      status: 'approved',
      approvedAt: '2026-08-27T10:01:00.000Z'
    })
  })

  it('switches the current approved version without deleting history', async () => {
    const delivery = await loadDelivery()
    expect(typeof delivery.registerPrevisExport).toBe('function')
    expect(typeof delivery.approvePrevisExport).toBe('function')

    const shot = createProject('Versions').scenes[0]!.shots[0]!
    for (const id of ['previs-001', 'previs-002']) {
      delivery.registerPrevisExport!(shot, {
        id,
        relativePath: `exports/${id}.mp4`,
        packageRelativePath: `exports/${id}`,
        createdAt: '2026-08-27T10:00:00.000Z',
        duration: 5,
        fps: 24,
        width: 768,
        height: 1344,
        aspect: '9:16'
      })
    }

    delivery.approvePrevisExport!(shot, 'previs-001', '2026-08-27T10:01:00.000Z')
    delivery.approvePrevisExport!(shot, 'previs-002', '2026-08-27T10:02:00.000Z')

    expect(shot.previsExports).toHaveLength(2)
    expect(shot.approvedPrevisId).toBe('previs-002')
    expect(shot.previsExports?.find((item: any) => item.id === 'previs-001')?.status).toBe('approved')
  })

  it('round-trips portable records and rejects an absolute previs path', () => {
    const doc = createProject('Portable previs') as any
    const shot = doc.scenes[0].shots[0]
    shot.previsExports = [{
      id: 'previs-001',
      relativePath: 'exports/Scene-1/Shot-1A/export-1/1A_reference.mp4',
      packageRelativePath: 'exports/Scene-1/Shot-1A/export-1',
      createdAt: '2026-08-27T10:00:00.000Z',
      duration: 5,
      fps: 24,
      width: 768,
      height: 1344,
      aspect: '9:16',
      engine: 'blender',
      status: 'approved',
      approvedAt: '2026-08-27T10:01:00.000Z'
    }]
    shot.approvedPrevisId = 'previs-001'
    shot.whiteModelEngine = 'blender'

    const roundTrip = parseProject(serializeProject(doc))
    expect(roundTrip.issues).toEqual([])
    expect((roundTrip.doc as any)?.scenes[0].shots[0].previsExports[0].relativePath)
      .toBe('exports/Scene-1/Shot-1A/export-1/1A_reference.mp4')
    expect((roundTrip.doc as any)?.scenes[0].shots[0].previsExports[0].engine).toBe('blender')
    expect((roundTrip.doc as any)?.scenes[0].shots[0].whiteModelEngine).toBe('blender')

    const invalid = JSON.parse(serializeProject(doc))
    invalid.scenes[0].shots[0].previsExports[0].relativePath = 'C:/outside/reference.mp4'
    const rejected = parseProject(JSON.stringify(invalid))
    expect(rejected.doc).toBeNull()
    expect(rejected.issues.some((issue) => issue.path.includes('previsExports[0].relativePath'))).toBe(true)
  })

  it('rejects unknown white-model engines on shots and export records', () => {
    const doc = createProject('Invalid white model engine') as any
    const shot = doc.scenes[0].shots[0]
    shot.whiteModelEngine = 'magic'
    let rejected = parseProject(serializeProject(doc))
    expect(rejected.doc).toBeNull()
    expect(rejected.issues.some((issue) => issue.path.endsWith('.whiteModelEngine'))).toBe(true)

    delete shot.whiteModelEngine
    shot.previsExports = [{
      id: 'previs-invalid-engine', relativePath: 'exports/reference.mp4', packageRelativePath: 'exports',
      createdAt: '2026-09-01T10:00:00.000Z', duration: 5, fps: 24,
      width: 768, height: 1344, aspect: '9:16', status: 'draft', engine: 'magic'
    }]
    rejected = parseProject(serializeProject(doc))
    expect(rejected.doc).toBeNull()
    expect(rejected.issues.some((issue) => issue.path.endsWith('.engine'))).toBe(true)
  })

  it('rejects an approved previs pointer that does not name an approved record', () => {
    const doc = createProject('Broken approval') as any
    const shot = doc.scenes[0].shots[0]
    shot.previsExports = [{
      id: 'previs-draft', relativePath: 'exports/draft.mp4', packageRelativePath: 'exports',
      createdAt: '2026-08-27T10:00:00.000Z', duration: 5, fps: 24,
      width: 768, height: 1344, aspect: '9:16', status: 'draft'
    }]
    shot.approvedPrevisId = 'previs-missing'

    const rejected = parseProject(serializeProject(doc))
    expect(rejected.doc).toBeNull()
    expect(rejected.issues.some((issue) => issue.path.includes('approvedPrevisId'))).toBe(true)
  })

  it('rejects incomplete, non-positive, and duplicate previs export records', () => {
    const source = createProject('Invalid records') as any
    const shot = source.scenes[0].shots[0]
    const valid = {
      id: 'previs-valid', relativePath: 'exports/reference.mp4', packageRelativePath: 'exports',
      createdAt: '2026-08-27T10:00:00.000Z', duration: 5, fps: 24,
      width: 768, height: 1344, aspect: '9:16', status: 'draft'
    }

    shot.previsExports = [{ ...valid }]
    delete shot.previsExports[0].duration
    let rejected = parseProject(serializeProject(source))
    expect(rejected.doc).toBeNull()
    expect(rejected.issues.some((issue) => issue.path.endsWith('.duration'))).toBe(true)

    shot.previsExports = [{ ...valid, fps: 0 }]
    rejected = parseProject(serializeProject(source))
    expect(rejected.doc).toBeNull()
    expect(rejected.issues.some((issue) => issue.path.endsWith('.fps'))).toBe(true)

    shot.previsExports = [{ ...valid }, { ...valid }]
    rejected = parseProject(serializeProject(source))
    expect(rejected.doc).toBeNull()
    expect(rejected.issues.some((issue) => issue.path.includes('previsExports[1].id'))).toBe(true)
  })
})
