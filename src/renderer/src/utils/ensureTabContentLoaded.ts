import { useTabStore } from '../stores/tabStore'
import { readPreviewContentWithCache } from './fileCache'

const inflight = new Map<string, Promise<void>>()
const generations = new Map<string, number>()

export function invalidateTabContentLoad(tabId: string): void {
  generations.set(tabId, (generations.get(tabId) ?? 0) + 1)
}

export function ensureTabContentLoaded(tabId: string): Promise<void> {
  const tab = useTabStore.getState().tabs.find(t => t.id === tabId)
  if (!tab || tab.content !== null) return Promise.resolve()

  const existing = inflight.get(tabId)
  if (existing) return existing

  const filePath = tab.file.path
  const generation = generations.get(tabId) ?? 0
  let shouldRetry = false
  const promise = readPreviewContentWithCache(filePath)
    .then(content => {
      const current = useTabStore.getState().tabs.find(t => t.id === tabId)
      if (!current || current.content !== null) return
      if (current.file.path !== filePath || (generations.get(tabId) ?? 0) !== generation) {
        shouldRetry = true
        return
      }
      useTabStore.getState().updateTabContent(tabId, content)
    })
    .catch(error => {
      console.error('[ensureTabContentLoaded] 读取失败:', filePath, error)
    })
    .finally(() => {
      inflight.delete(tabId)
      if (shouldRetry) void ensureTabContentLoaded(tabId)
    })

  inflight.set(tabId, promise)
  return promise
}
