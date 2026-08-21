import type { Tab } from '../components'
import type { EditSession } from '../stores/editSessionStore'
import type { WorkspaceDescriptor, WorkspaceRuntimeSnapshot } from '../stores/workspaceStore'
import { getAllLeaves, reconcileSplitState } from './splitTree'

export interface WorkspacePresentationSummary {
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
}

export function getWorkspaceDisplayLabel(
  workspace: Pick<WorkspaceDescriptor, 'name' | 'primaryRoot'>,
  tabs: Tab[] = []
): string {
  const name = workspace.name?.trim()
  if (name && name !== '未命名工作区' && !name.includes('/') && !name.includes('\\')) return name
  const rootName = workspace.primaryRoot?.split(/[/\\]/).filter(Boolean).pop()
  if (rootName) return rootName
  return tabs[0]?.file.name?.trim() || '空白会话'
}

export function hasOwnedDraft(
  workspace: WorkspaceDescriptor,
  sessions: Record<string, EditSession>
): boolean {
  return Object.values(sessions).some((session) => {
    const hasUnsavedState = session.dirty || session.saving || session.status === 'conflict' || session.status === 'error' || session.status === 'missing'
    if (!hasUnsavedState) return false
    if (session.workspaceId) {
      return session.workspaceId === workspace.id && session.lifecycleEpoch === workspace.lifecycleEpoch
    }
    if (!workspace.primaryRoot) return false
    const root = workspace.primaryRoot.replace(/[\\/]+$/, '')
    const filePath = session.canonicalPath || session.displayPath
    return filePath === root || filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`)
  })
}

export function hasMeaningfulWorkspaceState(
  runtime: WorkspaceRuntimeSnapshot,
  hasDraft = false
): boolean {
  const validTabIds = new Set(runtime.tabs
    .filter((tab) => Boolean(tab.id && tab.file?.path))
    .map((tab) => tab.id))
  if (validTabIds.size > 0 || hasDraft) return true

  const reconciledSplit = reconcileSplitState(runtime.splitState, validTabIds)
  if (reconciledSplit.root?.type === 'split') return true

  const validLeafIds = new Set(getAllLeaves(reconciledSplit.root).map((leaf) => leaf.id))
  const hasDocumentView = Object.entries(runtime.documentViews).some(([key, view]) => {
    const tabId = key.slice(key.lastIndexOf(':') + 1)
    if (!validTabIds.has(tabId)) return false
    return view.mode !== 'preview' || view.compareRatio !== 0.5 || view.target !== null
  })
  if (hasDocumentView) return true

  return Object.values(runtime.quickEditPlacements).some((placement) =>
    validTabIds.has(placement.tabId) &&
    (!placement.leafId || placement.leafId === 'single' || validLeafIds.has(placement.leafId))
  )
}

export function createWorkspacePresentation(
  workspace: WorkspaceDescriptor,
  runtime: WorkspaceRuntimeSnapshot,
  hasDraft: boolean
): WorkspacePresentationSummary {
  const tabNames = runtime.tabs.map((tab) => tab.file.name).filter(Boolean)
  const activeTabName = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)?.file.name ?? null
  const validTabIds = new Set(runtime.tabs.map((tab) => tab.id))
  const hasSplit = reconcileSplitState(runtime.splitState, validTabIds).root?.type === 'split'
  const hasMeaningfulState = hasMeaningfulWorkspaceState(runtime, hasDraft)
  return {
    workspaceId: workspace.id,
    lifecycleEpoch: workspace.lifecycleEpoch,
    label: getWorkspaceDisplayLabel(workspace, runtime.tabs),
    isEmptyPlaceholder: !workspace.primaryRoot && !hasMeaningfulState,
    hasMeaningfulState,
    tabCount: runtime.tabs.length,
    activeTabName,
    tabNames: tabNames.slice(0, 5),
    hasSplit,
    hasDraft,
  }
}
