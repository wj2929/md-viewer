import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { FolderActivation, WorkspaceOperationContext } from '../shared/workspace'
import type { WorkspaceTransferSnapshot } from '../main/workspaceTransferCoordinator'
import type { DocumentMarkColor } from '../shared/documentMarks'

// 自定义 API 暴露给渲染进程
const api = {
  // 平台信息（同步，供渲染进程直接使用）
  platform: process.platform as 'darwin' | 'win32' | 'linux',

  // 文件系统操作 (v1.0 核心功能)
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
  listChildDirs: (path: string) =>
    ipcRenderer.invoke('fs:listChildDirs', path) as Promise<Array<{ name: string; path: string }>>,
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  readLocalAssetBase64: (payload: { markdownFilePath: string; refPath: string }) =>
    ipcRenderer.invoke('fs:readLocalAssetBase64', payload) as Promise<{ base64: string; mimeType: string; resolvedPath: string }>,
  readExcalidrawFile: (payload: { markdownFilePath: string; refPath: string }) =>
    ipcRenderer.invoke('fs:readExcalidrawFile', payload) as Promise<{ content: string; resolvedPath: string }>,
  readBpmnFile: (payload: { markdownFilePath: string; refPath: string }) =>
    ipcRenderer.invoke('fs:readBpmnFile', payload) as Promise<{ content: string; resolvedPath: string }>,
  readFilePreview: (path: string) => ipcRenderer.invoke('fs:readFilePreview', path) as Promise<string>,
  issueLocalImageUrl: (markdownFilePath: string, rawResourcePath: string) =>
    ipcRenderer.invoke('fs:issueLocalImageUrl', markdownFilePath, rawResourcePath) as Promise<string>,
  testOpenMarkdownFile: (path: string) =>
    ipcRenderer.invoke('test:openMarkdownFile', path) as Promise<boolean>,
  testFileClipboardAction: process.env.NODE_ENV === 'test'
    ? (action: 'copy' | 'cut' | 'paste', target: string | string[]) =>
        ipcRenderer.invoke('test:file-clipboard-action', action, target) as Promise<{ success: boolean }>
    : undefined,
  openEditableMarkdown: (filePath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('fs:openEditableMarkdown', filePath, operation) as Promise<{
      canonicalPath: string
      displayPath: string
      fileName: string
      content: string
      mtimeMs: number
      size: number
      revisionToken: string
    }>,
  saveEditableMarkdown: (payload: {
    canonicalPath: string
    content: string
    expectedRevisionToken: string
    workspace: WorkspaceOperationContext
    force?: boolean
  }) =>
    ipcRenderer.invoke('fs:saveEditableMarkdown', payload) as Promise<{
      success: boolean
      mtimeMs?: number
      size?: number
      revisionToken?: string
      conflict?: {
        reason: string
        diskRevisionToken: string
      }
    }>,

  // 搜索专用：跨文件夹访问（仅检查 PROTECTED_PATTERNS）
  searchReadDir: (path: string) => ipcRenderer.invoke('search:readDir', path),
  searchReadFile: (path: string) => ipcRenderer.invoke('search:readFile', path),

  // 文件监听：工作区上下文用于隔离异步事件；省略参数仅供旧桥接兼容。
  watchFolder: (path: string, workspaceId?: string, lifecycleEpoch?: number) =>
    ipcRenderer.invoke('fs:watchFolder', path, workspaceId, lifecycleEpoch),
  watchFile: (path: string, workspaceId?: string, lifecycleEpoch?: number) =>
    ipcRenderer.invoke('fs:watchFile', path, workspaceId, lifecycleEpoch),
  unwatchFolder: (workspaceId?: string, lifecycleEpoch?: number) =>
    ipcRenderer.invoke('fs:unwatchFolder', workspaceId, lifecycleEpoch),

  // 导出功能
  exportHTML: (htmlContent: string, fileName: string) => ipcRenderer.invoke('export:html', htmlContent, fileName),
  exportPDF: (htmlContent: string, fileName: string) => ipcRenderer.invoke('export:pdf', htmlContent, fileName),
  exportDOCX: (htmlContent: string, fileName: string, basePath: string, markdown?: string, docStyle?: string, remoteImages?: Array<{ id: string; pngBase64: string; widthCm?: number }>) =>
    ipcRenderer.invoke('export:docx', htmlContent, fileName, basePath, markdown, undefined, docStyle, remoteImages) as Promise<{ filePath: string; warnings: string[]; usedPandoc?: boolean; usedRemote?: boolean; imagesFailed?: number } | null>,
  exportChartsZip: (payload: {
    markdownFilePath: string
    images: Array<{ filename: string; pngBase64: string }>
  }) => ipcRenderer.invoke('export:charts-zip', payload) as Promise<{ filePath?: string; written?: number; canceled?: boolean; error?: string }>,

  // v1.5.1：代码块截图（用于 DOCX 导出时保持 ASCII 艺术对齐）
  renderCodeBlockToPng: (code: string) =>
    ipcRenderer.invoke('render:codeBlockToPng', code) as Promise<{
      success: boolean
      data?: string
      width?: number
      height?: number
      error?: string
    }>,

  renderSvgToPng: (svgString: string, width?: number) =>
    ipcRenderer.invoke('render:svgToPng', svgString, width) as Promise<{
      success: boolean
      data?: string
      width?: number
      height?: number
      error?: string
    }>,

  renderKrokiSvg: (payload: { format: string; source: string }) =>
    ipcRenderer.invoke('render:krokiSvg', payload) as Promise<{
      ok: boolean
      svg?: string
      error?: string
      status?: number
    }>,

  testDocxConnection: (serverUrl: string, apiKey?: string) =>
    ipcRenderer.invoke('docx:testConnection', serverUrl, apiKey) as Promise<{
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
    }>,

  runPreflight: (request: { filePath: string; formats: string[]; docxServiceUrl?: string }) =>
    ipcRenderer.invoke('preflight:run', request) as Promise<import('../shared/preflight').PreflightResult>,

  // ===== TTS 朗读 =====
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
  }) =>
    ipcRenderer.invoke('tts:synthesize', req) as Promise<{
      ok: boolean
      kind?: string
      message?: string
      audioBase64?: string
      format?: string
      boundaries?: Array<{ text: string; offsetMs: number; durationMs: number }>
    }>,
  ttsCancel: (requestId: string) =>
    ipcRenderer.invoke('tts:cancel', requestId) as Promise<{ ok: boolean }>,
  ttsListVoices: (type: string) =>
    ipcRenderer.invoke('tts:listVoices', type) as Promise<
      Array<{ id: string; name: string; lang?: string }>
    >,
  ttsTestProvider: (req: {
    providerId: string
    type: string
    text?: string
    voice?: string
    baseUrl?: string
    region?: string
    model?: string
  }) => ipcRenderer.invoke('tts:testProvider', req) as Promise<{ ok: boolean; kind?: string; message?: string }>,
  ttsSetKey: (providerId: string, apiKey: string) =>
    ipcRenderer.invoke('tts:setKey', providerId, apiKey) as Promise<{ ok: boolean; hasKey?: boolean; message?: string }>,
  ttsEncryptionAvailable: () =>
    ipcRenderer.invoke('tts:encryptionAvailable') as Promise<boolean>,

  selectReferenceDocx: () =>
    ipcRenderer.invoke('docx:selectReferenceDocx') as Promise<string | null>,

  getLastDocxExportPath: () =>
    ipcRenderer.invoke('docx:getLastExportedFile') as Promise<string | null>,

  openLastDocxExport: () =>
    ipcRenderer.invoke('docx:openLastExport') as Promise<{ ok: boolean; error?: string }>,

  // 右键菜单 (v1.2 阶段 1 新增)
  showContextMenu: (file: { name: string; path: string; isDirectory: boolean }, basePath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('context-menu:show', file, basePath, operation),
  renameFile: (oldPath: string, newName: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('fs:rename', oldPath, newName, operation),
  duplicatePath: (sourcePath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('fs:duplicate', sourcePath, operation) as Promise<{
      sourcePath: string
      newPath: string
      isDirectory: boolean
    }>,

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

  // 书签右键菜单（BookmarkBar / BookmarkPanel）
  showBookmarkContextMenu: (bookmark: {
    id: string
    filePath: string
    fileName: string
    headingText?: string
  }) => ipcRenderer.invoke('context-menu:bookmark', bookmark),

  // v1.3.7：预览区域右键菜单（添加书签 + 原有功能）
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
  }) => ipcRenderer.invoke('preview:show-context-menu', params),

  // v1.3 阶段 3：剪贴板状态同步
  syncClipboardState: (files: string[], isCut: boolean, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('clipboard:sync-state', files, isCut, operation),
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
  openExternal: (url: string) =>
    ipcRenderer.invoke('shell:openExternal', url) as Promise<{ success: boolean; error?: string }>,

  // v1.3.4：历史文件夹
  getFolderHistory: () =>
    ipcRenderer.invoke('folder-history:get') as Promise<Array<{ id: string; path: string; name: string; lastOpened: number }>>,
  removeFolderFromHistory: (historyId: string) =>
    ipcRenderer.invoke('folder-history:remove', historyId),
  clearFolderHistory: () =>
    ipcRenderer.invoke('folder-history:clear'),
  activateHistoryFolder: (historyId: string) =>
    ipcRenderer.invoke('folder-history:activate', historyId) as Promise<FolderActivation>,
  getFolderTreeState: (operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('folder-tree-state:get', operation) as Promise<Record<string, false>>,
  saveFolderTreeState: (folders: Record<string, false>, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('folder-tree-state:save', folders, operation) as Promise<Record<string, false>>,
  clearFolderTreeState: (operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('folder-tree-state:clear', operation) as Promise<void>,
  getDocumentMarks: (operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('document-marks:get', operation) as Promise<Record<string, DocumentMarkColor>>,
  setDocumentMark: (
    filePath: string,
    color: DocumentMarkColor | null,
    operation: WorkspaceOperationContext
  ) => ipcRenderer.invoke('document-marks:set', filePath, color, operation) as Promise<Record<string, DocumentMarkColor>>,
  getReadPosition: (filePath: string) =>
    ipcRenderer.invoke('read-position:get', filePath) as Promise<{
      canonicalPath: string
      scrollRatio?: number
      headingId?: string
      updatedAt: number
      contentHash?: string
    } | null>,
  saveReadPosition: (position: {
    canonicalPath: string
    scrollRatio?: number
    headingId?: string
    updatedAt?: number
    contentHash?: string
    workspace: WorkspaceOperationContext
  }) => ipcRenderer.invoke('read-position:save', position) as Promise<{
    canonicalPath: string
    scrollRatio?: number
    headingId?: string
    updatedAt: number
    contentHash?: string
  }>,
  clearReadPosition: (filePath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('read-position:clear', filePath, operation) as Promise<void>,

  // 最近文件右键菜单
  showRecentFileContextMenu: (file: {
    filePath: string
    fileName: string
  }) => ipcRenderer.invoke('context-menu:recent-file', file),

  // v1.3.6：最近文件
  getRecentFiles: () =>
    ipcRenderer.invoke('recent-files:get') as Promise<Array<{
      id: string
      path: string
      name: string
      folderPath: string
      lastOpened: number
    }>>,
  activateRecentFile: (recentId: string) =>
    ipcRenderer.invoke('recent-files:activate', recentId) as Promise<FolderActivation & {
      filePath: string
      fileName: string
    }>,
  addRecentFile: (file: { path: string; name: string; folderPath: string }) =>
    ipcRenderer.invoke('recent-files:add', file),
  removeRecentFile: (filePath: string) =>
    ipcRenderer.invoke('recent-files:remove', filePath),
  clearRecentFiles: () =>
    ipcRenderer.invoke('recent-files:clear'),

  // v1.3.6：固定标签（按文件夹分组）
  getPinnedTabsForFolder: (folderPath: string) =>
    ipcRenderer.invoke('pinned-tabs:get-for-folder', folderPath) as Promise<Array<{ path: string; order: number }>>,
  addPinnedTab: (filePath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('pinned-tabs:add', filePath, operation) as Promise<boolean>,
  removePinnedTab: (filePath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('pinned-tabs:remove', filePath, operation),
  isTabPinned: (filePath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('pinned-tabs:is-pinned', filePath, operation) as Promise<boolean>,

  // v1.3.6：应用设置
  getAppSettings: () =>
    ipcRenderer.invoke('settings:get'),
  updateAppSettings: (updates: Record<string, unknown>) =>
    ipcRenderer.invoke('settings:update', updates),
  getReadAloudSettings: () =>
    ipcRenderer.invoke('tts:getSettings'),
  updateReadAloudSettings: (settings: unknown) =>
    ipcRenderer.invoke('tts:updateSettings', settings),

  // 搜索历史（原子 IPC）
  loadSearchHistory: () =>
    ipcRenderer.invoke('search-history:load') as Promise<{ searchBarHistory: string[]; inPageSearchHistory: string[] }>,
  addSearchHistory: (type: 'searchBar' | 'inPage', keyword: string) =>
    ipcRenderer.invoke('search-history:add', type, keyword) as Promise<string[]>,
  removeSearchHistory: (type: 'searchBar' | 'inPage', keyword: string) =>
    ipcRenderer.invoke('search-history:remove', type, keyword) as Promise<string[]>,
  clearSearchHistory: (type: 'searchBar' | 'inPage') =>
    ipcRenderer.invoke('search-history:clear', type) as Promise<void>,

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
  activateBookmark: (bookmarkId: string) =>
    ipcRenderer.invoke('bookmarks:activate', bookmarkId) as Promise<FolderActivation & {
      filePath: string
      fileName: string
    }>,
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
  getCliShimStatus: () =>
    ipcRenderer.invoke('cli-shim:status') as Promise<{
      supported: boolean
      installed: boolean
      platform: 'darwin' | 'win32' | 'linux'
      path?: string
      pathInShell?: boolean
      ownedByMdViewer?: boolean
      code?: string
      message?: string
    }>,
  installCliShim: () =>
    ipcRenderer.invoke('cli-shim:install') as Promise<{
      ok: boolean
      path?: string
      pathInShell?: boolean
      nextStep?: string
      code?: string
      message?: string
    }>,
  uninstallCliShim: () =>
    ipcRenderer.invoke('cli-shim:uninstall') as Promise<{
      ok: boolean
      path?: string
      pathInShell?: boolean
      nextStep?: string
      code?: string
      message?: string
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
  copyFile: (srcPath: string, destPath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('fs:copyFile', srcPath, destPath, operation),
  copyDir: (srcPath: string, destPath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('fs:copyDir', srcPath, destPath, operation),
  moveFile: (srcPath: string, destPath: string, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('fs:moveFile', srcPath, destPath, operation),
  moveFileToFolder: (srcPath: string, targetHistoryId: string, subRelPath: string | undefined, operation: WorkspaceOperationContext) =>
    ipcRenderer.invoke('fs:moveFileToFolder', srcPath, targetHistoryId, subRelPath, operation),
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
  onFileChanged: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => {
    const handler = (_event: unknown, data: { workspaceId: string; lifecycleEpoch: number; path?: string }) => callback(data)
    ipcRenderer.on('file:changed', handler)
    return () => ipcRenderer.removeListener('file:changed', handler)
  },

  onFileAdded: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => {
    const handler = (_event: unknown, data: { workspaceId: string; lifecycleEpoch: number; path?: string }) => callback(data)
    ipcRenderer.on('file:added', handler)
    return () => ipcRenderer.removeListener('file:added', handler)
  },

  onFileRemoved: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => {
    const handler = (_event: unknown, data: { workspaceId: string; lifecycleEpoch: number; path?: string }) => callback(data)
    ipcRenderer.on('file:removed', handler)
    return () => ipcRenderer.removeListener('file:removed', handler)
  },

  onFolderAdded: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => {
    const handler = (_event: unknown, data: { workspaceId: string; lifecycleEpoch: number; path?: string }) => callback(data)
    ipcRenderer.on('folder:added', handler)
    return () => ipcRenderer.removeListener('folder:added', handler)
  },

  // v1.3 新增：文件夹删除事件
  onFolderRemoved: (callback: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void) => {
    const handler = (_event: unknown, data: { workspaceId: string; lifecycleEpoch: number; path?: string }) => callback(data)
    ipcRenderer.on('folder:removed', handler)
    return () => ipcRenderer.removeListener('folder:removed', handler)
  },

  // v1.3 新增：文件重命名事件
  onFileRenamed: (callback: (event: { workspaceId: string; lifecycleEpoch: number; oldPath?: string; newPath?: string }) => void) => {
    const handler = (_event: unknown, data: { workspaceId: string; lifecycleEpoch: number; oldPath?: string; newPath?: string }) => callback(data)
    ipcRenderer.on('file:renamed', handler)
    return () => ipcRenderer.removeListener('file:renamed', handler)
  },

  // 监听恢复文件夹事件
  onRestoreFolder: (callback: (activation: FolderActivation) => void) => {
    const handler = (_event: unknown, activation: FolderActivation) => callback(activation)
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

  // v1.5.1：分屏打开（支持方向选择）
  onTabOpenInSplit: (callback: (data: { tabId: string; direction: 'horizontal' | 'vertical' }) => void) => {
    const handler = (_event: unknown, data: { tabId: string; direction: 'horizontal' | 'vertical' }) => callback(data)
    ipcRenderer.on('tab:open-in-split', handler)
    return () => ipcRenderer.removeListener('tab:open-in-split', handler)
  },

  // v1.5.1：文件树右键菜单"在分屏中打开"
  onFileOpenInSplit: (callback: (data: { filePath: string; direction: 'horizontal' | 'vertical' }) => void) => {
    const handler = (_event: unknown, data: { filePath: string; direction: 'horizontal' | 'vertical' }) => callback(data)
    ipcRenderer.on('file:open-in-split', handler)
    return () => ipcRenderer.removeListener('file:open-in-split', handler)
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

  onMarkdownExportDOCX: (callback: (docStyle?: string) => void) => {
    const handler = (_event: unknown, docStyle?: string) => callback(docStyle)
    ipcRenderer.on('markdown:export-docx', handler)
    return () => ipcRenderer.removeListener('markdown:export-docx', handler)
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

  onDocumentMarksChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('document-marks:changed', handler)
    return () => ipcRenderer.removeListener('document-marks:changed', handler)
  },

  onFileDuplicateRequest: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:duplicate-request', handler)
    return () => ipcRenderer.removeListener('file:duplicate-request', handler)
  },

  onFileMoveToRequest: (callback: (file: { path: string; isDirectory: boolean }) => void) => {
    const handler = (_event: unknown, file: { path: string; isDirectory: boolean }) => callback(file)
    ipcRenderer.on('file:move-to-request', handler)
    return () => ipcRenderer.removeListener('file:move-to-request', handler)
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

  onShortcutSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:settings', handler)
    return () => ipcRenderer.removeListener('shortcut:settings', handler)
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
  }) => void) => {
    const handler = (_event: unknown, params: {
      filePath: string
      tabId?: string
      leafId?: string | null
      canonicalPath?: string
      targetText?: string
      targetLine?: number
      sourceLine?: number
      scrollRatio?: number
      mode: 'document' | 'selection' | 'source-line' | 'scroll-ratio'
    }) => callback(params)
    ipcRenderer.on('markdown:quick-edit', handler)
    return () => ipcRenderer.removeListener('markdown:quick-edit', handler)
  },

  // v2.7.0: 从当前行朗读
  onReadAloudFromLine: (callback: (params: { sourceLine: number | null }) => void) => {
    const handler = (_event: unknown, params: { sourceLine: number | null }) => callback(params)
    ipcRenderer.on('markdown:read-aloud-from-line', handler)
    return () => ipcRenderer.removeListener('markdown:read-aloud-from-line', handler)
  },

  onExportChartsZipFromPreview: (callback: (params: {
    filePath: string
    tabId?: string
    leafId?: string | null
  }) => void) => {
    const handler = (_event: unknown, params: {
      filePath: string
      tabId?: string
      leafId?: string | null
    }) => callback(params)
    ipcRenderer.on('markdown:export-charts-zip', handler)
    return () => ipcRenderer.removeListener('markdown:export-charts-zip', handler)
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

  // v2.7.0：朗读播放/暂停
  onShortcutToggleReadAloud: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:toggle-read-aloud', handler)
    return () => ipcRenderer.removeListener('shortcut:toggle-read-aloud', handler)
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
  },

  // ============== v1.5.1：拖拽支持 ==============

  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  openDroppedPaths: (paths: string[]) =>
    ipcRenderer.invoke('drop:openPaths', paths),

  // ============== v1.5.1：内部 .md 链接跳转 ==============

  resolveMdLink: (currentFilePath: string, href: string) =>
    ipcRenderer.invoke('navigate:resolveMdLink', currentFilePath, href) as Promise<{ success: boolean; targetPath?: string; targetLine?: number; headingId?: string; error?: string }>,

  openMdLink: (currentFilePath: string, href: string) =>
    ipcRenderer.invoke('navigate:openMdLink', currentFilePath, href) as Promise<{ success: boolean; error?: string }>,

  // ============== v1.6.0：多窗口支持 ==============

  getWindowId: () => ipcRenderer.invoke('window:getWindowId') as Promise<number | null>,
  getWorkspaceBootstrap: () => ipcRenderer.invoke('workspace:getBootstrap') as Promise<{
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
  }>,
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
  }) => ipcRenderer.invoke('workspace:saveDesktopRuntime', runtime) as Promise<void>,
  requestPendingWorkspaceSource: () => ipcRenderer.invoke('workspace:requestPendingSource') as Promise<{ nonce: string } | null>,
  activateWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:activate', workspaceId) as Promise<{
    id: string; primaryRoot: string | null; lifecycleEpoch: number
  }>,
  createWorkspace: () => ipcRenderer.invoke('workspace:create') as Promise<{
    id: string; primaryRoot: string | null; lifecycleEpoch: number
  }>,
  onWorkspaceCreated: (callback: (workspace: { id: string; primaryRoot: string | null; lifecycleEpoch: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, workspace: { id: string; primaryRoot: string | null; lifecycleEpoch: number }) => callback(workspace)
    ipcRenderer.on('workspace:created', handler)
    return () => ipcRenderer.removeListener('workspace:created', handler)
  },
  closeWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:close', workspaceId) as Promise<{
    activeWorkspaceId: string | null
  }>,
  pruneInactiveWorkspaces: (request: {
    expectedActiveWorkspaceId: string
    candidates: Array<{ workspaceId: string; lifecycleEpoch: number; primaryRoot: string | null }>
  }) => ipcRenderer.invoke('workspace:pruneInactive', request) as Promise<{
    removedWorkspaceIds: string[]
    activeWorkspaceId: string | null
  }>,
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
  }>) => ipcRenderer.invoke('workspace:updatePresentations', presentations) as Promise<{ applied: boolean }>,
  listWorkspaceMergeSources: () => ipcRenderer.invoke('workspace:listMergeSources') as Promise<Array<{
    windowId: number
    title: string
    workspaceCount: number
    workspaces: Array<{ id: string; name: string; summary: string }>
  }>>,
  onWorkspaceMergeSourcesChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('workspace:merge-sources-changed', handler)
    return () => ipcRenderer.removeListener('workspace:merge-sources-changed', handler)
  },
  beginWindowTransfer: (sourceWindowId: number) => ipcRenderer.invoke('workspace:beginWindowTransfer', sourceWindowId) as Promise<{ nonce: string | null; closedEmptyWindow: boolean }>,
  submitWindowTransferSnapshots: (nonce: string, snapshots: WorkspaceTransferSnapshot[]) => ipcRenderer.invoke('workspace:submitWindowTransferSnapshots', nonce, snapshots) as Promise<void>,
  consumeWindowTransferSnapshots: (nonce: string) => ipcRenderer.invoke('workspace:consumeWindowTransferSnapshots', nonce) as Promise<WorkspaceTransferSnapshot[]>,
  stageWindowTransfer: (nonce: string) => ipcRenderer.invoke('workspace:stageWindowTransfer', nonce) as Promise<void>,
  completeWindowTransfer: (nonce: string) => ipcRenderer.invoke('workspace:completeWindowTransfer', nonce) as Promise<{
    workspaces: Array<{ sourceWorkspaceId: string; targetWorkspaceId: string; primaryRoot: string | null; lifecycleEpoch: number }>
    activeWorkspaceId: string
  }>,
  cancelWindowTransfer: (nonce: string) => ipcRenderer.invoke('workspace:cancelWindowTransfer', nonce) as Promise<void>,
  onWindowExportRequested: (callback: (payload: {
    nonce: string
    sourceActiveWorkspaceId: string | null
    workspaces: Array<{ workspaceId: string; sourceLifecycleEpoch: number; primaryRoot: string | null }>
  }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload)
    ipcRenderer.on('workspace:window-export-requested', handler)
    return () => ipcRenderer.removeListener('workspace:window-export-requested', handler)
  },
  onWindowTransferReady: (callback: (payload: { nonce: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { nonce: string }) => callback(payload)
    ipcRenderer.on('workspace:window-transfer-ready', handler)
    return () => ipcRenderer.removeListener('workspace:window-transfer-ready', handler)
  },
  splitActiveWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:splitActive', workspaceId) as Promise<{
    nonce: string; targetWindowId: number
  }>,
  beginWorkspaceTransfer: (sourceWindowId: number, workspaceId: string) =>
    ipcRenderer.invoke('workspace:beginTransfer', sourceWindowId, workspaceId) as Promise<{ nonce: string }>,
  submitWorkspaceTransferSnapshot: (nonce: string, snapshot: {
    workspaceId: string
    name: string
    primaryRoot: string | null
    lifecycleEpoch: number
    tabs: Array<{ id: string; filePath: string; isPinned?: boolean }>
    activeTabId: string | null
    splitState: unknown
  }) => ipcRenderer.invoke('workspace:submitTransferSnapshot', nonce, snapshot) as Promise<void>,
  consumeWorkspaceTransferSnapshot: (nonce: string) => ipcRenderer.invoke('workspace:consumeTransferSnapshot', nonce) as Promise<{
    workspaceId: string
    name: string
    primaryRoot: string | null
    tabs: Array<{ id: string; filePath: string; isPinned?: boolean }>
    activeTabId: string | null
    splitState: unknown
  }>,
  stageWorkspaceTransfer: (nonce: string) => ipcRenderer.invoke('workspace:stageTransfer', nonce) as Promise<void>,
  completeWorkspaceTransfer: (nonce: string) => ipcRenderer.invoke('workspace:completeTransfer', nonce) as Promise<{
    id: string; primaryRoot: string | null; lifecycleEpoch: number; replacedWorkspaceId: string | null
  }>,
  cancelWorkspaceTransfer: (nonce: string) => ipcRenderer.invoke('workspace:cancelTransfer', nonce) as Promise<void>,
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
  }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: {
      activeWorkspaceId: string | null
      workspaces: Array<{
        id: string
        name: string
        primaryRoot: string | null
        tabs: Array<{ id: string; relativePath: string; isPinned?: boolean }>
        activeTabId: string | null
        splitState: unknown
      }>
    }) => callback(payload)
    ipcRenderer.on('workspace:restore-runtime', handler)
    return () => ipcRenderer.removeListener('workspace:restore-runtime', handler)
  },
  onWorkspaceExportRequested: (callback: (payload: { nonce: string; workspaceId: string; sourceLifecycleEpoch: number; targetWindowId: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { nonce: string; workspaceId: string; sourceLifecycleEpoch: number; targetWindowId: number }) => callback(payload)
    ipcRenderer.on('workspace:export-requested', handler)
    return () => ipcRenderer.removeListener('workspace:export-requested', handler)
  },
  onWorkspaceTransferReady: (callback: (payload: { nonce: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { nonce: string }) => callback(payload)
    ipcRenderer.on('workspace:transfer-ready', handler)
    return () => ipcRenderer.removeListener('workspace:transfer-ready', handler)
  },
  onWorkspaceTransferCancelled: (callback: (payload: { nonce: string; reason?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { nonce: string; reason?: string }) => callback(payload)
    ipcRenderer.on('workspace:transfer-cancelled', handler)
    return () => ipcRenderer.removeListener('workspace:transfer-cancelled', handler)
  },
  onWorkspaceTransferredOut: (callback: (payload: { workspaceId: string; activeWorkspaceId: string | null }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { workspaceId: string; activeWorkspaceId: string | null }) => callback(payload)
    ipcRenderer.on('workspace:transferred-out', handler)
    return () => ipcRenderer.removeListener('workspace:transferred-out', handler)
  },
  onWorkspaceFolderActivated: (callback: (payload: { workspaceId: string; path: string; lifecycleEpoch: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { workspaceId: string; path: string; lifecycleEpoch: number }) => callback(payload)
    ipcRenderer.on('workspace:folder-activated', handler)
    return () => ipcRenderer.removeListener('workspace:folder-activated', handler)
  },
  newWindow: () => ipcRenderer.invoke('window:newWindow') as Promise<number>,
  newWindowWithFolder: () => ipcRenderer.invoke('window:newWindowWithFolder') as Promise<number | null>,
  getWindowCount: () => ipcRenderer.invoke('window:getWindowCount') as Promise<number>,

  onShortcutNewWindow: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:new-window', handler)
    return () => ipcRenderer.removeListener('shortcut:new-window', handler)
  },
  onShortcutNewWindowFolder: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:new-window-folder', handler)
    return () => ipcRenderer.removeListener('shortcut:new-window-folder', handler)
  },

  // 书签右键菜单：删除书签事件
  onBookmarkDelete: (callback: (bookmarkId: string) => void) => {
    const handler = (_event: unknown, bookmarkId: string) => callback(bookmarkId)
    ipcRenderer.on('bookmark:delete', handler)
    return () => ipcRenderer.removeListener('bookmark:delete', handler)
  },

  // 最近文件右键菜单：从历史中移除事件
  onRecentFileRemove: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('recent-file:remove', handler)
    return () => ipcRenderer.removeListener('recent-file:remove', handler)
  },

  // v1.6.0: 书签跨窗口同步
  onBookmarksChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('bookmarks:changed', handler)
    return () => ipcRenderer.removeListener('bookmarks:changed', handler)
  },

  // ============== v1.5.2：版本信息与更新检测 ==============

  getAppVersion: () =>
    ipcRenderer.invoke('app:getVersion') as Promise<{
      version: string; electron: string; chrome: string;
      node: string; platform: string; arch: string
    }>,
  checkForUpdates: () =>
    ipcRenderer.invoke('app:checkForUpdates') as Promise<{
      hasUpdate?: boolean; currentVersion?: string; latestVersion?: string;
      releaseUrl?: string; releaseNotes?: string; publishedAt?: string;
      error?: string
    }>
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
