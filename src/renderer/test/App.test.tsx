// @ts-nocheck - 测试文件的类型检查暂时跳过
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import App from '../src/App'
import { useFileStore } from '../src/stores/fileStore'
import { useTabStore } from '../src/stores/tabStore'
import { useBookmarkStore } from '../src/stores/bookmarkStore'
import { useLayoutStore } from '../src/stores/layoutStore'
import { useEditSessionStore } from '../src/stores/editSessionStore'
import { useQuickEditPlacementStore } from '../src/stores/quickEditPlacementStore'
import { useDocumentViewModeStore } from '../src/stores/documentViewModeStore'
import { useWorkspaceStore } from '../src/stores/workspaceStore'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

// Mock window.api
const folderActivation = (path: string) => ({
  id: `history:${path}`,
  path,
  name: path.split('/').filter(Boolean).pop() || 'folder',
  workspace: { id: 'test-workspace', primaryRoot: path, lifecycleEpoch: 1 },
})

const mockApi = {
  showWorkspaceContextMenu: vi.fn(),
  performWorkspaceBrowserAction: vi.fn().mockResolvedValue({}),
  listWorkspaceDirectory: vi.fn().mockResolvedValue([]),
  readWorkspaceResource: vi.fn(),
  openWorkspaceResource: vi.fn().mockResolvedValue({ success: false, cancelled: true }),
  getRecentFiles: vi.fn().mockResolvedValue([]),
  activateRecentFile: vi.fn(),
  activateBookmark: vi.fn(),
  getFolderTabSession: vi.fn().mockResolvedValue({ tabs: [] }),
  saveFolderTabSession: vi.fn().mockResolvedValue(undefined),
  openFolder: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  watchFolder: vi.fn().mockResolvedValue(undefined),
  unwatchFolder: vi.fn().mockResolvedValue(undefined),
  watchFile: vi.fn().mockResolvedValue(undefined),
  unwatchFile: vi.fn().mockResolvedValue(undefined),
  openEditableMarkdown: vi.fn(),
  saveEditableMarkdown: vi.fn(),
  exportHTML: vi.fn(),
  exportPDF: vi.fn(),
  searchReadFile: vi.fn(),
  showContextMenu: vi.fn().mockResolvedValue({ success: true }),
  renameFile: vi.fn().mockResolvedValue('/new/path'),
  createLinkImpact: vi.fn().mockResolvedValue({ impactId: 'impact-test', affectedSourceFiles: 0, exactChanges: 0, candidates: 0, items: [] }),
  executeLinkRewriteOperation: vi.fn().mockResolvedValue({
    newPath: '/new/path',
    receipt: { operationReceiptId: 'receipt-test' },
  }),
  createLinkRepairPlan: vi.fn().mockResolvedValue({ planId: 'plan-test', operationReceiptId: 'receipt-test', changes: [], warnings: [] }),
  applyLinkRepairPlan: vi.fn().mockResolvedValue({ planId: 'plan-test', files: [] }),
  discardLinkRepairPlan: vi.fn().mockResolvedValue(undefined),
  // v1.2 阶段 2：文件操作
  duplicatePath: vi.fn().mockResolvedValue({ newPath: '/test/folder/A copy.md' }),
  copyFile: vi.fn().mockResolvedValue('/new/path'),
  copyDir: vi.fn().mockResolvedValue('/new/path'),
  moveFile: vi.fn().mockResolvedValue('/new/path'),
  fileExists: vi.fn().mockResolvedValue(false),
  isDirectory: vi.fn().mockResolvedValue(false),
  onRestoreFolder: vi.fn(() => vi.fn()),
  onFileChanged: vi.fn(() => vi.fn()),
  onFileAdded: vi.fn(() => vi.fn()),
  onFileRemoved: vi.fn(() => vi.fn()),
  onWatchReconcile: vi.fn(() => vi.fn()),
  acknowledgeWatchReconcile: vi.fn().mockResolvedValue(true),
  notifyWatchGap: vi.fn().mockResolvedValue(true),
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
  onFileDuplicateRequest: vi.fn(() => vi.fn()),
  onFileMoveToRequest: vi.fn(() => vi.fn()),
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
  activateHistoryFolder: vi.fn().mockResolvedValue({ id: 'history-test', path: '/test', name: 'test' }),
  getFolderTreeState: vi.fn().mockResolvedValue({}),
  saveFolderTreeState: vi.fn().mockResolvedValue({}),
  clearFolderTreeState: vi.fn().mockResolvedValue(undefined),
  // v1.3.4：打开特定文件
  onOpenSpecificFile: vi.fn(() => vi.fn()),
  onFileOpenInSplit: vi.fn(() => vi.fn()),
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
  onShortcutToggleReadAloud: vi.fn(() => vi.fn()),
  onReadAloudFromLine: vi.fn(() => vi.fn()),
  ttsListVoices: vi.fn().mockResolvedValue([
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（女）', lang: 'zh-CN' }
  ]),
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
    bookmarkBarCollapsed: true,
    sidebarWidth: 280,
    sidebarCollapsed: false
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
  onQuickEditFromPreview: vi.fn(() => vi.fn()),
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
  openExternal: vi.fn().mockResolvedValue({ success: true }),
  getChartExamplesStatus: vi.fn().mockResolvedValue({
    state: 'ready',
    packageVersion: '2.8.0',
    appVersion: '2.8.0',
    bytes: 101139,
    caseCount: 93,
    rendererCount: 20,
    message: '内置离线示例包已就绪，无需联网。'
  }),
  installChartExamples: vi.fn().mockResolvedValue({ canceled: true }),
  saveChartExamples: vi.fn().mockResolvedValue({ canceled: true }),
  resolveMdLink: vi.fn().mockResolvedValue({ success: false, error: '文件不存在' }),
  openMdLink: vi.fn().mockResolvedValue({ success: true }),
  readLinkedAttachment: vi.fn(),
  prepareLinkedDocument: vi.fn(async request => {
    const result = await mockApi.resolveMdLink(request.source.filePath, request.href)
    if (!result.success) return { success: false, code: 'unavailable' }
    return { success: true, ...result, content: await mockApi.readFile(result.targetPath) ?? '',
      batchId: request.requestId, access: 'root' }
  }),
  prepareLinkedDocumentRefresh: vi.fn(),
  commitLinkedDocument: vi.fn().mockResolvedValue({ success: true }),
  cancelLinkedRead: vi.fn().mockResolvedValue(undefined),
  releaseLinkedReads: vi.fn().mockResolvedValue(undefined),
  revealLinkedResource: vi.fn().mockResolvedValue({ success: true }),
  openLocalAttachment: vi.fn().mockResolvedValue({ success: false, cancelled: true }),
  revealLocalResource: vi.fn().mockResolvedValue(undefined)
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

class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver
})

