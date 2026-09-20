import type { ReferenceAssetKind } from '../engine/types'
import type { RequirementSlotType, RequirementSlotView } from '../engine/asset-requirement-ir'

export interface ImportedDirectorPackVersion {
  id: string
  path: string
  sha256: string
  sizeBytes: number
  sourceName: string
  createdAt?: string
  width?: number
  height?: number
}

export interface ImportedDirectorPackSlot {
  slotId: string
  label: string
  type: RequirementSlotType
  view: RequirementSlotView
  required: boolean
  description?: string
  cameraId?: string
  version: ImportedDirectorPackVersion
}

export interface ImportedDirectorPackAsset {
  targetRefId: string
  assetId: string
  kind: ReferenceAssetKind
  stateId: string
  stateName: string
  appliesTo: string[]
  slots: ImportedDirectorPackSlot[]
  model?: ImportedDirectorPackVersion
}

export interface ImportedDirectorPackResult {
  name: string
  text: string
  packageId: string
  assets: ImportedDirectorPackAsset[]
  imageCount: number
  modelCount: number
  blenderManifestPath: string
}
