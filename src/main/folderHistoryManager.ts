/**
 * 历史文件夹管理器
 * 管理最近打开的文件夹列表
 */

import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs/promises'
import { randomUUID } from 'crypto'

const DEFAULT_MAX_ITEMS = 10

function getMaxFolderHistory(): number {
  try {
    const settingsStore = new Store({ name: 'app-data' })
    const settings = settingsStore.get('settings') as Record<string, unknown> | undefined
    const val = settings?.maxFolderHistory
    if (typeof val === 'number' && val >= 5 && val <= 50) return val
  } catch { /* ignore */ }
  return DEFAULT_MAX_ITEMS
}

export interface FolderHistoryItem {
  id: string
  path: string
  name: string
  lastOpened: number
}

type LegacyFolderHistoryItem = Omit<FolderHistoryItem, 'id'> & { id?: string }

interface HistoryStore {
  folderHistory: LegacyFolderHistoryItem[]
}

class FolderHistoryManager {
  private store: Store<HistoryStore>

  constructor() {
    this.store = new Store<HistoryStore>({
      name: 'folder-history',
      defaults: { folderHistory: [] }
    })
  }

  private getStoredHistory(): FolderHistoryItem[] {
    const stored = this.store.get('folderHistory', [])
    let migrated = false
    const history = stored.map(item => {
      if (item.id) return item as FolderHistoryItem
      migrated = true
      return { ...item, id: randomUUID() }
    })

    if (migrated) {
      this.store.set('folderHistory', history)
    }
    return history
  }

  /**
   * 获取历史文件夹列表（立即返回，后台验证）
   */
  async getHistory(): Promise<FolderHistoryItem[]> {
    const history = this.getStoredHistory()
    void this.validateInBackground(history)
    return history
  }

  /**
   * 从主进程记录中解析历史文件夹；渲染进程只能提供 opaque ID。
   */
  async resolveHistoryFolder(historyId: string): Promise<string | null> {
    const item = this.getStoredHistory().find(entry => entry.id === historyId)
    if (!item) return null

    try {
      const resolved = await fs.realpath(item.path)
      const stats = await fs.stat(resolved)
      return stats.isDirectory() ? resolved : null
    } catch {
      return null
    }
  }

  async findContainingFolder(filePath: string): Promise<string | null> {
    let resolvedFilePath: string
    try {
      resolvedFilePath = await fs.realpath(filePath)
    } catch {
      return null
    }

    const candidates: string[] = []
    for (const item of this.getStoredHistory()) {
      try {
        const resolvedRoot = await fs.realpath(item.path)
        const stats = await fs.stat(resolvedRoot)
        if (!stats.isDirectory()) continue
        const relative = path.relative(resolvedRoot, resolvedFilePath)
        if (relative === '' || (
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        )) {
          candidates.push(resolvedRoot)
        }
      } catch {
        // 不可访问的历史条目不适合作为激活根
      }
    }

    return candidates.sort((left, right) => right.length - left.length)[0] ?? null
  }

  /**
   * 添加文件夹到历史，并返回 canonical 记录。
   */
  async addFolder(folderPath: string): Promise<FolderHistoryItem | null> {
    try {
      const resolved = await fs.realpath(path.resolve(folderPath))
      const stats = await fs.stat(resolved)
      if (!stats.isDirectory()) return null

      const history = this.getStoredHistory()
      const existing = history.find(item => item.path === resolved)
      const newItem: FolderHistoryItem = {
        id: existing?.id ?? randomUUID(),
        path: resolved,
        name: path.basename(resolved),
        lastOpened: Date.now()
      }
      const updated = [newItem, ...history.filter(item => item.path !== resolved)]
        .slice(0, getMaxFolderHistory())
      this.store.set('folderHistory', updated)
      return newItem
    } catch {
      return null
    }
  }

  /**
   * 从历史中移除文件夹。
   */
  removeFolder(historyId: string): void {
    const history = this.getStoredHistory()
    this.store.set('folderHistory', history.filter(item => item.id !== historyId))
  }

  clearHistory(): void {
    this.store.set('folderHistory', [])
  }

  private async validateInBackground(history: FolderHistoryItem[]): Promise<void> {
    const validIds = new Set<string>()
    for (const item of history) {
      try {
        const resolved = await Promise.race([
          fs.realpath(item.path),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 1000)
          )
        ])
        const stats = await fs.stat(resolved)
        if (stats.isDirectory()) validIds.add(item.id)
      } catch {
        // 路径无效或超时，跳过
      }
    }

    const current = this.getStoredHistory()
    const invalidIds = new Set(history.filter(item => !validIds.has(item.id)).map(item => item.id))
    if (invalidIds.size > 0) {
      this.store.set('folderHistory', current.filter(item => !invalidIds.has(item.id)))
    }
  }
}

export const folderHistoryManager = new FolderHistoryManager()
