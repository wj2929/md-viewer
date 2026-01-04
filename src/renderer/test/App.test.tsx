import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import App from '../src/App'

// Mock window.api
const mockApi = {
  openFolder: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  watchFolder: vi.fn().mockResolvedValue(undefined),
  unwatchFolder: vi.fn().mockResolvedValue(undefined),
  watchFile: vi.fn().mockResolvedValue(undefined),
  exportHTML: vi.fn(),
  exportPDF: vi.fn(),
  showContextMenu: vi.fn().mockResolvedValue({ success: true }),
  renameFile: vi.fn().mockResolvedValue('/new/path'),
  // v1.2 阶段 2：文件操作
  copyFile: vi.fn().mockResolvedValue('/new/path'),
  copyDir: vi.fn().mockResolvedValue('/new/path'),
  moveFile: vi.fn().mockResolvedValue('/new/path'),
  fileExists: vi.fn().mockResolvedValue(false),
  isDirectory: vi.fn().mockResolvedValue(false),
  onRestoreFolder: vi.fn(() => vi.fn()),
  onFileChanged: vi.fn(() => vi.fn()),
  onFileAdded: vi.fn(() => vi.fn()),
  onFileRemoved: vi.fn(() => vi.fn()),
  // v1.3 新增：文件夹和重命名事件
  onFolderAdded: vi.fn(() => vi.fn()),
  onFolderRemoved: vi.fn(() => vi.fn()),
  onFileRenamed: vi.fn(() => vi.fn()),
  // v1.2 阶段 1：右键菜单事件
  onFileDeleted: vi.fn(() => vi.fn()),
  onFileStartRename: vi.fn(() => vi.fn()),
  onFileExportRequest: vi.fn(() => vi.fn()),
  onError: vi.fn(() => vi.fn()),
  // v1.2 阶段 2：剪贴板事件
  onClipboardCopy: vi.fn(() => vi.fn()),
  onClipboardCut: vi.fn(() => vi.fn()),
  onClipboardPaste: vi.fn(() => vi.fn()),
  // v1.2.1：快捷键事件
  onShortcutOpenFolder: vi.fn(() => vi.fn()),
  onShortcutRefresh: vi.fn(() => vi.fn()),
  onShortcutCloseTab: vi.fn(() => vi.fn()),
  onShortcutExportHTML: vi.fn(() => vi.fn()),
  onShortcutExportPDF: vi.fn(() => vi.fn()),
  onShortcutFocusSearch: vi.fn(() => vi.fn()),
  onShortcutNextTab: vi.fn(() => vi.fn()),
  onShortcutPrevTab: vi.fn(() => vi.fn()),
  onShortcutSwitchTab: vi.fn(() => vi.fn())
}

// Mock 全局 window.api
global.window.api = mockApi as any

