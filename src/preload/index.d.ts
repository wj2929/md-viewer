import { ElectronAPI } from '@electron-toolkit/preload'
import { type DocxStyle } from '../shared/docxStyles'
import { type ReadAloudSettings } from '../shared/ttsProviders'
import { type FolderActivation, type WorkspaceOperationContext } from '../shared/workspace'
import { type DocumentMarkColor } from '../shared/documentMarks'

// v1.7.0：DOCX 导出设置
interface DocxExportSettings {
  remoteEnabled: boolean
  serverUrl?: string
  apiKey?: string
  style?: DocxStyle
  styleTouched?: boolean
  timeoutMs: number
  embedFont: boolean
  localFallbackEnabled: boolean
  referenceDocxPath?: string
}

// v1.3.6：书签接口
interface Bookmark {
  id: string
  filePath: string
  fileName: string
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
  createdAt: number
  order: number
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // 平台信息
      platform: 'darwin' | 'win32' | 'linux'

      // 文件系统操作
      openFolder: () => Promise<FolderActivation | null>
      readDir: (path: string) => Promise<FileInfo[]>
      listChildDirs: (path: string) => Promise<Array<{ name: string; path: string }>>
      readFile: (path: string) => Promise<string>
      readLocalAssetBase64: (payload: {
        markdownFilePath: string
        refPath: string
      }) => Promise<{ base64: string; mimeType: string; resolvedPath: string }>
      readExcalidrawFile: (payload: {
        markdownFilePath: string
        refPath: string
      }) => Promise<{ content: string; resolvedPath: string }>
      readBpmnFile: (payload: {
        markdownFilePath: string
        refPath: string
      }) => Promise<{ content: string; resolvedPath: string }>
      readFilePreview: (path: string) => Promise<string>
      issueLocalImageUrl: (markdownFilePath: string, rawResourcePath: string) => Promise<string>
      testOpenMarkdownFile?: (path: string) => Promise<boolean>
      testFileClipboardAction?: (
        action: 'copy' | 'cut' | 'paste',
        target: string | string[]
      ) => Promise<{ success: boolean }>
      openEditableMarkdown: (filePath: string, operation: WorkspaceOperationContext) => Promise<{
        canonicalPath: string
        displayPath: string
        fileName: string
        content: string
        mtimeMs: number
        size: number
        revisionToken: string
      }>
      saveEditableMarkdown: (payload: {
        canonicalPath: string
        content: string
        expectedRevisionToken: string
        workspace: WorkspaceOperationContext
        force?: boolean
      }) => Promise<{
        success: boolean
        mtimeMs?: number
        size?: number
        revisionToken?: string
        conflict?: {
          reason: string
          diskRevisionToken: string
        }
      }>

      // 搜索专用：跨文件夹访问
      searchReadDir: (path: string) => Promise<FileInfo[]>
      searchReadFile: (path: string) => Promise<string>

      // 文件监听：工作区上下文用于隔离异步事件；省略参数仅供旧桥接兼容。
      watchFolder: (path: string, workspaceId?: string, lifecycleEpoch?: number) => Promise<{ success: boolean }>
      watchFile: (path: string, workspaceId?: string, lifecycleEpoch?: number) => Promise<{ success: boolean }>
      unwatchFolder: (workspaceId?: string, lifecycleEpoch?: number) => Promise<{ success: boolean }>

      // 导出功能
      exportHTML: (htmlContent: string, fileName: string) => Promise<string | null>
      exportPDF: (htmlContent: string, fileName: string) => Promise<string | null>
      exportDOCX: (htmlContent: string, fileName: string, basePath: string, markdown?: string, docStyle?: string, remoteImages?: Array<{ id: string; pngBase64: string; widthCm?: number }>) => Promise<{ filePath: string; warnings: string[]; usedPandoc?: boolean; usedRemote?: boolean; imagesFailed?: number } | null>
      exportChartsZip: (payload: {
        markdownFilePath: string
        images: Array<{ filename: string; pngBase64: string }>
      }) => Promise<{ filePath?: string; written?: number; canceled?: boolean; error?: string }>

