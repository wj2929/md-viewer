/**
 * 统一数据管理器
 * 管理最近文件、书签、固定标签等持久化数据
 * v1.3.6 新增
 */

import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs/promises'

// ============== 数据接口定义 ==============

/**
 * 最近打开的文件
 */
export interface RecentFile {
  path: string           // 文件绝对路径
  name: string           // 文件名
  folderPath: string     // 所在文件夹路径
  lastOpened: number     // 最后打开时间戳
}

/**
 * 书签
 */
export interface Bookmark {
  id: string              // UUID
  filePath: string        // 文件绝对路径
  fileName: string        // 文件名
  title?: string          // 自定义标题
  headingId?: string      // 锚点 ID（优先级 1）
  headingText?: string    // 标题文本（优先级 2，模糊匹配）
  scrollPosition?: number // 滚动位置百分比（优先级 3）
  createdAt: number       // 创建时间戳
  order: number           // 排序顺序
}

/**
 * 固定的标签页（v1.3.6 增强版：按文件夹分组）
 */
export interface PinnedTabInfo {
  relativePath: string   // 相对于文件夹的路径（安全存储）
  order: number          // 排序顺序
  pinnedAt: number       // 固定时间戳
}

/**
 * 按文件夹分组的固定标签
 */
export interface PinnedTabsByFolder {
  [folderPath: string]: PinnedTabInfo[]
}

/**
 * 旧版固定标签（兼容迁移）
 * @deprecated 使用 PinnedTabsByFolder 替代
 */
export interface PinnedTab {
  path: string           // 文件路径
  order: number          // 排序顺序
}

/**
 * 应用设置
 */
export interface AppSettings {
  imageDir: string       // 图片保存目录，默认 'assets'
  autoSave: boolean      // 自动保存，默认 true（失焦时保存）
  bookmarkPanelWidth: number     // 书签面板宽度
  bookmarkPanelCollapsed: boolean // 书签面板是否折叠
  bookmarkBarCollapsed: boolean   // 书签栏是否折叠（v1.3.6）
  maxRecentFiles?: number         // 最近文件上限（v1.5.2）
  maxFolderHistory?: number       // 文件夹历史上限（v1.5.2）
}

/**
 * Store 数据结构
 */
interface AppDataStore {
  recentFiles: RecentFile[]
  bookmarks: Bookmark[]
  pinnedTabs: PinnedTab[]                    // 旧版，保留用于迁移
  pinnedTabsByFolder: PinnedTabsByFolder     // v1.3.6 新版
  settings: AppSettings
}

// ============== 常量定义 ==============

const MAX_RECENT_FILES = 20
const MAX_BOOKMARKS = 100
const MAX_PINNED_TABS_PER_FOLDER = 15       // 每个文件夹最多固定标签数
const MAX_FOLDERS_WITH_PINNED = 50          // 最多保留多少个文件夹的固定标签
const VALIDATE_TIMEOUT = 1000 // 路径验证超时（毫秒）

// ============== 数据管理器类 ==============

class AppDataManager {
  private store: Store<AppDataStore>

  constructor() {
    this.store = new Store<AppDataStore>({
      name: 'app-data',
      defaults: {
        recentFiles: [],
        bookmarks: [],
        pinnedTabs: [],              // 旧版，保留用于迁移
        pinnedTabsByFolder: {},      // v1.3.6 新版
        settings: {
          imageDir: 'assets',
          autoSave: true,
          bookmarkPanelWidth: 240,
          bookmarkPanelCollapsed: false,
          bookmarkBarCollapsed: true
        }
      }
    })

    // 迁移旧版数据
    this.migrateOldPinnedTabs()
  }

