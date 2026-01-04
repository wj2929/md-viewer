/**
 * Tab 右键菜单处理器测试
 * @module tabMenuHandler.test
 * @description v1.3 新增
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { showTabContextMenu, TabMenuContext } from '../tabMenuHandler'
import { BrowserWindow, Menu, shell, clipboard } from 'electron'

// Mock Electron 模块
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  Menu: {
    buildFromTemplate: vi.fn().mockReturnValue({
      popup: vi.fn()
    })
  },
  shell: {
    showItemInFolder: vi.fn()
  },
  clipboard: {
    writeText: vi.fn()
  }
}))

// Mock security 模块
vi.mock('../security', () => ({
  validatePath: vi.fn()
}))

describe('tabMenuHandler', () => {
  let mockWindow: BrowserWindow
  let mockWebContents: { send: ReturnType<typeof vi.fn> }
  let mockMenu: { popup: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()

    mockWebContents = { send: vi.fn() }
    mockWindow = {
      webContents: mockWebContents
    } as unknown as BrowserWindow

    mockMenu = { popup: vi.fn() }
    vi.mocked(Menu.buildFromTemplate).mockReturnValue(mockMenu as any)
  })

  describe('showTabContextMenu', () => {
    const baseContext: TabMenuContext = {
      tabId: 'tab-1',
      filePath: '/Users/test/docs/README.md',
      basePath: '/Users/test/docs',
      tabCount: 3,
      tabIndex: 1
    }

    it('应该构建包含所有菜单项的模板', () => {
      showTabContextMenu(mockWindow, baseContext)

      expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1)
      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]

      // 检查菜单项
      const labels = template.map((item: any) => item.label).filter(Boolean)
      expect(labels).toContain('关闭')
      expect(labels).toContain('关闭其他标签')
      expect(labels).toContain('关闭所有标签')
      expect(labels).toContain('关闭左侧标签')
      expect(labels).toContain('关闭右侧标签')
      expect(labels).toContain('在 Finder 中显示')
      expect(labels).toContain('复制文件路径')
      expect(labels).toContain('复制相对路径')
    })

    it('应该正确设置菜单项的启用状态', () => {
      showTabContextMenu(mockWindow, baseContext)

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
      const closeOthers = template.find((item: any) => item.label === '关闭其他标签')
      const closeAll = template.find((item: any) => item.label === '关闭所有标签')
      const closeLeft = template.find((item: any) => item.label === '关闭左侧标签')
      const closeRight = template.find((item: any) => item.label === '关闭右侧标签')

      // tabCount = 3, tabIndex = 1
      expect(closeOthers?.enabled).toBe(true)  // tabCount > 1
      expect(closeAll?.enabled).toBe(true)     // tabCount > 0
      expect(closeLeft?.enabled).toBe(true)    // tabIndex > 0
      expect(closeRight?.enabled).toBe(true)   // tabIndex < tabCount - 1
    })

    it('当只有一个标签时应该禁用"关闭其他标签"', () => {
      const ctx: TabMenuContext = { ...baseContext, tabCount: 1, tabIndex: 0 }
      showTabContextMenu(mockWindow, ctx)

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
      const closeOthers = template.find((item: any) => item.label === '关闭其他标签')
      expect(closeOthers?.enabled).toBe(false)
    })

    it('当是第一个标签时应该禁用"关闭左侧标签"', () => {
      const ctx: TabMenuContext = { ...baseContext, tabIndex: 0 }
      showTabContextMenu(mockWindow, ctx)

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
      const closeLeft = template.find((item: any) => item.label === '关闭左侧标签')
      expect(closeLeft?.enabled).toBe(false)
    })

    it('当是最后一个标签时应该禁用"关闭右侧标签"', () => {
      const ctx: TabMenuContext = { ...baseContext, tabIndex: 2 }  // tabCount = 3
      showTabContextMenu(mockWindow, ctx)

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
      const closeRight = template.find((item: any) => item.label === '关闭右侧标签')
      expect(closeRight?.enabled).toBe(false)
    })

    it('应该弹出菜单', () => {
      showTabContextMenu(mockWindow, baseContext)
      expect(mockMenu.popup).toHaveBeenCalledWith({ window: mockWindow })
    })

    describe('菜单项点击处理', () => {
      it('点击"关闭"应该发送 tab:close 事件', () => {
        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const closeItem = template.find((item: any) => item.label === '关闭')
        closeItem?.click?.({} as any, mockWindow, {} as any)

        expect(mockWebContents.send).toHaveBeenCalledWith('tab:close', 'tab-1')
      })

      it('点击"关闭其他标签"应该发送 tab:close-others 事件', () => {
        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '关闭其他标签')
        item?.click?.({} as any, mockWindow, {} as any)

        expect(mockWebContents.send).toHaveBeenCalledWith('tab:close-others', 'tab-1')
      })

      it('点击"关闭所有标签"应该发送 tab:close-all 事件', () => {
        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '关闭所有标签')
        item?.click?.({} as any, mockWindow, {} as any)

        expect(mockWebContents.send).toHaveBeenCalledWith('tab:close-all')
      })

      it('点击"关闭左侧标签"应该发送 tab:close-left 事件', () => {
        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '关闭左侧标签')
        item?.click?.({} as any, mockWindow, {} as any)

        expect(mockWebContents.send).toHaveBeenCalledWith('tab:close-left', 'tab-1')
      })

      it('点击"关闭右侧标签"应该发送 tab:close-right 事件', () => {
        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '关闭右侧标签')
        item?.click?.({} as any, mockWindow, {} as any)

        expect(mockWebContents.send).toHaveBeenCalledWith('tab:close-right', 'tab-1')
      })

      it('点击"在 Finder 中显示"应该调用 shell.showItemInFolder', () => {
        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '在 Finder 中显示')
        item?.click?.({} as any, mockWindow, {} as any)

        expect(shell.showItemInFolder).toHaveBeenCalledWith('/Users/test/docs/README.md')
      })

      it('点击"复制文件路径"应该复制绝对路径到剪贴板', () => {
        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '复制文件路径')
        item?.click?.({} as any, mockWindow, {} as any)

        expect(clipboard.writeText).toHaveBeenCalledWith('/Users/test/docs/README.md')
      })

      it('点击"复制相对路径"应该复制相对路径到剪贴板', () => {
        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '复制相对路径')
        item?.click?.({} as any, mockWindow, {} as any)

        expect(clipboard.writeText).toHaveBeenCalledWith('README.md')
      })
    })

    describe('错误处理', () => {
      it('在 Finder 中显示失败时应该发送错误消息', () => {
        vi.mocked(shell.showItemInFolder).mockImplementationOnce(() => {
          throw new Error('文件不存在')
        })

        showTabContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '在 Finder 中显示')
        item?.click?.({} as any, mockWindow, {} as any)

        expect(mockWebContents.send).toHaveBeenCalledWith('error:show', {
          message: '无法在 Finder 中显示：文件不存在'
        })
      })
    })
  })
})