      // v1.5.1：代码块截图（用于 DOCX 导出时保持 ASCII 艺术对齐）
      renderCodeBlockToPng: (code: string) => Promise<{
        success: boolean
        data?: string  // base64 PNG
        width?: number
        height?: number
        error?: string
      }>

      // 右键菜单 (v1.2 阶段 1)
      showContextMenu: (
        file: { name: string; path: string; isDirectory: boolean },
        basePath: string,
        operation: WorkspaceOperationContext
      ) => Promise<{ success: boolean }>
      renameFile: (oldPath: string, newName: string, operation: WorkspaceOperationContext) => Promise<string>
      duplicatePath: (sourcePath: string, operation: WorkspaceOperationContext) => Promise<{
        sourcePath: string
        newPath: string
        isDirectory: boolean
      }>

      // v1.3 新增：Tab 右键菜单
      showTabContextMenu: (ctx: {
        tabId: string
        filePath: string
        basePath: string
        tabCount: number
        tabIndex: number
        isPinned?: boolean  // v1.3.6 新增
      }) => Promise<{ success: boolean }>

      // v1.3 阶段 2：Markdown 右键菜单
      showMarkdownContextMenu: (ctx: {
        filePath: string
        hasSelection: boolean
      }) => Promise<{ success: boolean }>

      // v1.3 阶段 3：剪贴板状态同步
      syncClipboardState: (files: string[], isCut: boolean, operation: WorkspaceOperationContext) => Promise<void>
      queryClipboardState: () => Promise<{ files: string[]; isCut: boolean; hasFiles: boolean }>

      // v1.3 阶段 6：跨应用剪贴板
      readSystemClipboard: () => Promise<Array<{ path: string; exists: boolean; isAllowed: boolean; reason?: string }>>
      writeSystemClipboard: (paths: string[], isCut: boolean) => Promise<boolean>
      hasSystemClipboardFiles: () => Promise<boolean>

      // v1.4：Shell 操作
      showItemInFolder: (filePath: string) => Promise<{ success: boolean }>
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>

      // v1.3.4：历史文件夹
      getFolderHistory: () => Promise<Array<{ id: string; path: string; name: string; lastOpened: number }>>
      removeFolderFromHistory: (historyId: string) => Promise<void>
      clearFolderHistory: () => Promise<void>
      activateHistoryFolder: (historyId: string) => Promise<FolderActivation>
      getFolderTreeState: (operation: WorkspaceOperationContext) => Promise<Record<string, false>>
      saveFolderTreeState: (folders: Record<string, false>, operation: WorkspaceOperationContext) => Promise<Record<string, false>>
      clearFolderTreeState: (operation: WorkspaceOperationContext) => Promise<void>
      getDocumentMarks: (operation: WorkspaceOperationContext) => Promise<Record<string, DocumentMarkColor>>
      setDocumentMark: (
        filePath: string,
        color: DocumentMarkColor | null,
        operation: WorkspaceOperationContext
      ) => Promise<Record<string, DocumentMarkColor>>
      getReadPosition: (filePath: string) => Promise<{
        canonicalPath: string
        scrollRatio?: number
        headingId?: string
        updatedAt: number
        contentHash?: string
      } | null>
      saveReadPosition: (position: {
        canonicalPath: string
        scrollRatio?: number
        headingId?: string
        updatedAt?: number
        contentHash?: string
        workspace: WorkspaceOperationContext
      }) => Promise<{
        canonicalPath: string
        scrollRatio?: number
        headingId?: string
        updatedAt: number
        contentHash?: string
      }>
      clearReadPosition: (filePath: string, operation: WorkspaceOperationContext) => Promise<void>

      // v1.3.6：最近文件
      getRecentFiles: () => Promise<Array<{
        id: string
        path: string
        name: string
        folderPath: string
        lastOpened: number
      }>>
      activateRecentFile: (recentId: string) => Promise<FolderActivation & {
        filePath: string
        fileName: string
      }>
      addRecentFile: (file: { path: string; name: string; folderPath: string }) => Promise<void>
      removeRecentFile: (filePath: string) => Promise<void>
      clearRecentFiles: () => Promise<void>

