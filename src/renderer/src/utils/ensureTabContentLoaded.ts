import { useTabStore } from '../stores/tabStore'
import { readTabPreviewContent } from './tabDocumentReader'
import { recordFileTerminal, startFileDiagnostic } from './diagnostics'

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
  const diagnosticOperation = startFileDiagnostic('restore')
  const promise = Promise.all([
    readTabPreviewContent(tab, true, diagnosticOperation),
    Promise.resolve(tab.linkedReadOnly ? null : window.api.getReadPosition?.(filePath)).catch(() => null),
  ])
    .then(([content, position]) => {
      const current = useTabStore.getState().tabs.find(t => t.id === tabId)
      if (!current || current.content !== null) {
        recordFileTerminal(diagnosticOperation, 'superseded')
        return
      }
      if (current.file.path !== filePath || (generations.get(tabId) ?? 0) !== generation) {
        shouldRetry = true
        recordFileTerminal(diagnosticOperation, 'superseded')
        return
      }
      const initialScrollRatio = typeof position?.scrollRatio === 'number' && Number.isFinite(position.scrollRatio)
        ? Math.max(0, Math.min(1, position.scrollRatio)) : undefined
      useTabStore.getState().setTabs(tabs => tabs.map(item =>
        item.id === tabId ? { ...item, content, diagnosticOperation, initialScrollRatio } : item
      ))
    })
    .catch(error => {
      const current = useTabStore.getState().tabs.find(item => item.id === tabId)
      if (current?.file.path === filePath && current.content === null && (generations.get(tabId) ?? 0) !== generation) {
        shouldRetry = true
        recordFileTerminal(diagnosticOperation, 'superseded')
        return
      }
      recordFileTerminal(diagnosticOperation, 'error')
      if (tab.linkedReadOnly && current?.file.path === filePath && current.content === null) {
        useTabStore.getState().setTabs(previous => previous.map(item => item.id === tabId ? { ...item, missing: true } : item))
      }
      if (!tab.linkedReadOnly) console.error('[ensureTabContentLoaded] 读取失败:', filePath, error)
    })
    .finally(() => {
      inflight.delete(tabId)
      if (shouldRetry) void ensureTabContentLoaded(tabId)
    })

  inflight.set(tabId, promise)
  return promise
}
