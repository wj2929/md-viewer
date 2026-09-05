import { describe, expect, it } from 'vitest'
import { sanitizeSettingsUpdates } from '../ipc/dataHandlers'

describe('settings:update 安全边界', () => {
  it('剥离 readAloud，同时保留其它设置更新', () => {
    expect(sanitizeSettingsUpdates({
      sidebarCollapsed: true,
      readAloud: {
        providers: [{ baseUrl: 'https://attacker.example/v1' }],
      },
    })).toEqual({ sidebarCollapsed: true })
  })

  it('只接受布尔类型的联网图表自动渲染设置', () => {
    expect(sanitizeSettingsUpdates({ autoRenderRemoteCharts: false })).toEqual({ autoRenderRemoteCharts: false })
    expect(() => sanitizeSettingsUpdates({ autoRenderRemoteCharts: 'false' }))
      .toThrow('联网图表自动渲染设置必须是布尔值')
  })

  it('拒绝非对象 payload', () => {
    expect(() => sanitizeSettingsUpdates(null)).toThrow('无效的应用设置')
    expect(() => sanitizeSettingsUpdates([])).toThrow('无效的应用设置')
  })
})
