import type { AilinDirectorPackage, DirectorPackageAssetBinding } from './director-package'
import type { ReferenceAsset, ReferenceAssetSlot, ReferenceAssetState, ReferenceAssetVersion } from './types'
import type { ImportedDirectorPackAsset, ImportedDirectorPackSlot } from '../shared/director-pack'

function assetName(pkg: AilinDirectorPackage, binding: DirectorPackageAssetBinding): string {
  if (binding.kind === 'scene') {
    return pkg.previsIR.locations?.find((location) => location.id === binding.targetRefId)?.name ?? binding.assetId
  }
  return pkg.previsIR.assets.find((asset) => asset.id === binding.targetRefId)?.name ?? binding.assetId
}

function cloneVersion(version: ReferenceAssetVersion): ReferenceAssetVersion {
  return { ...version }
}

function importedVersion(slot: ImportedDirectorPackSlot): ReferenceAssetVersion {
  return { ...slot.version }
}

function mergeSlot(
  previous: ReferenceAssetSlot | undefined,
  binding: DirectorPackageAssetBinding['slots'][number],
  imported: ImportedDirectorPackSlot | undefined,
  protectCurrent: boolean
): ReferenceAssetSlot {
  const versions = previous?.versions.map(cloneVersion) ?? []
  let currentVersionId = previous?.currentVersionId
  if (imported) {
    const duplicate = versions.find((version) => version.sha256 === imported.version.sha256)
    // Verified metadata can fill older same-content records without replacing
    // their path, identity, approval, or the user's selected version.
    if (duplicate) {
      if (!duplicate.width && imported.version.width) duplicate.width = imported.version.width
      if (!duplicate.height && imported.version.height) duplicate.height = imported.version.height
    }
    const version = duplicate ?? importedVersion(imported)
    if (!duplicate) versions.push(version)
    if (!protectCurrent) currentVersionId = version.id
  }
  return {
    id: binding.slotId,
    label: binding.label,
    type: binding.type,
    view: binding.view,
    required: binding.required,
    ...(binding.description ? { description: binding.description } : {}),
    ...(binding.cameraId ? { cameraId: binding.cameraId } : {}),
    ...(currentVersionId ? { currentVersionId } : {}),
    versions
  }
}

function completeness(states: readonly ReferenceAssetState[]): 'ready' | 'partial' {
  const required = states.flatMap((state) => state.slots.filter((slot) => slot.required))
  return required.length > 0 && required.every((slot) => Boolean(slot.currentVersionId)) ? 'ready' : 'partial'
}

export function mergeDirectorPackAssets(
  existing: readonly ReferenceAsset[],
  pkg: AilinDirectorPackage,
  imported: readonly ImportedDirectorPackAsset[]
): ReferenceAsset[] {
  const bindings = pkg.assetBindings ?? []
  const bindingIds = new Set(bindings.map((binding) => binding.assetId))
  const merged = bindings.map((binding): ReferenceAsset => {
    const previous = existing.find((asset) => asset.id === binding.assetId)
    const importedAsset = imported.find((asset) => asset.assetId === binding.assetId && asset.stateId === binding.stateId)
    const protectCurrent = previous?.status === 'approved' || previous?.status === 'locked'
    const previousState = previous?.states?.find((state) => state.id === binding.stateId)
    const slots = binding.slots.map((slot) => mergeSlot(
      previousState?.slots.find((candidate) => candidate.id === slot.slotId),
      slot,
      importedAsset?.slots.find((candidate) => candidate.slotId === slot.slotId),
      protectCurrent
    ))
    const bindingSlotIds = new Set(slots.map((slot) => slot.id))
    const state: ReferenceAssetState = {
      id: binding.stateId,
      name: binding.stateName,
      appliesTo: binding.appliesTo ?? pkg.stagePlans.map((stage) => stage.shotId),
      slots: [...slots, ...(previousState?.slots.filter((slot) => !bindingSlotIds.has(slot.id)).map((slot) => ({ ...slot, versions: slot.versions.map(cloneVersion) })) ?? [])]
    }
    const states = [
      state,
      ...(previous?.states?.filter((candidate) => candidate.id !== binding.stateId).map((candidate) => ({
        ...candidate,
        slots: candidate.slots.map((slot) => ({ ...slot, versions: slot.versions.map(cloneVersion) }))
      })) ?? [])
    ]
    const importedPaths = importedAsset?.slots.map((slot) => slot.version.path) ?? []
    if (importedAsset?.model) importedPaths.push(importedAsset.model.path)
    const files = [...new Set([...(previous?.files ?? []), ...importedPaths])]
    return {
      id: binding.assetId,
      kind: binding.kind,
      name: assetName(pkg, binding),
      files,
      status: protectCurrent ? previous!.status : completeness(states),
      ...(previous?.notes ? { notes: previous.notes } : {}),
      states
    }
  })
  return [...merged, ...existing.filter((asset) => !bindingIds.has(asset.id)).map((asset) => ({ ...asset }))]
}
