import { useTabStore } from '../stores/tabStore'
import { readPreviewContentWithCache } from './fileCache'

// 并发去重：同一 tab 的加载只发起一次
const inflight = new Map<string, Promise<void>>()

/**
 * 懒加载：确保指定 tab 的 content 已从磁盘读入。
 * - content 已加载（非 null）→ 立即返回
 * - 正在加载 → 复用同一 Promise
 * - 未加载 → 读盘并写回 tabStore；失败置空串占位，避免死循环反复重试
 */
export function ensureTabContentLoaded(tabId: string): Promise<void> {
  const tab = useTabStore.getState().tabs.find(t => t.id === tabId)
  if (!tab || tab.content !== null) return Promise.resolve()

  const existing = inflight.get(tabId)
  if (existing) return existing

  const filePath = tab.file.path
  const promise = readPreviewContentWithCache(filePath)
    .then(content => {
      // 读盘期间 tab 可能已被关闭；updateTabContent 对不存在的 id 是 no-op
      useTabStore.getState().updateTabContent(tabId, content)
    })
    .catch(error => {
      console.error('[ensureTabContentLoaded] 读取失败:', filePath, error)
      // 失败置空占位，避免触发器反复重试同一个失败文件
      const still = useTabStore.getState().tabs.find(t => t.id === tabId)
      if (still && still.content === null) {
        useTabStore.getState().updateTabContent(tabId, '')
      }
    })
    .finally(() => {
      inflight.delete(tabId)
    })

  inflight.set(tabId, promise)
  return promise
}
