import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PREVIS_IR_TEMPLATE,
  blockingIssuesFromPrevisIR,
  parsePrevisIR,
  validatePrevisIR,
  previsIRToStoryboardCards,
  revisePrevisIRShotText
} from '@engine/previs-ir'

const example = () => {
  const parsed = parsePrevisIR(readFileSync(resolve('previs-ir/previs-ir-1.0.example.json'), 'utf8'))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.ir
}

describe('Previs IR 1.0', () => {
  it('ships a valid model-agnostic template and example', () => {
    expect(parsePrevisIR(PREVIS_IR_TEMPLATE).ok).toBe(true)
    expect(blockingIssuesFromPrevisIR(example())).toEqual([])
  })

  it('reports broken asset references', () => {
    const ir = example()
    ir.shots[0]!.entities.push({ refId: 'missing-asset' })
    const result = validatePrevisIR(ir)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('missing-asset')
  })

  it('converts generic placements, movement, and camera instructions into a shot', () => {
    const cards = previsIRToStoryboardCards(example())
    expect(cards).toHaveLength(1)
    const plan = cards[0]!.plan
    expect(plan.entities.find((item) => item.name === '老槐树')?.assetId).toBe('prop.tree')
    expect(plan.entities.find((item) => item.name === '林夏')?.marks).toHaveLength(2)
    expect(plan.camera.marks).toHaveLength(2)
  })

  it('keeps unresolved technical details advisory', () => {
    const ir = example()
    ir.unresolved = [{ field: 'shots[0].camera.endPosition', reason: '缺少摄影机终点坐标。' }]
    expect(validatePrevisIR(ir).warnings).toContain('shots[0].camera.endPosition：缺少摄影机终点坐标。')
    expect(blockingIssuesFromPrevisIR(ir)).toEqual([])
  })

  it('revises text and camera direction without a model call', () => {
    const revision = revisePrevisIRShotText(
      example(), 'shot-001', '林夏从画左走到画右。全景，摄影机后拉3米，8秒，9:16，日光。'
    )
    expect(revision.ir.shots[0]?.duration).toBe(8)
    expect(revision.ir.shots[0]?.camera?.movement).toBe('dolly_out')
    expect(revision.changedFields).toContain('camera.distanceMeters')
  })
})
