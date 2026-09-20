/**
 * Prompt generation, v5: a SHORT, paste-ready prompt. The reference video
 * carries all the choreography — the prompt's job is only to say "use this
 * strictly as a motion reference" (character blocking + camera move/tracking),
 * name the subjects and setting in one breath, and get out of the user's way
 * so they can add their own style and world on top. No mark-by-mark
 * choreography, no timing tables — that detail lives in the video itself
 * (and in metadata.json for tools that want it).
 */

import { assetSpec } from './assets'
import type { GeneratorProfile } from './profiles'
import type { LightingPresetId, ReferenceAsset, Scene, Shot } from './types'

const LIGHTING_WORDS: Record<LightingPresetId, string> = {
  day: 'soft daylight',
  goldenHour: 'warm golden-hour light',
  night: 'night, cool moonlit ambience',
  interiorWarm: 'warm interior lighting',
  interiorCool: 'cool interior lighting',
  club: 'dark nightclub with colored moving lights',
  middaySky: 'bright midday sky, clear blue atmosphere',
  goldenHourSky: 'golden-hour sky, low warm sun',
  blueHourSky: 'blue-hour twilight sky, deep dusk tones'
}

export function generatePrompt(scene: Scene, shot: Shot, profile: GeneratorProfile): string {
  const lines: string[] = []
  const marks = [...shot.camera.marks].sort((a, b) => a.time - b.time)
  const lens = Math.round(marks[0]?.focalLength ?? 35)

  // One short look line.
  lines.push(
    `Cinematic shot, ${lens}mm lens, ${shot.aspect}, ${LIGHTING_WORDS[scene.environment.lighting]}.`
  )

  // Subjects in one breath — names/labels only, no movement narration (the
  // reference video shows the movement).
  const take = scene.blocking.find((b) => b.id === shot.blockingTakeId) ?? scene.blocking[0]
  const notable = scene.entities.filter((e) => {
    const cat = assetSpec(e.assetId).category
    const moves = take?.tracks.some((tr) => tr.entityId === e.id && tr.marks.length > 0)
    return (
      moves || e.label || cat === 'people' || cat === 'vehicles' || cat === 'animals'
    )
  })
  if (notable.length > 0) {
    const names = notable.map((e) => {
      const noun = assetSpec(e.assetId).promptNoun
      return e.label ? `${noun} ("${e.label.text}")` : noun
    })
    lines.push(`Subjects: ${[...new Set(names)].join(', ')}.`)
  }

  const envEntities = scene.entities.filter((e) => assetSpec(e.assetId).category === 'environment')
  if (envEntities.length > 0) {
    const envWords = [...new Set(envEntities.map((e) => assetSpec(e.assetId).promptNoun))]
    lines.push(`Setting: ${envWords.join(', ')}.`)
  }

  // The core instruction. Video-reference generators get the simple
  // motion-reference directive; image-only profiles keep their own clause.
  if (profile.refModes.includes('referenceVideo')) {
    lines.push(
      'Use the attached video strictly as a motion reference: match the character blocking and movement, and the camera blocking, movement, and tracking, exactly as shown. The grey figures are placeholders — replace them with the real subjects and world while keeping every move the same.'
    )
  } else {
    lines.push(profile.adherenceClause)
  }

  return lines.join('\n\n')
}

/** H3 Ref2VA's official six-field prompt shape, using stable picture/video tags. */
export function generateH3Ref2VAPrompt(
  scene: Scene,
  shot: Shot,
  profile: GeneratorProfile,
  assets: ReferenceAsset[]
): string {
  let pictureIndex = 1
  const definitions: string[] = []
  for (const [subjectIndex, asset] of assets.entries()) {
    const tags = asset.files.map(() => `<Picture ${pictureIndex++}>`)
    definitions.push(
      `<Subject ${subjectIndex + 1}> is the approved ${asset.kind} asset “${asset.name}”, sourced from ${tags.join(', ')}; preserve its identity, design, materials, proportions, and costume exactly.`
    )
  }
  definitions.push('<Video 1> is the white-model previs motion reference; use it only for character blocking, action timing, camera path, framing, and screen direction.')

  const storyboard = shot.storyboard?.content?.trim() || shot.notes?.trim() || 'Follow the staged shot exactly.'
  const base = generatePrompt(scene, shot, profile).split('\n\n').slice(0, 3).join(' ')
  return [
    'subject_definitions:',
    ...definitions,
    '',
    `summary: Create one continuous live-action cinematic shot for “${shot.name}”. ${storyboard}`,
    '',
    `retention_analysis: Fully retain every approved <Subject N> identity and asset design. Transfer only blocking, action timing, camera movement, framing, and screen direction from <Video 1>. Do not retain the grey placeholder appearance. ${base}`,
    '',
    `detailed_description: [Shot 1] Live-action, cinematic realism. ${storyboard} Follow <Video 1> continuously and exactly for all visible movement and camera motion while replacing every grey placeholder with the corresponding approved <Subject N>. Keep every visible character breathing, looking, listening, and reacting naturally; preserve all prop contacts and spatial relationships through the end of the shot.`,
    '',
    'overall_soundscape: Natural synchronized dialogue and diegetic room sound described by the storyboard; no extra speakers, narration, subtitles, or unrelated sound effects.',
    '',
    'non_diegetic_music: N/A'
  ].join('\n')
}

/** H3 FL2VA official alignment-first prompt shape. Picture 1/2 are approved real anchors. */
export function generateH3FL2VAPrompt(scene: Scene, shot: Shot): string {
  const duration = Math.max(0, shot.duration).toFixed(2)
  const storyboard = shot.storyboard?.content?.trim() || shot.notes?.trim() || 'Follow the staged action continuously.'
  return [
    `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${duration}-second mark of the target video.`,
    '',
    `integrated_multimodal_description: [Shot 1] Live-action, cinematic realism. Begin exactly from Picture 1 in “${scene.name}”. ${storyboard} Preserve character identity, costume, location geometry, props, lighting direction, screen direction and physical contacts throughout one continuous shot. Follow the staged camera path and performance timing, then progressively converge on Picture 2 at the end of the shot. No cuts, no identity drift, no scene change, no unintended text, no subtitles, no logo.`,
    '',
    'overall_soundscape: Natural synchronized dialogue, room tone, movement, breathing and cloth sounds described by the storyboard; no extra speakers or narration.',
    '',
    'non_diegetic_music: N/A'
  ].join('\n')
}
