/**
 * contextMenuHandler 测试
 * @description 测试右键菜单的构建逻辑、跨平台文案、IPC 事件发送
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Menu, shell, clipboard, dialog } from 'electron'
import { showContextMenu } from '../contextMenuHandler'
import { getClipboardState } from '../clipboardState'
import * as security from '../security'

// Mock Electron modules
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn((template) => ({
      popup: vi.fn(),
      _template: template // 保存 template 用于测试
    }))
  },
  shell: {
    showItemInFolder: vi.fn(),
    trashItem: vi.fn()
  },
  clipboard: {
    writeText: vi.fn()
  },
  dialog: {
    showMessageBox: vi.fn().mockResolvedValue({ response: 1 })
  },
  BrowserWindow: vi.fn()
}))

// Mock clipboardState module (v1.3 阶段 3)
vi.mock('../clipboardState', () => ({
  getClipboardState: vi.fn((_webContentsId: number) => ({ files: ['/some/file.md'], isCut: false, hasFiles: true })),
  syncClipboardState: vi.fn()
}))

// Mock security module
vi.mock('../security', () => ({
  validateSecurePathInBase: vi.fn(),
  validateNotProtected: vi.fn(),
  validateSearchPath: vi.fn(),
  isProtectedPath: vi.fn(),
  resetSecurity: vi.fn()
}))

describe('contextMenuHandler', () => {
  const findMenuItem = (template: any[], text: string) =>
    template.find((item: any) => {
      const labels: Record<string, RegExp> = {
        复制: /^📄 复制$/,
        剪切: /^✂️ 剪切$/,
        粘贴: /^📥 粘贴(?:到“.*”)?$/
      }
      return labels[text]?.test(item.label ?? '')
    })

  let mockWindow: any
  let mockWebContents: any

  beforeEach(() => {
    // 重置所有 mocks
    vi.clearAllMocks()
    vi.mocked(security.validateSecurePathInBase).mockReset()

    vi.mocked(getClipboardState).mockReturnValue({ files: ['/some/file.md'], isCut: false, hasFiles: true })

    // 创建 mock window
    mockWebContents = {
      send: vi.fn()
    }
    mockWindow = {
      webContents: mockWebContents
    }

    // 模拟 darwin 平台（默认）
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('基础功能', () => {
    it('应该成功构建并显示菜单', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      // 验证 Menu.buildFromTemplate 被调用
      expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1)

      // 验证菜单被弹出
      const menu = (Menu.buildFromTemplate as any).mock.results[0].value
      expect(menu.popup).toHaveBeenCalledWith({ window: mockWindow })
    })

    it('应该为文件生成正确数量的菜单项', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]

      // 文件菜单项：显示、分隔、复制路径、复制相对路径、分隔、复制、剪切、分隔、导出HTML、导出PDF、分隔、重命名、删除
      // 至少应该有 10+ 个项目（包括分隔符）
      expect(template.length).toBeGreaterThanOrEqual(10)
    })

    it('Markdown 文件显示“在新窗口中打开”并调用动作', async () => {
      const openMarkdownInNewWindow = vi.fn()
      showContextMenu(mockWindow, {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }, '/Users/test/documents', { openMarkdownInNewWindow })

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const item = template.find((entry: any) => entry.label === '🗔 在新窗口中打开')
      expect(item).toBeDefined()
      item.click()
      await Promise.resolve()
      expect(openMarkdownInNewWindow).toHaveBeenCalledWith('/Users/test/documents/test.md')
      expect(mockWebContents.send).not.toHaveBeenCalledWith('open-specific-file', expect.anything())
    })

    it('目录和非 Markdown 文件不显示“在新窗口中打开”', () => {
      const openMarkdownInNewWindow = vi.fn()
      showContextMenu(mockWindow, {
        name: 'subfolder', path: '/Users/test/documents/subfolder', isDirectory: true
      }, '/Users/test/documents', { openMarkdownInNewWindow })
      let template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      expect(template.some((entry: any) => entry.label === '🗔 在新窗口中打开')).toBe(false)

      vi.mocked(Menu.buildFromTemplate).mockClear()
      showContextMenu(mockWindow, {
        name: 'drawing.excalidraw', path: '/Users/test/documents/drawing.excalidraw', isDirectory: false
      }, '/Users/test/documents', { openMarkdownInNewWindow })
      template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      expect(template.some((entry: any) => entry.label === '🗔 在新窗口中打开')).toBe(false)
    })

    it('应该为文件夹生成正确的菜单项（包含粘贴）', () => {
      const folder = {
        name: 'subfolder',
        path: '/Users/test/documents/subfolder',
        isDirectory: true
      }

      showContextMenu(mockWindow, folder, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]

      // 文件夹应该有粘贴项，但没有导出项
      const labels = template.map((item: any) => item.label).filter(Boolean)

      expect(labels).toContain('📥 粘贴到“subfolder”')
      expect(labels).not.toContain('📤 导出 HTML')
      expect(labels).not.toContain('📑 导出 PDF')
    })

    it('应该为文件生成导出菜单项，并在有剪贴板内容时显示父目录粘贴', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const labels = template.map((item: any) => item.label).filter(Boolean)

      expect(labels).toContain('📤 导出 HTML')
      expect(labels).toContain('📑 导出 PDF')
      expect(labels).toContain('📥 粘贴到“documents”')
    })
  })

    it('无应用内剪贴板内容时不显示粘贴菜单', () => {
      vi.mocked(getClipboardState).mockReturnValue({ files: [], isCut: false, hasFiles: false })

      showContextMenu(mockWindow, {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      expect(template.find((item: any) => item.label?.startsWith('📥 粘贴'))).toBeUndefined()
    })

  describe('跨平台文案', () => {
    it('macOS 应该显示 "在 Finder 中显示"', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })

      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const showInFolderItem = template.find((item: any) => item.label?.endsWith('在 Finder 中显示'))

      expect(showInFolderItem).toBeDefined()
      expect(showInFolderItem.label).toBe('📂 在 Finder 中显示')
    })

    it('Windows 应该显示 "在资源管理器中显示"', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })

      const file = {
        name: 'test.md',
        path: 'C:\\Users\\test\\documents\\test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, 'C:\\Users\\test\\documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const showInFolderItem = template.find((item: any) => item.label?.endsWith('在资源管理器中显示'))

      expect(showInFolderItem).toBeDefined()
      expect(showInFolderItem.label).toBe('📂 在资源管理器中显示')
    })

    it('Linux 应该显示 "在文件管理器中显示"', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })

      const file = {
        name: 'test.md',
        path: '/home/user/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/home/user/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const showInFolderItem = template.find((item: any) => item.label?.endsWith('在文件管理器中显示'))

      expect(showInFolderItem).toBeDefined()
      expect(showInFolderItem.label).toBe('📂 在文件管理器中显示')
    })

    it('macOS 删除快捷键应该是 Cmd+Backspace', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })

      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const deleteItem = template.find((item: any) => item.label?.includes('删除'))

      expect(deleteItem).toBeDefined()
      expect(deleteItem.accelerator).toBe('Cmd+Backspace')
    })

    it('Windows/Linux 删除快捷键应该是 Delete', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })

      const file = {
        name: 'test.md',
        path: 'C:\\Users\\test\\documents\\test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, 'C:\\Users\\test\\documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const deleteItem = template.find((item: any) => item.label?.includes('删除'))

      expect(deleteItem).toBeDefined()
      expect(deleteItem.accelerator).toBe('Delete')
    })
  })

  describe('菜单项功能：在文件管理器中显示', () => {
    it('应该调用 shell.showItemInFolder', async () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const showInFolderItem = template[0] // 第一个菜单项

      // 执行 click 回调
      await showInFolderItem.click()

      expect(security.validateSecurePathInBase).toHaveBeenCalledWith(file.path, '/Users/test/documents')
      expect(shell.showItemInFolder).toHaveBeenCalledWith(file.path)
    })

    it('应该处理路径校验失败的情况', async () => {
      vi.mocked(security.validateSecurePathInBase).mockImplementation(() => {
        throw new Error('安全错误：路径不在允许范围内')
      })

      const file = {
        name: 'test.md',
        path: '/etc/passwd',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const showInFolderItem = template[0]

      await showInFolderItem.click()

      // 应该发送错误事件
      expect(mockWebContents.send).toHaveBeenCalledWith('error:show', {
        message: expect.stringContaining('安全错误')
      })

      // 不应该调用 shell
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })
  })

  describe('菜单项功能：复制路径', () => {
    it('应该复制绝对路径到剪贴板', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const copyPathItem = template.find((item: any) => item.label?.includes('复制路径'))

      copyPathItem.click()

      expect(clipboard.writeText).toHaveBeenCalledWith(file.path)
    })

    it('应该有正确的快捷键', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const copyPathItem = template.find((item: any) => item.label?.includes('复制路径'))

      expect(copyPathItem.accelerator).toBe('CmdOrCtrl+Alt+C')
    })
  })

  describe('菜单项功能：复制相对路径', () => {
    it('应该复制相对路径到剪贴板', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/subfolder/test.md',
        isDirectory: false
      }
      const basePath = '/Users/test/documents'

      showContextMenu(mockWindow, file, basePath)

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const copyRelativePathItem = template.find((item: any) => item.label?.includes('复制相对路径'))

      copyRelativePathItem.click()

      expect(clipboard.writeText).toHaveBeenCalledWith('subfolder/test.md')
    })

    it('应该有正确的快捷键', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const copyRelativePathItem = template.find((item: any) => item.label?.includes('复制相对路径'))

      expect(copyRelativePathItem.accelerator).toBe('Shift+Alt+C')
    })
  })

  describe('菜单项功能：导出 HTML', () => {
    it('应该发送导出请求到渲染进程', async () => {
      // Mock validatePath 不抛出错误（路径合法）
      vi.mocked(security.validateSecurePathInBase).mockResolvedValue('/Users/test/documents/test.md')

      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const exportHTMLItem = template.find((item: any) => item.label?.includes('导出 HTML'))

      await exportHTMLItem.click()

      expect(security.validateSecurePathInBase).toHaveBeenCalledWith(file.path, '/Users/test/documents')
      expect(mockWebContents.send).toHaveBeenCalledWith('file:export-request', {
        path: file.path,
        type: 'html'
      })
    })

    it('应该处理路径校验失败的情况', async () => {
      vi.mocked(security.validateSecurePathInBase).mockImplementation(() => {
        throw new Error('安全错误：路径不在允许范围内')
      })

      const file = {
        name: 'test.md',
        path: '/etc/passwd',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const exportHTMLItem = template.find((item: any) => item.label?.includes('导出 HTML'))

      await exportHTMLItem.click()

      // 错误消息可能包含 "安全错误" 或 "无法导出 HTML"
      expect(mockWebContents.send).toHaveBeenCalledWith('error:show', {
        message: expect.stringMatching(/(安全错误|无法导出 HTML)/)
      })
    })
  })

  describe('菜单项功能：导出 PDF', () => {
    it('应该发送导出请求到渲染进程', async () => {
      // Mock validatePath 不抛出错误（路径合法）
      vi.mocked(security.validateSecurePathInBase).mockResolvedValue('/Users/test/documents/test.md')

      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const exportPDFItem = template.find((item: any) => item.label?.includes('导出 PDF'))

      await exportPDFItem.click()

      expect(security.validateSecurePathInBase).toHaveBeenCalledWith(file.path, '/Users/test/documents')
      expect(mockWebContents.send).toHaveBeenCalledWith('file:export-request', {
        path: file.path,
        type: 'pdf'
      })
    })
  })

  describe('菜单项功能：重命名', () => {
    it('应该发送重命名事件到渲染进程', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const renameItem = template.find((item: any) => item.label?.endsWith('重命名'))

      renameItem.click()

      expect(mockWebContents.send).toHaveBeenCalledWith('file:start-rename', file.path)
    })

    it('应该有正确的快捷键', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const renameItem = template.find((item: any) => item.label?.endsWith('重命名'))

      expect(renameItem.accelerator).toBe('Enter')
    })
  })

  describe('菜单项功能：删除', () => {
    it('应该调用 shell.trashItem 并发送删除事件', async () => {
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0 } as any)
      vi.mocked(shell.trashItem).mockResolvedValue()

      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const deleteItem = template.find((item: any) => item.label?.includes('删除'))

      await deleteItem.click()

      expect(security.validateSecurePathInBase).toHaveBeenCalledWith(file.path, '/Users/test/documents')
      expect(shell.trashItem).toHaveBeenCalledWith(file.path)
      expect(mockWebContents.send).toHaveBeenCalledWith('file:deleted', file.path)
    })

    it('取消删除时不应触发文件系统操作', async () => {
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1 } as any)
      const file = { name: 'test.md', path: '/Users/test/documents/test.md', isDirectory: false }

      showContextMenu(mockWindow, file, '/Users/test/documents')
      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      await template.find((item: any) => item.label?.includes('删除')).click()

      expect(dialog.showMessageBox).toHaveBeenCalledWith(mockWindow, expect.objectContaining({
        buttons: ['删除', '取消'],
        defaultId: 1,
        cancelId: 1,
        detail: '项目将移到废纸篓。'
      }))
      expect(security.validateSecurePathInBase).not.toHaveBeenCalled()
      expect(shell.trashItem).not.toHaveBeenCalled()
      expect(mockWebContents.send).not.toHaveBeenCalledWith('file:deleted', file.path)
    })
    it('应该处理删除失败的情况', async () => {
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0 } as any)
      vi.mocked(security.validateSecurePathInBase).mockImplementation(() => {
        throw new Error('安全错误：无法操作受保护的系统路径')
      })

      const file = {
        name: 'passwd',
        path: '/etc/passwd',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const deleteItem = template.find((item: any) => item.label?.includes('删除'))

      await deleteItem.click()

      // 错误消息可能包含 "安全错误" 或 "无法删除文件"
      expect(mockWebContents.send).toHaveBeenCalledWith('error:show', {
        message: expect.stringMatching(/(安全错误|无法删除文件)/)
      })
      expect(shell.trashItem).not.toHaveBeenCalled()
    })
  })

  describe('菜单项功能：复制/剪切/粘贴（阶段 2）', () => {
    it('复制和剪切菜单项应该启用（阶段 2 已实现）', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const copyItem = findMenuItem(template, '复制')
      const cutItem = findMenuItem(template, '剪切')

      expect(copyItem.enabled).toBe(true)
      expect(cutItem.enabled).toBe(true)
    })

    it('粘贴菜单项应该启用（阶段 2 已实现）', () => {
      const folder = {
        name: 'subfolder',
        path: '/Users/test/documents/subfolder',
        isDirectory: true
      }

      showContextMenu(mockWindow, folder, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const pasteItem = findMenuItem(template, '粘贴')

      expect(pasteItem).toBeDefined()
      expect(pasteItem.enabled ?? true).toBe(true)
    })

    it('复制和剪切点击应该发送文件路径 IPC', async () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const copyItem = findMenuItem(template, '复制')
      const cutItem = findMenuItem(template, '剪切')

      await copyItem.click()
      await cutItem.click()

      expect(mockWebContents.send).toHaveBeenCalledWith('clipboard:copy', [file.path])
      expect(mockWebContents.send).toHaveBeenCalledWith('clipboard:cut', [file.path])
    })

    it('文件夹粘贴点击应该发送目标目录 IPC', () => {
      const folder = {
        name: 'subfolder',
        path: '/Users/test/documents/subfolder',
        isDirectory: true
      }

      showContextMenu(mockWindow, folder, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const pasteItem = findMenuItem(template, '粘贴')

      pasteItem.click()

      expect(mockWebContents.send).toHaveBeenCalledWith('clipboard:paste', folder.path)
    })

    it('文件粘贴点击应该发送父目录 IPC', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')
      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const pasteItem = findMenuItem(template, '粘贴')
      pasteItem.click()

      expect(mockWebContents.send).toHaveBeenCalledWith('clipboard:paste', '/Users/test/documents')
    })
    it('文件和文件夹应该包含创建副本菜单项', () => {
      const file = { name: 'test.md', path: '/Users/test/documents/test.md', isDirectory: false }
      const folder = { name: 'subfolder', path: '/Users/test/documents/subfolder', isDirectory: true }

      showContextMenu(mockWindow, file, '/Users/test/documents')
      const fileTemplate = (Menu.buildFromTemplate as any).mock.calls[0][0]
      expect(fileTemplate.find((item: any) => item.label === '📑 创建副本')).toBeDefined()

      vi.clearAllMocks()
      showContextMenu(mockWindow, folder, '/Users/test/documents')
      const folderTemplate = (Menu.buildFromTemplate as any).mock.calls[0][0]
      expect(folderTemplate.find((item: any) => item.label === '📑 创建副本')).toBeDefined()
    })

    it('文件和文件夹应该包含创建副本菜单项', () => {
      const file = { name: 'test.md', path: '/Users/test/documents/test.md', isDirectory: false }
      const folder = { name: 'subfolder', path: '/Users/test/documents/subfolder', isDirectory: true }

      showContextMenu(mockWindow, file, '/Users/test/documents')
      const fileTemplate = (Menu.buildFromTemplate as any).mock.calls[0][0]
      expect(fileTemplate.find((item: any) => item.label === '📑 创建副本')).toBeDefined()

      vi.clearAllMocks()
      showContextMenu(mockWindow, folder, '/Users/test/documents')
      const folderTemplate = (Menu.buildFromTemplate as any).mock.calls[0][0]
      expect(folderTemplate.find((item: any) => item.label === '📑 创建副本')).toBeDefined()
    })

    it('创建副本点击应该发送源路径请求', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')
      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const duplicateItem = template.find((item: any) => item.label === '📑 创建副本')

      duplicateItem.click()

      expect(mockWebContents.send).toHaveBeenCalledWith('file:duplicate-request', file.path)
      expect(mockWebContents.send).not.toHaveBeenCalledWith('clipboard:copy', expect.anything())
    })

    it('复制菜单项应该有正确的快捷键', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const copyItem = findMenuItem(template, '复制')

      expect(copyItem.accelerator).toBe('CmdOrCtrl+C')
    })

    it('剪切菜单项应该有正确的快捷键', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]
      const cutItem = findMenuItem(template, '剪切')

      expect(cutItem.accelerator).toBe('CmdOrCtrl+X')
    })
  })

  describe('菜单结构', () => {
    it('应该在正确的位置插入分隔符', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')

      const template = (Menu.buildFromTemplate as any).mock.calls[0][0]

      // 找出所有分隔符的位置
      const separators = template
        .map((item: any, index: number) => (item.type === 'separator' ? index : -1))
        .filter((index: number) => index !== -1)

      // 应该有至少 4 个分隔符
      expect(separators.length).toBeGreaterThanOrEqual(4)
    })

    it('文件夹菜单应该比文件菜单少导出项', () => {
      const file = {
        name: 'test.md',
        path: '/Users/test/documents/test.md',
        isDirectory: false
      }
      const folder = {
        name: 'subfolder',
        path: '/Users/test/documents/subfolder',
        isDirectory: true
      }

      showContextMenu(mockWindow, file, '/Users/test/documents')
      const fileTemplate = (Menu.buildFromTemplate as any).mock.calls[0][0]

      vi.clearAllMocks()

      showContextMenu(mockWindow, folder, '/Users/test/documents')
      const folderTemplate = (Menu.buildFromTemplate as any).mock.calls[0][0]

      // 文件菜单应该比文件夹菜单长（因为有导出项）
      expect(fileTemplate.length).toBeGreaterThan(folderTemplate.length)
    })
  })
})
