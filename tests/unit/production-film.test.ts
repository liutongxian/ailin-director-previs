import { describe, it, expect } from 'vitest'
import { filmPlan } from '../../src/engine/production-film'
describe('production film', () => {
  it('normalizes different sizes and preserves audio when some clips are silent', () => {
    const plan = filmPlan([{ path: 'a.mp4', duration: 4, hasAudio: true, trimStart: 0.5, caption: '第一句' }, { path: 'b.mp4', duration: 2, hasAudio: false, caption: '第二句' }], '9:16', true)
    expect(plan.duration).toBe(5.5)
    expect(plan.filter).toContain('scale=720:1280')
    expect(plan.filter).toContain('[0:a]atrim=start=0.5')
    expect(plan.filter).toContain('anullsrc=r=48000:cl=stereo')
    expect(plan.filter).toContain('amix=inputs=2:duration=first')
    expect(plan.subtitles).toContain('00:00:03,500 --> 00:00:05,500\n第二句')
  })
  it('rejects over-trimming instead of producing an empty clip', () => {
    expect(() => filmPlan([{ path: 'a.mp4', duration: 4, hasAudio: false, trimStart: 3, trimEnd: 1 }], '16:9')).toThrow('不足')
  })
})