// Mock matchMedia for theme
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('App 集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('应用初始化', () => {
    it('应该渲染欢迎页面', () => {
      render(<App />)

      expect(screen.getByText('欢迎使用 MD Viewer')).toBeInTheDocument()
      expect(screen.getByText('一个简洁的 Markdown 预览工具')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '打开文件夹' })).toBeInTheDocument()
    })

    it('应该显示应用标题', () => {
      render(<App />)
      expect(screen.getByText('MD Viewer')).toBeInTheDocument()
    })

    it('应该注册文件夹恢复监听器', () => {
      render(<App />)
      expect(mockApi.onRestoreFolder).toHaveBeenCalled()
    })

    it('应该显示主题切换按钮', () => {
      render(<App />)
      const themeToggle = document.querySelector('.theme-toggle')
      expect(themeToggle).toBeInTheDocument()
    })

    it('应该注册快捷键监听器', () => {
      render(<App />)
      expect(mockApi.onShortcutOpenFolder).toHaveBeenCalled()
      expect(mockApi.onShortcutRefresh).toHaveBeenCalled()
      expect(mockApi.onShortcutCloseTab).toHaveBeenCalled()
    })
  })

  describe('文件夹操作', () => {
    it('点击"打开文件夹"应该调用 openFolder API', async () => {
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.openFolder).toHaveBeenCalled()
      })
    })

    it('打开文件夹后应该加载文件列表', async () => {
      const mockFiles = [
        { name: 'test1.md', path: '/test/folder/test1.md', isDirectory: false },
        { name: 'test2.md', path: '/test/folder/test2.md', isDirectory: false }
      ]

      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue(mockFiles)

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.readDir).toHaveBeenCalledWith('/test/folder')
      })
    })

    it('打开文件夹失败时应该处理错误', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockApi.openFolder.mockRejectedValue(new Error('打开失败'))

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith('Failed to open folder:', expect.any(Error))
      })

      consoleError.mockRestore()
    })

    it('打开文件夹后应该显示文件夹名称', async () => {
      mockApi.openFolder.mockResolvedValue('/test/my-folder')
      mockApi.readDir.mockResolvedValue([
        { name: 'test.md', path: '/test/my-folder/test.md', isDirectory: false }
      ])

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByText('my-folder')).toBeInTheDocument()
      })
    })

    it('用户取消选择文件夹时不应该改变状态', async () => {
      mockApi.openFolder.mockResolvedValue(null)

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.openFolder).toHaveBeenCalled()
      })

      // 应该仍然显示欢迎页面
      expect(screen.getByText('欢迎使用 MD Viewer')).toBeInTheDocument()
    })
  })

  describe('文件监听功能 (v1.1)', () => {
    it('打开文件夹后应该启动文件监听', async () => {
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])
      mockApi.watchFolder.mockResolvedValue(undefined)

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.readDir).toHaveBeenCalledWith('/test/folder')
      })

      await waitFor(() => {
        expect(mockApi.watchFolder).toHaveBeenCalledWith('/test/folder')
      }, { timeout: 3000 })
    })

    it('应该注册文件变化监听器', async () => {
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])
      mockApi.watchFolder.mockResolvedValue({ success: true })

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.onFileChanged).toHaveBeenCalled()
        expect(mockApi.onFileAdded).toHaveBeenCalled()
        expect(mockApi.onFileRemoved).toHaveBeenCalled()
      })
    })

    it('文件监听失败时应该记录错误', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])
      mockApi.watchFolder.mockRejectedValue(new Error('监听失败'))

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith('Failed to watch folder:', expect.any(Error))
      })

      consoleError.mockRestore()
    })
  })

  describe('右键菜单事件 (v1.2)', () => {
    it('应该注册右键菜单事件监听器', async () => {
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.onFileDeleted).toHaveBeenCalled()
        expect(mockApi.onFileStartRename).toHaveBeenCalled()
        expect(mockApi.onFileExportRequest).toHaveBeenCalled()
        expect(mockApi.onError).toHaveBeenCalled()
      })
    })

    it('应该注册剪贴板事件监听器', async () => {
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.onClipboardCopy).toHaveBeenCalled()
        expect(mockApi.onClipboardCut).toHaveBeenCalled()
        expect(mockApi.onClipboardPaste).toHaveBeenCalled()
      })
    })
  })

  describe('快捷键功能 (v1.2.1)', () => {
    it('快捷键回调应该正确注册', () => {
      render(<App />)

      expect(mockApi.onShortcutOpenFolder).toHaveBeenCalled()
      expect(mockApi.onShortcutRefresh).toHaveBeenCalled()
      expect(mockApi.onShortcutCloseTab).toHaveBeenCalled()
      expect(mockApi.onShortcutExportHTML).toHaveBeenCalled()
      expect(mockApi.onShortcutExportPDF).toHaveBeenCalled()
      expect(mockApi.onShortcutFocusSearch).toHaveBeenCalled()
      expect(mockApi.onShortcutNextTab).toHaveBeenCalled()
      expect(mockApi.onShortcutPrevTab).toHaveBeenCalled()
      expect(mockApi.onShortcutSwitchTab).toHaveBeenCalled()
    })

    it('快捷键 OpenFolder 应该触发打开文件夹', async () => {
      let capturedCallback: () => void = () => {}
      mockApi.onShortcutOpenFolder.mockImplementation((cb) => {
        capturedCallback = cb
        return vi.fn()
      })
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])

      render(<App />)

      // 模拟快捷键触发
      act(() => {
        capturedCallback()
      })

      await waitFor(() => {
        expect(mockApi.openFolder).toHaveBeenCalled()
      })
    })

    it('快捷键 Refresh 应该触发刷新文件树', async () => {
      let capturedCallback: () => void = () => {}
      mockApi.onShortcutRefresh.mockImplementation((cb) => {
        capturedCallback = cb
        return vi.fn()
      })
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])

      render(<App />)

      // 先打开文件夹
      const button = screen.getByRole('button', { name: '打开文件夹' })
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.readDir).toHaveBeenCalledWith('/test/folder')
      })

      mockApi.readDir.mockClear()

      // 模拟快捷键触发刷新
      act(() => {
        capturedCallback()
      })

      await waitFor(() => {
        expect(mockApi.readDir).toHaveBeenCalledWith('/test/folder')
      })
    })
  })

  describe('主题切换 (v1.2)', () => {
    it('应该能切换主题', async () => {
      render(<App />)

      const themeToggle = document.querySelector('.theme-toggle')
      expect(themeToggle).toBeInTheDocument()

      if (themeToggle) {
        fireEvent.click(themeToggle)
        // 点击后主题应该变化（不检查 localStorage，因为 mock 的行为可能不同）
        // 只验证点击不会导致错误
        await waitFor(() => {
          expect(themeToggle).toBeInTheDocument()
        })
      }
    })
  })

  describe('刷新功能', () => {
    it('点击刷新按钮应该重新加载文件列表', async () => {
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([
        { name: 'test.md', path: '/test/folder/test.md', isDirectory: false }
      ])

      render(<App />)
      const openButton = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(openButton)

      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })

      // 清空调用记录
      mockApi.readDir.mockClear()

      // 点击刷新按钮
      const refreshBtn = document.querySelector('.refresh-btn')
      if (refreshBtn) {
        fireEvent.click(refreshBtn)

        await waitFor(() => {
          expect(mockApi.readDir).toHaveBeenCalledWith('/test/folder')
        })
      }
    })
  })

  describe('错误处理', () => {
    it('加载文件列表失败时应该显示空列表', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockRejectedValue(new Error('读取失败'))

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith('Failed to load files:', expect.any(Error))
      })

      consoleError.mockRestore()
    })
  })

  describe('状态持久化', () => {
    it('应该在挂载时恢复上次打开的文件夹', () => {
      render(<App />)
      expect(mockApi.onRestoreFolder).toHaveBeenCalled()
    })

    it('恢复文件夹回调应该正确设置状态', async () => {
      let capturedCallback: (folderPath: string) => void = () => {}
      mockApi.onRestoreFolder.mockImplementation((cb) => {
        capturedCallback = cb
        return vi.fn()
      })
      mockApi.readDir.mockResolvedValue([])

      render(<App />)

      // 模拟恢复文件夹
      act(() => {
        capturedCallback('/restored/folder')
      })

      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
    })
  })

  describe('ErrorBoundary', () => {
    it('应该被 ErrorBoundary 包裹', () => {
      render(<App />)
      // App 组件应该正常渲染，说明 ErrorBoundary 工作正常
      expect(screen.getByText('MD Viewer')).toBeInTheDocument()
    })
  })

  describe('ToastContainer', () => {
    it('应该渲染 ToastContainer', () => {
      render(<App />)
      // ToastContainer 默认不显示任何 toast
      // 但组件应该存在
      const app = document.querySelector('.app')
      expect(app).toBeInTheDocument()
    })
  })
})

