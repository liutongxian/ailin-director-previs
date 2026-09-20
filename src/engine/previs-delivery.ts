import type { PrevisExportRecord, Shot } from './types'

export type WhiteModelEngine = 'threejs' | 'blender'

export function selectedWhiteModelEngine(shot: Shot): WhiteModelEngine {
  return shot.whiteModelEngine === 'blender' ? 'blender' : 'threejs'
}

export function previsExportEngine(record: Pick<PrevisExportRecord, 'engine'>): WhiteModelEngine {
  return record.engine === 'blender' ? 'blender' : 'threejs'
}

export type RegisterPrevisExportInput = Omit<PrevisExportRecord, 'status' | 'approvedAt'>

export function registerPrevisExport(
  shot: Shot,
  input: RegisterPrevisExportInput
): PrevisExportRecord {
  const record: PrevisExportRecord = { ...input, status: 'draft' }
  shot.previsExports = [...(shot.previsExports ?? []).filter((item) => item.id !== record.id), record]
  return record
}

export function approvePrevisExport(shot: Shot, recordId: string, approvedAt: string): void {
  const record = shot.previsExports?.find((item) => item.id === recordId)
  if (!record) throw new Error(`Previs export not found: ${recordId}`)
  record.status = 'approved'
  record.approvedAt = approvedAt
  shot.approvedPrevisId = recordId
}

export function approvedPrevisExport(shot: Shot): PrevisExportRecord | undefined {
  if (!shot.approvedPrevisId) return undefined
  return shot.previsExports?.find((item) => item.id === shot.approvedPrevisId && item.status === 'approved')
}

/** Resolve the user-approved white-model video for local delivery; legacy shots keep the fresh Three.js export. */
export function deliveryReferenceVideoPath(shot: Shot, projectFolder: string, fallback: string): string {
  const approved = approvedPrevisExport(shot)
  if (!approved) return fallback
  const root = projectFolder.replace(/\\/gu, '/').replace(/\/+$/u, '')
  return `${root}/${approved.relativePath.replace(/\\/gu, '/').replace(/^\/+/, '')}`
}