  /**
   * 迁移旧版固定标签数据到新格式
   */
  private migrateOldPinnedTabs(): void {
    const oldTabs = this.store.get('pinnedTabs', [])
    if (oldTabs.length === 0) return

    const pinnedByFolder = this.store.get('pinnedTabsByFolder', {})

    // 按文件夹分组旧数据
    for (const tab of oldTabs) {
      const folderPath = path.dirname(tab.path)
      const relativePath = path.basename(tab.path)

      if (!pinnedByFolder[folderPath]) {
        pinnedByFolder[folderPath] = []
      }

      // 避免重复
      if (!pinnedByFolder[folderPath].some(t => t.relativePath === relativePath)) {
        pinnedByFolder[folderPath].push({
          relativePath,
          order: tab.order,
          pinnedAt: Date.now()
        })
      }
    }

    // 保存新格式，清空旧格式
    this.store.set('pinnedTabsByFolder', pinnedByFolder)
    this.store.set('pinnedTabs', [])
    console.log('[AppDataManager] Migrated old pinned tabs to new format')
  }

  // ============== 最近文件管理 ==============

  /**
   * 获取最近文件列表
   */
  getRecentFiles(): RecentFile[] {
    return this.store.get('recentFiles', [])
  }

  /**
   * 添加最近文件（自动去重和排序）
   */
  async addRecentFile(file: Omit<RecentFile, 'lastOpened'>): Promise<void> {
    const normalizedPath = path.resolve(file.path)

    // 验证文件存在
    try {
      const stats = await fs.stat(normalizedPath)
      if (stats.isDirectory()) return
    } catch {
      return
    }

    const recentFiles = this.store.get('recentFiles', [])

    // 移除已存在的相同路径
    const filtered = recentFiles.filter(item => item.path !== normalizedPath)

    // 添加到开头
    const newFile: RecentFile = {
      path: normalizedPath,
      name: file.name || path.basename(normalizedPath),
      folderPath: file.folderPath || path.dirname(normalizedPath),
      lastOpened: Date.now()
    }

    const updated = [newFile, ...filtered].slice(0, this.getMaxRecentFiles())
    this.store.set('recentFiles', updated)
  }

  /**
   * 从最近文件中移除
   */
  removeRecentFile(filePath: string): void {
    const normalizedPath = path.resolve(filePath)
    const recentFiles = this.store.get('recentFiles', [])
    const filtered = recentFiles.filter(item => item.path !== normalizedPath)
    this.store.set('recentFiles', filtered)
  }

  /**
   * 清空最近文件
   */
  clearRecentFiles(): void {
    this.store.set('recentFiles', [])
  }