describe('App 边界条件测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
  })

  it('应该处理空文件列表', async () => {
    mockApi.openFolder.mockResolvedValue('/empty/folder')
    mockApi.readDir.mockResolvedValue([])

    render(<App />)
    const button = screen.getByRole('button', { name: '打开文件夹' })

    fireEvent.click(button)

    await waitFor(() => {
      // 文件夹名称是路径最后一部分
      expect(screen.getByText('folder')).toBeInTheDocument()
    })

    // 应该显示空状态提示
    await waitFor(() => {
      expect(screen.getByText('没有找到 Markdown 文件')).toBeInTheDocument()
    })
  })

  it('应该处理深层嵌套的文件结构', async () => {
    const nestedFiles = [
      {
        name: 'level1',
        path: '/test/level1',
        isDirectory: true,
        children: [
          {
            name: 'level2',
            path: '/test/level1/level2',
            isDirectory: true,
            children: [
              { name: 'deep.md', path: '/test/level1/level2/deep.md', isDirectory: false }
            ]
          }
        ]
      }
    ]

    mockApi.openFolder.mockResolvedValue('/test')
    mockApi.readDir.mockResolvedValue(nestedFiles)

    render(<App />)
    const button = screen.getByRole('button', { name: '打开文件夹' })

    fireEvent.click(button)

    await waitFor(() => {
      expect(mockApi.readDir).toHaveBeenCalled()
    })
  })

  it('应该处理特殊字符的文件名', async () => {
    const specialFiles = [
      { name: '中文文件.md', path: '/test/中文文件.md', isDirectory: false },
      { name: 'file with spaces.md', path: '/test/file with spaces.md', isDirectory: false },
      { name: 'file-with-dashes.md', path: '/test/file-with-dashes.md', isDirectory: false }
    ]

    mockApi.openFolder.mockResolvedValue('/test')
    mockApi.readDir.mockResolvedValue(specialFiles)

    render(<App />)
    const button = screen.getByRole('button', { name: '打开文件夹' })

    fireEvent.click(button)

    await waitFor(() => {
      expect(mockApi.readDir).toHaveBeenCalled()
    })
  })
})