      // v1.3.6：固定标签（按文件夹分组）
      getPinnedTabsForFolder: (folderPath: string) => Promise<Array<{ path: string; order: number }>>
      addPinnedTab: (filePath: string, operation: WorkspaceOperationContext) => Promise<boolean>
      removePinnedTab: (filePath: string, operation: WorkspaceOperationContext) => Promise<void>
      isTabPinned: (filePath: string, operation: WorkspaceOperationContext) => Promise<boolean>

      // v1.7.0：SVG → PNG 截图（主进程 BrowserWindow）
      renderSvgToPng: (svgString: string, width?: number) => Promise<{
        success: boolean
        data?: string
        width?: number
        height?: number
        error?: string
      }>
      renderKrokiSvg: (payload: { format: string; source: string }) => Promise<{
        ok: boolean
        svg?: string
        error?: string
        status?: number
      }>

      // v1.7.0：DOCX 远程服务
      testDocxConnection: (serverUrl: string, apiKey?: string) => Promise<{
        ok: boolean
        version?: string
        mode?: string
        styles?: string[]
        fontsAvailable?: string[]
        embedFontSupported?: boolean
        chartRenderersAvailable?: string[]
        maxImagesPerRequest?: number
        maxRequestSizeMb?: number
        error?: string
      }>
      runPreflight: (request: { filePath: string; formats: string[]; docxServiceUrl?: string }) => Promise<import('../shared/preflight').PreflightResult>
      ttsSynthesize: (req: {
        requestId: string
        providerId: string
        type: string
        text: string
        voice?: string
        rate?: number
        baseUrl?: string
        region?: string
        model?: string
      }) => Promise<{
        ok: boolean
        kind?: string
        message?: string
        audioBase64?: string
        format?: string
        boundaries?: Array<{ text: string; offsetMs: number; durationMs: number }>
      }>
      ttsCancel: (requestId: string) => Promise<{ ok: boolean }>
      ttsListVoices: (type: string) => Promise<Array<{ id: string; name: string; lang?: string }>>
      ttsTestProvider: (req: {
        providerId: string
        type: string
        text?: string
        voice?: string
        baseUrl?: string
        region?: string
        model?: string
      }) => Promise<{ ok: boolean; kind?: string; message?: string }>
      ttsSetKey: (providerId: string, apiKey: string) => Promise<{ ok: boolean; hasKey?: boolean; message?: string }>
      ttsEncryptionAvailable: () => Promise<boolean>
      selectReferenceDocx: () => Promise<string | null>

      getLastDocxExportPath: () => Promise<string | null>
      openLastDocxExport: () => Promise<{ ok: boolean; error?: string }>

      // v1.3.6：应用设置
      getAppSettings: () => Promise<{ imageDir: string; autoSave: boolean; bookmarkPanelWidth: number; bookmarkPanelCollapsed: boolean; bookmarkBarCollapsed: boolean; sidebarWidth?: number; sidebarCollapsed?: boolean; maxRecentFiles?: number; maxFolderHistory?: number; showExportBranding?: boolean; docxExport?: DocxExportSettings; readAloud?: ReadAloudSettings }>
      updateAppSettings: (updates: Partial<{ imageDir: string; autoSave: boolean; bookmarkPanelWidth: number; bookmarkPanelCollapsed: boolean; bookmarkBarCollapsed: boolean; sidebarWidth: number; sidebarCollapsed: boolean; maxRecentFiles: number; maxFolderHistory: number; showExportBranding: boolean; docxExport: DocxExportSettings }>) => Promise<void>
      getReadAloudSettings: () => Promise<ReadAloudSettings>
      updateReadAloudSettings: (settings: ReadAloudSettings) => Promise<ReadAloudSettings>

      // v1.3.6：书签管理
      getBookmarks: () => Promise<Array<Bookmark>>
      activateBookmark: (bookmarkId: string) => Promise<FolderActivation & {
        filePath: string
        fileName: string
      }>
      addBookmark: (bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'order'>) => Promise<Bookmark>
      updateBookmark: (id: string, updates: {
        title?: string
        headingId?: string
        headingText?: string
        scrollPosition?: number
        order?: number
      }) => Promise<void>
      removeBookmark: (id: string) => Promise<void>
      updateAllBookmarks: (bookmarks: Array<{ id: string; order: number }>) => Promise<void>
      clearBookmarks: () => Promise<void>

