import { create } from 'zustand'
import type { FileInfo, Tab } from '../components'
import type { SplitState, PanelNode } from '../utils/splitTree'
import type { DocumentViewState } from './documentViewModeStore'
import type { QuickEditTarget } from '../utils/quickEditTarget'

import type { WorkspaceDescriptor as WorkspaceContract } from '../../../shared/workspace'

export interface WorkspaceDescriptor extends WorkspaceContract {
  name: string
}

export interface WorkspaceRuntimeSnapshot {
  folderPath: string | null
  files: FileInfo[]
  selectedPaths: Set<string>
  tabs: Tab[]
  activeTabId: string | null
  splitState: SplitState
  scrollToLine: number | undefined
  scrollToRatio: number | undefined
  highlightKeyword: string | undefined
  documentViews: Record<string, DocumentViewState>
  quickEditPlacements: Record<string, QuickEditTarget>
}

export const EMPTY_WORKSPACE_RUNTIME: WorkspaceRuntimeSnapshot = {
  folderPath: null,
  files: [],
  selectedPaths: new Set(),
  tabs: [],
  activeTabId: null,
  splitState: { root: null, activeLeafId: '' },
  scrollToLine: undefined,
  scrollToRatio: undefined,
  highlightKeyword: undefined,
  documentViews: {},
  quickEditPlacements: {},
}

interface WorkspaceStore {
  workspaces: WorkspaceDescriptor[]
  activeWorkspaceId: string | null
  runtimes: Record<string, WorkspaceRuntimeSnapshot>
  setWorkspaces: (workspaces: WorkspaceDescriptor[], activeWorkspaceId: string | null) => void
  upsertWorkspace: (workspace: WorkspaceDescriptor) => void
  removeWorkspace: (workspaceId: string) => void
  removeWorkspaces: (workspaceIds: string[]) => void
  setActiveWorkspaceId: (workspaceId: string | null) => void
  saveRuntime: (workspaceId: string, runtime: WorkspaceRuntimeSnapshot) => void
  getRuntime: (workspaceId: string) => WorkspaceRuntimeSnapshot
}

function cloneFileInfo(file: FileInfo): FileInfo {
  return {
    ...file,
    children: file.children?.map(cloneFileInfo),
  }
}

function clonePanelNode(node: PanelNode): PanelNode {
  if (node.type === 'leaf') return { ...node }
  return {
    ...node,
    first: clonePanelNode(node.first),
    second: clonePanelNode(node.second),
  }
}

function cloneDocumentViews(views: Record<string, DocumentViewState>): Record<string, DocumentViewState> {
  return Object.fromEntries(Object.entries(views).map(([key, view]) => [
    key,
    {
      ...view,
      target: view.target ? { ...view.target } : null,
    },
  ]))
}

function cloneRuntime(runtime: WorkspaceRuntimeSnapshot): WorkspaceRuntimeSnapshot {
  return {
    ...runtime,
    files: runtime.files.map(cloneFileInfo),
    selectedPaths: new Set(runtime.selectedPaths),
    tabs: runtime.tabs.map((tab) => ({ ...tab, file: { ...tab.file } })),
    splitState: {
      ...runtime.splitState,
      root: runtime.splitState.root ? clonePanelNode(runtime.splitState.root) : null,
    },
    documentViews: cloneDocumentViews(runtime.documentViews),
    quickEditPlacements: Object.fromEntries(
      Object.entries(runtime.quickEditPlacements).map(([key, placement]) => [key, { ...placement }])
    ),
  }
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  runtimes: {},
  setWorkspaces: (workspaces, activeWorkspaceId) => set((state) => {
    const runtimes = { ...state.runtimes }
    for (const workspace of workspaces) {
      runtimes[workspace.id] ??= cloneRuntime(EMPTY_WORKSPACE_RUNTIME)
    }
    return { workspaces, activeWorkspaceId, runtimes }
  }),
  upsertWorkspace: (workspace) => set((state) => {
    const index = state.workspaces.findIndex((item) => item.id === workspace.id)
    const existing = index < 0 ? undefined : state.workspaces[index]
    if (
      existing &&
      existing.name === workspace.name &&
      existing.primaryRoot === workspace.primaryRoot &&
      existing.lifecycleEpoch === workspace.lifecycleEpoch
    ) {
      return state
    }

    const workspaces = index < 0
      ? [...state.workspaces, workspace]
      : state.workspaces.map((item) => item.id === workspace.id ? workspace : item)
    return {
      workspaces,
      activeWorkspaceId: state.activeWorkspaceId ?? workspace.id,
      runtimes: state.runtimes[workspace.id]
        ? state.runtimes
        : { ...state.runtimes, [workspace.id]: cloneRuntime(EMPTY_WORKSPACE_RUNTIME) },
    }
  }),
  removeWorkspace: (workspaceId) => set((state) => {
    const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId)
    const { [workspaceId]: _, ...runtimes } = state.runtimes
    return {
      workspaces,
      runtimes,
      activeWorkspaceId: state.activeWorkspaceId === workspaceId ? workspaces[0]?.id ?? null : state.activeWorkspaceId,
    }
  }),
  removeWorkspaces: (workspaceIds) => set((state) => {
    const ids = new Set(workspaceIds)
    if (state.activeWorkspaceId && ids.has(state.activeWorkspaceId)) return state
    const workspaces = state.workspaces.filter((workspace) => !ids.has(workspace.id))
    if (workspaces.length === state.workspaces.length) return state
    const runtimes = Object.fromEntries(
      Object.entries(state.runtimes).filter(([workspaceId]) => !ids.has(workspaceId))
    )
    return { workspaces, runtimes }
  }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  saveRuntime: (workspaceId, runtime) => set((state) => ({
    runtimes: { ...state.runtimes, [workspaceId]: cloneRuntime(runtime) },
  })),
  getRuntime: (workspaceId) => cloneRuntime(
    get().runtimes[workspaceId] ?? EMPTY_WORKSPACE_RUNTIME
  ),
}))