  /**
   * 后台验证最近文件路径有效性（并行验证，不阻塞）
   */
  async validateRecentFilesInBackground(): Promise<void> {
    const recentFiles = this.store.get('recentFiles', [])
    if (recentFiles.length === 0) return

    const validationPromises = recentFiles.map(async (file) => {
      try {
        await Promise.race([
          fs.access(file.path),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), VALIDATE_TIMEOUT)
          )
        ])
        return file
      } catch {
        return null
      }
    })

    const results = await Promise.all(validationPromises)
    const validFiles = results.filter((file): file is RecentFile => file !== null)

    // 如果有失效路径，更新存储
    if (validFiles.length !== recentFiles.length) {
      this.store.set('recentFiles', validFiles)
    }
  }

  // ============== 书签管理 ==============

  /**
   * 获取所有书签
   */
  getBookmarks(): Bookmark[] {
    return this.store.get('bookmarks', [])
  }

  /**
   * 添加书签
   */
  addBookmark(bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'order'>): Bookmark {
    const bookmarks = this.store.get('bookmarks', [])

    // 检查是否超过最大数量
    if (bookmarks.length >= MAX_BOOKMARKS) {
      throw new Error(`书签数量已达上限 (${MAX_BOOKMARKS})`)
    }

    const newBookmark: Bookmark = {
      ...bookmark,
      id: this.generateId(),
      createdAt: Date.now(),
      order: bookmarks.length
    }

    this.store.set('bookmarks', [...bookmarks, newBookmark])
    return newBookmark
  }

  /**
   * 更新书签
   */
  updateBookmark(id: string, updates: Partial<Omit<Bookmark, 'id' | 'createdAt'>>): void {
    const bookmarks = this.store.get('bookmarks', [])
    const index = bookmarks.findIndex(b => b.id === id)

    if (index === -1) {
      throw new Error(`书签不存在: ${id}`)
    }

    bookmarks[index] = { ...bookmarks[index], ...updates }
    this.store.set('bookmarks', bookmarks)
  }

  /**
   * 删除书签
   */
  removeBookmark(id: string): void {
    const bookmarks = this.store.get('bookmarks', [])
    const filtered = bookmarks.filter(b => b.id !== id)
    this.store.set('bookmarks', filtered)
  }

  /**
   * 批量更新书签（用于拖拽排序）
   */
  updateBookmarks(bookmarks: Bookmark[]): void {
    // 验证数量
    if (bookmarks.length > MAX_BOOKMARKS) {
      bookmarks = bookmarks.slice(0, MAX_BOOKMARKS)
    }
    this.store.set('bookmarks', bookmarks)
  }

  /**
   * 清空所有书签
   */
  clearBookmarks(): void {
    this.store.set('bookmarks', [])
  }

  // ============== 固定标签管理（v1.3.6 增强版：按文件夹分组） ==============

  /**
   * 获取指定文件夹的固定标签（返回绝对路径）
   */
  async getPinnedTabsForFolder(folderPath: string): Promise<Array<{ path: string; order: number }>> {
    const normalizedFolder = path.resolve(folderPath)
    const pinnedByFolder = this.store.get('pinnedTabsByFolder', {})
    const folderTabs = pinnedByFolder[normalizedFolder] || []

    const validTabs: Array<{ path: string; order: number }> = []

    for (const tab of folderTabs) {
      const absolutePath = path.join(normalizedFolder, tab.relativePath)

      // 安全校验：确保路径在文件夹内
      if (!absolutePath.startsWith(normalizedFolder + path.sep)) {
        continue
      }

      // 验证文件存在
      try {
        const stats = await fs.stat(absolutePath)
        if (!stats.isFile()) continue

        validTabs.push({ path: absolutePath, order: tab.order })
      } catch {
        // 文件不存在，跳过
        continue
      }
    }

    return validTabs.sort((a, b) => a.order - b.order)
  }

  /**
   * 添加固定标签（需要指定文件夹）
   */
  addPinnedTabForFolder(filePath: string, folderPath: string): boolean {
    const normalizedFile = path.resolve(filePath)
    const normalizedFolder = path.resolve(folderPath)

    // 安全校验：文件必须在文件夹内
    if (!normalizedFile.startsWith(normalizedFolder + path.sep)) {
      console.warn('[AppDataManager] Cannot pin file outside folder')
      return false
    }

    const relativePath = path.relative(normalizedFolder, normalizedFile)
    const pinnedByFolder = this.store.get('pinnedTabsByFolder', {})

    if (!pinnedByFolder[normalizedFolder]) {
      pinnedByFolder[normalizedFolder] = []
    }

    // 检查是否已存在
    if (pinnedByFolder[normalizedFolder].some(t => t.relativePath === relativePath)) {
      return true
    }

    // 检查数量限制
    if (pinnedByFolder[normalizedFolder].length >= MAX_PINNED_TABS_PER_FOLDER) {
      console.warn('[AppDataManager] Max pinned tabs reached for folder')
      return false
    }

    pinnedByFolder[normalizedFolder].push({
      relativePath,
      order: pinnedByFolder[normalizedFolder].length,
      pinnedAt: Date.now()
    })

    this.store.set('pinnedTabsByFolder', pinnedByFolder)
    this.cleanupOldFolders()
    return true
  }

  /**
   * 移除固定标签
   */
  removePinnedTabForFolder(filePath: string, folderPath: string): void {
    const normalizedFile = path.resolve(filePath)
    const normalizedFolder = path.resolve(folderPath)
    const relativePath = path.relative(normalizedFolder, normalizedFile)

    const pinnedByFolder = this.store.get('pinnedTabsByFolder', {})
    if (!pinnedByFolder[normalizedFolder]) return

    pinnedByFolder[normalizedFolder] = pinnedByFolder[normalizedFolder]
      .filter(t => t.relativePath !== relativePath)
      .map((t, i) => ({ ...t, order: i }))

    this.store.set('pinnedTabsByFolder', pinnedByFolder)
  }

  /**
   * 检查文件是否被固定
   */
  isTabPinnedInFolder(filePath: string, folderPath: string): boolean {
    const normalizedFile = path.resolve(filePath)
    const normalizedFolder = path.resolve(folderPath)
    const relativePath = path.relative(normalizedFolder, normalizedFile)

    const pinnedByFolder = this.store.get('pinnedTabsByFolder', {})
    const folderTabs = pinnedByFolder[normalizedFolder] || []

    return folderTabs.some(t => t.relativePath === relativePath)
  }

  /**
   * 清理过多的文件夹记录（LRU 策略）
   */
  private cleanupOldFolders(): void {
    const pinnedByFolder = this.store.get('pinnedTabsByFolder', {})
    const folders = Object.keys(pinnedByFolder)

    if (folders.length <= MAX_FOLDERS_WITH_PINNED) return

    // 按最新固定时间排序
    const foldersByTime = folders.map(folder => ({
      folder,
      latestPinned: Math.max(...pinnedByFolder[folder].map(t => t.pinnedAt))
    })).sort((a, b) => b.latestPinned - a.latestPinned)

    // 保留最新的 N 个
    const toKeep = new Set(foldersByTime.slice(0, MAX_FOLDERS_WITH_PINNED).map(f => f.folder))

    for (const folder of folders) {
      if (!toKeep.has(folder)) {
        delete pinnedByFolder[folder]
      }
    }

    this.store.set('pinnedTabsByFolder', pinnedByFolder)
  }

  // ============== 旧版 API（兼容性，已废弃） ==============

  /** @deprecated 使用 getPinnedTabsForFolder */
  getPinnedTabs(): PinnedTab[] {
    return this.store.get('pinnedTabs', [])
  }

  /** @deprecated 使用 addPinnedTabForFolder */
  addPinnedTab(filePath: string): void {
    const folderPath = path.dirname(filePath)
    this.addPinnedTabForFolder(filePath, folderPath)
  }

  /** @deprecated 使用 removePinnedTabForFolder */
  removePinnedTab(filePath: string): void {
    const folderPath = path.dirname(filePath)
    this.removePinnedTabForFolder(filePath, folderPath)
  }

  /** @deprecated */
  updatePinnedTabsOrder(_paths: string[]): void {
    // 不再支持，保留空实现
  }

  /** @deprecated */
  clearPinnedTabs(): void {
    this.store.set('pinnedTabs', [])
  }

  /** @deprecated 使用 isTabPinnedInFolder */
  isTabPinned(filePath: string): boolean {
    const folderPath = path.dirname(filePath)
    return this.isTabPinnedInFolder(filePath, folderPath)
  }

  // ============== 设置管理 ==============

  /**
   * 获取设置
   */
  getSettings(): AppSettings {
    return this.store.get('settings')
  }

  /**
   * 更新设置
   */
  updateSettings(updates: Partial<AppSettings>): void {
    const settings = this.store.get('settings')
    this.store.set('settings', { ...settings, ...updates })
  }

  /**
   * 获取最近文件上限（v1.5.2）
   */
  getMaxRecentFiles(): number {
    const settings = this.store.get('settings')
    return settings.maxRecentFiles ?? MAX_RECENT_FILES
  }

  // ============== 工具方法 ==============

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }
}

// 导出单例
export const appDataManager = new AppDataManager()