      // v1.3.4：右键菜单安装
      checkContextMenuStatus: () => Promise<{
        installed: boolean
        platform: string
        installedAt?: number
        userConfirmedEnabled?: boolean
      }>
      installContextMenu: () => Promise<{ success: boolean; error?: string }>
      uninstallContextMenu: () => Promise<{ success: boolean; error?: string }>
      getCliShimStatus: () => Promise<{
        supported: boolean
        installed: boolean
        platform: 'darwin' | 'win32' | 'linux'
        path?: string
        pathInShell?: boolean
        ownedByMdViewer?: boolean
        code?: string
        message?: string
      }>
      installCliShim: () => Promise<{
        ok: boolean
        path?: string
        pathInShell?: boolean
        nextStep?: string
        code?: string
        message?: string
      }>
      uninstallCliShim: () => Promise<{
        ok: boolean
        path?: string
        pathInShell?: boolean
        nextStep?: string
        code?: string
        message?: string
      }>
      openSystemSettings: (section: string) => Promise<{ success: boolean; error?: string }>
      confirmContextMenuEnabled: () => Promise<{ success: boolean }>

      // 文件操作 (v1.2 阶段 2)
      copyFile: (srcPath: string, destPath: string, operation: WorkspaceOperationContext) => Promise<string>
      copyDir: (srcPath: string, destPath: string, operation: WorkspaceOperationContext) => Promise<string>
      moveFile: (srcPath: string, destPath: string, operation: WorkspaceOperationContext) => Promise<string>
      moveFileToFolder: (srcPath: string, targetHistoryId: string, subRelPath: string | undefined, operation: WorkspaceOperationContext) => Promise<string>
      fileExists: (filePath: string) => Promise<boolean>
      isDirectory: (filePath: string) => Promise<boolean>

      // 窗口操作
      minimize: () => void
      maximize: () => void
      close: () => void

      // 事件监听
      onFileChange: (callback: (event: unknown, data: unknown) => void) => () => void

      // 文件监听事件
      onFileChanged: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => () => void
      onFileAdded: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => () => void
      onFileRemoved: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => () => void

      // v1.3 新增文件监听事件
      onFolderAdded: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => () => void
      onFolderRemoved: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => () => void
      onFileRenamed: (callback: (event: { workspaceId: string; lifecycleEpoch: number; oldPath?: string; newPath?: string }) => void) => () => void

      // v1.3 新增：Tab 右键菜单事件
      onTabClose: (callback: (tabId: string) => void) => () => void
      onTabCloseOthers: (callback: (tabId: string) => void) => () => void
      onTabCloseAll: (callback: () => void) => () => void
      onTabCloseLeft: (callback: (tabId: string) => void) => () => void
      onTabCloseRight: (callback: (tabId: string) => void) => () => void

      // v1.5.1：分屏打开（支持方向选择）
      onTabOpenInSplit: (callback: (data: { tabId: string; direction: 'horizontal' | 'vertical' }) => void) => () => void

      // v1.5.1：文件树右键菜单"在分屏中打开"
      onFileOpenInSplit: (callback: (data: { filePath: string; direction: 'horizontal' | 'vertical' }) => void) => () => void

      // v1.3.6：Tab 固定/取消固定事件
      onTabPin: (callback: (tabId: string) => void) => () => void
      onTabUnpin: (callback: (tabId: string) => void) => () => void
      onTabAddBookmark: (callback: (data: { tabId: string; filePath: string }) => void) => () => void

      // v1.3 阶段 2：Markdown 右键菜单事件
      onMarkdownExportHTML: (callback: () => void) => () => void
      onMarkdownExportPDF: (callback: () => void) => () => void
      onMarkdownExportDOCX: (callback: () => void) => () => void
      onMarkdownCopySource: (callback: () => void) => () => void
      onMarkdownCopyPlainText: (callback: () => void) => () => void
      onMarkdownCopyHTML: (callback: () => void) => () => void

