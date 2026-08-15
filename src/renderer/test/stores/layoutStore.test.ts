import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLayoutStore } from '../../src/stores/layoutStore'

describe('layoutStore sidebar', () => {
  beforeEach(() => {
    window.api = {
      getAppSettings: vi.fn().mockResolvedValue({ sidebarWidth: 320, sidebarCollapsed: true }),
      updateAppSettings: vi.fn().mockResolvedValue(undefined)
    } as any
    useLayoutStore.setState({ sidebarWidth: 280, sidebarCollapsed: false, isResizing: false })
  })

  it('从设置恢复宽度和收缩状态', async () => {
    await useLayoutStore.getState().loadSettings()
    expect(useLayoutStore.getState()).toMatchObject({ sidebarWidth: 320, sidebarCollapsed: true })
  })

  it('旧设置缺字段时使用默认值', async () => {
    vi.mocked(window.api.getAppSettings).mockResolvedValue({} as any)
    useLayoutStore.setState({ sidebarWidth: 420, sidebarCollapsed: true })
    await useLayoutStore.getState().loadSettings()
    expect(useLayoutStore.getState()).toMatchObject({ sidebarWidth: 280, sidebarCollapsed: false })
  })

  it('恢复和设置宽度时限制在 180 到 500', async () => {
    vi.mocked(window.api.getAppSettings).mockResolvedValue({ sidebarWidth: 900 } as any)
    await useLayoutStore.getState().loadSettings()
    expect(useLayoutStore.getState().sidebarWidth).toBe(500)
    useLayoutStore.getState().setSidebarWidth(20)
    expect(useLayoutStore.getState().sidebarWidth).toBe(180)
  })

  it('toggleSidebar 保留宽度并持久化状态', () => {
    useLayoutStore.setState({ sidebarWidth: 360 })
    expect(useLayoutStore.getState().toggleSidebar()).toBe(true)
    expect(useLayoutStore.getState().sidebarWidth).toBe(360)
    expect(window.api.updateAppSettings).toHaveBeenCalledWith({ sidebarCollapsed: true })
  })

  it('只在显式持久化时保存当前宽度', async () => {
    useLayoutStore.getState().setSidebarWidth(350)
    expect(window.api.updateAppSettings).not.toHaveBeenCalled()
    await useLayoutStore.getState().persistSidebarWidth()
    expect(window.api.updateAppSettings).toHaveBeenCalledWith({ sidebarWidth: 350 })
  })
})
