import { describe, expect, it } from 'vitest'
import { buildRoutine, choreoStyles, type ChoreoKind } from '@engine/choreography'

describe('QA F-14 routine duration contract', () => {
  for (const kind of ['dance', 'fight', 'chase'] as ChoreoKind[]) {
    for (const style of choreoStyles(kind)) {
      it(`${kind}/${style.id} keeps every generated mark and hold inside the requested duration`, () => {
        const routine = buildRoutine({ kind, style: style.id, performers: kind === 'dance' ? 4 : 2, durationS: 8, bpm: 116, seed: 12345 }, { origin: { x: 0, z: 0, heading: 0 } })
        for (const actor of routine) {
          expect(actor.marks.length).toBeGreaterThan(1)
          for (const mark of actor.marks) {
            expect(mark.time).toBeGreaterThanOrEqual(0)
            expect(mark.time + mark.hold).toBeLessThanOrEqual(8 + 1e-8)
          }
        }
      })
    }
  }
})
