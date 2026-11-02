import type { PaneDiagnosticCause } from '../../../shared/diagnostics'
import { useWorkspaceStore } from '../stores/workspaceStore'
import type { PanelNode, SplitState } from './splitTree'
import { recordRendererDiagnosticEvent } from './diagnostics'

interface PaneState {
  tabs: { id: string }[]
  activeTabId: string | null
  splitState: SplitState
}

let paneSequence = 0
let lastTabChangeSequence = 0
let lastTabOperationId: string | undefined
let hydrationGeneration = 0
const workspaceTraceIds = new Map<string, string>()

function workspaceMetadata(workspaceId = useWorkspaceStore.getState().activeWorkspaceId) {
  const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === workspaceId)
  if (workspaceId && !workspaceTraceIds.has(workspaceId)) {
    workspaceTraceIds.set(workspaceId, `workspace_${crypto.randomUUID()}`)
    if (workspaceTraceIds.size > 100) workspaceTraceIds.delete(workspaceTraceIds.keys().next().value!)
  }
  return {
    workspaceTraceId: workspaceId ? workspaceTraceIds.get(workspaceId)! : null,
    workspaceEpoch: workspace?.lifecycleEpoch ?? null,
    hydrationGeneration,
  }
}

function activeLeaf(state: PaneState) {
  const visit = (node: PanelNode | null, position: string, depth: number): { position: string; tabId: string | null } | null => {
    if (!node || depth > 4) return null
    if (node.type === 'leaf') return node.id === state.splitState.activeLeafId ? { position, tabId: node.tabId } : null
    return visit(node.first, `${position}.first`, depth + 1) ?? visit(node.second, `${position}.second`, depth + 1)
  }
  return visit(state.splitState.root, 'root', 1) ?? {
    position: state.splitState.root ? 'missing' : 'none',
    tabId: null,
  }
}

export function recordPaneHydration(workspaceId: string): void {
  try {
    hydrationGeneration++
    lastTabChangeSequence = 0
    lastTabOperationId = undefined
    recordRendererDiagnosticEvent({
      event: 'workspace.pane.change',
      metadata: { ...workspaceMetadata(workspaceId), paneSequence: ++paneSequence, paneAction: 'hydrate', paneSource: 'workspace-hydrate' },
    })
  } catch {
    // 诊断失败不得改变工作区恢复。
  }
}

export function recordPaneChange(before: PaneState, after: PaneState, action: 'tab' | 'split', cause: PaneDiagnosticCause): void {
  try {
    const previous = activeLeaf(before)
    const current = activeLeaf(after)
    const tabChanged = before.activeTabId !== after.activeTabId
    const leafChanged = before.splitState.activeLeafId !== after.splitState.activeLeafId
    const leafDocumentChanged = previous.tabId !== current.tabId
    if (!tabChanged && !leafChanged && !leafDocumentChanged && previous.position === current.position) return
    const sequence = ++paneSequence
    if (action === 'tab' && tabChanged) {
      lastTabChangeSequence = sequence
      lastTabOperationId = cause.operationId
    }
    const operationId = cause.operationId ?? (cause.source === 'active-tab-sync' ? lastTabOperationId : undefined)
    const slot = (state: PaneState, id: string | null) => id ? state.tabs.findIndex(tab => tab.id === id) : -1
    recordRendererDiagnosticEvent({
      event: 'workspace.pane.change',
      ...(operationId ? { operationId } : {}),
      metadata: {
        ...workspaceMetadata(),
        paneSequence: sequence,
        lastTabChangeSequence,
        paneAction: action,
        paneSource: cause.source,
        ...(cause.inputTrusted !== undefined ? { inputTrusted: cause.inputTrusted } : {}),
        beforeLeafPosition: previous.position,
        afterLeafPosition: current.position,
        beforeTabSlot: slot(before, before.activeTabId),
        afterTabSlot: slot(after, after.activeTabId),
        beforeLeafTabSlot: slot(before, previous.tabId),
        afterLeafTabSlot: slot(after, current.tabId),
        tabChanged,
        leafChanged,
        leafDocumentChanged,
      },
    })
  } catch {
    // 不记录调用栈、DOM 文本、路径或原始 tab/leaf/workspace ID。
  }
}
