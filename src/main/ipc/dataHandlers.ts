import { BrowserWindow, ipcMain, shell, app, net } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import { IPCContext } from './context'
import { setAllowedBasePath, getAllowedBasePath, validatePath } from '../security'
import { syncClipboardState, getClipboardState } from '../clipboardState'
import { readFilesFromSystemClipboard, writeFilesToSystemClipboard, hasFilesInSystemClipboard } from '../clipboardManager'
import * as contextMenuManager from '../contextMenuManager'
import { validateSecurePath as validateLaunchPath } from '../security/pathValidator'

export function registerDataHandlers(ctx: IPCContext): void {
  // ============== 剪贴板 ==============

// ============== v1.3 阶段 3：剪贴板状态同步 ==============

// 同步剪贴板状态
ipcMain.handle('clipboard:sync-state', async (_, files: string[], isCut: boolean) => {
  syncClipboardState(files, isCut)
})

// 查询剪贴板状态
ipcMain.handle('clipboard:query-state', async () => {
  return getClipboardState()
})

// v1.3 阶段 6：从系统剪贴板读取文件
ipcMain.handle('clipboard:read-system', async () => {
  const files = readFilesFromSystemClipboard()
  console.log('[CLIPBOARD] Read from system:', files.length, 'files')
  return files
})

// v1.3 阶段 6：写入文件到系统剪贴板
ipcMain.handle('clipboard:write-system', async (_, paths: string[], isCut: boolean) => {
  const result = writeFilesToSystemClipboard(paths, isCut)
  console.log('[CLIPBOARD] Write to system:', paths.length, 'files, success:', result)
  return result
})

// v1.3 阶段 6：检查系统剪贴板是否有文件
ipcMain.handle('clipboard:has-system-files', async () => {
  return hasFilesInSystemClipboard()
})

  // ============== Shell 操作 ==============

// v1.4：在 Finder/Explorer 中显示文件
ipcMain.handle('shell:showItemInFolder', async (_, filePath: string) => {
  try {
    // 使用 shell.showItemInFolder 在文件管理器中显示并选中文件
    shell.showItemInFolder(filePath)
    return { success: true }
  } catch (error) {
    console.error('Failed to show item in folder:', error)
    throw error
  }
})

// 打开外部链接（用于 Pandoc 安装指南等）
ipcMain.handle('shell:openExternal', async (_, url: string) => {
  try {
    const urlObj = new URL(url)
    // 只允许 http/https 协议（阻止 file://、javascript: 等危险协议）
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      console.error(`[IPC] Blocked non-http external URL: ${url}`)
      return { success: false, error: '只允许打开 http/https 链接' }
    }
    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    console.error('[IPC] Failed to open external URL:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
})

  // ============== 历史文件夹管理 ==============

// v1.3.4：历史文件夹管理
ipcMain.handle('folder-history:get', async () => {
  return ctx.folderHistoryManager.getHistory()
})

ipcMain.handle('folder-history:remove', async (_, folderPath: string) => {
  ctx.folderHistoryManager.removeFolder(folderPath)
})

ipcMain.handle('folder-history:clear', async () => {
  ctx.folderHistoryManager.clearHistory()
})

// v1.3.4：设置当前文件夹（从历史选择时调用）
ipcMain.handle('folder:setPath', async (_, folderPath: string) => {
  setAllowedBasePath(folderPath)
  ctx.store.set('lastOpenedFolder', folderPath)
  await ctx.folderHistoryManager.addFolder(folderPath)
  return true
})

  // ============== 右键菜单安装 ==============

// v1.3.4：右键菜单安装
ipcMain.handle('context-menu:check-status', async () => {
  return contextMenuManager.checkStatus()
})

ipcMain.handle('context-menu:install', async () => {
  return contextMenuManager.install()
})

ipcMain.handle('context-menu:uninstall', async () => {
  return contextMenuManager.uninstall()
})

// v1.3.4：打开系统设置
ipcMain.handle('system:openSettings', async (_event, section: string) => {
  try {
    if (process.platform === 'darwin') {
      // macOS 系统设置深度链接
      const urlMap: Record<string, string> = {
        'extensions': 'x-apple.systempreferences:com.apple.preferences.extensions',
        'finder-extensions': 'x-apple.systempreferences:com.apple.preferences.extensions?Finder',
        'security': 'x-apple.systempreferences:com.apple.preference.security'
      }
      const url = urlMap[section] || urlMap['extensions']
      await shell.openExternal(url)
      return { success: true }
    } else if (process.platform === 'win32') {
      // Windows 默认程序设置
      await shell.openExternal('ms-settings:defaultapps')
      return { success: true }
    } else if (process.platform === 'linux') {
      // Linux：尝试打开系统设置应用（降级策略）
      const { exec } = await import('child_process')
      const tryOpen = (cmd: string): Promise<boolean> => {
        return new Promise((resolve) => {
          exec(`which ${cmd.split(' ')[0]}`, (err) => {
            if (err) { resolve(false); return }
            exec(cmd, (execErr) => resolve(!execErr))
          })
        })
      }
      // 按桌面环境优先级尝试
      if (await tryOpen('gnome-control-center info')) return { success: true }
      if (await tryOpen('systemsettings5')) return { success: true }
      if (await tryOpen('xfce4-settings-manager')) return { success: true }
      return { success: false, error: '请手动打开系统设置' }
    }
    return { success: false, error: '不支持的平台' }
  } catch (error) {
    console.error('[System] Failed to open settings:', error)
    return { success: false, error: String(error) }
  }
})

// v1.3.4：用户确认右键菜单已启用
ipcMain.handle('context-menu:confirm-enabled', async () => {
  return contextMenuManager.confirmEnabled()
})

  // ============== 最近文件管理 ==============

// ============== v1.3.6：最近文件管理 ==============

ipcMain.handle('recent-files:get', async () => {
  return ctx.appDataManager.getRecentFiles()
})

ipcMain.handle('recent-files:add', async (_, file: { path: string; name: string; folderPath: string }) => {
  await ctx.appDataManager.addRecentFile(file)
})

ipcMain.handle('recent-files:remove', async (_, filePath: string) => {
  ctx.appDataManager.removeRecentFile(filePath)
})

ipcMain.handle('recent-files:clear', async () => {
  ctx.appDataManager.clearRecentFiles()
})

  // ============== 固定标签管理 ==============

// ============== v1.3.6：固定标签管理（按文件夹分组） ==============

ipcMain.handle('pinned-tabs:get-for-folder', async (_, folderPath: string) => {
  return ctx.appDataManager.getPinnedTabsForFolder(folderPath)
})

ipcMain.handle('pinned-tabs:add', async (_, filePath: string) => {
  const basePath = getAllowedBasePath()
  if (!basePath) return false
  return ctx.appDataManager.addPinnedTabForFolder(filePath, basePath)
})

ipcMain.handle('pinned-tabs:remove', async (_, filePath: string) => {
  const basePath = getAllowedBasePath()
  if (!basePath) return
  ctx.appDataManager.removePinnedTabForFolder(filePath, basePath)
})

ipcMain.handle('pinned-tabs:is-pinned', async (_, filePath: string) => {
  const basePath = getAllowedBasePath()
  if (!basePath) return false
  return ctx.appDataManager.isTabPinnedInFolder(filePath, basePath)
})

  // ============== 应用设置管理 ==============

// ============== v1.3.6：应用设置管理 ==============

ipcMain.handle('settings:get', async () => {
  return ctx.appDataManager.getSettings()
})

ipcMain.handle('settings:update', async (_, updates: Record<string, unknown>) => {
  ctx.appDataManager.updateSettings(updates)
})

  // ============== 书签管理 ==============

// ============== v1.3.6：书签管理 ==============

ipcMain.handle('bookmarks:get', async () => {
  return ctx.appDataManager.getBookmarks()
})

ipcMain.handle('bookmarks:add', async (event, bookmark: {
  filePath: string
  fileName: string
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
}) => {
  // 安全校验
  validatePath(bookmark.filePath)
  const result = ctx.appDataManager.addBookmark(bookmark)
  // v1.6.0: 广播书签变更到其他窗口
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
  return result
})

ipcMain.handle('bookmarks:update', async (event, id: string, updates: {
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
  order?: number
}) => {
  ctx.appDataManager.updateBookmark(id, updates)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
})

ipcMain.handle('bookmarks:remove', async (event, id: string) => {
  ctx.appDataManager.removeBookmark(id)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
})

ipcMain.handle('bookmarks:update-all', async (event, bookmarks: Array<{
  id: string
  filePath: string
  fileName: string
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
  createdAt: number
  order: number
}>) => {
  ctx.appDataManager.updateBookmarks(bookmarks)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
})

ipcMain.handle('bookmarks:clear', async (event) => {
  ctx.appDataManager.clearBookmarks()
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
})

  // ============== 拖拽 & 导航 ==============

// v1.5.1: 拖拽支持 — 处理从 Finder 拖入的文件/文件夹
ipcMain.handle('drop:openPaths', async (event, paths: string[]) => {
  const folders: string[] = []
  const mdFiles: string[] = []
  const senderWindow = BrowserWindow.fromWebContents(event.sender)

  for (const p of paths) {
    const validation = await validateLaunchPath(p)
    if (!validation.valid) continue
    if (validation.type === 'directory') {
      folders.push(validation.normalizedPath)
    } else if (validation.normalizedPath.toLowerCase().endsWith('.md')) {
      mdFiles.push(validation.normalizedPath)
    }
  }

  if (folders.length > 0) {
    ctx.openPathInWindow(folders[0], 'directory', senderWindow || undefined)
  } else if (mdFiles.length > 0) {
    ctx.openPathInWindow(mdFiles[0], 'md-file', senderWindow || undefined)
    for (let i = 1; i < mdFiles.length; i++) {
      setTimeout(() => {
        if (senderWindow && !senderWindow.isDestroyed()) {
          senderWindow.webContents.send('open-specific-file', mdFiles[i])
        }
      }, 500 + i * 200)
    }
  }
})

// v1.5.1: 内部 .md 链接跳转 — 解析相对路径并打开目标 .md 文件
ipcMain.handle('navigate:openMdLink', async (event, currentFilePath: string, href: string) => {
  const dir = path.dirname(currentFilePath)
  const targetPath = path.resolve(dir, href)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)

  try {
    const stat = await fs.stat(targetPath)
    if (!stat.isFile() || !targetPath.toLowerCase().endsWith('.md')) {
      return { success: false, error: '目标不是 .md 文件' }
    }
  } catch {
    return { success: false, error: '文件不存在' }
  }

  ctx.openPathInWindow(targetPath, 'md-file', senderWindow || undefined)
  return { success: true }
})

  // ============== 应用版本 & 更新 ==============

// v1.5.2: 获取应用版本和系统信息
ipcMain.handle('app:getVersion', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch
}))

