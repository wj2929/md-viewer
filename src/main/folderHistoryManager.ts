/**
 * 历史文件夹管理器
 * 管理最近打开的文件夹列表
 */

import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs/promises'

const DEFAULT_MAX_ITEMS = 10

// 读取 settings store 中的 maxFolderHistory（避免循环依赖，直接读 electron-store）
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
  path: string
  name: string
  lastOpened: number
}

interface HistoryStore {
  folderHistory: FolderHistoryItem[]
}

class FolderHistoryManager {
  private store: Store<HistoryStore>

  constructor() {
    this.store = new Store<HistoryStore>({
      name: 'folder-history',
      defaults: {
        folderHistory: []
      }
    })
  }

  /**
   * 获取历史文件夹列表（立即返回，后台验证）
   */
  async getHistory(): Promise<FolderHistoryItem[]> {
    const history = this.store.get('folderHistory', [])

    // 后台异步验证，不阻塞返回
    setImmediate(() => this.validateInBackground(history))

    return history
  }

  /**
   * 添加文件夹到历史
   */
  async addFolder(folderPath: string): Promise<void> {
    const normalized = path.resolve(folderPath)

    // 验证路径存在
    try {
      const stats = await fs.stat(normalized)
      if (!stats.isDirectory()) return
    } catch {
      return
    }

    const history = this.store.get('folderHistory', [])

    // 移除已存在的相同路径
    const filtered = history.filter(item => item.path !== normalized)

    // 添加到开头
    const newItem: FolderHistoryItem = {
      path: normalized,
      name: path.basename(normalized),
      lastOpened: Date.now()
    }

    const updated = [newItem, ...filtered].slice(0, getMaxFolderHistory())
    this.store.set('folderHistory', updated)
  }

  /**
   * 从历史中移除文件夹
   */
  removeFolder(folderPath: string): void {
    const normalized = path.resolve(folderPath)
    const history = this.store.get('folderHistory', [])
    const filtered = history.filter(item => item.path !== normalized)
    this.store.set('folderHistory', filtered)
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.store.set('folderHistory', [])
  }

  /**
   * 后台验证历史路径
   */
  private async validateInBackground(history: FolderHistoryItem[]): Promise<void> {
    const validItems: FolderHistoryItem[] = []

    for (const item of history) {
      try {
        await Promise.race([
          fs.access(item.path),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 1000)
          )
        ])
        validItems.push(item)
      } catch {
        // 路径无效或超时，跳过
      }
    }

    // 如果有失效路径，更新存储
    if (validItems.length !== history.length) {
      this.store.set('folderHistory', validItems)
    }
  }
}

export const folderHistoryManager = new FolderHistoryManager()
