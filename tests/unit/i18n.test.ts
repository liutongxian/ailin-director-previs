import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, translate } from '../../src/renderer/i18n'

describe('renderer localization', () => {
  it('defaults to Simplified Chinese', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })

  it('translates core director workflow labels', () => {
    expect(translate('zh-CN', 'mode.stage')).toBe('搭景')
    expect(translate('zh-CN', 'mode.shoot')).toBe('拍摄')
    expect(translate('zh-CN', 'mode.deliver')).toBe('交付')
    expect(translate('zh-CN', 'camera.monitor')).toBe('镜头监看')
  })

  it('keeps a complete English fallback', () => {
    expect(translate('en-US', 'mode.stage')).toBe('STAGE')
    expect(translate('en-US', 'welcome.newProject')).toBe('New Project')
  })

  it('interpolates named values', () => {
    expect(translate('zh-CN', 'camera.current', { name: 'B' })).toBe('当前机位 B')
  })
})