      // 右键菜单事件 (v1.2 阶段 1)
      onFileDeleted: (callback: (filePath: string) => void) => () => void
      onFileStartRename: (callback: (filePath: string) => void) => () => void
      onDocumentMarksChanged: (callback: () => void) => () => void
      onFileDuplicateRequest: (callback: (filePath: string) => void) => () => void
      onFileMoveToRequest: (callback: (file: { path: string; isDirectory: boolean }) => void) => () => void
      onFileExportRequest: (
        callback: (data: { path: string; type: 'html' | 'pdf' }) => void
      ) => () => void
      onError: (callback: (error: { message: string }) => void) => () => void

      // 剪贴板事件 (v1.2 阶段 2)
      onClipboardCopy: (callback: (paths: string[]) => void) => () => void
      onClipboardCut: (callback: (paths: string[]) => void) => () => void
      onClipboardPaste: (callback: (targetDir: string) => void) => () => void

      // 其他事件
      onRestoreFolder: (callback: (activation: FolderActivation) => void) => () => void

      // v1.3.4：打开特定文件事件
      onOpenSpecificFile: (callback: (filePath: string) => void) => () => void

      // 快捷键事件 (v1.2.1)
      onShortcutOpenFolder: (callback: () => void) => () => void
      onShortcutRefresh: (callback: () => void) => () => void
      onShortcutCloseTab: (callback: () => void) => () => void
      onShortcutExportHTML: (callback: () => void) => () => void
      onShortcutExportPDF: (callback: () => void) => () => void
      onShortcutFocusSearch: (callback: () => void) => () => void
      onShortcutNextTab: (callback: () => void) => () => void
      onShortcutPrevTab: (callback: () => void) => () => void
      onShortcutSwitchTab: (callback: (tabIndex: number) => void) => () => void
      onShortcutAddBookmark: (callback: () => void) => () => void
      onShortcutSettings: (callback: () => void) => () => void

      // v1.3.7：预览区域右键菜单
      showPreviewContextMenu: (params: {
        filePath: string
        tabId?: string
        leafId?: string | null
        headingId: string | null
        headingText: string | null
        headingLevel: string | null
        hasSelection: boolean
        selectionText?: string
        sourceLine?: number | null
        scrollRatio?: number | null
        chartCount?: number
        linkHref: string | null
        basePath: string | null
      }) => Promise<void>
      onAddBookmarkFromPreview: (callback: (params: {
        filePath: string
        headingId: string | null
        headingText: string | null
      }) => void) => () => void
      onQuickEditFromPreview: (callback: (params: {
        filePath: string
        tabId?: string
        leafId?: string | null
        canonicalPath?: string
        targetText?: string
        targetLine?: number
        sourceLine?: number
        scrollRatio?: number
        mode: 'document' | 'selection' | 'source-line' | 'scroll-ratio'
      }) => void) => () => void
      onReadAloudFromLine: (callback: (params: { sourceLine: number | null }) => void) => () => void
      onExportChartsZipFromPreview: (callback: (params: {
        filePath: string
        tabId?: string
        leafId?: string | null
      }) => void) => () => void

      // v1.3.7：文件树右键添加书签
      onAddBookmarkFromFileTree: (callback: (params: {
        filePath: string
        fileName: string
      }) => void) => () => void

      // v1.4.0：快捷键帮助弹窗事件
      onOpenShortcutsHelp: (callback: () => void) => () => void

      // v1.4.0：页面内搜索事件（从右键菜单触发）
      onOpenInPageSearch: (callback: () => void) => () => void

      // v1.4.2：窗口置顶
      setAlwaysOnTop: (flag: boolean) => Promise<boolean>
      getAlwaysOnTop: () => Promise<boolean>
      toggleAlwaysOnTop: () => Promise<boolean>
      onAlwaysOnTopChanged: (callback: (flag: boolean) => void) => () => void
      onShortcutToggleAlwaysOnTop: (callback: () => void) => () => void

      // v1.4.3：全屏查看
      setFullScreen: (flag: boolean) => Promise<boolean>
      isFullScreen: () => Promise<boolean>
      toggleFullScreen: () => Promise<boolean>

      // v1.4.2：打印
      print: () => Promise<{ success: boolean }>
      onShortcutPrint: (callback: () => void) => () => void
      onShortcutToggleReadAloud: (callback: () => void) => () => void

