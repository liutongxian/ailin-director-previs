import { describe, expect, it } from 'vitest'
import {
  assetLabel,
  cameraMoveLabel,
  actionPresetLabel,
  motionPresetLabel,
  presetCategoryLabel,
  rigDescription,
  rigLabel
} from '../../src/renderer/localized-labels'

describe('localized filmmaking labels', () => {
  it('localizes built-in assets while preserving English mode', () => {
    expect(assetLabel('zh-CN', 'person.man', 'Man')).toBe('男性')
    expect(assetLabel('zh-CN', 'env.warehouse', 'Warehouse')).toBe('仓库')
    expect(assetLabel('en-US', 'env.warehouse', 'Warehouse')).toBe('Warehouse')
  })

  it('localizes director presets by stable id', () => {
    expect(cameraMoveLabel('zh-CN', 'slow-push-in', 'Slow Push-In')).toBe('缓慢推近')
    expect(actionPresetLabel('zh-CN', 'plane-takeoff', 'Plane Takeoff')).toBe('飞机起飞')
    expect(motionPresetLabel('zh-CN', 'jab-cross', 'Jab / Cross')).toBe('刺拳／直拳组合')
    expect(presetCategoryLabel('zh-CN', 'orbit & arc')).toBe('环绕／弧线')
  })

  it('localizes rig names and explanations', () => {
    expect(rigLabel('zh-CN', 'handheld', 'Handheld')).toBe('手持摄影')
    expect(rigDescription('zh-CN', 'handheld', 'fallback')).toContain('手持')
  })
})
