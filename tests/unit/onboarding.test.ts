import { afterEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_STORAGE_KEY, GUIDE_TRACKS, placeGuideBubble, readGuideProgress } from '../../src/renderer/onboarding'

afterEach(() => vi.unstubAllGlobals())

describe('guide recovery and placement', () => {
  it('recovers from corrupt, stale and hostile progress without blocking startup', () => {
    for (const value of ['{bad', 'null', '{"track":"__proto__","step":1}', '{"track":"toString"}']) {
      vi.stubGlobal('window', { localStorage: { getItem: () => value } })
      expect(readGuideProgress()).toMatchObject({ seen: false, track: 'sample', step: 0 })
    }
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => {
      expect(key).toBe(GUIDE_STORAGE_KEY)
      return '{"seen":true,"track":"manual","step":999,"viewed":["sample","__proto__"]}'
    } } })
    expect(readGuideProgress()).toEqual({ seen: true, track: 'manual', step: 0, viewed: ['sample'] })
  })

  it('still opens when browser storage is unavailable', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('storage disabled') } })
    expect(readGuideProgress().track).toBe('sample')
  })

  it('keeps a bubble inside a resized window and avoids covering a small target', () => {
    for (const target of [null, { left: 950, top: 720, width: 50, height: 35 }, { left: 10, top: 10, width: 90, height: 30 }]) {
      const p = placeGuideBubble(target, 340, 250, 1024, 768)
      expect(p.left).toBeGreaterThanOrEqual(12)
      expect(p.top).toBeGreaterThanOrEqual(12)
      expect(p.left + 340).toBeLessThanOrEqual(1012)
      expect(p.top + 250).toBeLessThanOrEqual(756)
      if (target) expect(p.left + 340 <= target.left || p.left >= target.left + target.width || p.top + 250 <= target.top || p.top >= target.top + target.height).toBe(true)
    }
  })

  it('all routes include video delivery, and manual work starts with project creation', () => {
    for (const track of Object.values(GUIDE_TRACKS)) expect(track.steps.some((step) => step.check === 'video-exported')).toBe(true)
    expect(GUIDE_TRACKS.package.steps.some((step) => step.check === 'package-imported')).toBe(true)
    expect(GUIDE_TRACKS.manual.steps.some((step) => step.check === 'project-created')).toBe(true)
  })
})
