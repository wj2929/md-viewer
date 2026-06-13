import { describe, expect, it, vi } from 'vitest'
import { createMacApplicationMenuTemplate } from '../applicationMenu'

describe('application menu', () => {
  it('keeps CLI actions out of macOS menus and exposes Settings instead', () => {
    const openSettings = vi.fn()
    const template = createMacApplicationMenuTemplate({
      openSettings,
    })
    const appSubmenu = template[0].submenu as Electron.MenuItemConstructorOptions[]
    const helpSubmenu = template.find(item => item.role === 'help')?.submenu as Electron.MenuItemConstructorOptions[] | undefined
    const settingsItem = appSubmenu.find(item => item.label === '设置...')

    expect(appSubmenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '设置...' }),
    ]))
    expect(appSubmenu).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '安装命令行工具 (md-viewer)' }),
      expect.objectContaining({ label: '卸载命令行工具 (md-viewer)' }),
    ]))
    expect(helpSubmenu ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'CLI 使用指南' }),
    ]))
    settingsItem?.click?.({} as any, undefined as any, {} as any)
    expect(openSettings).toHaveBeenCalledTimes(1)
    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'editMenu' }),
      expect.objectContaining({ role: 'viewMenu' }),
      expect.objectContaining({ role: 'windowMenu' }),
    ]))
  })
})
