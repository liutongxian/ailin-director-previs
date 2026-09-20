import type { Scene } from './types'

export interface ContinuitySegmentPlan {
  shotId: string
  shotName: string
  fps: number
  duration: number
  incomingOverlapFrames: number
  outgoingOverlapFrames: number
  incomingOverlapSeconds: number
  outgoingOverlapSeconds: number
  /** Remove this duplicated prefix after the generated clips are approved. */
  trimGeneratedHeadFrames: number
  previousTailPattern?: string
}

export interface ContinuityPlan {
  schema: 1
  strategy: 'repeat-then-trim'
  instructions: string[]
  segments: ContinuitySegmentPlan[]
}

function safeOverlap(frames: number | undefined, shotFrames: number): number {
  if (!Number.isFinite(frames)) return 0
  return Math.max(0, Math.min(Math.round(frames ?? 0), Math.max(0, shotFrames - 1)))
}

export function buildContinuityPlan(scene: Scene): ContinuityPlan {
  const segments = scene.shots.map((shot, index): ContinuitySegmentPlan => {
    const previous = scene.shots[index - 1]
    const shotFrames = Math.max(1, Math.round(shot.duration * shot.fps))
    const previousFrames = previous ? Math.max(1, Math.round(previous.duration * previous.fps)) : 1
    const incoming = previous
      ? safeOverlap(previous.continuity?.overlapFramesToNext ?? 8, previousFrames)
      : 0
    const outgoing = index < scene.shots.length - 1
      ? safeOverlap(shot.continuity?.overlapFramesToNext ?? 8, shotFrames)
      : 0
    return {
      shotId: shot.id,
      shotName: shot.name,
      fps: shot.fps,
      duration: shot.duration,
      incomingOverlapFrames: incoming,
      outgoingOverlapFrames: outgoing,
      incomingOverlapSeconds: previous ? incoming / previous.fps : 0,
      outgoingOverlapSeconds: outgoing / shot.fps,
      trimGeneratedHeadFrames: incoming,
      ...(previous
        ? { previousTailPattern: `../Shot-${previous.name}/continuity/tail-%04d.png` }
        : {})
    }
  })
  return {
    schema: 1,
    strategy: 'repeat-then-trim',
    instructions: [
      'Generate each next segment with the previous segment tail frames prepended as continuity context.',
      'Keep the repeated prefix in generated review clips so motion and identity can be compared.',
      'When assembling the approved long video, trim trimGeneratedHeadFrames from every segment after the first.'
    ],
    segments
  }
}