// v1.5.2: 检查更新（多源容错）
ipcMain.handle('app:checkForUpdates', async () => {
  // semver 比较：a > b 返回 true
  const isNewerVersion = (remote: string, local: string): boolean => {
    const r = remote.split('.').map(Number)
    const l = local.split('.').map(Number)
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rv = r[i] || 0
      const lv = l[i] || 0
      if (rv > lv) return true
      if (rv < lv) return false
    }
    return false
  }

  const GITHUB_REPO = 'wj2929/md-viewer'
  const SOURCES = [
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@latest/package.json`
  ]
  const TIMEOUT_MS = 5000

  // 源1: GitHub Releases API
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const response = await net.fetch(SOURCES[0], {
      headers: {
        'User-Agent': 'MD-Viewer',
        'Accept': 'application/vnd.github.v3+json'
      },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const latestVersion = data.tag_name?.replace(/^v/, '')
    const currentVersion = app.getVersion()
    console.log(`[UpdateCheck] GitHub API: current=${currentVersion}, latest=${latestVersion}`)
    return {
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: data.html_url,
      releaseNotes: data.body,
      publishedAt: data.published_at
    }
  } catch (err) {
    console.warn('[UpdateCheck] GitHub API failed:', err)
  }

  // 源2: jsDelivr CDN (读取 package.json 的 version 字段)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const response = await net.fetch(SOURCES[1], {
      headers: { 'User-Agent': 'MD-Viewer' },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const latestVersion = data.version
    const currentVersion = app.getVersion()
    console.log(`[UpdateCheck] jsDelivr: current=${currentVersion}, latest=${latestVersion}`)
    return {
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
      publishedAt: undefined
    }
  } catch (err) {
    console.warn('[UpdateCheck] jsDelivr failed:', err)
  }

  return { error: '无法连接到更新服务器，请检查网络连接后重试' }
})
}
