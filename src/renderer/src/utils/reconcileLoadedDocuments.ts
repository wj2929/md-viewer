import { hasLocalEditActivity, useEditSessionStore, useTabStore } from '../stores'
import { clearFileCache, readPreviewContentWithCache } from './fileCache'
import { readTabPreviewContent } from './tabDocumentReader'
import { invalidateTabContentLoad } from './ensureTabContentLoaded'
import { getActiveWorkspaceLifecycleKey, isActiveWorkspaceLifecycleKey } from './workspaceOperationContext'
import { collectLocalResourceDependencies } from '../../../shared/markdown/resourceDependencies'

// Used by recovery and manual refresh; shell tabs deliberately remain unmaterialized.
export async function reconcileLoadedDocuments(): Promise<void> {
  const lifecycle = getActiveWorkspaceLifecycleKey()
  if (!lifecycle) return
  const tabs = useTabStore.getState().tabs.filter(tab => tab.content !== null)
  const sessions = Object.values(useEditSessionStore.getState().sessions).filter(session => (
    session.workspaceId === lifecycle.workspaceId && session.lifecycleEpoch === lifecycle.lifecycleEpoch
  ))
  const paths = new Set([...tabs.map(tab => tab.file.path), ...sessions.map(session => session.displayPath)])
  for (const filePath of paths) {
    if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
    const findSession = () => Object.values(useEditSessionStore.getState().sessions).find(session => (
      session.displayPath === filePath || session.canonicalPath === filePath
    ))
    const initialSession = findSession()
    const initialTabs = tabs.filter(tab => tab.file.path === filePath)
    const linkedTab = initialTabs.find(tab => tab.linkedReadOnly)
    if (!linkedTab) clearFileCache(filePath, 'watcher')
    for (const tab of initialTabs) invalidateTabContentLoad(tab.id)
    try {
      const editable = !linkedTab && initialSession && initialSession.workspaceId && Number.isInteger(initialSession.lifecycleEpoch)
        ? await window.api.openEditableMarkdown(filePath, {
            workspaceId: initialSession.workspaceId, lifecycleEpoch: initialSession.lifecycleEpoch as number,
          })
        : null
      const content = linkedTab ? await readTabPreviewContent(linkedTab, true)
        : editable?.content ?? await readPreviewContentWithCache(filePath, true)
      if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
      const currentSession = findSession()
      if (currentSession && !linkedTab) {
        if (hasLocalEditActivity(currentSession) || currentSession.draftVersion !== initialSession?.draftVersion ||
          currentSession.baseRevisionToken !== initialSession?.baseRevisionToken) {
          if (content !== currentSession.original) useEditSessionStore.getState().markConflict(currentSession.canonicalPath, 'external_changed', editable?.revisionToken)
          continue
        }
        if (!editable) continue
        if (content !== currentSession.original || editable.revisionToken !== currentSession.baseRevisionToken ||
          currentSession.conflictReason || currentSession.error) {
          useEditSessionStore.getState().replaceFromDisk(currentSession.canonicalPath, content, editable.revisionToken)
        }
      } else if (initialSession && !linkedTab) continue
      // A no-op recovery must not remount a resource-free preview or invalidate its pending links.
      const refreshResources = initialTabs.some(tab => tab.content === content) && collectLocalResourceDependencies(content).length > 0
      useTabStore.getState().setTabs(previous => previous.map(tab => {
        const initialTab = initialTabs.find(initial => initial.id === tab.id)
        if (!initialTab || tab.file.path !== filePath || tab.content !== initialTab.content
          || (!linkedTab && hasLocalEditActivity(findSession()))) return tab
        if (tab.content === content && !tab.missing && !tab.renameCandidatePath && !refreshResources) return tab
        return { ...tab, content, missing: false, renameCandidatePath: undefined, resourceRevision: (tab.resourceRevision ?? 0) + 1 }
      }))
    } catch (error) {
      if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
      if (linkedTab) throw error
      const exists = await window.api.fileExists(filePath)
      if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
      if (exists) throw error
      const currentSession = findSession()
      if (currentSession && hasLocalEditActivity(currentSession)) {
        useEditSessionStore.getState().markConflict(currentSession.canonicalPath, 'missing')
      } else {
        useTabStore.getState().setTabs(previous => previous.map(tab => (
          initialTabs.some(initial => initial.id === tab.id && initial.file.path === tab.file.path)
            ? { ...tab, missing: true, renameCandidatePath: undefined } : tab
        )))
      }
    }
  }
}
