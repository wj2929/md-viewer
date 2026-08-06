import { BrowserWindow, ipcMain, shell, app, net } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import { IPCContext } from './context'
import { validateSecurePathInBase } from '../security'
import { getSenderFolderRoot, validateSenderPath, validateSenderReadPath } from './senderSecurity'
import { activateFolderForWindow, activateHistoryFolderForWindow } from '../folderActivation'
import { syncClipboardState, getClipboardState } from '../clipboardState'
import { readFilesFromSystemClipboard, writeFilesToSystemClipboard, hasFilesInSystemClipboard } from '../clipboardManager'
import * as contextMenuManager from '../contextMenuManager'
import { validateSecurePath as validateLaunchPath } from '../security/pathValidator'
import { getCliShimStatus, installCliShim, uninstallCliShim } from '../cliShimInstaller'

const PREVIEWABLE_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.excalidraw'])
const MARKDOWN_LINK_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn'])

function isPreviewableFilePath(filePath: string): boolean {
  return PREVIEWABLE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function splitMarkdownLinkHref(href: string): { cleanHref: string; headingId?: string } {
  const decoded = safeDecodeURIComponent(href)
  const hashIndex = decoded.indexOf('#')
  const beforeHash = hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded
  const rawHeading = hashIndex >= 0 ? decoded.slice(hashIndex + 1) : ''
  const queryIndex = beforeHash.indexOf('?')
  const cleanHref = (queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash).trim()
  const headingId = safeDecodeURIComponent(rawHeading).trim()
  return { cleanHref, headingId: headingId || undefined }
}

function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return slug || 'heading'
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .trim()
}

function findHeadingLine(markdown: string, headingId: string): number | undefined {
  const normalizedTarget = headingId.replace(/_/g, '').toLowerCase()
  const usedSlugs = new Map<string, number>()
  const lines = markdown.split(/\r?\n/)
  let fence: string | null = null

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    const fenceMatch = trimmed.match(/^(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1].startsWith('`') ? '```' : '~~~'
      if (!fence) {
        fence = marker
      } else if (marker === fence) {
        fence = null
      }
      continue
    }

    if (fence) continue

    const headingMatch = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!headingMatch) continue

    const baseSlug = slugifyHeading(normalizeHeadingText(headingMatch[2]))
    const count = usedSlugs.get(baseSlug) || 0
    const slug = count > 0 ? `${baseSlug}-${count}` : baseSlug
    usedSlugs.set(baseSlug, count + 1)

    if (slug === headingId || slug.replace(/_/g, '').toLowerCase() === normalizedTarget) {
      return index + 1
    }
  }

  return undefined
}

async function resolveMarkdownLinkTarget(currentFilePath: string, href: string): Promise<{
  success: boolean
  targetPath?: string
  targetLine?: number
  headingId?: string
  error?: string
}> {
  const { cleanHref, headingId } = splitMarkdownLinkHref(href)
  if (!cleanHref) return { success: false, error: '链接目标为空' }

  const dir = path.dirname(currentFilePath)
  const targetPath = path.resolve(dir, cleanHref)
  if (!MARKDOWN_LINK_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) {
    return { success: false, error: '目标不是 Markdown 文件' }
  }

  try {
    const stat = await fs.stat(targetPath)
    if (!stat.isFile()) return { success: false, error: '目标不是 Markdown 文件' }
  } catch {
    return { success: false, error: '文件不存在' }
  }

  let targetLine: number | undefined
  if (headingId) {
    try {
      targetLine = findHeadingLine(await fs.readFile(targetPath, 'utf8'), headingId)
    } catch {
      targetLine = undefined
    }
  }

  return { success: true, targetPath, targetLine, headingId }
}

