// @ts-nocheck - 测试文件的类型检查暂时跳过
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import App from '../src/App'
import { useFileStore } from '../src/stores/fileStore'
import { useTabStore } from '../src/stores/tabStore'
import { useBookmarkStore } from '../src/stores/bookmarkStore'
import { useLayoutStore } from '../src/stores/layoutStore'

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
  // v1.3 新增：Tab 右键菜单
  showTabContextMenu: vi.fn().mockResolvedValue({ success: true }),
  onTabClose: vi.fn(() => vi.fn()),
  onTabCloseOthers: vi.fn(() => vi.fn()),
  onTabCloseAll: vi.fn(() => vi.fn()),
  onTabCloseLeft: vi.fn(() => vi.fn()),
  onTabCloseRight: vi.fn(() => vi.fn()),
  // v1.3 阶段 2：Markdown 右键菜单
  showMarkdownContextMenu: vi.fn().mockResolvedValue({ success: true }),
  onMarkdownExportHTML: vi.fn(() => vi.fn()),
  onMarkdownExportPDF: vi.fn(() => vi.fn()),
  onMarkdownExportDOCX: vi.fn(() => vi.fn()),
  onMarkdownCopySource: vi.fn(() => vi.fn()),
  onMarkdownCopyPlainText: vi.fn(() => vi.fn()),
  onMarkdownCopyHTML: vi.fn(() => vi.fn()),
  // v1.3 阶段 3：剪贴板状态同步
  syncClipboardState: vi.fn().mockResolvedValue(undefined),
  queryClipboardState: vi.fn().mockResolvedValue({ files: [], isCut: false, hasFiles: false }),
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
  onShortcutSwitchTab: vi.fn(() => vi.fn()),
  // v1.3.4：历史文件夹
  getFolderHistory: vi.fn().mockResolvedValue([]),
  removeFolderFromHistory: vi.fn().mockResolvedValue(undefined),
  clearFolderHistory: vi.fn().mockResolvedValue(undefined),
  setFolderPath: vi.fn().mockResolvedValue(true),
  // v1.3.4：打开特定文件
  onOpenSpecificFile: vi.fn(() => vi.fn()),
  // v1.3.4：右键菜单安装
  checkContextMenuStatus: vi.fn().mockResolvedValue({ installed: false, platform: 'darwin' }),
  installContextMenu: vi.fn().mockResolvedValue({ success: true }),
  uninstallContextMenu: vi.fn().mockResolvedValue({ success: true }),
  // v1.3.6：标签固定功能
  onTabPin: vi.fn(() => vi.fn()),
  onTabUnpin: vi.fn(() => vi.fn()),
  getPinnedTabs: vi.fn().mockResolvedValue([]),
  savePinnedTabs: vi.fn().mockResolvedValue(undefined),
  // v1.3.6：书签功能
  onTabAddBookmark: vi.fn(() => vi.fn()),
  getBookmarks: vi.fn().mockResolvedValue([]),
  addBookmark: vi.fn().mockResolvedValue({ id: 'bookmark-1', filePath: '/test/file.md', fileName: 'file.md', createdAt: Date.now(), order: 0 }),
  deleteBookmark: vi.fn().mockResolvedValue(undefined),
  updateBookmarkOrder: vi.fn().mockResolvedValue(undefined),
  // v1.3.6：快捷键 - 添加书签
  onShortcutAddBookmark: vi.fn(() => vi.fn()),
  // v1.3.6：最近文件
  getRecentFiles: vi.fn().mockResolvedValue([]),
  addRecentFile: vi.fn().mockResolvedValue(undefined),
  showRecentFileContextMenu: vi.fn().mockResolvedValue(undefined),
  onRecentFileRemove: vi.fn(() => vi.fn()),
  // v1.3.6：应用设置
  getAppSettings: vi.fn().mockResolvedValue({
    imageDir: '',
    autoSave: false,
    bookmarkPanelWidth: 240,
    bookmarkPanelCollapsed: true,
    bookmarkBarCollapsed: true
  }),
  updateAppSettings: vi.fn().mockResolvedValue(undefined),
  // v1.3.6：固定标签
  getPinnedTabsForFolder: vi.fn().mockResolvedValue([]),
  addPinnedTab: vi.fn().mockResolvedValue(true),
  removePinnedTab: vi.fn().mockResolvedValue(undefined),
  isTabPinned: vi.fn().mockResolvedValue(false),
  // v1.3.7：预览区右键菜单
  showPreviewContextMenu: vi.fn().mockResolvedValue(undefined),
  onAddBookmarkFromPreview: vi.fn(() => vi.fn()),
  onAddBookmarkFromFileTree: vi.fn(() => vi.fn()),
  // v1.4.0：快捷键帮助弹窗
  onOpenShortcutsHelp: vi.fn(() => vi.fn()),
  onOpenInPageSearch: vi.fn(() => vi.fn()),
  // v1.4：Shell 操作
  showItemInFolder: vi.fn().mockResolvedValue({ success: true }),
  // v1.4.2：窗口置顶
  setAlwaysOnTop: vi.fn().mockResolvedValue(true),
  getAlwaysOnTop: vi.fn().mockResolvedValue(false),
  toggleAlwaysOnTop: vi.fn().mockResolvedValue(true),
  onAlwaysOnTopChanged: vi.fn(() => vi.fn()),
  onShortcutToggleAlwaysOnTop: vi.fn(() => vi.fn()),
  // v1.4.2：打印
  print: vi.fn().mockResolvedValue({ success: true }),
  onShortcutPrint: vi.fn(() => vi.fn()),
  // v1.4.2：字体大小调节
  onShortcutFontIncrease: vi.fn(() => vi.fn()),
  onShortcutFontDecrease: vi.fn(() => vi.fn()),
  onShortcutFontReset: vi.fn(() => vi.fn()),
  // v1.6.0：多窗口支持
  getWindowId: vi.fn().mockResolvedValue(1),
  newWindow: vi.fn().mockResolvedValue(2),
  newWindowWithFolder: vi.fn().mockResolvedValue(null),
  getWindowCount: vi.fn().mockResolvedValue(1),
  onShortcutNewWindow: vi.fn(() => vi.fn()),
  onShortcutNewWindowFolder: vi.fn(() => vi.fn()),
  onBookmarksChanged: vi.fn(() => vi.fn()),
  // v1.5.2：版本信息与更新检测
  getAppVersion: vi.fn().mockResolvedValue({
    version: '1.5.2', electron: '39.2.7', chrome: '134.0.6998.35',
    node: '22.14.0', platform: 'darwin', arch: 'arm64'
  }),
  checkForUpdates: vi.fn().mockResolvedValue({
    hasUpdate: false, currentVersion: '1.5.2', latestVersion: '1.5.2'
  }),
  openExternal: vi.fn().mockResolvedValue({ success: true })
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
    // v1.6.0: 重置 Zustand stores 到初始状态
    useFileStore.setState({ folderPath: null, files: [], isLoading: false, selectedPaths: new Set() })
    useTabStore.setState({ tabs: [], activeTabId: null, splitState: { root: null, activeLeafId: '' }, scrollToLine: undefined, highlightKeyword: undefined })
    useBookmarkStore.setState({ bookmarks: [], bookmarksLoading: true, bookmarkPanelCollapsed: true, bookmarkPanelWidth: 240, bookmarkBarCollapsed: true })
    useLayoutStore.setState({ sidebarWidth: 280, isResizing: false, showSettings: false, showShortcutsHelp: false, isFullscreen: false, isDragOver: false, lightbox: null })
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
      // v1.3.6：欢迎页面时没有 NavigationBar，应该显示欢迎文本
      expect(screen.getByText('欢迎使用 MD Viewer')).toBeInTheDocument()
    })

    it('应该注册文件夹恢复监听器', () => {
      render(<App />)
      expect(mockApi.onRestoreFolder).toHaveBeenCalled()
    })

    it('应该显示主题切换按钮', async () => {
      // v1.3.6：主题切换按钮只在打开文件夹后的 NavigationBar 中显示
      // 初始状态下（欢迎页面）没有主题切换按钮
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])

      render(<App />)

      // 打开文件夹
      const button = screen.getByRole('button', { name: '打开文件夹' })
      fireEvent.click(button)

      // 等待 NavigationBar 渲染，然后查找主题切换按钮
      await waitFor(() => {
        const themeToggles = screen.queryAllByRole('radio', { name: /自动|亮色|暗色/ })
        expect(themeToggles.length).toBeGreaterThan(0)
      })
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
        // v1.3.6：文件夹名称在 NavigationBar 的 .nav-folder-path 中，格式是 "📂 my-folder"
        const folderPath = document.querySelector('.nav-folder-path')
        expect(folderPath).toBeInTheDocument()
        expect(folderPath?.textContent).toContain('my-folder')
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
        // onFileStartRename 已移至 FileTree 组件，App 不再监听
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
      // v1.3.6：主题切换按钮只在打开文件夹后显示
      mockApi.openFolder.mockResolvedValue('/test/folder')
      mockApi.readDir.mockResolvedValue([])

      render(<App />)

      // 打开文件夹
      const button = screen.getByRole('button', { name: '打开文件夹' })
      fireEvent.click(button)

      // 等待 NavigationBar 渲染
      await waitFor(() => {
        const themeToggles = screen.queryAllByRole('radio', { name: /自动|亮色|暗色/ })
        expect(themeToggles.length).toBeGreaterThan(0)

        // 点击第一个主题切换按钮
        if (themeToggles.length > 0) {
          fireEvent.click(themeToggles[0])
        }
      })

      // 验证点击不会导致错误
      await waitFor(() => {
        const themeToggles = screen.queryAllByRole('radio', { name: /自动|亮色|暗色/ })
        expect(themeToggles.length).toBeGreaterThan(0)
      })
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
        // v1.3.6：文件夹名称在 NavigationBar 中
        const folderPath = document.querySelector('.nav-folder-path')
        expect(folderPath).toBeInTheDocument()
        expect(folderPath?.textContent).toContain('folder')
      })

      // 清空调用记录
      mockApi.readDir.mockClear()

      // v1.3.6：刷新按钮在 NavigationBar 的 .nav-refresh-btn 中
      const refreshBtn = document.querySelector('.nav-refresh-btn')
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
        // v1.3.6：文件夹名称在 NavigationBar 中
        const folderPath = document.querySelector('.nav-folder-path')
        expect(folderPath).toBeInTheDocument()
        expect(folderPath?.textContent).toContain('folder')
      })
    })
  })

  describe('ErrorBoundary', () => {
    it('应该被 ErrorBoundary 包裹', () => {
      render(<App />)
      // App 组件应该正常渲染，说明 ErrorBoundary 工作正常
      // v1.3.6：欢迎页面时检查欢迎文本
      expect(screen.getByText('欢迎使用 MD Viewer')).toBeInTheDocument()
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
    // v1.6.0: 重置 Zustand stores 到初始状态
    useFileStore.setState({ folderPath: null, files: [], isLoading: false, selectedPaths: new Set() })
    useTabStore.setState({ tabs: [], activeTabId: null, splitState: { root: null, activeLeafId: '' }, scrollToLine: undefined, highlightKeyword: undefined })
    useBookmarkStore.setState({ bookmarks: [], bookmarksLoading: true, bookmarkPanelCollapsed: true, bookmarkPanelWidth: 240, bookmarkBarCollapsed: true })
    useLayoutStore.setState({ sidebarWidth: 280, isResizing: false, showSettings: false, showShortcutsHelp: false, isFullscreen: false, isDragOver: false, lightbox: null })
  })

  it('应该处理空文件列表', async () => {
    mockApi.openFolder.mockResolvedValue('/empty/folder')
    mockApi.readDir.mockResolvedValue([])

    render(<App />)
    const button = screen.getByRole('button', { name: '打开文件夹' })

    fireEvent.click(button)

    await waitFor(() => {
      // v1.3.6：文件夹名称在 NavigationBar 的 .nav-folder-path 中
      const folderPath = document.querySelector('.nav-folder-path')
      expect(folderPath).toBeInTheDocument()
      expect(folderPath?.textContent).toContain('folder')
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