      // v1.4.2：字体大小调节
      onShortcutFontIncrease: (callback: () => void) => () => void
      onShortcutFontDecrease: (callback: () => void) => () => void
      onShortcutFontReset: (callback: () => void) => () => void

      // v1.5.1：拖拽支持
      getPathForFile: (file: File) => string
      openDroppedPaths: (paths: string[]) => Promise<void>

      // v1.5.1：内部 .md 链接跳转
      resolveMdLink: (currentFilePath: string, href: string) => Promise<{
        success: boolean
        targetPath?: string
        targetLine?: number
        headingId?: string
        error?: string
      }>
      openMdLink: (currentFilePath: string, href: string) => Promise<{ success: boolean; error?: string }>

      // 书签右键菜单
      showBookmarkContextMenu: (bookmark: {
        id: string
        filePath: string
        fileName: string
        headingText?: string
      }) => Promise<void>
      onBookmarkDelete: (callback: (bookmarkId: string) => void) => () => void

      // 最近文件右键菜单
      showRecentFileContextMenu: (file: {
        filePath: string
        fileName: string
      }) => Promise<void>
      onRecentFileRemove: (callback: (filePath: string) => void) => () => void

      // v1.6.0：多窗口支持
      getWindowId: () => Promise<number | null>
      getWorkspaceBootstrap: () => Promise<{
        activeWorkspaceId: string | null
        workspaces: Array<{ id: string; primaryRoot: string | null; lifecycleEpoch: number }>
        restoredRuntime?: {
          activeWorkspaceId: string | null
          workspaces: Array<{
            id: string
            name: string
            primaryRoot: string | null
            tabs: Array<{ id: string; relativePath: string; isPinned?: boolean }>
            activeTabId: string | null
            splitState: unknown
          }>
        } | null
      }>
      saveWorkspaceDesktopRuntime: (runtime: {
        activeWorkspaceId: string | null
        workspaces: Array<{
          id: string
          name: string
          primaryRoot: string | null
          lifecycleEpoch: number
          tabs: Array<{ id: string; filePath: string; isPinned?: boolean }>
          activeTabId: string | null
          splitState: unknown
        }>
      }) => Promise<void>
      requestPendingWorkspaceSource: () => Promise<{ nonce: string } | null>
      activateWorkspace: (workspaceId: string) => Promise<{
        id: string; primaryRoot: string | null; lifecycleEpoch: number
      }>
      createWorkspace: () => Promise<{
        id: string; primaryRoot: string | null; lifecycleEpoch: number
      }>
      onWorkspaceCreated: (callback: (workspace: {
        id: string; primaryRoot: string | null; lifecycleEpoch: number
      }) => void) => () => void
      closeWorkspace: (workspaceId: string) => Promise<{ activeWorkspaceId: string | null }>
      pruneInactiveWorkspaces: (request: {
        expectedActiveWorkspaceId: string
        candidates: Array<{ workspaceId: string; lifecycleEpoch: number; primaryRoot: string | null }>
      }) => Promise<{ removedWorkspaceIds: string[]; activeWorkspaceId: string | null }>
      updateWorkspacePresentations: (presentations: Array<{
        workspaceId: string
        lifecycleEpoch: number
        label: string
        isEmptyPlaceholder: boolean
        hasMeaningfulState: boolean
        tabCount: number
        activeTabName: string | null
        tabNames: string[]
        hasSplit: boolean
        hasDraft: boolean
      }>) => Promise<{ applied: boolean }>
      listWorkspaceMergeSources: () => Promise<Array<{
        windowId: number
        title: string
        workspaceCount: number
        summary: string
        workspaces: Array<{ id: string; name: string; summary: string }>
      }>>
      onWorkspaceMergeSourcesChanged: (callback: () => void) => () => void
      beginWindowTransfer: (sourceWindowId: number) => Promise<{ nonce: string | null; closedEmptyWindow: boolean }>
      submitWindowTransferSnapshots: (nonce: string, snapshots: Array<{
        workspaceId: string
        name: string
        primaryRoot: string | null
        lifecycleEpoch: number
        tabs: Array<{ id: string; filePath: string; isPinned?: boolean }>
        activeTabId: string | null
        splitState: unknown
      }>) => Promise<void>
      consumeWindowTransferSnapshots: (nonce: string) => Promise<Array<{
        workspaceId: string
        name: string
        primaryRoot: string | null
        lifecycleEpoch: number
        tabs: Array<{ id: string; filePath: string; isPinned?: boolean }>
        activeTabId: string | null
        splitState: unknown
      }>>
      stageWindowTransfer: (nonce: string) => Promise<void>
      completeWindowTransfer: (nonce: string) => Promise<{
        workspaces: Array<{ sourceWorkspaceId: string; targetWorkspaceId: string; primaryRoot: string | null; lifecycleEpoch: number }>
        activeWorkspaceId: string
      }>
      cancelWindowTransfer: (nonce: string) => Promise<void>
      onWindowExportRequested: (callback: (payload: {
        nonce: string
        sourceActiveWorkspaceId: string | null
        workspaces: Array<{ workspaceId: string; sourceLifecycleEpoch: number; primaryRoot: string | null }>
      }) => void) => () => void
      onWindowTransferReady: (callback: (payload: { nonce: string }) => void) => () => void
      splitActiveWorkspace: (workspaceId: string) => Promise<{ nonce: string; targetWindowId: number }>
      beginWorkspaceTransfer: (sourceWindowId: number, workspaceId: string) => Promise<{ nonce: string }>
      submitWorkspaceTransferSnapshot: (nonce: string, snapshot: {
        workspaceId: string
        name: string
        primaryRoot: string | null
        lifecycleEpoch: number
        tabs: Array<{ id: string; filePath: string; isPinned?: boolean }>
        activeTabId: string | null
        splitState: unknown
      }) => Promise<void>
      consumeWorkspaceTransferSnapshot: (nonce: string) => Promise<{
        workspaceId: string
        name: string
        primaryRoot: string | null
        lifecycleEpoch: number
        tabs: Array<{ id: string; filePath: string; isPinned?: boolean }>
        activeTabId: string | null
        splitState: unknown
      }>
      stageWorkspaceTransfer: (nonce: string) => Promise<void>
      completeWorkspaceTransfer: (nonce: string) => Promise<{
        id: string; primaryRoot: string | null; lifecycleEpoch: number; replacedWorkspaceId: string | null
      }>
      cancelWorkspaceTransfer: (nonce: string) => Promise<void>
      onWorkspaceRestoreRuntime: (callback: (payload: {
        activeWorkspaceId: string | null
        workspaces: Array<{
          id: string
          name: string
          primaryRoot: string | null
          tabs: Array<{ id: string; relativePath: string; isPinned?: boolean }>
          activeTabId: string | null
          splitState: unknown
        }>
      }) => void) => () => void
      onWorkspaceExportRequested: (callback: (payload: { nonce: string; workspaceId: string; sourceLifecycleEpoch: number; targetWindowId: number }) => void) => () => void
      onWorkspaceTransferReady: (callback: (payload: { nonce: string }) => void) => () => void
      onWorkspaceTransferCancelled: (callback: (payload: { nonce: string; reason?: string }) => void) => () => void
      onWorkspaceTransferredOut: (callback: (payload: { workspaceId: string; activeWorkspaceId: string | null }) => void) => () => void
      onWorkspaceFolderActivated: (callback: (payload: { workspaceId: string; path: string; lifecycleEpoch: number }) => void) => () => void
      newWindow: () => Promise<number>
      newWindowWithFolder: () => Promise<number | null>
      getWindowCount: () => Promise<number>
      onShortcutNewWindow: (callback: () => void) => () => void
      onShortcutNewWindowFolder: (callback: () => void) => () => void
      onBookmarksChanged: (callback: () => void) => () => void

      // v1.5.2：版本信息与更新检测
      getAppVersion: () => Promise<{
        version: string; electron: string; chrome: string;
        node: string; platform: string; arch: string
      }>
      checkForUpdates: () => Promise<{
        hasUpdate?: boolean; currentVersion?: string; latestVersion?: string;
        releaseUrl?: string; releaseNotes?: string; publishedAt?: string;
        error?: string
      }>
    }
  }

  interface FileInfo {
    name: string
    path: string
    treePath?: string
    isDirectory: boolean
    children?: FileInfo[]
  }
}