export function registerDataHandlers(ctx: IPCContext): void {
  // ============== 剪贴板 ==============

// ============== v1.3 阶段 3：剪贴板状态同步 ==============

// 同步剪贴板状态
ipcMain.handle('clipboard:sync-state', async (event, files: string[], isCut: boolean) => {
  const root = getSenderFolderRoot(ctx, event)
  for (const filePath of files) {
    await validateSecurePathInBase(filePath, root)
  }
  syncClipboardState(event.sender.id, files, isCut)
})

// 查询剪贴板状态
ipcMain.handle('clipboard:query-state', async (event) => {
  return getClipboardState(event.sender.id)
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

ipcMain.handle('folder-history:remove', async (_, historyId: string) => {
  ctx.folderHistoryManager.removeFolder(historyId)
})

ipcMain.handle('folder-history:clear', async () => {
  ctx.folderHistoryManager.clearHistory()
})

// 激活主进程持有的历史目录记录；禁止 renderer 提供路径扩大授权根。
ipcMain.handle('folder-history:activate', async (event, historyId: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    throw new Error('无法识别当前窗口')
  }

  return activateHistoryFolderForWindow(ctx, win, historyId)
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

// v2.5：命令行工具安装
ipcMain.handle('cli-shim:status', async () => {
  return getCliShimStatus()
})

ipcMain.handle('cli-shim:install', async () => {
  return installCliShim()
})

ipcMain.handle('cli-shim:uninstall', async () => {
  return uninstallCliShim()
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

ipcMain.handle('recent-files:activate', async (event, recentId: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const recentFile = ctx.appDataManager.getRecentFile(recentId)
  if (!win || !recentFile) {
    throw new Error('安全错误：最近文件不存在或当前窗口无效')
  }

  let rootPath = recentFile.folderPath
  try {
    await validateSecurePathInBase(recentFile.path, rootPath)
  } catch {
    rootPath = path.dirname(recentFile.path)
  }

  const activation = await activateFolderForWindow(ctx, win, rootPath)
  const canonicalFilePath = await validateSecurePathInBase(recentFile.path, activation.path)
  return { ...activation, filePath: canonicalFilePath, fileName: path.basename(canonicalFilePath) }
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

ipcMain.handle('pinned-tabs:add', async (event, filePath: string) => {
  const root = getSenderFolderRoot(ctx, event)
  const canonicalPath = await validateSenderPath(ctx, event, filePath)
  return ctx.appDataManager.addPinnedTabForFolder(canonicalPath, root)
})

ipcMain.handle('pinned-tabs:remove', async (event, filePath: string) => {
  const root = getSenderFolderRoot(ctx, event)
  const canonicalPath = await validateSenderPath(ctx, event, filePath)
  ctx.appDataManager.removePinnedTabForFolder(canonicalPath, root)
})

ipcMain.handle('pinned-tabs:is-pinned', async (event, filePath: string) => {
  // 查询类：放宽到任一已授权文件夹，避免跨文件夹分屏时阻断；
  // 固定分组仍按发起窗口根查询，跨文件夹文件自然返回未固定
  const root = getSenderFolderRoot(ctx, event)
  const canonicalPath = await validateSenderReadPath(ctx, event, filePath)
  return ctx.appDataManager.isTabPinnedInFolder(canonicalPath, root)
})

  // ============== 应用设置管理 ==============

// ============== v1.3.6：应用设置管理 ==============

ipcMain.handle('settings:get', async () => {
  return ctx.appDataManager.getSettings()
})

ipcMain.handle('settings:update', async (_, updates: Record<string, unknown>) => {
  ctx.appDataManager.updateSettings(updates)
})

ipcMain.handle('folder-tree-state:get', async (event) => {
  const root = getSenderFolderRoot(ctx, event)
  return ctx.appDataManager.getFolderTreeState(root)
})

ipcMain.handle('folder-tree-state:save', async (event, folders: Record<string, unknown>) => {
  if (!folders || typeof folders !== 'object' || Array.isArray(folders)) {
    throw new Error('无效的文件树状态')
  }

  const root = getSenderFolderRoot(ctx, event)
  return ctx.appDataManager.saveFolderTreeState(root, folders)
})

ipcMain.handle('folder-tree-state:clear', async (event) => {
  const root = getSenderFolderRoot(ctx, event)
  ctx.appDataManager.clearFolderTreeState(root)
})

ipcMain.handle('read-position:get', async (event, filePath: string) => {
  await validateSenderReadPath(ctx, event, filePath)
  return ctx.appDataManager.getReadPosition(filePath)
})

ipcMain.handle('read-position:save', async (event, position: {
  canonicalPath: string
  scrollRatio?: number
  headingId?: string
  updatedAt?: number
  contentHash?: string
}) => {
  await validateSenderPath(ctx, event, position.canonicalPath)
  return ctx.appDataManager.saveReadPosition(position)
})

ipcMain.handle('read-position:clear', async (event, filePath: string) => {
  await validateSenderPath(ctx, event, filePath)
  ctx.appDataManager.clearReadPosition(filePath)
})

  // ============== 搜索历史管理（原子操作） ==============

ipcMain.handle('search-history:load', async () => {
  return ctx.appDataManager.getSearchHistory()
})

ipcMain.handle('search-history:add', async (_, type: 'searchBar' | 'inPage', keyword: string) => {
  return type === 'searchBar'
    ? ctx.appDataManager.addSearchBarHistory(keyword)
    : ctx.appDataManager.addInPageSearchHistory(keyword)
})

ipcMain.handle('search-history:remove', async (_, type: 'searchBar' | 'inPage', keyword: string) => {
  return type === 'searchBar'
    ? ctx.appDataManager.removeSearchBarHistory(keyword)
    : ctx.appDataManager.removeInPageSearchHistory(keyword)
})

ipcMain.handle('search-history:clear', async (_, type: 'searchBar' | 'inPage') => {
  type === 'searchBar'
    ? ctx.appDataManager.clearSearchBarHistory()
    : ctx.appDataManager.clearInPageSearchHistory()
})

  // ============== 书签管理 ==============

// ============== v1.3.6：书签管理 ==============

ipcMain.handle('bookmarks:get', async () => {
  return ctx.appDataManager.getBookmarks()
})

ipcMain.handle('bookmarks:activate', async (event, bookmarkId: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const bookmark = ctx.appDataManager.getBookmark(bookmarkId)
  if (!win || !bookmark) {
    throw new Error('安全错误：书签不存在或当前窗口无效')
  }

  const rootPath = await ctx.folderHistoryManager.findContainingFolder(bookmark.filePath)
    ?? path.dirname(bookmark.filePath)
  const activation = await activateFolderForWindow(ctx, win, rootPath)
  const canonicalFilePath = await validateSecurePathInBase(bookmark.filePath, activation.path)
  return { ...activation, filePath: canonicalFilePath, fileName: path.basename(canonicalFilePath) }
})

ipcMain.handle('bookmarks:add', async (event, bookmark: {
  filePath: string
  fileName: string
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
}) => {
  // 安全校验：书签只记录路径引用（写的是书签库，非目标文件），
  // 用读放宽校验——允许给分屏打开的跨文件夹文件加书签，仍受 realpath 边界 + 受保护路径拦截
  await validateSenderReadPath(ctx, event, bookmark.filePath)
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
    } else if (isPreviewableFilePath(validation.normalizedPath)) {
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

// v2.4.0: 内部 Markdown 链接解析 — 仅返回目标，打开前由渲染进程统一处理脏草稿确认
ipcMain.handle('navigate:resolveMdLink', async (_, currentFilePath: string, href: string) => {
  return resolveMarkdownLinkTarget(currentFilePath, href)
})

// v1.5.1: 内部 .md 链接跳转 — 解析相对路径并打开目标 .md 文件
ipcMain.handle('navigate:openMdLink', async (event, currentFilePath: string, href: string) => {
  const result = await resolveMarkdownLinkTarget(currentFilePath, href)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)

  if (!result.success || !result.targetPath) return result

  ctx.openPathInWindow(result.targetPath, 'md-file', senderWindow || undefined)
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
