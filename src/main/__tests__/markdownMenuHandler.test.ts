/**
 * Markdown 右键菜单处理器测试
 * @module markdownMenuHandler.test
 * @description v1.3 阶段 2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { showMarkdownContextMenu, MarkdownMenuContext } from '../markdownMenuHandler'
import { BrowserWindow, Menu } from 'electron'

// Mock Electron 模块
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  Menu: {
    buildFromTemplate: vi.fn().mockReturnValue({
      popup: vi.fn()
    })
  }
}))

// Mock security 模块
vi.mock('../security', () => ({
  validatePath: vi.fn()
}))

describe('markdownMenuHandler', () => {
  let mockWindow: BrowserWindow
  let mockWebContents: { send: ReturnType<typeof vi.fn>; copy: ReturnType<typeof vi.fn> }
  let mockMenu: { popup: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()

    mockWebContents = {
      send: vi.fn(),
      copy: vi.fn()
    }
    mockWindow = {
      webContents: mockWebContents
    } as unknown as BrowserWindow

    mockMenu = { popup: vi.fn() }
    vi.mocked(Menu.buildFromTemplate).mockReturnValue(mockMenu as any)
  })

  describe('showMarkdownContextMenu', () => {
    const baseContext: MarkdownMenuContext = {
      filePath: '/Users/test/docs/README.md',
      hasSelection: false
    }

    it('应该构建包含所有菜单项的模板', () => {
      showMarkdownContextMenu(mockWindow, baseContext)

      expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1)
      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]

      // 检查菜单项
      const labels = template.map((item: any) => item.label).filter(Boolean)
      expect(labels).toContain('导出 HTML')
      expect(labels).toContain('导出 PDF')
      expect(labels).toContain('复制为 Markdown')
      expect(labels).toContain('复制为纯文本')
      expect(labels).toContain('复制为 HTML')
    })

    it('没有选中内容时不应包含"复制选中内容"', () => {
      showMarkdownContextMenu(mockWindow, baseContext)

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
      const labels = template.map((item: any) => item.label).filter(Boolean)
      expect(labels).not.toContain('复制选中内容')
    })

    it('有选中内容时应该包含"复制选中内容"', () => {
      const ctx: MarkdownMenuContext = { ...baseContext, hasSelection: true }
      showMarkdownContextMenu(mockWindow, ctx)

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
      const labels = template.map((item: any) => item.label).filter(Boolean)
      expect(labels).toContain('复制选中内容')
    })

    it('应该弹出菜单', () => {
      showMarkdownContextMenu(mockWindow, baseContext)
      expect(mockMenu.popup).toHaveBeenCalledWith({ window: mockWindow })
    })

    describe('菜单项点击处理', () => {
      it('点击"导出 HTML"应该发送 markdown:export-html 事件', () => {
        showMarkdownContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '导出 HTML')
        item?.click?.()

        expect(mockWebContents.send).toHaveBeenCalledWith('markdown:export-html')
      })

      it('点击"导出 PDF"应该发送 markdown:export-pdf 事件', () => {
        showMarkdownContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '导出 PDF')
        item?.click?.()

        expect(mockWebContents.send).toHaveBeenCalledWith('markdown:export-pdf')
      })

      it('点击"复制为 Markdown"应该发送 markdown:copy-source 事件', () => {
        showMarkdownContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '复制为 Markdown')
        item?.click?.()

        expect(mockWebContents.send).toHaveBeenCalledWith('markdown:copy-source')
      })

      it('点击"复制为纯文本"应该发送 markdown:copy-plain-text 事件', () => {
        showMarkdownContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '复制为纯文本')
        item?.click?.()

        expect(mockWebContents.send).toHaveBeenCalledWith('markdown:copy-plain-text')
      })

      it('点击"复制为 HTML"应该发送 markdown:copy-html 事件', () => {
        showMarkdownContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '复制为 HTML')
        item?.click?.()

        expect(mockWebContents.send).toHaveBeenCalledWith('markdown:copy-html')
      })

      it('点击"复制选中内容"应该调用 webContents.copy()', () => {
        const ctx: MarkdownMenuContext = { ...baseContext, hasSelection: true }
        showMarkdownContextMenu(mockWindow, ctx)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '复制选中内容')
        item?.click?.()

        expect(mockWebContents.copy).toHaveBeenCalled()
      })
    })

    describe('快捷键配置', () => {
      it('导出 HTML 应该有快捷键 CmdOrCtrl+E', () => {
        showMarkdownContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '导出 HTML')
        expect(item?.accelerator).toBe('CmdOrCtrl+E')
      })

      it('导出 PDF 应该有快捷键 CmdOrCtrl+Shift+E', () => {
        showMarkdownContextMenu(mockWindow, baseContext)

        const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0]
        const item = template.find((item: any) => item.label === '导出 PDF')
        expect(item?.accelerator).toBe('CmdOrCtrl+Shift+E')
      })
    })
  })
})
