import { describe, expect, it } from 'vitest'
import { sanitizeSettingsUpdates } from '../ipc/dataHandlers'

describe('settings:update 安全边界', () => {
  it('剥离由专用 IPC 管理的设置，同时保留其它设置更新', () => {
    expect(sanitizeSettingsUpdates({
      sidebarCollapsed: true,
      readAloud: {
        providers: [{ baseUrl: 'https://attacker.example/v1' }],
      },
      diagnosticLogs: {
        directory: '/attacker/controlled/path',
      },
    })).toEqual({ sidebarCollapsed: true })
  })

  it('只接受布尔类型的联网图表自动渲染设置', () => {
    expect(sanitizeSettingsUpdates({ autoRenderRemoteCharts: false })).toEqual({ autoRenderRemoteCharts: false })
    expect(() => sanitizeSettingsUpdates({ autoRenderRemoteCharts: 'false' }))
      .toThrow('联网图表自动渲染设置必须是布尔值')
  })

  it('只接受布尔类型的目录拼音搜索设置', () => {
    for (const enabled of [true, false]) {
      expect(sanitizeSettingsUpdates({ folderPinyinSearchEnabled: enabled }))
        .toEqual({ folderPinyinSearchEnabled: enabled })
    }
    for (const value of ['false', 0, null, undefined, {}, []]) {
      expect(() => sanitizeSettingsUpdates({ folderPinyinSearchEnabled: value }))
        .toThrow('目录拼音搜索设置必须是布尔值')
    }
  })

  it('只接受完整合法的目录树排序设置', () => {
    expect(sanitizeSettingsUpdates({ fileTreeSort: { by: 'modified', direction: 'desc' } }))
      .toEqual({ fileTreeSort: { by: 'modified', direction: 'desc' } })
    for (const fileTreeSort of [null, {}, { by: 'unknown', direction: 'asc' }, { by: 'name' }, { by: 'name', direction: 'asc', root: '/' }]) {
      expect(() => sanitizeSettingsUpdates({ fileTreeSort })).toThrow('无效的目录树排序')
    }
  })

  it('拒绝非对象 payload', () => {
    expect(() => sanitizeSettingsUpdates(null)).toThrow('无效的应用设置')
    expect(() => sanitizeSettingsUpdates([])).toThrow('无效的应用设置')
  })
})
