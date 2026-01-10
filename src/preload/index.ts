import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 自定义 API 暴露给渲染进程
const api = {
  // 文件系统操作 (v1.0 核心功能)
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),

  // 文件监听 (v1.1 新增) - 只监听已打开的文件
  watchFolder: (path: string) => ipcRenderer.invoke('fs:watchFolder', path),
  watchFile: (path: string) => ipcRenderer.invoke('fs:watchFile', path),
  unwatchFolder: () => ipcRenderer.invoke('fs:unwatchFolder'),

  // 导出功能
  exportHTML: (htmlContent: string, fileName: string) => ipcRenderer.invoke('export:html', htmlContent, fileName),
  exportPDF: (htmlContent: string, fileName: string) => ipcRenderer.invoke('export:pdf', htmlContent, fileName),

  // 右键菜单 (v1.2 阶段 1 新增)
  showContextMenu: (file: { name: string; path: string; isDirectory: boolean }, basePath: string) =>
    ipcRenderer.invoke('context-menu:show', file, basePath),
  renameFile: (oldPath: string, newName: string) => ipcRenderer.invoke('fs:rename', oldPath, newName),

  // v1.3 新增：Tab 右键菜单
  showTabContextMenu: (ctx: {
    tabId: string
    filePath: string
    basePath: string
    tabCount: number
    tabIndex: number
    isPinned?: boolean  // v1.3.6 新增
  }) => ipcRenderer.invoke('tab:show-context-menu', ctx),

  // v1.3 阶段 2：Markdown 右键菜单
  showMarkdownContextMenu: (ctx: {
    filePath: string
    hasSelection: boolean
  }) => ipcRenderer.invoke('markdown:show-context-menu', ctx),

  // v1.3.7：预览区域右键菜单（添加书签 + 原有功能）
  showPreviewContextMenu: (params: {
    filePath: string
    headingId: string | null
    headingText: string | null
    headingLevel: string | null
    hasSelection: boolean
  }) => ipcRenderer.invoke('preview:show-context-menu', params),

  // v1.3 阶段 3：剪贴板状态同步
  syncClipboardState: (files: string[], isCut: boolean) =>
    ipcRenderer.invoke('clipboard:sync-state', files, isCut),
  queryClipboardState: () =>
    ipcRenderer.invoke('clipboard:query-state') as Promise<{ files: string[]; isCut: boolean; hasFiles: boolean }>,

  // v1.3 阶段 6：跨应用剪贴板
  readSystemClipboard: () =>
    ipcRenderer.invoke('clipboard:read-system') as Promise<Array<{ path: string; exists: boolean; isAllowed: boolean; reason?: string }>>,
  writeSystemClipboard: (paths: string[], isCut: boolean) =>
    ipcRenderer.invoke('clipboard:write-system', paths, isCut) as Promise<boolean>,
  hasSystemClipboardFiles: () =>
    ipcRenderer.invoke('clipboard:has-system-files') as Promise<boolean>,

  // v1.4：Shell 操作
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke('shell:showItemInFolder', filePath) as Promise<{ success: boolean }>,

  // v1.3.4：历史文件夹
  getFolderHistory: () =>
    ipcRenderer.invoke('folder-history:get') as Promise<Array<{ path: string; name: string; lastOpened: number }>>,
  removeFolderFromHistory: (folderPath: string) =>
    ipcRenderer.invoke('folder-history:remove', folderPath),
  clearFolderHistory: () =>
    ipcRenderer.invoke('folder-history:clear'),
  setFolderPath: (folderPath: string) =>
    ipcRenderer.invoke('folder:setPath', folderPath) as Promise<boolean>,

  // v1.3.6：最近文件
  getRecentFiles: () =>
    ipcRenderer.invoke('recent-files:get') as Promise<Array<{ path: string; name: string; folderPath: string; lastOpened: number }>>,
  addRecentFile: (file: { path: string; name: string; folderPath: string }) =>
    ipcRenderer.invoke('recent-files:add', file),
  removeRecentFile: (filePath: string) =>
    ipcRenderer.invoke('recent-files:remove', filePath),
  clearRecentFiles: () =>
    ipcRenderer.invoke('recent-files:clear'),

  // v1.3.6：固定标签（按文件夹分组）
  getPinnedTabsForFolder: (folderPath: string) =>
    ipcRenderer.invoke('pinned-tabs:get-for-folder', folderPath) as Promise<Array<{ path: string; order: number }>>,
  addPinnedTab: (filePath: string) =>
    ipcRenderer.invoke('pinned-tabs:add', filePath) as Promise<boolean>,
  removePinnedTab: (filePath: string) =>
    ipcRenderer.invoke('pinned-tabs:remove', filePath),
  isTabPinned: (filePath: string) =>
    ipcRenderer.invoke('pinned-tabs:is-pinned', filePath) as Promise<boolean>,

  // v1.3.6：应用设置
  getAppSettings: () =>
    ipcRenderer.invoke('settings:get') as Promise<{ imageDir: string; autoSave: boolean; bookmarkPanelWidth: number; bookmarkPanelCollapsed: boolean; bookmarkBarCollapsed: boolean }>,
  updateAppSettings: (updates: Partial<{ imageDir: string; autoSave: boolean; bookmarkPanelWidth: number; bookmarkPanelCollapsed: boolean; bookmarkBarCollapsed: boolean }>) =>
    ipcRenderer.invoke('settings:update', updates),

  // v1.3.6：书签管理
  getBookmarks: () =>
    ipcRenderer.invoke('bookmarks:get') as Promise<Array<{
      id: string
      filePath: string
      fileName: string
      title?: string
      headingId?: string
      headingText?: string
      scrollPosition?: number
      createdAt: number
      order: number
    }>>,
  addBookmark: (bookmark: {
    filePath: string
    fileName: string
    title?: string
    headingId?: string
    headingText?: string
    scrollPosition?: number
  }) =>
    ipcRenderer.invoke('bookmarks:add', bookmark) as Promise<{
      id: string
      filePath: string
      fileName: string
      title?: string
      headingId?: string
      headingText?: string
      scrollPosition?: number
      createdAt: number
      order: number
    }>,
  updateBookmark: (id: string, updates: {
    title?: string
    headingId?: string
    headingText?: string
    scrollPosition?: number
    order?: number
  }) =>
    ipcRenderer.invoke('bookmarks:update', id, updates),
  removeBookmark: (id: string) =>
    ipcRenderer.invoke('bookmarks:remove', id),
  updateAllBookmarks: (bookmarks: Array<{
    id: string
    filePath: string
    fileName: string
    title?: string
    headingId?: string
    headingText?: string
    scrollPosition?: number
    createdAt: number
    order: number
  }>) =>
    ipcRenderer.invoke('bookmarks:update-all', bookmarks),
  clearBookmarks: () =>
    ipcRenderer.invoke('bookmarks:clear'),

  // v1.3.4：右键菜单安装
  checkContextMenuStatus: () =>
    ipcRenderer.invoke('context-menu:check-status') as Promise<{
      installed: boolean
      platform: string
      installedAt?: number
      userConfirmedEnabled?: boolean
    }>,
  installContextMenu: () =>
    ipcRenderer.invoke('context-menu:install') as Promise<{
      success: boolean
      error?: string
    }>,
  uninstallContextMenu: () =>
    ipcRenderer.invoke('context-menu:uninstall') as Promise<{
      success: boolean
      error?: string
    }>,
  openSystemSettings: (section: string) =>
    ipcRenderer.invoke('system:openSettings', section) as Promise<{
      success: boolean
      error?: string
    }>,
  confirmContextMenuEnabled: () =>
    ipcRenderer.invoke('context-menu:confirm-enabled') as Promise<{
      success: boolean
    }>,

  // 文件操作 (v1.2 阶段 2 新增)
  copyFile: (srcPath: string, destPath: string) => ipcRenderer.invoke('fs:copyFile', srcPath, destPath),
  copyDir: (srcPath: string, destPath: string) => ipcRenderer.invoke('fs:copyDir', srcPath, destPath),
  moveFile: (srcPath: string, destPath: string) => ipcRenderer.invoke('fs:moveFile', srcPath, destPath),
  fileExists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
  isDirectory: (filePath: string) => ipcRenderer.invoke('fs:isDirectory', filePath),

  // 窗口操作
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // 事件监听
  onFileChange: (callback: (event: unknown, data: unknown) => void) => {
    ipcRenderer.on('fs:fileChanged', callback)
    return () => ipcRenderer.removeListener('fs:fileChanged', callback)
  },

  // 文件监听事件 (v1.1 新增)
  onFileChanged: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:changed', handler)
    return () => ipcRenderer.removeListener('file:changed', handler)
  },

  onFileAdded: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:added', handler)
    return () => ipcRenderer.removeListener('file:added', handler)
  },

  onFileRemoved: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:removed', handler)
    return () => ipcRenderer.removeListener('file:removed', handler)
  },

  // v1.3 新增：文件夹添加事件
  onFolderAdded: (callback: (dirPath: string) => void) => {
    const handler = (_event: unknown, dirPath: string) => callback(dirPath)
    ipcRenderer.on('folder:added', handler)
    return () => ipcRenderer.removeListener('folder:added', handler)
  },

  // v1.3 新增：文件夹删除事件
  onFolderRemoved: (callback: (dirPath: string) => void) => {
    const handler = (_event: unknown, dirPath: string) => callback(dirPath)
    ipcRenderer.on('folder:removed', handler)
    return () => ipcRenderer.removeListener('folder:removed', handler)
  },

  // v1.3 新增：文件重命名事件
  onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => {
    const handler = (_event: unknown, data: { oldPath: string; newPath: string }) => callback(data)
    ipcRenderer.on('file:renamed', handler)
    return () => ipcRenderer.removeListener('file:renamed', handler)
  },

  // 监听恢复文件夹事件
  onRestoreFolder: (callback: (folderPath: string) => void) => {
    const handler = (_event: unknown, folderPath: string) => callback(folderPath)
    ipcRenderer.on('restore-folder', handler)
    return () => ipcRenderer.removeListener('restore-folder', handler)
  },

  // v1.3.4：监听打开特定文件事件
  onOpenSpecificFile: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('open-specific-file', handler)
    return () => ipcRenderer.removeListener('open-specific-file', handler)
  },

  // v1.3 新增：Tab 右键菜单事件
  onTabClose: (callback: (tabId: string) => void) => {
    const handler = (_event: unknown, tabId: string) => callback(tabId)
    ipcRenderer.on('tab:close', handler)
    return () => ipcRenderer.removeListener('tab:close', handler)
  },

  onTabCloseOthers: (callback: (tabId: string) => void) => {
    const handler = (_event: unknown, tabId: string) => callback(tabId)
    ipcRenderer.on('tab:close-others', handler)
    return () => ipcRenderer.removeListener('tab:close-others', handler)
  },

  onTabCloseAll: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('tab:close-all', handler)
    return () => ipcRenderer.removeListener('tab:close-all', handler)
  },

  onTabCloseLeft: (callback: (tabId: string) => void) => {
    const handler = (_event: unknown, tabId: string) => callback(tabId)
    ipcRenderer.on('tab:close-left', handler)
    return () => ipcRenderer.removeListener('tab:close-left', handler)
  },

  onTabCloseRight: (callback: (tabId: string) => void) => {
    const handler = (_event: unknown, tabId: string) => callback(tabId)
    ipcRenderer.on('tab:close-right', handler)
    return () => ipcRenderer.removeListener('tab:close-right', handler)
  },

  // v1.3.6：Tab 固定/取消固定事件
  onTabPin: (callback: (tabId: string) => void) => {
    const handler = (_event: unknown, tabId: string) => callback(tabId)
    ipcRenderer.on('tab:pin', handler)
    return () => ipcRenderer.removeListener('tab:pin', handler)
  },

  onTabUnpin: (callback: (tabId: string) => void) => {
    const handler = (_event: unknown, tabId: string) => callback(tabId)
    ipcRenderer.on('tab:unpin', handler)
    return () => ipcRenderer.removeListener('tab:unpin', handler)
  },

  // v1.3.6：添加书签事件
  onTabAddBookmark: (callback: (data: { tabId: string; filePath: string }) => void) => {
    const handler = (_event: unknown, data: { tabId: string; filePath: string }) => callback(data)
    ipcRenderer.on('tab:add-bookmark', handler)
    return () => ipcRenderer.removeListener('tab:add-bookmark', handler)
  },

  // v1.3 阶段 2：Markdown 右键菜单事件
  onMarkdownExportHTML: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('markdown:export-html', handler)
    return () => ipcRenderer.removeListener('markdown:export-html', handler)
  },

  onMarkdownExportPDF: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('markdown:export-pdf', handler)
    return () => ipcRenderer.removeListener('markdown:export-pdf', handler)
  },

  onMarkdownCopySource: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('markdown:copy-source', handler)
    return () => ipcRenderer.removeListener('markdown:copy-source', handler)
  },

  onMarkdownCopyPlainText: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('markdown:copy-plain-text', handler)
    return () => ipcRenderer.removeListener('markdown:copy-plain-text', handler)
  },

  onMarkdownCopyHTML: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('markdown:copy-html', handler)
    return () => ipcRenderer.removeListener('markdown:copy-html', handler)
  },

  // 右键菜单事件 (v1.2 阶段 1 新增)
  onFileDeleted: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:deleted', handler)
    return () => ipcRenderer.removeListener('file:deleted', handler)
  },

  onFileStartRename: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:start-rename', handler)
    return () => ipcRenderer.removeListener('file:start-rename', handler)
  },

  onFileExportRequest: (callback: (data: { path: string; type: 'html' | 'pdf' }) => void) => {
    const handler = (_event: unknown, data: { path: string; type: 'html' | 'pdf' }) => callback(data)
    ipcRenderer.on('file:export-request', handler)
    return () => ipcRenderer.removeListener('file:export-request', handler)
  },

  onError: (callback: (error: { message: string }) => void) => {
    const handler = (_event: unknown, error: { message: string }) => callback(error)
    ipcRenderer.on('error:show', handler)
    return () => ipcRenderer.removeListener('error:show', handler)
  },

  // 剪贴板事件 (v1.2 阶段 2 新增)
  onClipboardCopy: (callback: (paths: string[]) => void) => {
    const handler = (_event: unknown, paths: string[]) => callback(paths)
    ipcRenderer.on('clipboard:copy', handler)
    return () => ipcRenderer.removeListener('clipboard:copy', handler)
  },

  onClipboardCut: (callback: (paths: string[]) => void) => {
    const handler = (_event: unknown, paths: string[]) => callback(paths)
    ipcRenderer.on('clipboard:cut', handler)
    return () => ipcRenderer.removeListener('clipboard:cut', handler)
  },

  onClipboardPaste: (callback: (targetDir: string) => void) => {
    const handler = (_event: unknown, targetDir: string) => callback(targetDir)
    ipcRenderer.on('clipboard:paste', handler)
    return () => ipcRenderer.removeListener('clipboard:paste', handler)
  },

  // 快捷键事件 (v1.2.1 新增)
  onShortcutOpenFolder: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:open-folder', handler)
    return () => ipcRenderer.removeListener('shortcut:open-folder', handler)
  },

  onShortcutRefresh: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:refresh', handler)
    return () => ipcRenderer.removeListener('shortcut:refresh', handler)
  },

  onShortcutCloseTab: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:close-tab', handler)
    return () => ipcRenderer.removeListener('shortcut:close-tab', handler)
  },

  onShortcutExportHTML: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:export-html', handler)
    return () => ipcRenderer.removeListener('shortcut:export-html', handler)
  },

  onShortcutExportPDF: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:export-pdf', handler)
    return () => ipcRenderer.removeListener('shortcut:export-pdf', handler)
  },

  onShortcutFocusSearch: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:focus-search', handler)
    return () => ipcRenderer.removeListener('shortcut:focus-search', handler)
  },

  onShortcutNextTab: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:next-tab', handler)
    return () => ipcRenderer.removeListener('shortcut:next-tab', handler)
  },

  onShortcutPrevTab: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:prev-tab', handler)
    return () => ipcRenderer.removeListener('shortcut:prev-tab', handler)
  },

  onShortcutSwitchTab: (callback: (tabIndex: number) => void) => {
    const handler = (_event: unknown, tabIndex: number) => callback(tabIndex)
    ipcRenderer.on('shortcut:switch-tab', handler)
    return () => ipcRenderer.removeListener('shortcut:switch-tab', handler)
  },

  // v1.3.6：添加书签快捷键
  onShortcutAddBookmark: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:add-bookmark', handler)
    return () => ipcRenderer.removeListener('shortcut:add-bookmark', handler)
  },

  // v1.3.7：预览区域右键菜单事件
  onAddBookmarkFromPreview: (callback: (params: {
    filePath: string
    headingId: string | null
    headingText: string | null
  }) => void) => {
    const handler = (_event: unknown, params: {
      filePath: string
      headingId: string | null
      headingText: string | null
    }) => callback(params)
    ipcRenderer.on('add-bookmark-from-preview', handler)
    return () => ipcRenderer.removeListener('add-bookmark-from-preview', handler)
  },

  // v1.3.7：文件树右键菜单事件
  onAddBookmarkFromFileTree: (callback: (params: {
    filePath: string
    fileName: string
  }) => void) => {
    const handler = (_event: unknown, params: {
      filePath: string
      fileName: string
    }) => callback(params)
    ipcRenderer.on('add-bookmark-from-file-tree', handler)
    return () => ipcRenderer.removeListener('add-bookmark-from-file-tree', handler)
  },

  // v1.4.0：快捷键帮助弹窗事件
  onOpenShortcutsHelp: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('open-shortcuts-help', handler)
    return () => ipcRenderer.removeListener('open-shortcuts-help', handler)
  },

  // v1.4.0：页面内搜索事件（从右键菜单触发）
  onOpenInPageSearch: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:open-in-page-search', handler)
    return () => ipcRenderer.removeListener('shortcut:open-in-page-search', handler)
  },

  // ============== v1.4.2：窗口置顶 ==============

  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  getAlwaysOnTop: () => ipcRenderer.invoke('window:getAlwaysOnTop') as Promise<boolean>,
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop') as Promise<boolean>,
  onAlwaysOnTopChanged: (callback: (flag: boolean) => void) => {
    const handler = (_event: unknown, flag: boolean) => callback(flag)
    ipcRenderer.on('alwaysOnTop:changed', handler)
    return () => ipcRenderer.removeListener('alwaysOnTop:changed', handler)
  },
  onShortcutToggleAlwaysOnTop: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:toggle-always-on-top', handler)
    return () => ipcRenderer.removeListener('shortcut:toggle-always-on-top', handler)
  },

  // ============== v1.4.3：全屏查看 ==============

  setFullScreen: (flag: boolean) => ipcRenderer.invoke('window:setFullScreen', flag) as Promise<boolean>,
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen') as Promise<boolean>,
  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen') as Promise<boolean>,

  // ============== v1.4.2：打印 ==============

  print: () => ipcRenderer.invoke('window:print') as Promise<{ success: boolean }>,
  onShortcutPrint: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:print', handler)
    return () => ipcRenderer.removeListener('shortcut:print', handler)
  },

  // ============== v1.4.2：字体大小调节 ==============

  onShortcutFontIncrease: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:font-increase', handler)
    return () => ipcRenderer.removeListener('shortcut:font-increase', handler)
  },
  onShortcutFontDecrease: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:font-decrease', handler)
    return () => ipcRenderer.removeListener('shortcut:font-decrease', handler)
  },
  onShortcutFontReset: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:font-reset', handler)
    return () => ipcRenderer.removeListener('shortcut:font-reset', handler)
  }
}

// 仅在 contextIsolation 启用时暴露 API
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (for legacy support)
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