describe('App 集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
    // v1.6.0: 重置 Zustand stores 到初始状态
    useFileStore.setState({ folderPath: null, files: [], isLoading: false, selectedPaths: new Set() })
    useTabStore.setState({ tabs: [], activeTabId: null, splitState: { root: null, activeLeafId: '' }, scrollToLine: undefined, highlightKeyword: undefined })
    useBookmarkStore.setState({ bookmarks: [], bookmarksLoading: true, bookmarkPanelCollapsed: true, bookmarkPanelWidth: 240, bookmarkBarCollapsed: true })
    useLayoutStore.setState({ sidebarWidth: 280, sidebarCollapsed: false, isResizing: false, showSettings: false, showShortcutsHelp: false, isFullscreen: false, isDragOver: false, lightbox: null })
    useEditSessionStore.getState().reset()
    useQuickEditPlacementStore.getState().reset()
    useDocumentViewModeStore.getState().reset()
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, runtimes: {} })
    vi.stubGlobal('confirm', vi.fn(() => false))
    mockApi.onQuickEditFromPreview.mockImplementation(() => vi.fn())
    mockApi.openEditableMarkdown.mockResolvedValue({
      canonicalPath: '/real/test/folder/report.md',
      displayPath: '/test/folder/report.md',
      fileName: 'report.md',
      content: '# Report',
      mtimeMs: 1000,
      size: 8,
      revisionToken: '1000:8'
    })
    mockApi.saveEditableMarkdown.mockResolvedValue({ success: true, mtimeMs: 2000, size: 9, revisionToken: '2000:9' })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  describe('应用初始化', () => {
    it('应该渲染欢迎页面', () => {
      render(<App />)

      expect(screen.getByText('欢迎使用 MD Viewer')).toBeInTheDocument()
      expect(screen.getByText('一个简洁的 Markdown 预览工具')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '打开文件夹' })).toBeInTheDocument()
    })

    it('从欢迎页直达图表离线示例', async () => {
      render(<App />)

      fireEvent.click(screen.getByRole('button', { name: /图表与架构图/ }))

      expect(screen.getByRole('tab', { name: '图表', exact: true })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: /离线示例/ })).toHaveAttribute('aria-selected', 'true')
      await waitFor(() => {
        expect(screen.getByText('内置离线示例包已就绪，无需联网。')).toBeInTheDocument()
      })
    })

    it('在 renderer 已更新但 preload 仍旧时明确提示重启', async () => {
      const installChartExamples = mockApi.installChartExamples
      ;(mockApi as any).installChartExamples = undefined
      try {
        render(<App />)
        fireEvent.click(screen.getByRole('button', { name: /图表与架构图/ }))
        const openButton = await screen.findByRole('button', { name: '打开离线示例…' })
        await waitFor(() => expect(openButton).toBeEnabled())

        fireEvent.click(openButton)

        expect(await screen.findByText(
          '应用后台功能尚未更新，请完全退出并重新启动 MD Viewer 后再试。'
        )).toBeInTheDocument()
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      } finally {
        mockApi.installChartExamples = installChartExamples
      }
    })

    it('可以收起并恢复文件树侧栏且保留展开宽度', async () => {
      mockApi.getAppSettings.mockResolvedValue({
        imageDir: '', autoSave: false, bookmarkPanelWidth: 240,
        bookmarkPanelCollapsed: true, bookmarkBarCollapsed: true,
        sidebarWidth: 360, sidebarCollapsed: false
      })
      mockApi.readDir.mockResolvedValue([])
      useFileStore.setState({
        folderPath: '/test/folder',
        files: [],
        isLoading: false,
        selectedPaths: new Set()
      })
      const { container } = render(<App />)

      const collapseButton = await screen.findByRole('button', { name: '隐藏文件树' })
      await waitFor(() => expect(useLayoutStore.getState().sidebarWidth).toBe(360))
      let sidebar = document.querySelector('.sidebar') as HTMLElement
      expect(collapseButton).toHaveAttribute('aria-pressed', 'true')
      expect(sidebar.style.width).toBe('360px')
      expect(document.querySelector('#file-tree-panel')).toBeInTheDocument()
      expect(document.querySelector('.resize-handle')).toBeInTheDocument()

      fireEvent.click(collapseButton)
      expect(screen.getByRole('button', { name: '显示文件树' })).toHaveAttribute('aria-pressed', 'false')
      expect(document.querySelector('.sidebar')).not.toBeInTheDocument()
      expect(document.querySelector('#file-tree-panel')).not.toBeInTheDocument()
      expect(document.querySelector('.resize-handle')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '显示文件树' }))
      sidebar = document.querySelector('.sidebar') as HTMLElement
      expect(sidebar).toBeInTheDocument()
      expect(sidebar.style.width).toBe('360px')
      expect(mockApi.updateAppSettings).toHaveBeenCalledWith({ sidebarCollapsed: true })
      expect(mockApi.updateAppSettings).toHaveBeenCalledWith({ sidebarCollapsed: false })
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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

      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
      mockApi.readDir.mockResolvedValue(mockFiles)

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.readDir).toHaveBeenCalledWith('/test/folder')
      })
    })

    it('切换文件夹时应该保留已固定标签', async () => {
      useTabStore.setState({
        tabs: [{
          id: 'pinned-old',
          file: { name: 'old.md', path: '/old/folder/old.md', isDirectory: false },
          content: '# Old',
          isPinned: true
        }],
        activeTabId: 'pinned-old',
        splitState: { root: null, activeLeafId: '' },
        scrollToLine: undefined,
        scrollToRatio: undefined,
        highlightKeyword: undefined
      })
      mockApi.openFolder.mockResolvedValue(folderActivation('/new/folder'))
      mockApi.readDir.mockResolvedValue([
        { name: 'new.md', path: '/new/folder/new.md', isDirectory: false }
      ])
      mockApi.getPinnedTabsForFolder.mockResolvedValueOnce([
        { path: '/new/folder/new.md', order: 0 }
      ])
      mockApi.readFile.mockResolvedValueOnce('# New')

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }))

      await waitFor(() => {
        const tabs = useTabStore.getState().tabs
        expect(tabs.some(tab => tab.file.path === '/old/folder/old.md' && tab.isPinned)).toBe(true)
        expect(tabs.some(tab => tab.file.path === '/new/folder/new.md' && tab.isPinned)).toBe(true)
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/my-folder'))
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

  describe('异步目录恢复的导航边界', () => {

    it('首次目录读取等待逻辑监听注册，接收端先于注册请求安装', async () => {
      let finish!: () => void
      mockApi.watchFolder.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ success: true }) }))
      mockApi.readDir.mockResolvedValue([])
      useWorkspaceStore.setState({ activeWorkspaceId: 'test-workspace', workspaces: [{ id: 'test-workspace', name: 'Startup', primaryRoot: '/test/folder', lifecycleEpoch: 1 }] })
      useFileStore.setState({ folderPath: '/test/folder' })
      try {
        render(<App />)
        await waitFor(() => expect(mockApi.watchFolder).toHaveBeenCalled())
        expect(mockApi.onWatchReconcile).toHaveBeenCalledTimes(1)
        expect(mockApi.onWatchReconcile.mock.invocationCallOrder[0]).toBeLessThan(mockApi.watchFolder.mock.invocationCallOrder[0])
        expect(mockApi.readDir).not.toHaveBeenCalled()
        await act(async () => { finish() })
        await waitFor(() => expect(mockApi.readDir).toHaveBeenCalledWith('/test/folder'))
      } finally { mockApi.watchFolder.mockResolvedValue(undefined) }
    })

    it('注册同根已有索引监听时立即到达的补查也有接收端并准确应答', async () => {
      mockApi.readDir.mockResolvedValue([])
      useWorkspaceStore.setState({ activeWorkspaceId: 'test-workspace', workspaces: [{ id: 'test-workspace', name: 'Startup', primaryRoot: '/test/folder', lifecycleEpoch: 1 }] })
      useFileStore.setState({ folderPath: '/test/folder' })
      let receiverReady = false
      mockApi.watchFolder.mockImplementation(async () => {
        const receive = mockApi.onWatchReconcile.mock.calls.at(-1)?.[0]
        receiverReady = typeof receive === 'function'
        receive?.({ workspaceId: 'test-workspace', lifecycleEpoch: 1, requestId: 'early-reconcile', phase: 'refresh' })
        return { success: true }
      })
      try {
        render(<App />)
        await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('early-reconcile', 'ok'))
        expect(receiverReady).toBe(true)
      } finally { mockApi.watchFolder.mockResolvedValue(undefined) }
    })

    it('启动快照迟到时保留已激活的新根和初始文件', async () => {
      let finishBootstrap!: (value: unknown) => void
      mockApi.getWorkspaceBootstrap = vi.fn(() => new Promise(resolve => { finishBootstrap = resolve }))
      mockApi.onWorkspaceFolderActivated = vi.fn(() => vi.fn())
      mockApi.readDir.mockResolvedValue([{ name: 'initial.md', path: '/test/folder/initial.md', isDirectory: false }])
      mockApi.readFile.mockResolvedValue('# Initial')
      mockApi.getPinnedTabsForFolder.mockResolvedValue([])
      try {
        render(<App />)
        const activation = folderActivation('/test/folder')
        activation.workspace.lifecycleEpoch = 2
        await act(async () => {
          mockApi.onWorkspaceFolderActivated.mock.calls.at(-1)[0]({ workspaceId: activation.workspace.id, path: activation.path, lifecycleEpoch: 2 })
          await mockApi.onRestoreFolder.mock.calls.at(-1)[0]({ ...activation, initialFileRelativePath: 'initial.md' })
        })
        const activeId = useTabStore.getState().activeTabId
        await act(async () => finishBootstrap({ workspaces: [{ id: activation.workspace.id, primaryRoot: null, lifecycleEpoch: 1 }], activeWorkspaceId: activation.workspace.id }))
        expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({ primaryRoot: '/test/folder', lifecycleEpoch: 2 })
        expect(useFileStore.getState().folderPath).toBe('/test/folder')
        expect(useTabStore.getState().activeTabId).toBe(activeId)
        await waitFor(() => expect(mockApi.readDir.mock.calls.some(([path]) => path === '/test/folder')).toBe(true))
      } finally {
        delete mockApi.getWorkspaceBootstrap
        delete mockApi.onWorkspaceFolderActivated
      }
    })

    it('目录恢复事件直接交付根内初始文件，不依赖延迟裸路径事件', async () => {
      mockApi.readDir.mockResolvedValue([])
      mockApi.readFile.mockResolvedValue('# Initial')
      mockApi.getPinnedTabsForFolder.mockResolvedValue([])
      render(<App />)
      await act(async () => {
        await mockApi.onRestoreFolder.mock.calls.at(-1)[0]({
          ...folderActivation('/test/folder'), initialFileRelativePath: 'nested/initial.md',
        })
      })
      expect(useTabStore.getState().tabs.find(tab => tab.id === useTabStore.getState().activeTabId)?.file.path).toBe('/test/folder/nested/initial.md')
    })

    it.each([false, true])('跨根分屏existing=%s时以当前epoch登记文件监听', async existing => {
      mockApi.readDir.mockResolvedValue([])
      mockApi.readFile.mockResolvedValue('# Document')
      mockApi.getPinnedTabsForFolder.mockResolvedValue([])
      render(<App />)
      const restore = (path: string, initialFileRelativePath: string, lifecycleEpoch: number) =>
        mockApi.onRestoreFolder.mock.calls.at(-1)[0]({
          ...folderActivation(path), initialFileRelativePath,
          workspace: { id: 'test-workspace', primaryRoot: path, lifecycleEpoch },
        })
      if (existing) await act(async () => { await restore('/test/other', 'cross.md', 1) })
      await act(async () => { await restore('/test/folder', 'a.md', 2) })
      const reads = mockApi.readFile.mock.calls.length
      const previousTab = useTabStore.getState().tabs.find(tab => tab.file.path === '/test/other/cross.md')
      mockApi.watchFile.mockClear()
      await act(async () => {
        await mockApi.onFileOpenInSplit.mock.calls.at(-1)[0]({ filePath: '/test/other/cross.md', direction: 'horizontal' })
      })
      expect(mockApi.watchFile).toHaveBeenCalledExactlyOnceWith('/test/other/cross.md', 'test-workspace', 2)
      if (existing) {
        expect(useTabStore.getState().tabs.find(tab => tab.file.path === '/test/other/cross.md')?.id).toBe(previousTab.id)
        expect(mockApi.readFile).toHaveBeenCalledTimes(reads)
      }
    })

    it('初始文件等待固定标签期间选择B，旧初始文件不重新领取导航意图', async () => {
      mockApi.readDir.mockResolvedValue([])
      mockApi.readFile.mockResolvedValue('# Newer')
      let release!: (value: unknown[]) => void
      mockApi.getPinnedTabsForFolder.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
      render(<App />)
      act(() => { void mockApi.onRestoreFolder.mock.calls.at(-1)[0]({
        ...folderActivation('/test/folder'), initialFileRelativePath: 'initial.md',
      }) })
      await waitFor(() => expect(mockApi.getPinnedTabsForFolder).toHaveBeenCalled())
      await act(async () => { await mockApi.onOpenSpecificFile.mock.calls.at(-1)[0]('/test/folder/newer.md') })
      const before = useTabStore.getState()
      await act(async () => release([]))
      expect(useTabStore.getState().tabs).toEqual(before.tabs)
      expect(useTabStore.getState().activeTabId).toBe(before.activeTabId)
      expect(mockApi.readFile).not.toHaveBeenCalledWith('/test/folder/initial.md', expect.anything())
      mockApi.getPinnedTabsForFolder.mockResolvedValue([])
    })

    it.each(['session', 'pinned', 'fallback'])('迟到的%s恢复不能覆盖之后明确选择的文档', async stage => {
      const activation = folderActivation('/test/folder')
      useWorkspaceStore.getState().upsertWorkspace({ ...activation.workspace, name: 'folder' })
      useWorkspaceStore.getState().setActiveWorkspaceId(activation.workspace.id)
      mockApi.openFolder.mockResolvedValue(activation)
      mockApi.readDir.mockResolvedValue([])
      mockApi.readFile.mockResolvedValue('# Newer')
      let release!: (value: unknown) => void
      let reject!: (error: Error) => void
      const pending = new Promise((resolve, fail) => { release = resolve; reject = fail })
      mockApi.getFolderTabSession.mockResolvedValue({ tabs: [] })
      mockApi.getPinnedTabsForFolder.mockResolvedValue([])
      if (stage === 'pinned') mockApi.getPinnedTabsForFolder.mockReturnValueOnce(pending)
      else mockApi.getFolderTabSession.mockReturnValueOnce(pending)
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }))
      await waitFor(() => expect(stage === 'pinned' ? mockApi.getPinnedTabsForFolder : mockApi.getFolderTabSession).toHaveBeenCalled())
      await act(async () => {
        await mockApi.onOpenSpecificFile.mock.calls.at(-1)[0]('/test/folder/newer.md')
      })
      await waitFor(() => expect(useTabStore.getState().tabs.some(tab => tab.file.name === 'newer.md')).toBe(true))
      const before = useTabStore.getState()
      mockApi.getPinnedTabsForFolder.mockResolvedValue([{ path: '/test/folder/old.md' }])
      await act(async () => {
        if (stage === 'fallback') reject(new Error('fixture delayed failure'))
        else release(stage === 'session' ? { tabs: [{ path: '/test/folder/old.md' }], activePath: '/test/folder/old.md' } : [{ path: '/test/folder/old.md' }])
      })
      expect(useTabStore.getState().tabs).toEqual(before.tabs)
      expect(useTabStore.getState().activeTabId).toBe(before.activeTabId)
      expect(useTabStore.getState().splitState).toEqual(before.splitState)
      mockApi.getFolderTabSession.mockResolvedValue({ tabs: [] })
      mockApi.getPinnedTabsForFolder.mockResolvedValue([])
    })

    it.each(['workspace', 'epoch', 'unmount'])('%s改变后不提交旧恢复事件的固定标签', async change => {
      const activation = folderActivation('/test/folder')
      useWorkspaceStore.getState().upsertWorkspace({ ...activation.workspace, name: 'folder' })
      useWorkspaceStore.getState().setActiveWorkspaceId(activation.workspace.id)
      let release!: (tabs: unknown[]) => void
      mockApi.getPinnedTabsForFolder.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
      const { unmount } = render(<App />)
      act(() => { void mockApi.onRestoreFolder.mock.calls.at(-1)[0](activation) })
      await waitFor(() => expect(mockApi.getPinnedTabsForFolder).toHaveBeenCalled())
      if (change === 'unmount') unmount()
      else act(() => {
        const workspace = change === 'workspace'
          ? { id: 'other', name: 'other', primaryRoot: '/other', lifecycleEpoch: 1 }
          : { ...activation.workspace, name: 'folder', lifecycleEpoch: 2 }
        useWorkspaceStore.getState().upsertWorkspace(workspace)
        useWorkspaceStore.getState().setActiveWorkspaceId(workspace.id)
      })
      const before = useTabStore.getState()
      await act(async () => release([{ path: '/test/folder/old.md' }]))
      expect(useTabStore.getState().tabs).toEqual(before.tabs)
      expect(useTabStore.getState().activeTabId).toBe(before.activeTabId)
      mockApi.getPinnedTabsForFolder.mockResolvedValue([])
    })
  })

  describe('已打开文件刷新', () => {
    it('再次选择已打开文件时应该重新读取磁盘最新内容', async () => {
      const file = { name: 'test-excalidraw.md', path: '/test/folder/test-excalidraw.md', isDirectory: false }
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
      mockApi.readDir.mockResolvedValue([file])
      mockApi.readFile
        .mockResolvedValueOnce('# 旧内容')
        .mockResolvedValueOnce('# 新内容')

      render(<App />)

      fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }))

      const fileName = await screen.findByText('test-excalidraw.md')
      fireEvent.click(fileName)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: '旧内容' })).toBeInTheDocument()
      })

      fireEvent.click(fileName)

      await waitFor(() => {
        expect(mockApi.readFile).toHaveBeenCalledTimes(2)
        expect(screen.getByRole('heading', { name: '新内容' })).toBeInTheDocument()
      })
    })
  })

  describe('Markdown 编辑模式', () => {
    it('快速编辑此处应该进入对照预览编辑工作区', async () => {
      let quickEditHandler: ((target: any) => void) | undefined
      const file = { name: 'report.md', path: '/test/folder/report.md', isDirectory: false }
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
      mockApi.readDir.mockResolvedValue([file])
      mockApi.readFile.mockResolvedValue('# Report')
      mockApi.onQuickEditFromPreview.mockImplementation((handler) => {
        quickEditHandler = handler
        return vi.fn()
      })

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }))

      const fileName = await screen.findByText('report.md')
      fireEvent.click(fileName)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Report' })).toBeInTheDocument()
      })

      await act(async () => {
        quickEditHandler?.({
          filePath: '/test/folder/report.md',
          mode: 'source-line',
          sourceLine: 1,
        })
      })

      await waitFor(() => {
        expect(mockApi.openEditableMarkdown).toHaveBeenCalledWith('/test/folder/report.md', { workspaceId: 'test-workspace', lifecycleEpoch: 1 })
        expect(screen.getByLabelText('report.md 编辑工作区')).toBeInTheDocument()
      })
    })
  })

  describe('文件监听功能 (v1.1)', () => {
    it('打开文件夹后应该启动文件监听', async () => {
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
      mockApi.readDir.mockResolvedValue([])
      mockApi.watchFolder.mockResolvedValue(undefined)

      render(<App />)
      const button = screen.getByRole('button', { name: '打开文件夹' })

      fireEvent.click(button)

      await waitFor(() => {
        expect(mockApi.readDir).toHaveBeenCalledWith('/test/folder')
      })

      await waitFor(() => {
        expect(mockApi.watchFolder).toHaveBeenCalledWith('/test/folder', 'test-workspace', 1)
      }, { timeout: 3000 })
    })

    it('应该注册文件变化监听器', async () => {
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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

    it('已打开 Markdown 文件收到外部修改事件后应该自动读取磁盘最新内容', async () => {
      let fileChangedHandler: ((event: string) => Promise<void>) | undefined
      const file = { name: 'live.md', path: '/test/folder/live.md', isDirectory: false }
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
      mockApi.readDir.mockResolvedValue([file])
      mockApi.watchFolder.mockResolvedValue({ success: true })
      mockApi.onFileChanged.mockImplementation((handler) => {
        fileChangedHandler = handler
        return vi.fn()
      })
      mockApi.readFile
        .mockResolvedValueOnce('# 旧内容')
        .mockResolvedValueOnce('# 新内容')

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }))

      const fileName = await screen.findByText('live.md')
      fireEvent.click(fileName)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: '旧内容' })).toBeInTheDocument()
      })

      await act(async () => {
        await fileChangedHandler?.({ workspaceId: 'test-workspace', lifecycleEpoch: 1, path: '/test/folder/live.md' })
      })

      await waitFor(() => {
        expect(mockApi.readFile).toHaveBeenCalledTimes(2)
        expect(screen.getByRole('heading', { name: '新内容' })).toBeInTheDocument()
      })
    })

    it('编辑器输入仍在防抖窗口时外部修改不得覆盖本地输入', async () => {
      let fileChangedHandler: ((event: { workspaceId: string; lifecycleEpoch: number; path: string }) => Promise<void>) | undefined
      const file = { name: 'live.md', path: '/test/folder/live.md', isDirectory: false }
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
      mockApi.readDir.mockResolvedValue([file])
      mockApi.watchFolder.mockResolvedValue({ success: true })
      mockApi.onFileChanged.mockImplementation((handler) => {
        fileChangedHandler = handler
        return vi.fn()
      })
      mockApi.readFile.mockResolvedValue('# 旧内容')

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }))
      fireEvent.click(await screen.findByText('live.md'))
      await screen.findByRole('heading', { name: '旧内容' })

      act(() => {
        useEditSessionStore.getState().openSession({
          canonicalPath: '/real/test/folder/live.md',
          displayPath: file.path,
          fileName: file.name,
          content: '# 旧内容',
          mtimeMs: 1000,
          revisionToken: '1000:8',
          workspaceId: 'test-workspace',
          lifecycleEpoch: 1,
        })
        useEditSessionStore.getState().setPendingInput('/real/test/folder/live.md', true)
      })

      await act(async () => {
        await fileChangedHandler?.({ workspaceId: 'test-workspace', lifecycleEpoch: 1, path: file.path })
      })

      const session = useEditSessionStore.getState().sessions['/real/test/folder/live.md']
      expect(session.conflictReason).toBe('external_changed')
      expect(session.pendingInput).toBe(true)
      expect(mockApi.readFile).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('heading', { name: '旧内容' })).toBeInTheDocument()
    })

    it.each(['during-refresh', 'before-drain'])('补查快照之后丢事件必须 ACK superseded：%s', async phase => {
      let reconcileHandler: any
      let addedHandler: any
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
      mockApi.readDir.mockResolvedValue([])
      mockApi.watchFolder.mockResolvedValue({ success: true })
      mockApi.onWatchReconcile.mockImplementation(handler => { reconcileHandler = handler; return vi.fn() })
      mockApi.onFileAdded.mockImplementation(handler => { addedHandler = handler; return vi.fn() })
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }))
      await waitFor(() => expect(reconcileHandler).toBeDefined())
      const request = { workspaceId: 'test-workspace', lifecycleEpoch: 1 }
      let release: ((files: any[]) => void) | undefined
      if (phase === 'during-refresh') mockApi.readDir.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      await act(async () => { reconcileHandler({ ...request, requestId: 'refresh-1', phase: 'refresh' }) })
      if (phase === 'during-refresh') await waitFor(() => expect(release).toBeDefined())
      else await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('refresh-1', 'ok'))
      await act(async () => {
        for (let i = 0; i < 140; i++) addedHandler({ ...request, path: `/test/folder/new-${i}.md` })
        release?.([])
      })
      expect(mockApi.notifyWatchGap).toHaveBeenCalledTimes(1)
      if (phase === 'during-refresh') {
        await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('refresh-1', 'superseded'))
      } else {
        await act(async () => { reconcileHandler({ ...request, requestId: 'drain-1', phase: 'drain' }) })
        await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('drain-1', 'superseded'))
      }
      await act(async () => { reconcileHandler({ ...request, requestId: 'refresh-2', phase: 'refresh' }) })
      await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('refresh-2', 'ok'))
      await act(async () => { reconcileHandler({ ...request, requestId: 'drain-2', phase: 'drain' }) })
      await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('drain-2', 'ok'))
      expect(mockApi.notifyWatchGap).toHaveBeenCalledTimes(1)
    })

    it('补查在途切根后不成功 ACK 旧工作区，也不覆盖新文件树', async () => {
      let reconcileHandler: any
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
      mockApi.readDir.mockResolvedValue([])
      mockApi.watchFolder.mockResolvedValue({ success: true })
      mockApi.onWatchReconcile.mockImplementation(handler => { reconcileHandler = handler; return vi.fn() })
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }))
      await waitFor(() => expect(reconcileHandler).toBeDefined())
      let release!: (files: any[]) => void
      mockApi.readDir.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      await act(async () => { reconcileHandler({ workspaceId: 'test-workspace', lifecycleEpoch: 1, requestId: 'old-refresh', phase: 'refresh' }) })
      await waitFor(() => expect(release).toBeDefined())
      await act(async () => {
        useWorkspaceStore.setState({ activeWorkspaceId: 'other', workspaces: [{ id: 'other', primaryRoot: '/other', lifecycleEpoch: 2 }] })
        useFileStore.setState({ folderPath: '/other', files: [] })
        release([{ name: 'stale.md', path: '/test/folder/stale.md', isDirectory: false }])
      })
      await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('old-refresh', 'superseded'))
      expect(useFileStore.getState().files.some(file => file.name === 'stale.md')).toBe(false)
    })

    it('文件监听失败时应该记录错误', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      mockApi.openFolder.mockResolvedValue(folderActivation('/test/folder'))
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
      let capturedCallback: (activation: ReturnType<typeof folderActivation>) => void = () => {}
      mockApi.onRestoreFolder.mockImplementation((cb) => {
        capturedCallback = cb
        return vi.fn()
      })
      mockApi.readDir.mockResolvedValue([])

      render(<App />)

      // 模拟恢复文件夹
      act(() => {
        capturedCallback(folderActivation('/restored/folder'))
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

  describe('快速编辑', () => {
    beforeEach(() => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'test-workspace', name: '测试工作区', primaryRoot: '/test/folder', lifecycleEpoch: 1 }],
        activeWorkspaceId: 'test-workspace',
        runtimes: {},
      })
      useFileStore.setState({
        folderPath: '/test/folder',
        files: [{ name: 'report.md', path: '/test/folder/report.md', isDirectory: false }],
        isLoading: false,
        selectedPaths: new Set()
      })
      useTabStore.setState({
        tabs: [{
          id: 'tab-1',
          file: { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
          content: '# Report'
        }],
        activeTabId: 'tab-1',
        splitState: { root: null, activeLeafId: '' },
        scrollToLine: undefined,
        highlightKeyword: undefined
      })
    })

    it('不应该在正文区显示快速编辑按钮', () => {
      render(<App />)

      expect(screen.queryByRole('button', { name: '快速编辑 report.md' })).not.toBeInTheDocument()
    })

    it('应该通过预览区右键菜单事件进入对照预览编辑工作区', async () => {
      let quickEditCallback: (params: { filePath: string }) => void = () => {}
      mockApi.onQuickEditFromPreview.mockImplementation((callback) => {
        quickEditCallback = callback
        return vi.fn()
      })

      render(<App />)

      act(() => {
        quickEditCallback({ filePath: '/test/folder/report.md' })
      })

      await waitFor(() => {
        expect(mockApi.openEditableMarkdown).toHaveBeenCalledWith('/test/folder/report.md', { workspaceId: 'test-workspace', lifecycleEpoch: 1 })
      })
      expect(await screen.findByLabelText('report.md 编辑工作区')).toBeInTheDocument()
      expect(await screen.findByLabelText('Markdown 源码编辑区')).toBeInTheDocument()
    })

    it('保存快速编辑后应该更新当前标签内容', async () => {
      render(<App />)

      act(() => {
        const callback = mockApi.onQuickEditFromPreview.mock.calls[0][0]
        callback({ filePath: '/test/folder/report.md' })
      })
      await screen.findByLabelText('Markdown 源码编辑区')

      act(() => {
        useEditSessionStore.getState().updateDraft('/real/test/folder/report.md', '# Changed')
      })
      fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

      await waitFor(() => {
        expect(mockApi.saveEditableMarkdown).toHaveBeenCalledWith({
          canonicalPath: '/real/test/folder/report.md',
          content: '# Changed',
          expectedRevisionToken: '1000:8',
          workspace: { workspaceId: 'test-workspace', lifecycleEpoch: 1 },
          force: false
        })
      })
      expect(useTabStore.getState().tabs[0].content).toBe('# Changed')
      expect(useEditSessionStore.getState().sessions['/real/test/folder/report.md'].dirty).toBe(false)
    })

    it('编辑快速草稿时应该实时更新预览并显示草稿状态', async () => {
      render(<App />)

      act(() => {
        const callback = mockApi.onQuickEditFromPreview.mock.calls[0][0]
        callback({ filePath: '/test/folder/report.md' })
      })
      await screen.findByLabelText('Markdown 源码编辑区')

      act(() => {
        useEditSessionStore.getState().updateDraft('/real/test/folder/report.md', '# Draft Preview')
      })

      expect(await screen.findByText('草稿预览，未保存到磁盘')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getByText('Draft Preview')).toBeInTheDocument()
      })
    })

    it('退出编辑模式应该回到普通预览', async () => {
      render(<App />)

      act(() => {
        const callback = mockApi.onQuickEditFromPreview.mock.calls[0][0]
        callback({ filePath: '/test/folder/report.md' })
      })

      expect(await screen.findByLabelText('report.md 编辑工作区')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '退出编辑模式' }))

      await waitFor(() => {
        expect(screen.queryByLabelText('report.md 编辑工作区')).not.toBeInTheDocument()
      })
      expect(screen.queryByRole('button', { name: '编辑文档' })).not.toBeInTheDocument()
    })

    it('存在未保存编辑草稿时取消切换标签应该留在当前标签', () => {
      useTabStore.setState({
        tabs: [
          {
            id: 'tab-1',
            file: { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
            content: '# Report'
          },
          {
            id: 'tab-2',
            file: { name: 'other.md', path: '/test/folder/other.md', isDirectory: false },
            content: '# Other'
          }
        ],
        activeTabId: 'tab-1',
        splitState: { root: null, activeLeafId: '' },
        scrollToLine: undefined,
        highlightKeyword: undefined
      })
      useEditSessionStore.getState().openSession({
        canonicalPath: '/real/test/folder/report.md',
        displayPath: '/test/folder/report.md',
        fileName: 'report.md',
        content: '# Report',
        mtimeMs: 1000,
        size: 8,
        revisionToken: '1000:8'
      })
      useEditSessionStore.getState().updateDraft('/real/test/folder/report.md', '# Unsaved')
      vi.mocked(window.confirm).mockReturnValue(false)

      render(<App />)

      fireEvent.click(screen.getByText('other.md'))

      expect(window.confirm).toHaveBeenCalledWith('当前文档有未保存编辑草稿，离开后草稿会保留但尚未写入磁盘。是否继续？')
      expect(useTabStore.getState().activeTabId).toBe('tab-1')
    })

    it('存在未保存编辑草稿时确认后允许切换标签', () => {
      useTabStore.setState({
        tabs: [
          {
            id: 'tab-1',
            file: { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
            content: '# Report'
          },
          {
            id: 'tab-2',
            file: { name: 'other.md', path: '/test/folder/other.md', isDirectory: false },
            content: '# Other'
          }
        ],
        activeTabId: 'tab-1',
        splitState: { root: null, activeLeafId: '' },
        scrollToLine: undefined,
        highlightKeyword: undefined
      })
      useEditSessionStore.getState().openSession({
        canonicalPath: '/real/test/folder/report.md',
        displayPath: '/test/folder/report.md',
        fileName: 'report.md',
        content: '# Report',
        mtimeMs: 1000,
        size: 8,
        revisionToken: '1000:8'
      })
      useEditSessionStore.getState().updateDraft('/real/test/folder/report.md', '# Unsaved')
      vi.mocked(window.confirm).mockReturnValue(true)

      render(<App />)

      fireEvent.click(screen.getByText('other.md'))

      expect(useTabStore.getState().activeTabId).toBe('tab-2')
    })

    it('脏草稿离开确认后目标文件尚在加载时重复触发同一导航不应重复提醒', async () => {
      const files = [
        { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
        { name: 'other.md', path: '/test/folder/other.md', isDirectory: false }
      ]
      mockApi.readDir.mockResolvedValue(files)
      useFileStore.setState({
        folderPath: '/test/folder',
        files,
        isLoading: false,
        selectedPaths: new Set()
      })
      useTabStore.setState({
        tabs: [
          {
            id: 'tab-1',
            file: { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
            content: '# Report'
          }
        ],
        activeTabId: 'tab-1',
        splitState: { root: null, activeLeafId: '' },
        scrollToLine: undefined,
        highlightKeyword: undefined
      })
      useEditSessionStore.getState().openSession({
        canonicalPath: '/real/test/folder/report.md',
        displayPath: '/test/folder/report.md',
        fileName: 'report.md',
        content: '# Report',
        mtimeMs: 1000,
        size: 8,
        revisionToken: '1000:8'
      })
      useEditSessionStore.getState().updateDraft('/real/test/folder/report.md', '# Unsaved')
      vi.mocked(window.confirm).mockReturnValue(true)

      let resolveReadFile: (content: string) => void = () => {}
      mockApi.readFile.mockImplementation(() => new Promise(resolve => {
        resolveReadFile = resolve
      }))

      render(<App />)

      const targetFile = await screen.findByText('other.md')
      fireEvent.click(targetFile)
      fireEvent.click(targetFile)

      expect(window.confirm).toHaveBeenCalledTimes(1)
      expect(mockApi.readFile).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveReadFile('# Other')
      })
    })

    it('点击内部 Markdown 链接时取消未保存草稿确认不应打开目标文件', async () => {
      const files = [
        { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
        { name: 'other.md', path: '/test/folder/other.md', isDirectory: false }
      ]
      mockApi.readDir.mockResolvedValue(files)
      mockApi.readFile.mockResolvedValueOnce('# Other')
      mockApi.resolveMdLink.mockResolvedValue({
        success: true,
        targetPath: '/test/folder/other.md',
      })
      useFileStore.setState({
        folderPath: '/test/folder',
        files,
        isLoading: false,
        selectedPaths: new Set()
      })
      useTabStore.setState({
        tabs: [
          {
            id: 'tab-1',
            file: { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
            content: '# Report\n\n[打开目标](./other.md)'
          }
        ],
        activeTabId: 'tab-1',
        splitState: { root: null, activeLeafId: '' },
        scrollToLine: undefined,
        highlightKeyword: undefined
      })
      useEditSessionStore.getState().openSession({
        canonicalPath: '/real/test/folder/report.md',
        displayPath: '/test/folder/report.md',
        fileName: 'report.md',
        content: '# Report\n\n[打开目标](./other.md)',
        mtimeMs: 1000,
        size: 29,
        revisionToken: '1000:29'
      })
      useEditSessionStore.getState().updateDraft('/real/test/folder/report.md', '# Report\n\n[打开目标](./other.md)\n\n未保存草稿')
      vi.mocked(window.confirm).mockReturnValue(false)

      render(<App />)

      fireEvent.click(await screen.findByRole('link', { name: '打开目标' }))

      await waitFor(() => {
        expect(mockApi.resolveMdLink).toHaveBeenCalledWith('/test/folder/report.md', './other.md')
      })
      await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1))
      expect(mockApi.openMdLink).not.toHaveBeenCalled()
      expect(mockApi.commitLinkedDocument).not.toHaveBeenCalled()
      expect(mockApi.releaseLinkedReads).toHaveBeenCalled()
      expect(useTabStore.getState().activeTabId).toBe('tab-1')
    })

    it('点击内部 Markdown 链接时确认未保存草稿后应打开目标文件', async () => {
      const files = [
        { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
        { name: 'other.md', path: '/test/folder/other.md', isDirectory: false }
      ]
      mockApi.readDir.mockResolvedValue(files)
      mockApi.resolveMdLink.mockResolvedValue({
        success: true,
        targetPath: '/test/folder/other.md',
        targetLine: 3,
        headingId: '目标章节',
      })
      mockApi.readFile.mockResolvedValue('# Other\n\n## 目标章节\n\n内容')
      useFileStore.setState({
        folderPath: '/test/folder',
        files,
        isLoading: false,
        selectedPaths: new Set()
      })
      useTabStore.setState({
        tabs: [
          {
            id: 'tab-1',
            file: { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
            content: '# Report\n\n[打开目标](./other.md#目标章节)'
          }
        ],
        activeTabId: 'tab-1',
        splitState: { root: null, activeLeafId: '' },
        scrollToLine: undefined,
        highlightKeyword: undefined
      })
      useEditSessionStore.getState().openSession({
        canonicalPath: '/real/test/folder/report.md',
        displayPath: '/test/folder/report.md',
        fileName: 'report.md',
        content: '# Report\n\n[打开目标](./other.md#目标章节)',
        mtimeMs: 1000,
        size: 34,
        revisionToken: '1000:34'
      })
      useEditSessionStore.getState().updateDraft('/real/test/folder/report.md', '# Report\n\n[打开目标](./other.md#目标章节)\n\n未保存草稿')
      vi.mocked(window.confirm).mockReturnValue(true)

      render(<App />)

      fireEvent.click(await screen.findByRole('link', { name: '打开目标' }))

      await waitFor(() => {
        expect(mockApi.readFile).toHaveBeenCalledWith('/test/folder/other.md')
        expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: '返回来源：report.md' }).length).toBeGreaterThan(0)
      })
      expect(window.confirm).toHaveBeenCalledTimes(1)
      expect(useTabStore.getState().tabs.some(tab => tab.file.path === '/test/folder/other.md')).toBe(true)
    })

    it('点击不存在的内部 Markdown 链接应该显示错误提示且不离开当前文件', async () => {
      const files = [
        { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
      ]
      mockApi.readDir.mockResolvedValue(files)
      mockApi.resolveMdLink.mockResolvedValue({ success: false, error: '文件不存在' })
      useFileStore.setState({
        folderPath: '/test/folder',
        files,
        isLoading: false,
        selectedPaths: new Set()
      })
      useTabStore.setState({
        tabs: [
          {
            id: 'tab-1',
            file: { name: 'report.md', path: '/test/folder/report.md', isDirectory: false },
            content: '# Report\n\n[缺失文档](./missing.md)'
          }
        ],
        activeTabId: 'tab-1',
        splitState: { root: null, activeLeafId: '' },
        scrollToLine: undefined,
        highlightKeyword: undefined
      })

      render(<App />)

      fireEvent.click(await screen.findByRole('link', { name: '缺失文档' }))

      await waitFor(() => {
        expect(screen.getByText('链接跳转失败：文件不存在、不可读取或属于受保护路径。')).toBeInTheDocument()
      })
      expect(window.confirm).not.toHaveBeenCalled()
      expect(useTabStore.getState().activeTabId).toBe('tab-1')
    })

    it('存在未保存快速编辑草稿时应该拦截导出 HTML', async () => {
      let exportHtmlCallback: () => Promise<void> | void = () => {}
      mockApi.onShortcutExportHTML.mockImplementation((callback) => {
        exportHtmlCallback = callback
        return vi.fn()
      })

      render(<App />)

      act(() => {
        const callback = mockApi.onQuickEditFromPreview.mock.calls[0][0]
        callback({ filePath: '/test/folder/report.md' })
      })
      await screen.findByLabelText('Markdown 源码编辑区')
      act(() => {
        useEditSessionStore.getState().updateDraft('/real/test/folder/report.md', '# Unsaved Draft')
      })

      await act(async () => {
        await exportHtmlCallback()
      })

      expect(await screen.findByText('请先保存编辑草稿后再导出')).toBeInTheDocument()
      expect(mockApi.exportHTML).not.toHaveBeenCalled()
    })

    it('应该通过分屏预览区右键菜单事件打开面板内编辑工作区', async () => {
      useTabStore.setState(state => ({
        ...state,
        splitState: {
          root: { type: 'leaf', id: 'leaf-1', tabId: 'tab-1' },
          activeLeafId: 'leaf-1'
        }
      }))

      render(<App />)

      act(() => {
        const callback = mockApi.onQuickEditFromPreview.mock.calls[0][0]
        callback({ filePath: '/test/folder/report.md', leafId: 'leaf-1' })
      })

      expect(await screen.findByLabelText('report.md 编辑工作区')).toBeInTheDocument()
      expect(document.querySelector('.split-panel-content.with-quick-edit .quick-edit-drawer')).not.toBeInTheDocument()
    })
  })
  describe('工作区完整目录与临时预览协调', () => {
    const file = (name: string) => ({ name: `${name}.md`, path: `/test/folder/${name}.md`, isDirectory: false })
    const resource = (name = 'data.json', handle = `handle-${name}`) => ({ kind: 'text', name, relativePath: name,
      extension: '.json', size: 13, content: '{"value":123}', revealLabel: '在 Finder 中显示', canOpenExternally: true, resourceHandle: handle })
    beforeEach(() => {
      mockApi.showWorkspaceContextMenu.mockReset()
      mockApi.performWorkspaceBrowserAction.mockReset().mockResolvedValue({})
      useWorkspaceStore.setState({ workspaces: [{ id: 'test-workspace', name: '测试', primaryRoot: '/test/folder', lifecycleEpoch: 1 }], activeWorkspaceId: 'test-workspace', runtimes: {} })
      const files = ['A', 'B', 'C'].map(file)
      mockApi.readDir.mockResolvedValue(files)
      useFileStore.setState({ folderPath: '/test/folder', files, isLoading: false, selectedPaths: new Set() })
      useTabStore.setState({ tabs: [{ id: 'tab-A', file: file('A'), content: '# A' }], activeTabId: 'tab-A', splitState: { root: null, activeLeafId: '' } })
      mockApi.readFile.mockReset().mockImplementation(async path => `# ${path.split('/').at(-1).replace('.md', '')}`)
      mockApi.listWorkspaceDirectory.mockReset().mockResolvedValue(['A.md', 'B.md', 'C.md', 'data.json', 'image.png'].map(name => ({ name, relativePath: name, kind: 'file' })))
      mockApi.readWorkspaceResource.mockReset().mockImplementation(async request => request.relativePath === 'image.png'
        ? { ...resource('image.png'), kind: 'file', preview: { kind: 'image', url: 'local-image://asset/synthetic' } }
        : resource())
    })
    const browser = () => within(screen.getByRole('complementary', { name: '工作区文件' }))
    const select = (name: string) => fireEvent.click(browser().getByRole('button', { name, exact: true }))
    async function open() {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: '浏览工作区文件' }))
      await browser().findByRole('button', { name: 'data.json', exact: true })
    }
    async function showResource() {
      await open(); select('data.json')
      await screen.findByRole('textbox', { name: '只读附件文本' })
    }
    async function contextAction(action: string, relativePath = 'A.md', kind = 'file') {
      const target = { id: `target-${relativePath}`, relativePath, name: relativePath.split('/').at(-1), path: `/test/folder/${relativePath}`, kind }
      mockApi.showWorkspaceContextMenu.mockResolvedValueOnce({ action, target })
      fireEvent.contextMenu(browser().getByRole('button', { name: target.name, exact: true }))
      return target
    }
    it('右键复制绑定中栏目标，不更改左树选择或打开文档', async () => {
      await open()
      act(() => useFileStore.setState({ selectedPaths: new Set(['/test/folder/B.md']) }))
      await contextAction('copy-path', 'data.json')
      await waitFor(() => expect(mockApi.performWorkspaceBrowserAction).toHaveBeenCalledWith({ workspaceId: 'test-workspace', lifecycleEpoch: 1 }, 'target-data.json', 'copy-path'))
      expect(useFileStore.getState().selectedPaths).toEqual(new Set(['/test/folder/B.md']))
      expect(useTabStore.getState().tabs).toHaveLength(1)
      expect(mockApi.readWorkspaceResource).not.toHaveBeenCalled()
    })
    it.each(['dirty', 'pendingInput', 'composing', 'saving'])('草稿 %s 状态阻止重命名和废纸篓，但不修改草稿', async flag => {
      await open()
      act(() => {
        useEditSessionStore.getState().openSession({ canonicalPath: '/test/folder/A.md', displayPath: '/test/folder/A.md', fileName: 'A.md', content: '# A', mtimeMs: 1, size: 3, revisionToken: '1' })
        useEditSessionStore.setState(state => ({ sessions: { ...state.sessions, '/test/folder/A.md': { ...state.sessions['/test/folder/A.md'], [flag]: true } } }))
      })
      await contextAction('trash')
      expect(await screen.findByRole('alert')).toHaveTextContent('草稿')
      expect(mockApi.performWorkspaceBrowserAction).not.toHaveBeenCalled()
      await contextAction('rename')
      expect(await screen.findByRole('alert')).toHaveTextContent('草稿')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(useEditSessionStore.getState().sessions['/test/folder/A.md'][flag]).toBe(true)
    })
    it('新建默认 Markdown，允许取消，成功后普通资源不进标签', async () => {
      await open()
      const root = { id: 'root-target', relativePath: '', name: 'folder', path: '/test/folder', kind: 'directory' }
      mockApi.showWorkspaceContextMenu.mockResolvedValueOnce({ action: 'create-file', target: root })
      fireEvent.contextMenu(browser().getByRole('tree'))
      expect(await screen.findByRole('textbox', { name: '名称' })).toHaveValue('未命名.md')
      fireEvent.keyDown(screen.getByRole('textbox', { name: '名称' }), { key: 'Escape' })
      expect(mockApi.performWorkspaceBrowserAction).not.toHaveBeenCalled()
      mockApi.showWorkspaceContextMenu.mockResolvedValueOnce({ action: 'create-file', target: root })
      fireEvent.contextMenu(browser().getByRole('tree'))
      fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), { target: { value: 'new.json' } })
      mockApi.performWorkspaceBrowserAction.mockImplementation(async (_operation, _id, action) => action === 'create-file'
        ? { entry: { name: 'new.json', relativePath: 'new.json', kind: 'file' } } : {})
      fireEvent.click(screen.getByRole('button', { name: '继续' }))
      await screen.findByRole('textbox', { name: '只读附件文本' })
      expect(useTabStore.getState().tabs).toHaveLength(1)
      expect(mockApi.addRecentFile).not.toHaveBeenCalled()
    })
    it('目录重命名同步后代标签并保留分屏ID、无关标签和未自动修复链接', async () => {
      mockApi.listWorkspaceDirectory.mockResolvedValue([{ name: 'docs', relativePath: 'docs', kind: 'directory' }, { name: 'data.json', relativePath: 'data.json', kind: 'file' }])
      const child = { id: 'child-tab', file: { name: 'child.md', path: '/test/folder/docs/child.md', isDirectory: false }, content: '# Child', isPinned: true }
      const sibling = { id: 'sibling-tab', file: { name: 'sibling.md', path: '/test/folder/docs-other/sibling.md', isDirectory: false }, content: '# Sibling' }
      useTabStore.setState(state => ({ tabs: [...state.tabs, child, sibling], splitState: { root: { type: 'split', id: 'split', direction: 'horizontal', ratio: 0.5,
        first: { type: 'leaf', id: 'first', tabId: 'tab-A' }, second: { type: 'leaf', id: 'second', tabId: child.id } }, activeLeafId: 'first' } }))
      useWorkspaceStore.getState().upsertWorkspace({ id: 'background', name: 'background', primaryRoot: '/test/folder', lifecycleEpoch: 1 })
      useWorkspaceStore.getState().saveRuntime('background', { ...useWorkspaceStore.getState().getRuntime('background'), folderPath: '/test/folder',
        tabs: [{ ...child, id: 'background-tab' }], activeTabId: 'background-tab',
        documentViews: { 'single:background-tab': { mode: 'edit', compareRatio: 0.5, target: null } },
        quickEditPlacements: { single: { filePath: child.file.path, tabId: 'background-tab', mode: 'document' } } })
      await open()
      await contextAction('rename', 'docs', 'directory')
      fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), { target: { value: 'renamed' } })
      fireEvent.click(screen.getByRole('button', { name: '继续' }))
      await screen.findByRole('button', { name: '重命名文件夹' })
      expect(mockApi.executeLinkRewriteOperation).not.toHaveBeenCalled()
      mockApi.performWorkspaceBrowserAction.mockImplementation(async (_operation, _id, action) => action === 'rename'
        ? { renamed: { newPath: '/test/folder/renamed', receipt: { operationReceiptId: 'receipt' } } } : {})
      const before = useTabStore.getState().splitState
      fireEvent.click(screen.getByRole('button', { name: '重命名文件夹' }))
      await screen.findByRole('heading', { name: /重命名结果/ })
      expect(useTabStore.getState().tabs.find(tab => tab.id === child.id)).toMatchObject({ file: { path: '/test/folder/renamed/child.md' }, isPinned: true })
      expect(useTabStore.getState().tabs.find(tab => tab.id === sibling.id)?.file.path).toBe(sibling.file.path)
      expect(useTabStore.getState().splitState).toEqual(before)
      const runtime = useWorkspaceStore.getState().getRuntime('background')
      expect(runtime.tabs[0].file.path).toBe('/test/folder/renamed/child.md')
      expect(runtime.documentViews['single:background-tab'].mode).toBe('preview')
      expect(runtime.quickEditPlacements).toEqual({})
      expect(runtime.files).toEqual(useFileStore.getState().files)
      expect(mockApi.applyLinkRepairPlan).not.toHaveBeenCalled()
    })
    it('删除确认取消保留资源；成功仅关闭目标资源，保留原文档', async () => {
      await showResource()
      mockApi.performWorkspaceBrowserAction.mockResolvedValueOnce({ deleted: false })
      await contextAction('trash', 'data.json')
      await waitFor(() => expect(mockApi.performWorkspaceBrowserAction).toHaveBeenCalled())
      expect(screen.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
      mockApi.performWorkspaceBrowserAction.mockResolvedValueOnce({ deleted: true })
      await contextAction('trash', 'data.json')
      await waitFor(() => expect(screen.queryByRole('textbox', { name: '只读附件文本' })).toBeNull())
      expect(useTabStore.getState().tabs.map(tab => tab.id)).toEqual(['tab-A'])
      expect(mockApi.releaseLinkedReads).toHaveBeenCalledWith(['handle-data.json'])
    })

    it('当前窗口打开目录必须先归档父目录会话再激活', async () => {
      mockApi.listWorkspaceDirectory.mockResolvedValue([{ name: 'docs', relativePath: 'docs', kind: 'directory' }, { name: 'data.json', relativePath: 'data.json', kind: 'file' }])
      await open()
      mockApi.performWorkspaceBrowserAction.mockResolvedValueOnce({ activation: folderActivation('/test/folder/docs') })
      await contextAction('open-folder', 'docs', 'directory')
      await waitFor(() => expect(useFileStore.getState().folderPath).toBe('/test/folder/docs'))
      expect(mockApi.saveFolderTabSession).toHaveBeenCalledWith(expect.objectContaining({ tabs: [{ filePath: '/test/folder/A.md', isPinned: undefined }] }), { workspaceId: 'test-workspace', lifecycleEpoch: 1 })
      expect(mockApi.saveFolderTabSession.mock.invocationCallOrder[0]).toBeLessThan(mockApi.performWorkspaceBrowserAction.mock.invocationCallOrder[0])
    })

    it('切换工作区后迟到的目录激活回执不能覆盖当前窗口内容', async () => {
      mockApi.listWorkspaceDirectory.mockResolvedValue([{ name: 'docs', relativePath: 'docs', kind: 'directory' }, { name: 'data.json', relativePath: 'data.json', kind: 'file' }])
      await open()
      let finish!: (value: unknown) => void
      mockApi.performWorkspaceBrowserAction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      await contextAction('open-folder', 'docs', 'directory')
      await waitFor(() => expect(mockApi.performWorkspaceBrowserAction).toHaveBeenCalled())
      act(() => {
        useWorkspaceStore.getState().upsertWorkspace({ id: 'other', name: 'other', primaryRoot: '/other', lifecycleEpoch: 1 })
        useWorkspaceStore.getState().setActiveWorkspaceId('other')
        useFileStore.setState({ folderPath: '/other', files: [] })
      })
      await act(async () => finish({ activation: { ...folderActivation('/test/folder/docs'), workspace: { id: 'test-workspace', primaryRoot: '/test/folder/docs', lifecycleEpoch: 2 } } }))
      expect(useFileStore.getState().folderPath).toBe('/other')
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('other')
      expect(useWorkspaceStore.getState().workspaces.find(item => item.id === 'test-workspace')?.primaryRoot).toBe('/test/folder/docs')
    })

    it('归档失败时取消目录切换，不调用激活入口', async () => {
      mockApi.listWorkspaceDirectory.mockResolvedValue([{ name: 'docs', relativePath: 'docs', kind: 'directory' }, { name: 'data.json', relativePath: 'data.json', kind: 'file' }])
      await open()
      mockApi.saveFolderTabSession.mockRejectedValueOnce(new Error('fixture archive failure'))
      await contextAction('open-folder', 'docs', 'directory')
      expect(await screen.findByRole('alert')).toHaveTextContent('未切换目录')
      expect(mockApi.performWorkspaceBrowserAction).not.toHaveBeenCalled()
      expect(useFileStore.getState().folderPath).toBe('/test/folder')
    })

    it.each([['renamed.md', 1], ['renamed.txt', 0]])('文件改名为 %s 后正确保持文档或非文档边界', async (name, tabCount) => {
      await open()
      act(() => useEditSessionStore.getState().openSession({ canonicalPath: '/test/folder/A.md', displayPath: '/test/folder/A.md', fileName: 'A.md', content: '# A', mtimeMs: 1, size: 3, revisionToken: '1' }))
      await contextAction('rename')
      fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), { target: { value: name } })
      fireEvent.click(screen.getByRole('button', { name: '继续' }))
      await screen.findByRole('button', { name: '重命名文件', exact: true })
      mockApi.performWorkspaceBrowserAction.mockImplementation(async (_operation, _id, action) => action === 'rename'
        ? { renamed: { newPath: `/test/folder/${name}`, receipt: { operationReceiptId: 'receipt' } } } : {})
      fireEvent.click(screen.getByRole('button', { name: '重命名文件', exact: true }))
      await screen.findByRole('heading', { name: /重命名结果/ })
      expect(useTabStore.getState().tabs).toHaveLength(tabCount)
      expect(useEditSessionStore.getState().sessions['/test/folder/A.md']).toBeUndefined()
      if (tabCount) expect(useTabStore.getState().tabs[0]).toMatchObject({ id: 'tab-A', file: { path: `/test/folder/${name}` } })
    })

    it('资源不进tab/recent，中栏与预览关闭互不绑定，原正文保持挂载', async () => {
      await showResource()
      expect(useTabStore.getState().tabs).toHaveLength(1)
      expect(mockApi.addRecentFile).not.toHaveBeenCalled()
      expect(document.querySelector('.document-workbench')).toHaveAttribute('hidden')
      expect(document.querySelector('.document-workbench')).toHaveAttribute('inert')
      fireEvent.click(browser().getByRole('button', { name: '关闭工作区文件' }))
      expect(screen.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
      await screen.findByRole('heading', { name: 'A', exact: true })
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      expect(document.querySelector('.document-workbench')).not.toHaveAttribute('hidden')
    })
    it('Markdown读取失败或取消草稿确认都保留当前有效资源', async () => {
      await showResource()
      mockApi.readFile.mockRejectedValueOnce(new Error('synthetic read failure'))
      select('B.md')
      await screen.findByText(/synthetic read failure/)
      expect(screen.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
      act(() => {
        useEditSessionStore.getState().openSession({ canonicalPath: '/test/folder/A.md', displayPath: '/test/folder/A.md', fileName: 'A.md', content: '# A', mtimeMs: 1, size: 3, revisionToken: '1' })
        useEditSessionStore.getState().updateDraft('/test/folder/A.md', '# unsaved')
      })
      select('B.md')
      expect(window.confirm).toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
    })
    it('Markdown→图片→JSON连续点击，迟到Markdown不能创建或激活标签', async () => {
      await open()
      let finish!: (value: string) => void
      mockApi.readFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      select('B.md')
      await waitFor(() => expect(mockApi.readFile).toHaveBeenCalled())
      select('image.png'); await screen.findByRole('img')
      select('data.json'); await screen.findByRole('textbox', { name: '只读附件文本' })
      await act(async () => finish('# B late'))
      expect(useTabStore.getState().tabs.map(tab => tab.file.name)).toEqual(['A.md'])
      expect(screen.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
    })
    it('旧资源读取迟到只释放handle；关闭预览使在途资源失效', async () => {
      await showResource()
      let finish!: (value: unknown) => void
      mockApi.readWorkspaceResource.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      select('image.png')
      await act(async () => mockApi.onShortcutCloseTab.mock.calls.at(-1)[0]())
      await screen.findByRole('heading', { name: 'A', exact: true })
      await act(async () => finish(resource('late.json', 'late-resource')))
      expect(mockApi.releaseLinkedReads).toHaveBeenCalledWith(['late-resource'])
      expect(screen.queryByRole('textbox', { name: '只读附件文本' })).toBeNull()
      expect(useTabStore.getState().tabs).toHaveLength(1)
    })
    it('新Markdown选择不会被pending丢弃，旧结果不能覆盖最后选择', async () => {
      await open()
      let finish!: (value: string) => void
      mockApi.readFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      select('B.md'); await waitFor(() => expect(mockApi.readFile).toHaveBeenCalled())
      select('C.md'); await screen.findByRole('heading', { name: 'C', exact: true })
      await act(async () => finish('# B late'))
      expect(useTabStore.getState().tabs.some(tab => tab.file.name === 'B.md')).toBe(false)
      expect(useTabStore.getState().tabs.find(tab => tab.id === useTabStore.getState().activeTabId)?.file.name).toBe('C.md')
    })
    it.each(['onShortcutNextTab', 'onShortcutPrevTab', 'onShortcutSwitchTab', 'onOpenSpecificFile'])('主进程文档导航 %s 成功后退出资源', async event => {
      await showResource()
      const callback = mockApi[event].mock.calls.at(-1)[0]
      await act(async () => { if (event === 'onShortcutSwitchTab') callback(0); else if (event === 'onOpenSpecificFile') await callback('/test/folder/A.md'); else callback() })
      await waitFor(() => expect(screen.queryByRole('textbox', { name: '只读附件文本' })).toBeNull())
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
    })
    it('主进程查找/关闭命令作用于资源，导出和保存不能穿透到后台文档', async () => {
      await showResource()
      act(() => mockApi.onShortcutFocusSearch.mock.calls.at(-1)[0]())
      expect(document.querySelector('.workspace-resource-preview .cm-search')).not.toBeNull()
      await act(async () => { await mockApi.onShortcutExportHTML.mock.calls.at(-1)[0](); await mockApi.onMarkdownExportDOCX.mock.calls.at(-1)[0]() })
      fireEvent.keyDown(screen.getByRole('textbox', { name: '只读附件文本' }), { key: 's', metaKey: true })
      expect(mockApi.exportHTML).not.toHaveBeenCalled(); expect(mockApi.saveEditableMarkdown).not.toHaveBeenCalled()
      act(() => mockApi.onShortcutCloseTab.mock.calls.at(-1)[0]())
      expect(useTabStore.getState().tabs).toHaveLength(1)
      await screen.findByRole('heading', { name: 'A', exact: true })
    })
    it('资源期间后台内容刷新不退出预览；焦点在中栏的刷新只读取目录', async () => {
      await showResource()
      const changed = mockApi.onFileChanged.mock.calls.at(-1)[0]
      await act(async () => { await changed({ workspaceId: 'test-workspace', lifecycleEpoch: 1, path: '/test/folder/A.md' }) })
      expect(screen.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
      mockApi.readDir.mockClear(); mockApi.readFile.mockClear(); mockApi.listWorkspaceDirectory.mockClear()
      fireEvent.focus(browser().getByRole('textbox', { name: '过滤已加载项' }))
      await act(async () => mockApi.onShortcutRefresh.mock.calls.at(-1)[0]())
      expect(mockApi.listWorkspaceDirectory).toHaveBeenCalled()
      expect(mockApi.readDir).not.toHaveBeenCalled(); expect(mockApi.readFile).not.toHaveBeenCalled()
    })
    it('Windows目录条目使用原生分隔符，复用已有文档标签而不重复打开', async () => {
      const previous = mockApi.platform
      mockApi.platform = 'win32'
      try {
        const root = 'C:\\test'
        const files = ['A', 'B'].map(name => ({ name: `${name}.md`, path: `${root}\\${name}.md`, isDirectory: false }))
        useWorkspaceStore.setState({ workspaces: [{ id: 'test-workspace', name: '测试', primaryRoot: root, lifecycleEpoch: 1 }], activeWorkspaceId: 'test-workspace', runtimes: {} })
        useFileStore.setState({ folderPath: root, files, isLoading: false, selectedPaths: new Set() })
        useTabStore.setState({ tabs: [{ id: 'tab-A', file: files[0], content: '# A' }], activeTabId: 'tab-A', splitState: { root: null, activeLeafId: '' } })
        mockApi.readDir.mockResolvedValue(files)
        await open(); select('A.md')
        await waitFor(() => expect(mockApi.readFile.mock.calls.map(call => call[0])).toContain('C:\\test\\A.md'))
        expect(useTabStore.getState().tabs).toHaveLength(1)
        expect(useTabStore.getState().activeTabId).toBe('tab-A')
      } finally { mockApi.platform = previous }
    })
    it('中栏不借原多选触发剪切或副本，原左树同类操作仍可用', async () => {
      await showResource()
      const target = '/test/folder/A.md'
      act(() => useFileStore.setState({ selectedPaths: new Set([target]) }))
      fireEvent.focus(browser().getByRole('textbox', { name: '过滤已加载项' }))
      await act(async () => {
        mockApi.onClipboardCut.mock.calls.at(-1)[0]([target])
        await mockApi.onFileDuplicateRequest.mock.calls.at(-1)[0](target)
      })
      expect(mockApi.syncClipboardState).not.toHaveBeenCalled()
      expect(mockApi.duplicatePath).not.toHaveBeenCalled()
      fireEvent.pointerDown(document.querySelector('.sidebar .file-tree')!)
      await act(async () => mockApi.onClipboardCut.mock.calls.at(-1)[0]([target]))
      expect(mockApi.syncClipboardState).toHaveBeenCalledWith([target], true, { workspaceId: 'test-workspace', lifecycleEpoch: 1 })
    })
    it('切工作区后旧资源结果不会显示或留下handle', async () => {
      await open()
      let finish!: (value: unknown) => void
      mockApi.readWorkspaceResource.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      select('data.json')
      act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'other', workspaces: [{ id: 'other', primaryRoot: '/other', lifecycleEpoch: 2 }] }))
      await act(async () => finish(resource('late.json', 'old-workspace-resource')))
      expect(mockApi.releaseLinkedReads).toHaveBeenCalledWith(['old-workspace-resource'])
      expect(screen.queryByRole('textbox', { name: '只读附件文本' })).toBeNull()
    })
  })

  describe('本地附件与本次来源导航', () => {
    const documents = {
      A: '# A\n\n[到B](./B.md)\n\n[到C](./C.md)\n\n[JSON](./data.json)',
      B: '# B\n\n[到C](./C.md)', C: '# C',
    }
    const file = (name: string) => ({ name: `${name}.md`, path: `/test/folder/${name}.md`, isDirectory: false })
    const floatingReturn = (name: string, root: ParentNode = document) => root.querySelector<HTMLButtonElement>(`.link-origin-floating[aria-label="返回来源：${name}.md"]`)!
    beforeEach(() => {
      useWorkspaceStore.setState({ workspaces: [{ id: 'test-workspace', name: '测试', primaryRoot: '/test/folder', lifecycleEpoch: 1 }], activeWorkspaceId: 'test-workspace', runtimes: {} })
      mockApi.readDir.mockResolvedValue(['A', 'B', 'C'].map(file))
      useFileStore.setState({ folderPath: '/test/folder', files: ['A', 'B', 'C'].map(file), isLoading: false, selectedPaths: new Set() })
      useTabStore.setState({ tabs: [{ id: 'tab-A', file: file('A'), content: documents.A }], activeTabId: 'tab-A', splitState: { root: null, activeLeafId: '' }, scrollToLine: undefined, scrollToRatio: undefined, highlightKeyword: undefined })
      mockApi.readFile.mockReset().mockImplementation(async path => documents[path.split('/').at(-1)!.replace('.md', '')])
      mockApi.resolveMdLink.mockReset().mockImplementation(async (_source, href) => ({ success: true,
        targetPath: href.startsWith('/') ? decodeURIComponent(href) : `/test/folder/${href.replace('./', '')}` }))
      mockApi.readLinkedAttachment.mockReset().mockResolvedValue({ kind: 'text', name: 'data.json', relativePath: 'data.json', extension: '.json', size: 29, revealLabel: '在 Finder 中显示', canOpenExternally: true, content: '{"id":9007199254740993123}' })
    })

    afterEach(() => {
      act(() => useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, runtimes: {} }))
    })

    it.each([[false, false], [false, true], [true, false], [true, true]])('块预检使用草稿而非磁盘：disk=%s draft=%s', async (diskBlock, draftBlock) => {
      const disk = '# B\n\n磁盘正文' + (diskBlock ? ' ^remote' : '')
      const draft = '# Draft\n\n草稿正文' + (draftBlock ? ' ^remote' : '')
      useTabStore.setState(state => ({ tabs: [...state.tabs, { id: 'tab-B', file: file('B'), content: disk }] }))
      useEditSessionStore.getState().openSession({ canonicalPath: '/test/folder/B.md', displayPath: '/test/folder/B.md', fileName: 'B.md', content: disk, mtimeMs: 1, size: 1, revisionToken: '1' })
      useEditSessionStore.getState().updateDraft('/test/folder/B.md', draft)
      mockApi.prepareLinkedDocument.mockResolvedValueOnce({ success: true, targetPath: '/test/folder/B.md', content: disk, blockId: 'remote', batchId: 'block-batch', access: 'root' })
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      if (draftBlock) {
        await screen.findByRole('heading', { name: 'Draft', exact: true })
        expect(mockApi.commitLinkedDocument).toHaveBeenCalledWith('block-batch')
      } else {
        await screen.findByText('未找到块 ^remote（当前草稿）。')
        expect(useTabStore.getState().activeTabId).toBe('tab-A')
        expect(mockApi.commitLinkedDocument).not.toHaveBeenCalled()
        expect(document.querySelector('.link-origin-floating')).toBeNull()
      }
      expect(useEditSessionStore.getState().sessions['/test/folder/B.md'].draft).toBe(draft)
      expect(useTabStore.getState().tabs.find(tab => tab.id === 'tab-B')?.content).toBe(disk)
    })
    it('commit 等待期间目标草稿移除块，留在来源且不留下未附着授权', async () => {
      const disk = '# B\n\n正文 ^remote'
      useTabStore.setState(state => ({ tabs: [...state.tabs, { id: 'tab-B', file: file('B'), content: disk }] }))
      useEditSessionStore.getState().openSession({ canonicalPath: '/test/folder/B.md', displayPath: '/test/folder/B.md', fileName: 'B.md', content: disk, mtimeMs: 1, size: 1, revisionToken: '1' })
      useEditSessionStore.getState().updateDraft('/test/folder/B.md', disk + '\n\n初次草稿')
      mockApi.prepareLinkedDocument.mockResolvedValueOnce({ success: true, targetPath: '/test/folder/B.md', content: disk, blockId: 'remote', batchId: 'changing-block', access: 'root' })
      let commit!: (value: unknown) => void
      mockApi.commitLinkedDocument.mockImplementationOnce(() => new Promise(resolve => { commit = resolve }))
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await waitFor(() => expect(mockApi.commitLinkedDocument).toHaveBeenCalledWith('changing-block'))
      await act(async () => {
        useEditSessionStore.getState().updateDraft('/test/folder/B.md', '# Changed\n\n块已移除')
        commit({ success: true })
      })
      await screen.findByText('目标内容已变化，无法确认指定块，请重新点击链接。')
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      expect(document.querySelector('.link-origin-floating')).toBeNull()
      expect(mockApi.releaseLinkedReads).toHaveBeenCalledWith(['changing-block'])
    })

    it.each([false, true])('无变化补查不取消在途链接，cleanSession=%s', async cleanSession => {
      let reconcileHandler: any
      let complete: (value: any) => void
      mockApi.onWatchReconcile.mockImplementation(handler => { reconcileHandler = handler; return vi.fn() })
      mockApi.prepareLinkedDocument.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      if (cleanSession) {
        useEditSessionStore.getState().openSession({ canonicalPath: file('A').path, displayPath: file('A').path,
          fileName: 'A.md', content: documents.A, mtimeMs: 1, revisionToken: 'same', workspaceId: 'test-workspace', lifecycleEpoch: 1 })
        mockApi.openEditableMarkdown.mockResolvedValueOnce({ content: documents.A, revisionToken: 'same' })
      }
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await waitFor(() => expect(complete).toBeDefined())
      await act(async () => { reconcileHandler({ workspaceId: 'test-workspace', lifecycleEpoch: 1, requestId: 'no-change', phase: 'refresh' }) })
      await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('no-change', 'ok'))
      await act(async () => complete({ success: true, targetPath: file('B').path, content: documents.B, batchId: 'delayed-B', access: 'root' }))
      await screen.findByRole('heading', { name: 'B', exact: true })
      expect(mockApi.commitLinkedDocument).toHaveBeenCalledWith('delayed-B')
      expect(floatingReturn('A')).toBeInTheDocument()
    })

    it('补查后仍使用目标草稿做块缺失预检，而非无声取消', async () => {
      let reconcileHandler: any
      let complete: (value: any) => void
      useTabStore.setState(state => ({ tabs: [...state.tabs, { id: 'tab-B', file: file('B'), content: documents.B }] }))
      useEditSessionStore.getState().openSession({ canonicalPath: file('B').path, displayPath: file('B').path,
        fileName: 'B.md', content: documents.B, mtimeMs: 1, revisionToken: 'same', workspaceId: 'test-workspace', lifecycleEpoch: 1 })
      useEditSessionStore.getState().updateDraft(file('B').path, '# Draft without block')
      mockApi.onWatchReconcile.mockImplementation(handler => { reconcileHandler = handler; return vi.fn() })
      mockApi.openEditableMarkdown.mockResolvedValueOnce({ content: documents.B, revisionToken: 'same' })
      mockApi.prepareLinkedDocument.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await waitFor(() => expect(complete).toBeDefined())
      await act(async () => { reconcileHandler({ workspaceId: 'test-workspace', lifecycleEpoch: 1, requestId: 'draft-check', phase: 'refresh' }) })
      await waitFor(() => expect(mockApi.acknowledgeWatchReconcile).toHaveBeenCalledWith('draft-check', 'ok'))
      await act(async () => complete({ success: true, targetPath: file('B').path, content: documents.B,
        blockId: 'remote', batchId: 'delayed-block', access: 'root' }))
      await screen.findByText('未找到块 ^remote（当前草稿）。')
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      expect(mockApi.commitLinkedDocument).not.toHaveBeenCalled()
      expect(useEditSessionStore.getState().sessions[file('B').path].draft).toBe('# Draft without block')
      expect(mockApi.releaseLinkedReads).toHaveBeenCalledWith(['delayed-block'])
    })

    it.each(['content', 'resource', 'missing', 'draft'])('来源%s变化仍取消当前请求并提示重新点击', async change => {
      let complete: (value: any) => void
      mockApi.prepareLinkedDocument.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await waitFor(() => expect(complete).toBeDefined())
      act(() => {
        if (change === 'draft') {
          useEditSessionStore.getState().openSession({ canonicalPath: file('A').path, displayPath: file('A').path,
            fileName: 'A.md', content: documents.A, mtimeMs: 1, revisionToken: 'same' })
          useEditSessionStore.getState().updateDraft(file('A').path, documents.A + '\n新草稿')
        } else useTabStore.getState().setTabs(tabs => tabs.map(tab => tab.id !== 'tab-A' ? tab : { ...tab,
          ...(change === 'content' ? { content: '# Changed' } : change === 'resource' ? { resourceRevision: 1 } : { missing: true }),
        }))
      })
      await act(async () => complete({ success: true, targetPath: file('B').path, content: documents.B,
        batchId: 'cancelled-B', documentId: 'unattached-document', access: 'linked-readonly' }))
      await screen.findByText('来源文档已更新，本次跳转已取消，请重新点击链接。')
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      expect(mockApi.commitLinkedDocument).not.toHaveBeenCalled()
      expect(mockApi.releaseLinkedReads).toHaveBeenCalledWith(['cancelled-B', 'unattached-document'])
      expect(mockApi.cancelLinkedRead).toHaveBeenCalled()
    })

    it.each(['content', 'resource'])('目标%s变化仍取消提交，不覆盖更新后的目标', async change => {
      let commit: (value: any) => void
      useTabStore.setState(state => ({ tabs: [...state.tabs, { id: 'tab-B', file: file('B'), content: documents.B }] }))
      mockApi.commitLinkedDocument.mockImplementationOnce(() => new Promise(resolve => { commit = resolve }))
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await waitFor(() => expect(commit).toBeDefined())
      await act(async () => {
        useTabStore.getState().setTabs(tabs => tabs.map(tab => tab.id !== 'tab-B' ? tab : { ...tab,
          ...(change === 'content' ? { content: '# Updated B' } : { resourceRevision: 1 }),
        }))
        commit({ success: true })
      })
      await screen.findByText('目标文档已更新，本次跳转已取消，请重新点击链接。')
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      expect(useTabStore.getState().tabs.find(tab => tab.id === 'tab-B')).toMatchObject(
        change === 'content' ? { content: '# Updated B' } : { resourceRevision: 1 })
      expect(document.querySelector('.link-origin-floating')).toBeNull()
      expect(mockApi.releaseLinkedReads).toHaveBeenCalled()
    })

    it.each(['tab', 'workspace', 'request'])('被%s替代的旧导航静默取消，不干扰新操作', async change => {
      let complete: (value: any) => void
      mockApi.prepareLinkedDocument.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await waitFor(() => expect(complete).toBeDefined())
      if (change === 'request') {
        fireEvent.click(screen.getByRole('link', { name: '到C' }))
        await screen.findByRole('heading', { name: 'C', exact: true })
      } else act(() => {
        if (change === 'workspace') useWorkspaceStore.setState({ activeWorkspaceId: 'elsewhere' })
        else useTabStore.setState(state => ({ tabs: [...state.tabs, { id: 'tab-C', file: file('C'), content: documents.C }], activeTabId: 'tab-C' }))
      })
      await act(async () => complete({ success: true, targetPath: file('B').path, content: documents.B, batchId: 'obsolete-B', access: 'root' }))
      expect(screen.queryByText('来源文档已更新，本次跳转已取消，请重新点击链接。')).not.toBeInTheDocument()
      expect(mockApi.commitLinkedDocument).not.toHaveBeenCalledWith('obsolete-B')
      expect(mockApi.releaseLinkedReads).toHaveBeenCalledWith(['obsolete-B'])
      expect(useTabStore.getState().tabs.some(tab => tab.file.path === file('B').path)).toBe(false)
    })

    it('A→B→C首次正文可点击即有正确访问链，并可马上C→B→A', async () => {
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await screen.findByRole('heading', { name: 'B', exact: true })
      expect(floatingReturn('A')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('link', { name: '到C' }))
      await screen.findByRole('heading', { name: 'C', exact: true })
      expect(floatingReturn('B')).toBeInTheDocument()
      fireEvent.click(floatingReturn('B'))
      await screen.findByRole('heading', { name: 'B', exact: true })
      fireEvent.click(floatingReturn('A'))
      await screen.findByRole('heading', { name: 'A', exact: true })
      expect(document.querySelector('.link-origin-floating')).toBeNull()
      expect(useTabStore.getState().tabs).toHaveLength(3)
      expect(mockApi.prepareLinkedDocument.mock.calls.slice(-2).every(([request]) => request.rootOnly === true)).toBe(true)
      expect(mockApi.commitLinkedDocument).toHaveBeenCalledTimes(4)
    })
    it('Wiki嵌入保留旧resolver但正文和标题走rootOnly安全批次', async () => {
      useTabStore.setState(state => ({ tabs: state.tabs.map(tab => ({ ...tab,
        content: '# A\n\n![[B.md#heading|嵌入目标]]',
      })) }))
      mockApi.resolveMdLink.mockResolvedValueOnce({ success: true, targetPath: '/test/folder/B.md', headingId: 'heading', targetLine: 999 })
      mockApi.prepareLinkedDocument.mockResolvedValueOnce({ success: true, targetPath: '/test/folder/B.md',
        content: '# Safe B\n\n## Heading', targetLine: 3, headingId: 'heading', batchId: 'embed-batch', access: 'root' })
      render(<App />)
      const embed = document.querySelector<HTMLAnchorElement>('a[data-mdv-wiki-link]')!
      expect(embed).toBeInTheDocument()
      fireEvent.click(embed)
      await screen.findByRole('heading', { name: 'Safe B', exact: true })
      expect(mockApi.prepareLinkedDocument).toHaveBeenCalledWith(expect.objectContaining({
        rootOnly: true, href: '/test/folder/B.md#heading', source: { filePath: '/test/folder/A.md' },
      }))
      expect(mockApi.commitLinkedDocument).toHaveBeenCalledWith('embed-batch')
      expect(mockApi.readFile).not.toHaveBeenCalled()
    })
    it('最新请求替代迟到读取，旧B不能覆盖新C或追加到来源链', async () => {
      let completeB: (value: string) => void
      mockApi.readFile.mockImplementation(path => path.endsWith('/B.md') ? new Promise(resolve => { completeB = resolve }) : Promise.resolve(documents.C))
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await waitFor(() => expect(mockApi.readFile).toHaveBeenCalledWith('/test/folder/B.md'))
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      fireEvent.click(screen.getByRole('link', { name: '到C' }))
      await screen.findByRole('heading', { name: 'C', exact: true })
      await act(async () => completeB(documents.B))
      expect(screen.getByRole('heading', { name: 'C', exact: true })).toBeInTheDocument()
      expect(useTabStore.getState().tabs.some(tab => tab.file.path.endsWith('/B.md'))).toBe(false)
      expect(floatingReturn('A')).toBeInTheDocument()
      expect(floatingReturn('B')).toBeNull()
    })
    it('读取失败保持来源视图/游标；关闭来源tab后返回可安全重开', async () => {
      const view = render(<App />)
      mockApi.readFile.mockRejectedValueOnce(new Error('fixture unavailable'))
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await screen.findByText('链接跳转失败：文件不可访问或已失去读取授权。')
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      expect(document.querySelector('.link-origin-floating')).toBeNull()
      fireEvent.click(screen.getByRole('link', { name: '到B' }))
      await screen.findByRole('heading', { name: 'B', exact: true })
      act(() => useTabStore.getState().setTabs(tabs => tabs.filter(tab => tab.id !== 'tab-A')))
      fireEvent.click(floatingReturn('A'))
      await screen.findByRole('heading', { name: 'A', exact: true })
      expect(useTabStore.getState().tabs.find(tab => tab.file.path.endsWith('/A.md'))?.id).not.toBe('tab-A')
      view.unmount()
    })
    it('显式文件树进入已有目标重置为无来源根，不能复活旧访问绑定', async () => {
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await screen.findByRole('heading', { name: 'B', exact: true })
      fireEvent.click(document.querySelector('.file-tree-row[data-path="/test/folder/B.md"]') ?? screen.getAllByText('B.md').find(node => node.closest('.file-tree-row'))!)
      await waitFor(() => expect(document.querySelector('.link-origin-floating')).toBeNull())
      expect(screen.getByRole('heading', { name: 'B', exact: true })).toBeInTheDocument()
    })
    it('源草稿在等待期间变化则不提交', async () => {
      let completeB: (value: string) => void
      mockApi.readFile.mockImplementation(() => new Promise(resolve => { completeB = resolve }))
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: '到B' }))
      await waitFor(() => expect(mockApi.readFile).toHaveBeenCalledWith('/test/folder/B.md'))
      act(() => {
        useEditSessionStore.getState().openSession({ canonicalPath: '/test/folder/A.md', displayPath: '/test/folder/A.md', fileName: 'A.md', content: documents.A, mtimeMs: 1, size: 1, revisionToken: '1' })
        useEditSessionStore.getState().updateDraft('/test/folder/A.md', documents.A + '\n新草稿')
      })
      await act(async () => completeB(documents.B))
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      expect(useTabStore.getState().tabs).toHaveLength(1)
      expect(document.querySelector('.link-origin-floating')).toBeNull()
    })
    it('目标在另一leaf产生新草稿仍在原leaf打开，不覆盖共享草稿或抢活跃leaf', async () => {
      let completeB: (value: string) => void
      mockApi.readFile.mockImplementation(() => new Promise(resolve => { completeB = resolve }))
      useTabStore.setState(state => ({ tabs: [...state.tabs, { id: 'tab-B', file: file('B'), content: documents.B }], splitState: { root: { type: 'split', id: 'split', direction: 'horizontal', ratio: .5, first: { type: 'leaf', id: 'left', tabId: 'tab-A' }, second: { type: 'leaf', id: 'right', tabId: 'tab-B' } }, activeLeafId: 'left' } }))
      render(<App />)
      const left = document.querySelector('[data-leaf-id="left"]')!
      const right = document.querySelector('[data-leaf-id="right"]')!
      fireEvent.click(left.querySelector('a')!)
      await waitFor(() => expect(mockApi.readFile).toHaveBeenCalledWith('/test/folder/B.md'))
      act(() => {
        useEditSessionStore.getState().openSession({ canonicalPath: '/test/folder/B.md', displayPath: '/test/folder/B.md', fileName: 'B.md', content: documents.B, mtimeMs: 1, size: 1, revisionToken: '1' })
        useEditSessionStore.getState().updateDraft('/test/folder/B.md', '# B 最新草稿')
      })
      fireEvent.click(right)
      await act(async () => completeB('# B 过期磁盘数据'))
      expect(useTabStore.getState().splitState.activeLeafId).toBe('right')
      expect(useTabStore.getState().splitState.root.first.tabId).toBe('tab-B')
      expect(useTabStore.getState().splitState.root.second.tabId).toBe('tab-B')
      expect(useTabStore.getState().tabs.find(tab => tab.id === 'tab-B')?.content).toBe(documents.B)
      expect(useEditSessionStore.getState().sessions['/test/folder/B.md'].draft).toBe('# B 最新草稿')
      expect(floatingReturn('A', left)).toBeInTheDocument()
      expect(right.querySelector('.link-origin-floating')).toBeNull()
    })
    it('JSON不占文档tab，主进程Mod-F/Mod-W IPC只查找/关闭附件', async () => {
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: 'JSON' }))
      const text = await screen.findByRole('textbox', { name: '只读附件文本' })
      expect(text).toHaveAttribute('aria-readonly', 'true')
      expect(useTabStore.getState().tabs).toHaveLength(1)
      act(() => mockApi.onShortcutFocusSearch.mock.calls.at(-1)[0]())
      expect(document.querySelector('.local-attachment-dialog .cm-search')).toBeInTheDocument()
      act(() => mockApi.onShortcutCloseTab.mock.calls.at(-1)[0]())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(useTabStore.getState().tabs).toHaveLength(1)
      expect(useTabStore.getState().activeTabId).toBe('tab-A')
      expect(document.querySelector('.link-origin-floating')).toBeNull()
    })
    it('切换工作区使在途附件结果失效，迟到正文不再显示', async () => {
      let complete: (value: unknown) => void
      mockApi.readLinkedAttachment.mockImplementation(() => new Promise(resolve => { complete = resolve }))
      render(<App />)
      fireEvent.click(await screen.findByRole('link', { name: 'JSON' }))
      await screen.findByText('附件读取中…')
      act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'other', workspaces: [{ id: 'other', name: '其它', primaryRoot: '/other', lifecycleEpoch: 2 }] }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await act(async () => complete({ kind: 'text', name: 'late.txt', content: '迟到正文', extension: '.txt', size: 4 }))
      expect(screen.queryByText('迟到正文')).not.toBeInTheDocument()
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
    useLayoutStore.setState({ sidebarWidth: 280, sidebarCollapsed: false, isResizing: false, showSettings: false, showShortcutsHelp: false, isFullscreen: false, isDragOver: false, lightbox: null })
    useEditSessionStore.getState().reset()
    vi.stubGlobal('confirm', vi.fn(() => false))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('应该处理空文件列表', async () => {
    mockApi.openFolder.mockResolvedValue(folderActivation('/empty/folder'))
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
      expect(screen.getByText('没有找到 Markdown 或 Excalidraw 文件')).toBeInTheDocument()
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

    mockApi.openFolder.mockResolvedValue(folderActivation('/test'))
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

    mockApi.openFolder.mockResolvedValue(folderActivation('/test'))
    mockApi.readDir.mockResolvedValue(specialFiles)

    render(<App />)
    const button = screen.getByRole('button', { name: '打开文件夹' })

    fireEvent.click(button)

    await waitFor(() => {
      expect(mockApi.readDir).toHaveBeenCalled()
    })
  })
})
