import { ElectronAPI } from '@electron-toolkit/preload'

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
      openFolder: () => Promise<string | null>
      readDir: (path: string) => Promise<FileInfo[]>
      readFile: (path: string) => Promise<string>

      // 文件监听 (v1.1) - 只监听已打开的文件
      watchFolder: (path: string) => Promise<{ success: boolean }>
      watchFile: (path: string) => Promise<{ success: boolean }>
      unwatchFolder: () => Promise<{ success: boolean }>

      // 导出功能
      exportHTML: (htmlContent: string, fileName: string) => Promise<string | null>
      exportPDF: (htmlContent: string, fileName: string) => Promise<string | null>
      exportDOCX: (htmlContent: string, fileName: string, basePath: string, markdown?: string) => Promise<{ filePath: string; warnings: string[]; usedPandoc?: boolean } | null>

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
        basePath: string
      ) => Promise<{ success: boolean }>
      renameFile: (oldPath: string, newName: string) => Promise<string>

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
      syncClipboardState: (files: string[], isCut: boolean) => Promise<void>
      queryClipboardState: () => Promise<{ files: string[]; isCut: boolean; hasFiles: boolean }>

      // v1.3 阶段 6：跨应用剪贴板
      readSystemClipboard: () => Promise<Array<{ path: string; exists: boolean; isAllowed: boolean; reason?: string }>>
      writeSystemClipboard: (paths: string[], isCut: boolean) => Promise<boolean>
      hasSystemClipboardFiles: () => Promise<boolean>

      // v1.4：Shell 操作
      showItemInFolder: (filePath: string) => Promise<{ success: boolean }>
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>

      // v1.3.4：历史文件夹
      getFolderHistory: () => Promise<Array<{ path: string; name: string; lastOpened: number }>>
      removeFolderFromHistory: (folderPath: string) => Promise<void>
      clearFolderHistory: () => Promise<void>
      setFolderPath: (folderPath: string) => Promise<boolean>

      // v1.3.6：最近文件
      getRecentFiles: () => Promise<Array<{ path: string; name: string; folderPath: string; lastOpened: number }>>
      addRecentFile: (file: { path: string; name: string; folderPath: string }) => Promise<void>
      removeRecentFile: (filePath: string) => Promise<void>
      clearRecentFiles: () => Promise<void>

      // v1.3.6：固定标签（按文件夹分组）
      getPinnedTabsForFolder: (folderPath: string) => Promise<Array<{ path: string; order: number }>>
      addPinnedTab: (filePath: string) => Promise<boolean>
      removePinnedTab: (filePath: string) => Promise<void>
      isTabPinned: (filePath: string) => Promise<boolean>

      // v1.3.6：应用设置
      getAppSettings: () => Promise<{ imageDir: string; autoSave: boolean; bookmarkPanelWidth: number; bookmarkPanelCollapsed: boolean; bookmarkBarCollapsed: boolean }>
      updateAppSettings: (updates: Partial<{ imageDir: string; autoSave: boolean; bookmarkPanelWidth: number; bookmarkPanelCollapsed: boolean; bookmarkBarCollapsed: boolean }>) => Promise<void>

      // v1.3.6：书签管理
      getBookmarks: () => Promise<Array<Bookmark>>
      addBookmark: (bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'order'>) => Promise<Bookmark>
      updateBookmark: (id: string, updates: Partial<Omit<Bookmark, 'id' | 'createdAt'>>) => Promise<void>
      removeBookmark: (id: string) => Promise<void>
      updateAllBookmarks: (bookmarks: Bookmark[]) => Promise<void>
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
      openSystemSettings: (section: string) => Promise<{ success: boolean; error?: string }>
      confirmContextMenuEnabled: () => Promise<{ success: boolean }>

      // 文件操作 (v1.2 阶段 2)
      copyFile: (srcPath: string, destPath: string) => Promise<string>
      copyDir: (srcPath: string, destPath: string) => Promise<string>
      moveFile: (srcPath: string, destPath: string) => Promise<string>
      fileExists: (filePath: string) => Promise<boolean>
      isDirectory: (filePath: string) => Promise<boolean>

      // 窗口操作
      minimize: () => void
      maximize: () => void
      close: () => void

      // 事件监听
      onFileChange: (callback: (event: unknown, data: unknown) => void) => () => void

      // 文件监听事件 (v1.1)
      onFileChanged: (callback: (filePath: string) => void) => () => void
      onFileAdded: (callback: (filePath: string) => void) => () => void
      onFileRemoved: (callback: (filePath: string) => void) => () => void

      // v1.3 新增文件监听事件
      onFolderAdded: (callback: (dirPath: string) => void) => () => void
      onFolderRemoved: (callback: (dirPath: string) => void) => () => void
      onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => () => void

      // v1.3 新增：Tab 右键菜单事件
      onTabClose: (callback: (tabId: string) => void) => () => void
      onTabCloseOthers: (callback: (tabId: string) => void) => () => void
      onTabCloseAll: (callback: () => void) => () => void
      onTabCloseLeft: (callback: (tabId: string) => void) => () => void
      onTabCloseRight: (callback: (tabId: string) => void) => () => void

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
      onFileExportRequest: (
        callback: (data: { path: string; type: 'html' | 'pdf' }) => void
      ) => () => void
      onError: (callback: (error: { message: string }) => void) => () => void

      // 剪贴板事件 (v1.2 阶段 2)
      onClipboardCopy: (callback: (paths: string[]) => void) => () => void
      onClipboardCut: (callback: (paths: string[]) => void) => () => void
      onClipboardPaste: (callback: (targetDir: string) => void) => () => void

      // 其他事件
      onRestoreFolder: (callback: (folderPath: string) => void) => () => void

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

      // v1.3.7：预览区域右键菜单
      showPreviewContextMenu: (params: {
        filePath: string
        headingId: string | null
        headingText: string | null
        headingLevel: string | null
        hasSelection: boolean
      }) => Promise<void>
      onAddBookmarkFromPreview: (callback: (params: {
        filePath: string
        headingId: string | null
        headingText: string | null
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

      // v1.4.2：字体大小调节
      onShortcutFontIncrease: (callback: () => void) => () => void
      onShortcutFontDecrease: (callback: () => void) => () => void
      onShortcutFontReset: (callback: () => void) => () => void
    }
  }

  interface FileInfo {
    name: string
    path: string
    isDirectory: boolean
    children?: FileInfo[]
  }
}
