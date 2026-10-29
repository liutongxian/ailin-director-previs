import type { ProjectDoc } from './types'
import { buildStoryboardScenes } from './director'
import { parsePrevisIR, previsIRToStoryboardCards } from './previs-ir'
import { syncProductionAssetPlan } from './production-asset-plan'

/** Add editable cards without replacing existing shots, cameras, assets or generated versions. */
export function applyProductionBreakdown(doc: ProjectDoc, text: string): string {
  const parsed = parsePrevisIR(text)
  if (!parsed.ok) throw new Error(parsed.error)
  const cards = previsIRToStoryboardCards(parsed.ir)
  const oldIR = doc.previsIR ? parsePrevisIR(doc.previsIR.text) : null
  const oldCards = oldIR?.ok ? previsIRToStoryboardCards(oldIR.ir) : []
  const initialScene = doc.scenes.length === 1 ? doc.scenes[0] : undefined
  const all = doc.scenes.flatMap((item) => item.shots)
  let firstId = ''
  for (const card of cards) {
    let shot = all.find((item) => item.storyboard?.sourceShotId === card.sourceShotId)
    if (!shot) {
      const scene = buildStoryboardScenes([card], 'model-ir')[0]!
      scene.number = doc.scenes.length + 1
      doc.scenes.push(scene)
      shot = scene.shots[0]!
    }
    if (!firstId) firstId = shot.id
    const prior = oldCards.find((item) => item.sourceShotId === card.sourceShotId)
    // Preserve local text edits; the latest source is still available in the stored breakdown.
    if (!shot.storyboard?.content || !prior || shot.storyboard.content === prior.content) {
      shot.name = card.name
      shot.notes = card.content
      shot.duration = card.plan.duration
      shot.aspect = card.plan.aspect
      shot.storyboard = { ...shot.storyboard, sourceShotId: card.sourceShotId, sourceName: doc.sourceScript?.name, content: card.content }
    }
  }
  // Remove only the untouched empty starter card, never a user-authored or staged shot.
  const starter = initialScene && all.length === 1 && all[0]?.name === `${initialScene.number}A` && !initialScene.entities.length && !initialScene.drafts?.length ? all[0] : undefined
  if (starter && !starter.storyboard && !starter.notes && !starter.generationInput && !starter.productionAttempts?.length && !starter.previsExports?.length) doc.scenes = doc.scenes.filter((scene) => scene !== initialScene)
  doc.previsIR = { name: '智能拆镜', text, engine: 'model-ir' }
  delete doc.directorPackage
  syncProductionAssetPlan(doc)
  return firstId
}
