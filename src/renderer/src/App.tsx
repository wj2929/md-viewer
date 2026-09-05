import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { FileTree, FileInfo, VirtualizedMarkdown, TabBar, Tab, SearchBar, SearchBarHandle, ErrorBoundary, ToastContainer, ThemeToggle, FolderHistoryDropdown, RecentFilesDropdown, SettingsPanel, FloatingNav, ReadAloudBar, BookmarkPanel, Bookmark, BookmarkBar, Header, NavigationBar, ShortcutsHelpDialog, ImageLightbox, LightboxState, SplitPanel, ExportTaskView, QuickEditDrawer, MarkdownEditWorkbench, PreflightPanel, MoveToDialog, RenameRepairDialog, WorkspaceSwitcher, WorkspaceImportControl, LoadingPlaceholder, MissingFilePlaceholder } from './components'
import type { FolderActivation } from '../../shared/workspace'
import type { ChartsSettingsView, EditorInsertionSession, OpenChartSettingsRequest } from './components/settings/chartSettingsTypes'
import { SplitState, PanelNode, createLeaf, splitLeaf, closeLeaf, updateRatio, updateLeafTab, findLeaf, getAllLeaves, findLeafByTabId, getTreeDepth, MAX_SPLIT_DEPTH, swapLeaves, reconcileSplitState } from './utils/splitTree'
import { readPreviewContentWithCache, clearFileCache } from './utils/fileCache'
import { ensureTabContentLoaded, invalidateTabContentLoad } from './utils/ensureTabContentLoaded'
import { buildPreviewContentForFile, isMarkdownFile } from './utils/previewableFiles'
import { useToast } from './hooks/useToast'
import { useTheme } from './hooks/useTheme'
import { useDragDrop } from './hooks/useDragDrop'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useIPC } from './hooks/useIPC'
import { useExport } from './hooks/useExport'
import { useEditDraftPersistence } from './hooks/useEditDraftPersistence'
import { hasLocalEditActivity, useClipboardStore, useWindowStore, useUIStore, useFileStore, useTabStore, useBookmarkStore, useLayoutStore, useEditSessionStore, useQuickEditPlacementStore, useDocumentViewModeStore, useWorkspaceStore } from './stores'
import type { DocumentViewMode, EditConflictReason, EditSession } from './stores'
import { useExportTaskStore } from './stores/exportTaskStore'
import { useReadAloudStore } from './stores/readAloudStore'
import type { QuickEditTarget } from './utils/quickEditTarget'
import type { FileTreeRevealRequest } from './components/FileTree'
import type { ExternalDocumentOpenOptions, OpenDocumentCommand } from './utils/v24WorkflowContracts'
import { createOpenDocumentCommand } from './utils/v24WorkflowContracts'
import type { BacklinkItem } from './components/BacklinksPanel'
import {
  getActiveWorkspaceLifecycleKey,
  getActiveWorkspaceOperationContext,
  isActiveWorkspaceLifecycleKey,
} from './utils/workspaceOperationContext'
import { createWorkspacePresentation, hasOwnedDraft } from './utils/workspacePresentation'
import {
  restoreFolderSplitLayout,
  serializeFolderSplitLayout,
  type FolderSplitLeafPositions,
} from './utils/folderSplitLayout'
import type { WorkspacePresentationSummary } from './utils/workspacePresentation'

function findEditSessionForPath(sessions: Record<string, EditSession>, filePath: string): EditSession | undefined {
  return Object.values(sessions).find(session =>
    session.displayPath === filePath || session.canonicalPath === filePath
  )
}

function normalizeConflictReason(reason: string | undefined): EditConflictReason {
  return reason === 'missing' || reason === 'renamed' || reason === 'external_changed' || reason === 'revision_changed'
    ? reason
    : 'revision_changed'
}

function getDraftPreviewDebounceMs(content: string, hasEditSession: boolean): number | undefined {
  if (!hasEditSession) return undefined
  return /```(?:mermaid|echarts|js|json|drawio|plantuml|dot|graphviz|markmap|infographic|excalidraw)\b/i.test(content)
    ? 900
    : 250
}

const SINGLE_LEAF_ID = 'single'
const UNSAVED_EDIT_LEAVE_MESSAGE = '当前文档有未保存编辑草稿，离开后草稿会保留但尚未写入磁盘。是否继续？'
const DIRTY_LEAVE_CONFIRM_REUSE_MS = 1200

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

function isPathInsideFolder(filePath: string, folderPath: string): boolean {
  const base = folderPath.replace(/[\\/]+$/, '')
  return filePath === base || filePath.startsWith(`${base}/`) || filePath.startsWith(`${base}\\`)
}

function remapImportedWorkspaceSnapshot(snapshot: {
  tabs: Array<{ id: string; filePath: string; isPinned?: boolean }>
  activeTabId: string | null
  splitState: SplitState
}, nonce: string): { tabIds: Map<string, string>; activeTabId: string | null; splitState: SplitState } {
  const tabIds = new Map(snapshot.tabs.map((tab, index) => [tab.id, `import-${nonce}-tab-${index}`]))
  const remapNode = (node: PanelNode | null, index: { value: number }): PanelNode | null => {
    if (!node) return null
    if (node.type === 'leaf') {
      return { ...node, id: `import-${nonce}-leaf-${index.value++}`, tabId: tabIds.get(node.tabId) ?? node.tabId }
    }
    return {
      ...node,
      id: `import-${nonce}-split-${index.value++}`,
      first: remapNode(node.first, index)!,
      second: remapNode(node.second, index)!,
    }
  }
  const root = remapNode(snapshot.splitState.root, { value: 0 })
  const activeTabId = snapshot.activeTabId ? tabIds.get(snapshot.activeTabId) ?? null : null
  const leaves = getAllLeaves(root)
  return {
    tabIds,
    activeTabId,
    splitState: { root, activeLeafId: leaves[0]?.id ?? '' },
  }
}

function App(): React.JSX.Element {
  // v1.6.0: Zustand stores
  const { folderPath, setFolderPath, files, setFiles, isLoading, setIsLoading, selectedPaths, setSelectedPaths } = useFileStore()
  const { tabs, setTabs, activeTabId, setActiveTabId, splitState, setSplitState, scrollToLine, setScrollToLine, scrollToRatio, setScrollToRatio, highlightKeyword, setHighlightKeyword } = useTabStore()
  const workspaceStore = useWorkspaceStore()
  const { workspaces, activeWorkspaceId, setWorkspaces, upsertWorkspace, replaceWorkspace, removeWorkspace, removeWorkspaces, setActiveWorkspaceId, saveRuntime, getRuntime } = workspaceStore
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [activeWorkspaceId, workspaces]
  )
  const activeWorkspaceEpoch = activeWorkspace?.lifecycleEpoch
  const activeWorkspaceRoot = activeWorkspace?.primaryRoot
  const { bookmarks, bookmarksLoading, bookmarkPanelCollapsed, setBookmarkPanelCollapsed, bookmarkPanelWidth, setBookmarkPanelWidth, bookmarkBarCollapsed, setBookmarkBarCollapsed, loadBookmarks, loadSettings: loadBookmarkSettings } = useBookmarkStore()
  const { sidebarWidth, setSidebarWidth, sidebarCollapsed, toggleSidebar, loadSettings: loadLayoutSettings, persistSidebarWidth, isResizing, setIsResizing, showSettings, setShowSettings, showShortcutsHelp, setShowShortcutsHelp, isFullscreen, isDragOver, lightbox, setLightbox } = useLayoutStore()
  const editSessions = useEditSessionStore(state => state.sessions)
  const meaningfulWorkspaceIdsRef = useRef(new Set<string>())
  const openEditSession = useEditSessionStore(state => state.openSession)
  const markEditSessionSaved = useEditSessionStore(state => state.markSaved)
  const markEditSessionConflict = useEditSessionStore(state => state.markConflict)
  const replaceEditSessionFromDisk = useEditSessionStore(state => state.replaceFromDisk)
  const quickEditPlacements = useQuickEditPlacementStore(state => state.placements)
  const replaceQuickEditPlacements = useQuickEditPlacementStore(state => state.replacePlacements)
  const closeQuickEditPlacement = useQuickEditPlacementStore(state => state.closePlacement)
  const documentViews = useDocumentViewModeStore(state => state.views)
  const getDocumentViewState = useDocumentViewModeStore(state => state.getViewState)
  const replaceDocumentViews = useDocumentViewModeStore(state => state.replaceViews)
  const setDocumentViewMode = useDocumentViewModeStore(state => state.setMode)
  const setDocumentViewTarget = useDocumentViewModeStore(state => state.setTarget)
  const setDocumentCompareRatio = useDocumentViewModeStore(state => state.setCompareRatio)
  const workspacePresentations = useMemo(() => workspaces.map((workspace) => {
    const runtime = workspace.id === activeWorkspaceId ? {
      ...getRuntime(workspace.id),
      folderPath,
      files,
      selectedPaths,
      tabs,
      activeTabId,
      splitState,
      scrollToLine,
      scrollToRatio,
      highlightKeyword,
      documentViews,
      quickEditPlacements,
    } : getRuntime(workspace.id)
    const hasDraft = hasOwnedDraft(workspace, editSessions)
    const presentation = createWorkspacePresentation(workspace, runtime, hasDraft)
    if (presentation.hasMeaningfulState) meaningfulWorkspaceIdsRef.current.add(workspace.id)
    return presentation
  }), [activeTabId, activeWorkspaceId, documentViews, editSessions, files, folderPath, getRuntime, highlightKeyword, quickEditPlacements, scrollToLine, scrollToRatio, selectedPaths, splitState, tabs, workspaces])
  const workspaceSummaries = useMemo(() => Object.fromEntries(workspacePresentations.map((presentation) => [
    presentation.workspaceId,
    { tabCount: presentation.tabCount, hasSplit: presentation.hasSplit, hasDraft: presentation.hasDraft, hasMeaningfulState: presentation.hasMeaningfulState },
  ])), [workspacePresentations])
  const visibleWorkspaceCount = workspacePresentations.filter((presentation) =>
    presentation.workspaceId === activeWorkspaceId || presentation.hasMeaningfulState
  ).length

  const [workspaceBootstrapReady, setWorkspaceBootstrapReady] = useState(false)
  const [pendingTransferNonce, setPendingTransferNonce] = useState<string | null>(null)
  const [isWorkspaceImportOpen, setIsWorkspaceImportOpen] = useState(false)
  const [hasWorkspaceMergeSources, setHasWorkspaceMergeSources] = useState(false)
  const [workspaceImportAnchor, setWorkspaceImportAnchor] = useState<HTMLElement | null>(null)
  const pendingTransferNonceRef = useRef<string | null>(null)
  const setPendingWorkspaceTransfer = useCallback((nonce: string | null) => {
    pendingTransferNonceRef.current = nonce
    setPendingTransferNonce(nonce)
  }, [])
  const workspaceBootstrapLoadedRef = useRef(false)
  const workspaceTransitionRef = useRef(false)
  const workspacePresentationsSyncedRef = useRef(false)
  const workspacePresentationTimerRef = useRef<number | null>(null)
  const workspacePresentationInFlightRef = useRef(false)
  const workspacePresentationPendingRef = useRef<WorkspacePresentationSummary[] | null>(null)
  const workspacePruneInFlightRef = useRef(false)
  const [fileTreeRevealRequest, setFileTreeRevealRequest] = useState<FileTreeRevealRequest | null>(null)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'appearance' | 'charts'>('appearance')
  const [settingsChartsView, setSettingsChartsView] = useState<ChartsSettingsView>('capabilities')
  const [settingsInsertionSession, setSettingsInsertionSession] = useState<EditorInsertionSession | undefined>()
  const openSettings = useCallback((options?: {
    tab?: 'appearance' | 'charts'
    chartsView?: ChartsSettingsView
    insertionSession?: EditorInsertionSession
  }) => {
    setSettingsInitialTab(options?.tab ?? 'appearance')
    setSettingsChartsView(options?.chartsView ?? 'capabilities')
    setSettingsInsertionSession(options?.insertionSession)
    setShowSettings(true)
  }, [setShowSettings])
  const closeSettings = useCallback(() => {
    setShowSettings(false)
    setSettingsInitialTab('appearance')
    setSettingsChartsView('capabilities')
    setSettingsInsertionSession(undefined)
  }, [setShowSettings])
  const handleOpenChartSettings = useCallback((request: OpenChartSettingsRequest) => {
    openSettings({
      tab: 'charts',
      chartsView: request.initialView,
      insertionSession: request.insertionSession,
    })
  }, [openSettings])
  const fileTreeRevealSequenceRef = useRef(0)
  const requestFileTreeReveal = useCallback((filePath: string) => {
    const lifecycle = getActiveWorkspaceLifecycleKey()
    const currentFolderPath = useFileStore.getState().folderPath
    if (
      !lifecycle?.primaryRoot
      || !currentFolderPath
      || lifecycle.primaryRoot !== currentFolderPath
      || !isPathInsideFolder(filePath, currentFolderPath)
    ) return

    fileTreeRevealSequenceRef.current += 1
    setFileTreeRevealRequest({
      id: fileTreeRevealSequenceRef.current,
      filePath,
      basePath: currentFolderPath,
      workspaceId: lifecycle.workspaceId,
      lifecycleEpoch: lifecycle.lifecycleEpoch,
    })
  }, [])

  const prunableWorkspaceIds = useMemo(() => new Set(
    workspacePresentations
      .filter((presentation) =>
        presentation.workspaceId !== activeWorkspaceId &&
        !presentation.hasMeaningfulState &&
        !meaningfulWorkspaceIdsRef.current.has(presentation.workspaceId)
      )
      .map((presentation) => presentation.workspaceId)
  ), [activeWorkspaceId, workspacePresentations])

  useEffect(() => {
    if (!workspaceBootstrapReady || !window.api.listWorkspaceMergeSources) return
    let cancelled = false
    let timer: number | undefined
    let fallbackTimer: number | undefined
    const refresh = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void window.api.listWorkspaceMergeSources().then((sources) => {
          if (cancelled) return
          setHasWorkspaceMergeSources(sources.length > 0)
          if (sources.length === 0 && pendingTransferNonceRef.current === null) setIsWorkspaceImportOpen(false)
        }).catch((error) => console.warn('[Workspace] Failed to refresh merge source availability:', error))
      }, 100)
    }
    refresh()
    fallbackTimer = window.setInterval(refresh, 2000)
    const unsubscribe = window.api.onWorkspaceMergeSourcesChanged?.(refresh)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer)
      unsubscribe?.()
    }
  }, [workspaceBootstrapReady])

  const flushWorkspacePresentations = useCallback(() => {
    if (workspacePresentationInFlightRef.current || !window.api.updateWorkspacePresentations) return
    const pending = workspacePresentationPendingRef.current
    if (!pending) return
    workspacePresentationPendingRef.current = null
    workspacePresentationInFlightRef.current = true
    void window.api.updateWorkspacePresentations(pending).then((result) => {
      if (result?.applied !== false && workspacePresentationPendingRef.current === null) {
        workspacePresentationsSyncedRef.current = true
      }
    }).catch((error) => {
      console.error('[Workspace] Failed to update presentations:', error)
    }).finally(() => {
      workspacePresentationInFlightRef.current = false
      if (workspacePresentationPendingRef.current) flushWorkspacePresentations()
    })
  }, [])

  useEffect(() => {
    if (!workspaceBootstrapReady || !window.api.updateWorkspacePresentations) return
    workspacePresentationsSyncedRef.current = false
    workspacePresentationPendingRef.current = workspacePresentations
    if (workspacePresentationTimerRef.current !== null) {
      window.clearTimeout(workspacePresentationTimerRef.current)
    }
    workspacePresentationTimerRef.current = window.setTimeout(() => {
      workspacePresentationTimerRef.current = null
      flushWorkspacePresentations()
    }, 100)
    return () => {
      if (workspacePresentationTimerRef.current !== null) {
        window.clearTimeout(workspacePresentationTimerRef.current)
        workspacePresentationTimerRef.current = null
      }
    }
  }, [flushWorkspacePresentations, workspaceBootstrapReady, workspacePresentations])

  const captureWorkspaceRuntime = useCallback(() => ({
    folderPath,
    files,
    selectedPaths,
    tabs,
    activeTabId,
    splitState,
    scrollToLine,
    scrollToRatio,
    highlightKeyword,
    documentViews,
    quickEditPlacements,
  }), [folderPath, files, selectedPaths, tabs, activeTabId, splitState, scrollToLine, scrollToRatio, highlightKeyword, documentViews, quickEditPlacements])

  const hydrateWorkspaceRuntime = useCallback((workspaceId: string, fallbackRoot?: string | null) => {
    const runtime = getRuntime(workspaceId)
    const workspace = workspaces.find((item) => item.id === workspaceId)
    setFolderPath(runtime.folderPath ?? fallbackRoot ?? workspace?.primaryRoot ?? null)
    setFiles(runtime.files)
    setSelectedPaths(new Set(runtime.selectedPaths))
    setTabs(runtime.tabs)
    setActiveTabId(runtime.activeTabId)
    setSplitState(runtime.splitState)
    setScrollToLine(runtime.scrollToLine)
    setScrollToRatio(runtime.scrollToRatio)
    setHighlightKeyword(runtime.highlightKeyword)
    replaceDocumentViews(runtime.documentViews)
    replaceQuickEditPlacements(runtime.quickEditPlacements)
  }, [getRuntime, replaceDocumentViews, replaceQuickEditPlacements, setActiveTabId, setFiles, setFolderPath, setHighlightKeyword, setScrollToLine, setScrollToRatio, setSelectedPaths, setSplitState, setTabs, workspaces])

  const createWorkspace = useCallback(async () => {
    if (activeWorkspaceId) saveRuntime(activeWorkspaceId, captureWorkspaceRuntime())
    const workspace = await window.api.createWorkspace()
    upsertWorkspace({ id: workspace.id, primaryRoot: workspace.primaryRoot, lifecycleEpoch: workspace.lifecycleEpoch, name: '未命名工作区' })
    setActiveWorkspaceId(workspace.id)
    hydrateWorkspaceRuntime(workspace.id, workspace.primaryRoot)
  }, [activeWorkspaceId, captureWorkspaceRuntime, hydrateWorkspaceRuntime, saveRuntime, setActiveWorkspaceId, upsertWorkspace])

  useEffect(() => {
    if (!window.api.getWorkspaceBootstrap || workspaceBootstrapLoadedRef.current) return
    let cancelled = false
    workspaceBootstrapLoadedRef.current = true
    void window.api.getWorkspaceBootstrap().then(async (bootstrap) => {
      if (cancelled) return
      const descriptors = bootstrap.workspaces.map((workspace) => ({
        id: workspace.id,
        primaryRoot: workspace.primaryRoot,
        lifecycleEpoch: workspace.lifecycleEpoch,
        name: bootstrap.restoredRuntime?.workspaces.find((item) => item.id === workspace.id)?.name
          || workspace.primaryRoot?.split(/[/\\]/).pop()
          || '未命名工作区',
      }))
      setWorkspaces(descriptors, bootstrap.activeWorkspaceId)
      workspaceBootstrapLoadedRef.current = true
      if (bootstrap.restoredRuntime) {
        for (const restored of bootstrap.restoredRuntime.workspaces) {
          const workspace = descriptors.find((item) => item.id === restored.id)
          if (!workspace?.primaryRoot) continue
          const root = workspace.primaryRoot
          // 懒加载：恢复时只建壳 tab（content=null），激活或进入分屏叶子时才读盘
          const restoredTabs: Tab[] = restored.tabs.map((tab) => {
            const separator = root.endsWith('/') || root.endsWith('\\') ? '' : '/'
            const filePath = `${root}${separator}${tab.relativePath}`
            return {
              id: tab.id,
              file: { name: filePath.split(/[/\\]/).pop() || '', path: filePath, isDirectory: false },
              content: null,
              isPinned: tab.isPinned,
            }
          })
          const validTabIds = new Set(restoredTabs.map((tab) => tab.id))
          saveRuntime(restored.id, {
            folderPath: workspace.primaryRoot,
            files: [],
            selectedPaths: new Set(),
            tabs: restoredTabs,
            activeTabId: restored.activeTabId && validTabIds.has(restored.activeTabId) ? restored.activeTabId : restoredTabs[0]?.id ?? null,
            splitState: reconcileSplitState(restored.splitState as SplitState, validTabIds),
            scrollToLine: undefined,
            scrollToRatio: undefined,
            highlightKeyword: undefined,
            documentViews: {},
            quickEditPlacements: {},
          })
        }
        const active = descriptors.find((workspace) => workspace.id === bootstrap.activeWorkspaceId)
        if (active) hydrateWorkspaceRuntime(active.id, active.primaryRoot)
      } else {
        const active = descriptors.find((workspace) => workspace.id === bootstrap.activeWorkspaceId)
        if (active?.primaryRoot) setFolderPath(active.primaryRoot)
      }
      setWorkspaceBootstrapReady(true)
      if (window.api.requestPendingWorkspaceSource) {
        void window.api.requestPendingWorkspaceSource().then((transfer) => {
          if (transfer) setPendingWorkspaceTransfer(transfer.nonce)
        }).catch((error) => console.error('[Workspace] Failed to request split source:', error))
      }
    }).catch((error) => {
      console.error('[Workspace] Failed to load bootstrap:', error)
    })
    return () => { cancelled = true }
  }, [hydrateWorkspaceRuntime, saveRuntime, setWorkspaces])

  useEffect(() => {
    if (!window.api.onWorkspaceCreated) return
    return window.api.onWorkspaceCreated((workspace) => {
      const state = useWorkspaceStore.getState()
      if (state.activeWorkspaceId) state.saveRuntime(state.activeWorkspaceId, captureWorkspaceRuntime())
      state.upsertWorkspace({ ...workspace, name: '未命名工作区' })
      state.setActiveWorkspaceId(workspace.id)
      hydrateWorkspaceRuntime(workspace.id, workspace.primaryRoot)
    })
  }, [captureWorkspaceRuntime, hydrateWorkspaceRuntime])

  useEffect(() => {
    if (!window.api.onWorkspaceFolderActivated) return
    return window.api.onWorkspaceFolderActivated(({ workspaceId, path, lifecycleEpoch }) => {
      upsertWorkspace({
        id: workspaceId,
        primaryRoot: path,
        lifecycleEpoch,
        name: path.split(/[/\\]/).pop() || '未命名工作区',
      })
      setActiveWorkspaceId(workspaceId)
      setFolderPath(path)
    })
  }, [setActiveWorkspaceId, setFolderPath, upsertWorkspace])

  useEffect(() => {
    if (!window.api.onWindowExportRequested) return
    return window.api.onWindowExportRequested(({ nonce, workspaces: plan }) => {
      const planned = plan.map((item) => {
        const descriptor = workspaces.find((workspace) => workspace.id === item.workspaceId)
        if (!descriptor || descriptor.lifecycleEpoch !== item.sourceLifecycleEpoch || descriptor.primaryRoot !== item.primaryRoot) return null
        const runtime = descriptor.id === activeWorkspaceId ? captureWorkspaceRuntime() : getRuntime(descriptor.id)
        const dirtyCount = runtime.tabs.filter((tab) => findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path)?.dirty).length
        return { descriptor, runtime, dirtyCount }
      })
      if (planned.some((item) => !item)) {
        void window.api.cancelWindowTransfer(nonce)
        return
      }
      const dirtyCount = planned.reduce((total, item) => total + (item?.dirtyCount ?? 0), 0)
      if (dirtyCount > 0) {
        window.alert(`来源窗口含 ${dirtyCount} 个未保存草稿。请先保存或关闭草稿后再合并窗口。`)
        void window.api.cancelWindowTransfer(nonce)
        return
      }
      setPendingWorkspaceTransfer(nonce)
      const snapshots = planned.map((item) => ({
        workspaceId: item!.descriptor.id,
        name: item!.descriptor.name || '未命名工作区',
        primaryRoot: item!.descriptor.primaryRoot,
        lifecycleEpoch: item!.descriptor.lifecycleEpoch,
        tabs: item!.runtime.tabs.map((tab) => ({ id: tab.id, filePath: tab.file.path, isPinned: tab.isPinned })),
        activeTabId: item!.runtime.activeTabId,
        splitState: item!.runtime.splitState,
      }))
      void window.api.submitWindowTransferSnapshots(nonce, snapshots).catch((error) => {
        setPendingWorkspaceTransfer(null)
        console.error('[Workspace] Failed to export window:', error)
        void window.api.cancelWindowTransfer(nonce)
      })
    })
  }, [activeWorkspaceId, captureWorkspaceRuntime, getRuntime, setPendingWorkspaceTransfer, workspaces])

  useEffect(() => {
    if (!window.api.onWindowTransferReady) return
    return window.api.onWindowTransferReady(({ nonce }) => {
      void (async () => {
        try {
          const snapshots = await window.api.consumeWindowTransferSnapshots(nonce)
          const prepared = []
          for (const snapshot of snapshots) {
            const remapped = remapImportedWorkspaceSnapshot({ ...snapshot, splitState: snapshot.splitState as SplitState }, `${nonce}-${snapshot.workspaceId}`)
            // 懒加载：接收方也只建壳 tab，激活或进入分屏叶子时才读盘
            const importedTabs: Tab[] = snapshot.tabs.map((tab) => ({
              id: remapped.tabIds.get(tab.id)!,
              file: { name: getFileNameFromPath(tab.filePath), path: tab.filePath, isDirectory: false },
              content: null,
              isPinned: tab.isPinned,
            }))
            const validTabIds = new Set(importedTabs.map((tab) => tab.id))
            prepared.push({ snapshot, tabs: importedTabs, activeTabId: remapped.activeTabId && validTabIds.has(remapped.activeTabId) ? remapped.activeTabId : importedTabs[0]?.id ?? null, splitState: reconcileSplitState(remapped.splitState, validTabIds) })
          }
          await window.api.stageWindowTransfer(nonce)
          const result = await window.api.completeWindowTransfer(nonce)
          for (const mapping of result.workspaces) {
            const item = prepared.find((entry) => entry.snapshot.workspaceId === mapping.sourceWorkspaceId)
            if (!item) throw new Error('窗口合并结果与准备数据不匹配')
            upsertWorkspace({ id: mapping.targetWorkspaceId, primaryRoot: mapping.primaryRoot, lifecycleEpoch: mapping.lifecycleEpoch, name: item.snapshot.name })
            saveRuntime(mapping.targetWorkspaceId, {
              folderPath: mapping.primaryRoot, files: [], selectedPaths: new Set(), tabs: item.tabs,
              activeTabId: item.activeTabId, splitState: item.splitState, scrollToLine: undefined,
              scrollToRatio: undefined, highlightKeyword: undefined, documentViews: {}, quickEditPlacements: {},
            })
          }
          setActiveWorkspaceId(result.activeWorkspaceId)
          hydrateWorkspaceRuntime(result.activeWorkspaceId)
        } catch (error) {
          console.error('[Workspace] Failed to import window:', error)
          void window.api.cancelWindowTransfer(nonce)
        } finally {
          setPendingWorkspaceTransfer(null)
        }
      })()
    })
  }, [hydrateWorkspaceRuntime, saveRuntime, setActiveWorkspaceId, upsertWorkspace])

  useEffect(() => {
    if (!window.api.onWorkspaceExportRequested) return
    return window.api.onWorkspaceExportRequested(({ nonce, workspaceId, sourceLifecycleEpoch }) => {
      const descriptor = workspaces.find((workspace) => workspace.id === workspaceId)
      if (!descriptor || descriptor.lifecycleEpoch !== sourceLifecycleEpoch) {
        void window.api.cancelWorkspaceTransfer(nonce)
        return
      }
      const runtime = workspaceId === activeWorkspaceId
        ? captureWorkspaceRuntime()
        : getRuntime(workspaceId)
      const dirtySessions = runtime.tabs
        .map((tab) => findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path))
        .filter((session): session is EditSession => Boolean(session?.dirty))
      if (dirtySessions.length > 0) {
        window.alert(`工作区含 ${dirtySessions.length} 个未保存草稿。请先保存或关闭草稿后再导入工作区。`)
        void window.api.cancelWorkspaceTransfer(nonce)
        return
      }
      if (runtime.folderPath !== descriptor.primaryRoot) {
        console.error('[Workspace] Refusing to export an out-of-date workspace runtime')
        void window.api.cancelWorkspaceTransfer(nonce)
        return
      }
      setPendingWorkspaceTransfer(nonce)
      void window.api.submitWorkspaceTransferSnapshot(nonce, {
        workspaceId,
        name: descriptor.name || '未命名工作区',
        primaryRoot: descriptor.primaryRoot,
        lifecycleEpoch: descriptor.lifecycleEpoch,
        tabs: runtime.tabs.map((tab) => ({ id: tab.id, filePath: tab.file.path, isPinned: tab.isPinned })),
        activeTabId: runtime.activeTabId,
        splitState: runtime.splitState,
      }).catch((error) => {
        setPendingWorkspaceTransfer(null)
        console.error('[Workspace] Failed to export workspace:', error)
        void window.api.cancelWorkspaceTransfer(nonce)
      })
    })
  }, [activeWorkspaceId, captureWorkspaceRuntime, getRuntime, setPendingWorkspaceTransfer, workspaces])

  useEffect(() => {
    if (!window.api.onWorkspaceTransferReady) return
    return window.api.onWorkspaceTransferReady(({ nonce }) => {
      void (async () => {
        try {
          const snapshot = await window.api.consumeWorkspaceTransferSnapshot(nonce)
          const remapped = remapImportedWorkspaceSnapshot({ ...snapshot, splitState: snapshot.splitState as SplitState }, nonce)
          // 懒加载：接收方只建壳 tab，激活或进入分屏叶子时才读盘
          const tabs: Tab[] = snapshot.tabs.map((tab) => ({
            id: remapped.tabIds.get(tab.id)!,
            file: { name: tab.filePath.split(/[/\\]/).pop() || '', path: tab.filePath, isDirectory: false },
            content: null,
            isPinned: tab.isPinned,
          }))
          const validTabIds = new Set(tabs.map((tab) => tab.id))
          const splitState = reconcileSplitState(remapped.splitState, validTabIds)
          await window.api.stageWorkspaceTransfer(nonce)
          const imported = await window.api.completeWorkspaceTransfer(nonce)
          const activeTabId = remapped.activeTabId && validTabIds.has(remapped.activeTabId)
            ? remapped.activeTabId
            : tabs[0]?.id ?? null
          const importedRuntime = {
            folderPath: imported.primaryRoot,
            files: [],
            selectedPaths: new Set<string>(),
            tabs,
            activeTabId,
            splitState,
            scrollToLine: undefined,
            scrollToRatio: undefined,
            highlightKeyword: undefined,
            documentViews: {},
            quickEditPlacements: {},
          }
          replaceWorkspace(imported.replacedWorkspaceId, {
            id: imported.id,
            primaryRoot: imported.primaryRoot,
            lifecycleEpoch: imported.lifecycleEpoch,
            name: snapshot.name,
          }, importedRuntime)
          setActiveWorkspaceId(imported.id)
          hydrateWorkspaceRuntime(imported.id, imported.primaryRoot)
        } catch (error) {
          console.error('[Workspace] Failed to import workspace:', error)
          void window.api.cancelWorkspaceTransfer(nonce)
        } finally {
          setPendingWorkspaceTransfer(null)
        }
      })()
    })
  }, [hydrateWorkspaceRuntime, replaceWorkspace, setActiveWorkspaceId])

  useEffect(() => {
    if (!pendingTransferNonce) return
    const blockRuntimeChanges = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', blockRuntimeChanges, true)
    document.addEventListener('dblclick', blockRuntimeChanges, true)
    document.addEventListener('contextmenu', blockRuntimeChanges, true)
    document.addEventListener('dragstart', blockRuntimeChanges, true)
    document.addEventListener('drop', blockRuntimeChanges, true)
    document.addEventListener('keydown', blockRuntimeChanges, true)
    return () => {
      document.removeEventListener('click', blockRuntimeChanges, true)
      document.removeEventListener('dblclick', blockRuntimeChanges, true)
      document.removeEventListener('contextmenu', blockRuntimeChanges, true)
      document.removeEventListener('dragstart', blockRuntimeChanges, true)
      document.removeEventListener('drop', blockRuntimeChanges, true)
      document.removeEventListener('keydown', blockRuntimeChanges, true)
    }
  }, [pendingTransferNonce])

  useEffect(() => {
    if (!window.api.onWorkspaceTransferredOut) return
    return window.api.onWorkspaceTransferredOut(({ workspaceId, activeWorkspaceId: nextWorkspaceId }) => {
      setPendingWorkspaceTransfer(null)
      removeWorkspace(workspaceId)
      setActiveWorkspaceId(nextWorkspaceId)
      if (nextWorkspaceId) hydrateWorkspaceRuntime(nextWorkspaceId)
    })
  }, [hydrateWorkspaceRuntime, removeWorkspace, setActiveWorkspaceId])

  const requestWorkspaceMerge = useCallback(async (sourceWindowId: number) => {
    const result = await window.api.beginWindowTransfer(sourceWindowId)
    if (result.closedEmptyWindow || !result.nonce) {
      setIsWorkspaceImportOpen(false)
      return
    }
    setPendingWorkspaceTransfer(result.nonce)
  }, [])

  const { lastExportedFilePath, lastExportedTime } = useExportTaskStore()

  const toast = useToast()
  const { theme, setTheme } = useTheme()

  const handleOpenLastExport = useCallback(async () => {
    try {
      const result = await window.api.openLastDocxExport()
      if (!result.ok) toast.error(result.error || '无法打开文件')
    } catch { toast.error('无法打开文件') }
  }, [toast])
  const { isAlwaysOnTop, toggleAlwaysOnTop, initialize: initWindowStore, syncFromMain: syncAlwaysOnTop } = useWindowStore()
  const { applyCSSVariable } = useUIStore()

  // Refs
  const tabsRef = useRef<Tab[]>([])
  tabsRef.current = tabs
  const splitStateRef = useRef<SplitState>(splitState)
  splitStateRef.current = splitState
  const splitLeafPositionsRef = useRef<FolderSplitLeafPositions>({})
  const searchBarRef = useRef<SearchBarHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [previewElement, setPreviewElement] = useState<HTMLDivElement | null>(null)
  // 跨根移动目标选择弹窗
  useEffect(() => {
    if (!window.api.onWorkspaceTransferCancelled) return
    return window.api.onWorkspaceTransferCancelled(({ nonce, reason }) => {
      if (pendingTransferNonceRef.current !== nonce) return
      setPendingWorkspaceTransfer(null)
      console.warn('[Workspace] Import cancelled:', reason)
    })
  }, [setPendingWorkspaceTransfer])
  const [moveToSources, setMoveToSources] = useState<string[] | null>(null)
  const [renameRepairRequest, setRenameRepairRequest] = useState<{
    operation: { workspaceId: string; lifecycleEpoch: number }
    oldPath: string
    newName: string
    mapping: { oldRelativePath: string; newRelativePath: string }
    impact: Awaited<ReturnType<typeof window.api.createLinkImpact>>
  } | null>(null)
  const dirtyLeaveDecisionRef = useRef<{
    activeTabId: string
    canonicalPath: string
    draftVersion: number
    nextFilePath: string
    allowed: boolean
    expiresAt: number
  } | null>(null)
  const pendingFileSelectPathRef = useRef<string | null>(null)
  const setPreviewNode = useCallback((element: HTMLDivElement | null) => {
    previewRef.current = element
    setPreviewElement(element)
  }, [])

  // v1.6.0: 提取的 hooks
  useDragDrop()
  useKeyboardShortcuts()
  useEditDraftPersistence()

  const confirmLeaveDirtyActiveTab = useCallback((nextFilePath?: string): boolean => {
    const currentActiveTabId = useTabStore.getState().activeTabId
    const active = tabsRef.current.find(tab => tab.id === currentActiveTabId)
    if (!active || active.file.path === nextFilePath) return true

    const session = findEditSessionForPath(useEditSessionStore.getState().sessions, active.file.path)
    if (!session?.dirty) return true

    const decision = dirtyLeaveDecisionRef.current
    const targetPath = nextFilePath || ''
    const now = Date.now()
    if (
      decision &&
      decision.activeTabId === currentActiveTabId &&
      decision.canonicalPath === session.canonicalPath &&
      decision.draftVersion === session.draftVersion &&
      decision.nextFilePath === targetPath &&
      decision.expiresAt > now
    ) {
      return decision.allowed
    }

    const allowed = window.confirm(UNSAVED_EDIT_LEAVE_MESSAGE)
    const nextDecision = {
      activeTabId: currentActiveTabId || '',
      canonicalPath: session.canonicalPath,
      draftVersion: session.draftVersion,
      nextFilePath: targetPath,
      allowed,
      expiresAt: allowed ? now + DIRTY_LEAVE_CONFIRM_REUSE_MS : Number.POSITIVE_INFINITY,
    }
    dirtyLeaveDecisionRef.current = nextDecision
    if (!allowed) {
      window.setTimeout(() => {
        if (dirtyLeaveDecisionRef.current === nextDecision) dirtyLeaveDecisionRef.current = null
      }, 0)
    }
    return allowed
  }, [])

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId || workspaceTransitionRef.current) return
    if (!confirmLeaveDirtyActiveTab()) return

    workspaceTransitionRef.current = true
    try {
      if (activeWorkspaceId) saveRuntime(activeWorkspaceId, captureWorkspaceRuntime())

      const workspace = await window.api.activateWorkspace(workspaceId)
      upsertWorkspace({
        id: workspace.id,
        primaryRoot: workspace.primaryRoot,
        lifecycleEpoch: workspace.lifecycleEpoch,
      name: workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
      })
      setActiveWorkspaceId(workspace.id)
      hydrateWorkspaceRuntime(workspace.id, workspace.primaryRoot)
    } finally {
      workspaceTransitionRef.current = false
    }
  }, [activeWorkspaceId, captureWorkspaceRuntime, confirmLeaveDirtyActiveTab, hydrateWorkspaceRuntime, saveRuntime, setActiveWorkspaceId, upsertWorkspace])

  const closeActiveWorkspace = useCallback(async () => {
    if (!activeWorkspaceId || workspaceTransitionRef.current) return
    if (!confirmLeaveDirtyActiveTab()) return

    workspaceTransitionRef.current = true
    try {
      const { activeWorkspaceId: nextWorkspaceId } = await window.api.closeWorkspace(activeWorkspaceId)
      removeWorkspace(activeWorkspaceId)
      setActiveWorkspaceId(nextWorkspaceId)
      if (nextWorkspaceId) hydrateWorkspaceRuntime(nextWorkspaceId)
    } finally {
      workspaceTransitionRef.current = false
    }
  }, [activeWorkspaceId, confirmLeaveDirtyActiveTab, hydrateWorkspaceRuntime, removeWorkspace, setActiveWorkspaceId])

  useEffect(() => { loadBookmarkSettings() }, [])
  useEffect(() => { loadLayoutSettings() }, [loadLayoutSettings])

  // v1.4.2：初始化 Zustand stores
  useEffect(() => {
    const platform = window.api?.platform || 'darwin'
    document.body.setAttribute('data-platform', platform)
    initWindowStore()
    applyCSSVariable()
    const cleanupAlwaysOnTop = window.api.onAlwaysOnTopChanged(syncAlwaysOnTop)
    return () => { cleanupAlwaysOnTop() }
  }, [initWindowStore, applyCSSVariable, syncAlwaysOnTop])

  const requestWorkspaceSplit = useCallback(async () => {
    if (!activeWorkspaceId || workspaceTransitionRef.current) return
    if (!confirmLeaveDirtyActiveTab()) return

    workspaceTransitionRef.current = true
    try {
      await window.api.splitActiveWorkspace(activeWorkspaceId)
    } catch (error) {
      toast.error(`无法拆分工作区：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      workspaceTransitionRef.current = false
    }
  }, [activeWorkspaceId, confirmLeaveDirtyActiveTab, toast])

  useEffect(() => {
    if (
      !workspaceBootstrapReady ||
      !activeWorkspaceId ||
      !window.api.pruneInactiveWorkspaces ||
      pendingTransferNonce ||
      prunableWorkspaceIds.size === 0
    ) return

    const timer = window.setTimeout(() => {
      if (
        workspaceTransitionRef.current ||
        workspacePruneInFlightRef.current ||
        !workspacePresentationsSyncedRef.current
      ) return
      const state = useWorkspaceStore.getState()
      if (state.activeWorkspaceId !== activeWorkspaceId) return
      const candidates = state.workspaces
        .filter((workspace) => workspace.id !== activeWorkspaceId && prunableWorkspaceIds.has(workspace.id))
        .map((workspace) => ({
          workspaceId: workspace.id,
          lifecycleEpoch: workspace.lifecycleEpoch,
          primaryRoot: workspace.primaryRoot,
        }))
      if (candidates.length === 0) return

      workspacePruneInFlightRef.current = true
      void window.api.pruneInactiveWorkspaces({
        expectedActiveWorkspaceId: activeWorkspaceId,
        candidates,
      }).then((result) => {
        if (result.activeWorkspaceId !== useWorkspaceStore.getState().activeWorkspaceId) return
        removeWorkspaces(result.removedWorkspaceIds)
        for (const workspaceId of result.removedWorkspaceIds) meaningfulWorkspaceIdsRef.current.delete(workspaceId)
      }).catch((error) => {
        console.warn('[Workspace] Deferred inactive workspace cleanup:', error)
      }).finally(() => {
        workspacePruneInFlightRef.current = false
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, pendingTransferNonce, prunableWorkspaceIds, removeWorkspaces, workspaceBootstrapReady])

  useEffect(() => {
    if (
      !workspaceBootstrapReady ||
      !window.api.saveWorkspaceDesktopRuntime ||
      workspaces.length === 0 ||
      workspacePruneInFlightRef.current ||
      prunableWorkspaceIds.size > 0 ||
      pendingTransferNonce ||
      (activeWorkspaceRoot !== undefined && activeWorkspaceRoot !== folderPath)
    ) return

    const timer = window.setTimeout(() => {
      const runtimeFor = (workspaceId: string) => workspaceId === activeWorkspaceId
        ? captureWorkspaceRuntime()
        : getRuntime(workspaceId)
      const runtime = {
        activeWorkspaceId,
        workspaces: workspaces.map((workspace) => {
          const snapshot = runtimeFor(workspace.id)
          return {
            id: workspace.id,
            name: workspace.name,
            primaryRoot: workspace.primaryRoot,
            lifecycleEpoch: workspace.lifecycleEpoch,
            tabs: snapshot.tabs.map((tab) => ({
              id: tab.id,
              filePath: tab.file.path,
              isPinned: Boolean(tab.isPinned),
            })),
            activeTabId: snapshot.activeTabId,
            splitState: snapshot.splitState,
          }
        }),
      }
      void window.api.saveWorkspaceDesktopRuntime(runtime).catch((error) => {
        console.error('[Workspace] Failed to checkpoint desktop session:', error)
      })
    }, 750)
    return () => window.clearTimeout(timer)
  }, [activeTabId, activeWorkspaceId, activeWorkspaceRoot, captureWorkspaceRuntime, files, folderPath, getRuntime, highlightKeyword, pendingTransferNonce, prunableWorkspaceIds, scrollToLine, scrollToRatio, selectedPaths, splitState, tabs, workspaceBootstrapReady, workspaces])

  // 初始加载书签
  useEffect(() => { loadBookmarks() }, [loadBookmarks])

  // v2.7.0:初始加载朗读设置(多 provider)
  const loadReadAloudSettings = useReadAloudStore((s) => s.loadSettings)
  useEffect(() => { loadReadAloudSettings() }, [loadReadAloudSettings])

  // v1.3.6 Day 7.6：监听书签数量变化，首次添加书签时自动展开 BookmarkPanel
  const hasShownBookmarkPanelRef = useRef(false)
  useEffect(() => {
    if (bookmarks.length === 1 && bookmarkPanelCollapsed && !hasShownBookmarkPanelRef.current) {
      hasShownBookmarkPanelRef.current = true
      setBookmarkPanelCollapsed(false)
      window.api.updateAppSettings({ bookmarkPanelCollapsed: false }).catch(err => {
        console.error('[App] Failed to save bookmark panel state:', err)
      })
    }
  }, [bookmarks.length, bookmarkPanelCollapsed])

  // v1.3.6：响应式布局
  useEffect(() => {
    const BREAKPOINT = 1200
    const mediaQuery = window.matchMedia(`(max-width: ${BREAKPOINT}px)`)
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setBookmarkBarCollapsed(true)
        setBookmarkPanelCollapsed(true)
      }
    }
    handleMediaChange(mediaQuery)
    mediaQuery.addEventListener('change', handleMediaChange)
    return () => mediaQuery.removeEventListener('change', handleMediaChange)
  }, [])

  // 监听恢复文件夹事件
  useEffect(() => {
    const cleanup = window.api.onRestoreFolder(async (activation) => {
      useWorkspaceStore.getState().upsertWorkspace({
        ...activation.workspace,
        name: activation.workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
      })
      setFolderPath(activation.path)
      try {
        const pinnedTabs = await window.api.getPinnedTabsForFolder(activation.path)
        if (pinnedTabs.length > 0) {
          // 懒加载：固定标签建壳，激活时才读盘
          const newTabs: Tab[] = pinnedTabs.map((pinned) => ({
            id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file: { name: pinned.path.split(/[/\\]/).pop() || '', path: pinned.path, isDirectory: false },
            content: null,
            isPinned: true
          }))
          if (newTabs.length > 0) {
            setTabs(prev => [...prev, ...newTabs])
            // 新窗口可能同时收到 open-specific-file；目录恢复不能在异步完成后
            // 抢走已明确打开文件的焦点。普通恢复时 activeTabId 为空，仍激活首个固定标签。
            if (!useTabStore.getState().activeTabId) {
              setActiveTabId(newTabs[0].id)
            }
          }
        }
      } catch (err) {
        console.error('[App] Failed to restore pinned tabs on folder restore:', err)
      }
    })
    return cleanup
  }, [])

  // v1.3.6：恢复固定标签
  const restorePinnedTabs = useCallback(async (targetFolderPath: string) => {
    try {
      const pinnedTabs = await window.api.getPinnedTabsForFolder(targetFolderPath)
      if (pinnedTabs.length === 0) return
      // 懒加载：固定标签建壳，激活时才读盘
      const newTabs: Tab[] = pinnedTabs.map((pinned) => ({
        id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file: { name: pinned.path.split(/[/\\]/).pop() || '', path: pinned.path, isDirectory: false },
        content: null,
        isPinned: true
      }))
      if (newTabs.length > 0) {
        let firstAddedTabId: string | null = null
        setTabs(prev => {
          const existingPaths = new Set(prev.map(tab => tab.file.path))
          const tabsToAdd = newTabs.filter(tab => {
            if (existingPaths.has(tab.file.path)) return false
            existingPaths.add(tab.file.path)
            return true
          })
          firstAddedTabId = tabsToAdd[0]?.id ?? null
          return [...prev, ...tabsToAdd]
        })
        if (firstAddedTabId) setActiveTabId(firstAddedTabId)
      }
    } catch (error) {
      console.error('[App] Failed to restore pinned tabs:', error)
    }
  }, [])

  const keepPinnedTabsForFolderSwitch = useCallback(() => {
    setTabs(prev => prev.filter(tab => tab.isPinned))
    setSplitState({ root: null, activeLeafId: '' })
    splitLeafPositionsRef.current = {}
  }, [setSplitState, setTabs])

  // v2.8.0：切走当前文件夹前，把实时 tab 列表 + 当前文档归档到 folderTabSessions。
  // 必须在触发切换的 activation IPC（会替换主进程工作区根）之前调用，否则旧路径会按新根校验被拒。
  const archiveCurrentFolderTabs = useCallback(async () => {
    const oldFolderPath = useFileStore.getState().folderPath
    if (!oldFolderPath) return
    const operation = getActiveWorkspaceOperationContext()
    if (!operation) return
    const currentTabs = tabsRef.current
    const activeId = useTabStore.getState().activeTabId
    const activeTab = currentTabs.find(tab => tab.id === activeId)
    try {
      await window.api.saveFolderTabSession(
        {
          tabs: currentTabs.map(tab => ({ filePath: tab.file.path, isPinned: tab.isPinned })),
          activeFilePath: activeTab?.file.path ?? null,
          splitLayout: serializeFolderSplitLayout(
            splitStateRef.current,
            currentTabs,
            oldFolderPath,
            splitLeafPositionsRef.current,
          ),
        },
        operation
      )
    } catch (error) {
      console.error('[App] Failed to archive folder tab session:', error)
    }
  }, [])

  // v2.8.0：切回文件夹时，用归档的 tab 会话重建壳 tab（content=null，懒加载）。
  // 无归档则回退到固定标签恢复。active 采用归档的当前文档；isPinned 以 pinned store 为权威校正。
  const restoreFolderTabSession = useCallback(async (targetFolderPath: string) => {
    try {
      const session = await window.api.getFolderTabSession(targetFolderPath)
      if (session.tabs.length === 0) {
        splitLeafPositionsRef.current = {}
        setSplitState({ root: null, activeLeafId: '' })
        await restorePinnedTabs(targetFolderPath)
        return
      }
      const pinnedTabs = await window.api.getPinnedTabsForFolder(targetFolderPath)
      const pinnedPaths = new Set(pinnedTabs.map(tab => tab.path))
      const shellTabs: Tab[] = session.tabs.map(entry => ({
        id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file: { name: entry.path.split(/[/\\]/).pop() || '', path: entry.path, isDirectory: false },
        content: null,
        isPinned: pinnedPaths.has(entry.path),
      }))
      const targetActivePath = session.activePath ?? session.tabs[0]?.path ?? null
      let activeId: string | null = null
      let finalTabs: Tab[] = []
      setTabs(prev => {
        const existingPaths = new Set(prev.map(tab => tab.file.path))
        const merged = [...prev]
        for (const shell of shellTabs) {
          if (existingPaths.has(shell.file.path)) continue
          existingPaths.add(shell.file.path)
          merged.push(shell)
        }
        if (targetActivePath) {
          activeId = merged.find(tab => tab.file.path === targetActivePath)?.id ?? null
        }
        finalTabs = merged
        return merged
      })
      const restoredSplit = restoreFolderSplitLayout(session.splitLayout, finalTabs, targetFolderPath)
      if (restoredSplit) {
        splitLeafPositionsRef.current = Object.fromEntries(
          Object.entries(restoredSplit.leafViewStates)
            .filter(([, viewState]) => typeof viewState.scrollRatio === 'number')
            .map(([leafId, viewState]) => {
              const leaf = findLeaf(restoredSplit.splitState.root, leafId)
              const tab = leaf ? finalTabs.find(item => item.id === leaf.tabId) : undefined
              return [leafId, {
                filePath: tab?.file.path ?? '',
                scrollRatio: viewState.scrollRatio ?? 0,
                ...(viewState.headingId ? { headingId: viewState.headingId } : {}),
                ...(viewState.contentHash ? { contentHash: viewState.contentHash } : {}),
              }]
            })
        )
        setSplitState(restoredSplit.splitState)
        const activeLeaf = findLeaf(restoredSplit.splitState.root, restoredSplit.splitState.activeLeafId)
        if (activeLeaf) activeId = activeLeaf.tabId
      } else {
        splitLeafPositionsRef.current = {}
        setSplitState({ root: null, activeLeafId: '' })
      }
      if (activeId) setActiveTabId(activeId)
    } catch (error) {
      console.error('[App] Failed to restore folder tab session:', error)
      await restorePinnedTabs(targetFolderPath)
    }
  }, [restorePinnedTabs])

  const refreshExistingTabContent = useCallback(async (tab: Tab, loadContent: () => Promise<string>, errorPrefix = '无法打开文件') => {
    const dirtySession = findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path)
    setActiveTabId(tab.id)
    if (dirtySession?.dirty) return

    try {
      clearFileCache(tab.file.path)
      const content = await loadContent()
      setTabs(prev => prev.map(item =>
        item.id === tab.id
          ? { ...item, content }
          : item
      ))
    } catch (error) {
      console.error('Failed to refresh existing tab:', error)
      toast.error(`${errorPrefix}：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [setActiveTabId, setTabs, toast])

  const applyFolderActivation = useCallback(async (activation: FolderActivation): Promise<void> => {
    upsertWorkspace({
      ...activation.workspace,
      name: activation.workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
    })
    setFolderPath(activation.path)
    keepPinnedTabsForFolderSwitch()
    setActiveTabId(null)
    await restoreFolderTabSession(activation.path)
  }, [keepPinnedTabsForFolderSwitch, restoreFolderTabSession, upsertWorkspace])

  // 打开文件夹
  const openFolder = useCallback(async (): Promise<FolderActivation | null> => {
    if (!confirmLeaveDirtyActiveTab()) return null
    await archiveCurrentFolderTabs()
    try {
      const activation = await window.api.openFolder()
      if (!activation) return null
      await applyFolderActivation(activation)
      return activation
    } catch (error) {
      console.error('Failed to open folder:', error)
      return null
    }
  }, [applyFolderActivation, archiveCurrentFolderTabs, confirmLeaveDirtyActiveTab])

  const handleOpenFolder = useCallback(async () => {
    await openFolder()
  }, [openFolder])

  // 从历史选择文件夹
  const handleSelectHistoryFolder = useCallback(async (historyId: string) => {
    if (!confirmLeaveDirtyActiveTab()) return
    await archiveCurrentFolderTabs()
    const activation = await window.api.activateHistoryFolder(historyId)
    upsertWorkspace({
      ...activation.workspace,
      name: activation.workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
    })
    setFolderPath(activation.path)
    keepPinnedTabsForFolderSwitch()
    setActiveTabId(null)
    await restoreFolderTabSession(activation.path)
  }, [archiveCurrentFolderTabs, confirmLeaveDirtyActiveTab, keepPinnedTabsForFolderSwitch, restoreFolderTabSession, upsertWorkspace])

  // 从主进程持有的最近文件记录激活；renderer 不再推导或授权根目录。
  const handleSelectRecentFile = useCallback(async (recentId: string, options?: ExternalDocumentOpenOptions) => {
    if (!confirmLeaveDirtyActiveTab()) return
    await archiveCurrentFolderTabs()
    try {
      const activation = await window.api.activateRecentFile(recentId)
      upsertWorkspace({
        ...activation.workspace,
        name: activation.workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
      })
      setFolderPath(activation.path)
      keepPinnedTabsForFolderSwitch()
      setActiveTabId(null)
      await restoreFolderTabSession(activation.path)

      // 刚点击的最近文件始终覆盖归档 active：确保它有 tab 并激活 + 预热内容
      const pinnedTabs = await window.api.getPinnedTabsForFolder(activation.path)
      const isPinned = pinnedTabs.some(tab => tab.path === activation.filePath)
      let targetId: string | null = null
      setTabs(prev => {
        const existing = prev.find(tab => tab.file.path === activation.filePath)
        if (existing) {
          targetId = existing.id
          return prev
        }
        const shell: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file: { name: activation.fileName, path: activation.filePath, isDirectory: false },
          content: null,
          isPinned,
        }
        targetId = shell.id
        return [...prev, shell]
      })
      if (targetId) {
        setScrollToLine(options?.lineNumber)
        setScrollToRatio(undefined)
        setHighlightKeyword(options?.highlightKeyword)
        setActiveTabId(targetId)
        void ensureTabContentLoaded(targetId)
      }
    } catch (error) {
      toast.error(`无法打开最近文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [archiveCurrentFolderTabs, confirmLeaveDirtyActiveTab, keepPinnedTabsForFolderSwitch, restoreFolderTabSession, setHighlightKeyword, setScrollToLine, setScrollToRatio, toast, upsertWorkspace])

  // 加载文件列表
  useEffect(() => {
    const hasWorkspaceBootstrap = Object.hasOwn(window.api, 'getWorkspaceBootstrap')
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (!folderPath || !lifecycle || lifecycle.primaryRoot !== folderPath || (hasWorkspaceBootstrap && !workspaceBootstrapReady)) return
    const loadFiles = async () => {
      setIsLoading(true)
      try {
        const fileList = await window.api.readDir(folderPath)
        if (isActiveWorkspaceLifecycleKey(lifecycle)) setFiles(fileList)
      } catch (error) {
        console.error('Failed to load files:', error)
        if (isActiveWorkspaceLifecycleKey(lifecycle)) setFiles([])
      } finally {
        if (isActiveWorkspaceLifecycleKey(lifecycle)) setIsLoading(false)
      }
    }
    loadFiles()
  }, [folderPath])

  // 手动刷新文件树
  const handleRefreshFiles = useCallback(async () => {
    const currentFolderPath = useFileStore.getState().folderPath
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (!currentFolderPath || !lifecycle || lifecycle.primaryRoot !== currentFolderPath) return
    setIsLoading(true)
    try {
      const fileList = await window.api.readDir(currentFolderPath)
      if (isActiveWorkspaceLifecycleKey(lifecycle)) setFiles(fileList)
    } catch (error) {
      console.error('Failed to refresh files:', error)
    } finally {
      if (isActiveWorkspaceLifecycleKey(lifecycle)) setIsLoading(false)
    }
  }, [])

  // 文件重命名处理
  const handleFileRenamed = useCallback(async (oldPath: string, newName: string) => {
    try {
      const operation = getActiveWorkspaceOperationContext()
      const lifecycle = getActiveWorkspaceLifecycleKey()
      if (!operation || !lifecycle?.primaryRoot) throw new Error('工作区尚未就绪')
      const root = lifecycle.primaryRoot.replace(/[\\/]+$/, '')
      const oldRelativePath = oldPath.slice(root.length + 1).replace(/\\/g, '/')
      const parent = oldRelativePath.includes('/') ? oldRelativePath.slice(0, oldRelativePath.lastIndexOf('/') + 1) : ''
      const mapping = { oldRelativePath, newRelativePath: `${parent}${newName}` }
      const impact = await window.api.createLinkImpact(operation, mapping)
      setRenameRepairRequest({ operation, oldPath, newName, mapping, impact })
    } catch (error) {
      console.error('Failed to rename file:', error)
      toast.error(`重命名失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeWorkspaceId, toast, workspaces])

  const confirmCloseDirtyTab = useCallback((tab: Tab): boolean => {
    const session = findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path)
    if (!session?.dirty) return true
    return window.confirm(`"${tab.file.name}" 有未保存编辑草稿，关闭会保留内存草稿但不会写入磁盘。是否继续关闭标签？`)
  }, [])

  const resolveReadPositionRatio = useCallback(async (filePath: string): Promise<number | undefined> => {
    try {
      const position = await window.api.getReadPosition?.(filePath)
      if (!position || typeof position.scrollRatio !== 'number') return undefined
      return Math.max(0, Math.min(1, position.scrollRatio))
    } catch (error) {
      console.warn('[App] Failed to restore read position:', error)
      return undefined
    }
  }, [])

  const handleReadPositionChange = useCallback((filePath: string, position: { scrollRatio: number; headingId?: string }) => {
    const workspace = getActiveWorkspaceOperationContext()
    if (!workspace) return
    window.api.saveReadPosition?.({
      canonicalPath: filePath,
      scrollRatio: position.scrollRatio,
      headingId: position.headingId,
      workspace,
    }).catch(error => {
      console.warn('[App] Failed to save read position:', error)
    })
  }, [])

  const handleSplitReadPositionChange = useCallback((
    leafId: string,
    filePath: string,
    position: { scrollRatio: number; headingId?: string },
  ) => {
    splitLeafPositionsRef.current[leafId] = { filePath, ...position }
    handleReadPositionChange(filePath, position)
  }, [handleReadPositionChange])

  const getRestoredSplitLeafViewState = useCallback((leafId: string, filePath: string) => {
    const state = splitLeafPositionsRef.current[leafId]
    return state?.filePath === filePath ? state : undefined
  }, [])

  const clearRestoredSplitLeafViewState = useCallback((leafId: string) => {
    delete splitLeafPositionsRef.current[leafId]
  }, [])

  const removeTabsFromSession = useCallback((predicate: (tab: Tab) => boolean) => {
    setTabs(prev => {
      const nextTabs = prev.filter(predicate)
      setSplitState(split => reconcileSplitState(split, new Set(nextTabs.map(tab => tab.id))))

      const currentActiveTabId = useTabStore.getState().activeTabId
      if (!currentActiveTabId || !nextTabs.some(tab => tab.id === currentActiveTabId)) {
        setActiveTabId(nextTabs[0]?.id ?? null)
      }
      return nextTabs
    })
  }, [setActiveTabId, setSplitState, setTabs])

  const recoverMissingTab = useCallback(async (tabId: string, candidatePath?: string) => {
    const tab = tabsRef.current.find(item => item.id === tabId)
    if (!tab) return
    const targetPath = candidatePath ?? tab.file.path
    try {
      clearFileCache(targetPath)
      const operation = getActiveWorkspaceOperationContext()
      const editSession = findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path)
      const editable = editSession && operation
        ? await window.api.openEditableMarkdown(targetPath, operation)
        : null
      const content = editable?.content ?? await window.api.readFile(targetPath)
      if (editSession && editable) {
        useEditSessionStore.getState().closeSession(editSession.canonicalPath)
        useEditSessionStore.getState().openSession({
          ...editable,
          workspaceId: operation!.workspaceId,
          lifecycleEpoch: operation!.lifecycleEpoch,
        })
      }
      if (candidatePath && operation) {
        void window.api.unwatchFile(tab.file.path, operation.workspaceId, operation.lifecycleEpoch).catch(() => {})
        void window.api.watchFile(targetPath, operation.workspaceId, operation.lifecycleEpoch).catch(() => {})
      }
      setTabs(prev => prev.map(item => item.id === tabId && item.file.path === tab.file.path
        ? {
            ...item,
            content,
            missing: false,
            renameCandidatePath: undefined,
            file: candidatePath
              ? { ...item.file, path: targetPath, name: getFileNameFromPath(targetPath) }
              : item.file,
          }
        : item))
    } catch (error) {
      console.error('Failed to recover missing file:', error)
    }
  }, [setTabs])

  // 关闭标签
  const handleTabClose = useCallback((tabId: string) => {
    const closingTab = tabsRef.current.find(tab => tab.id === tabId)
    if (closingTab && !confirmCloseDirtyTab(closingTab)) return
    const operation = getActiveWorkspaceOperationContext()
    if (closingTab && operation) {
      void window.api.unwatchFile(
        closingTab.file.path,
        operation.workspaceId,
        operation.lifecycleEpoch
      ).catch(() => {})
    }

    setTabs(prev => {
      const closingTab = prev.find(tab => tab.id === tabId)
      if (closingTab) clearFileCache(closingTab.file.path)
      const newTabs = prev.filter(tab => tab.id !== tabId)
      setSplitState(split => reconcileSplitState(
        split,
        new Set(newTabs.map(tab => tab.id))
      ))
      const currentActiveTabId = useTabStore.getState().activeTabId
      if (tabId === currentActiveTabId) {
        const closedIndex = prev.findIndex(tab => tab.id === tabId)
        if (newTabs.length > 0) {
          const nextTab = newTabs[closedIndex] || newTabs[closedIndex - 1]
          setActiveTabId(nextTab.id)
        } else {
          setActiveTabId(null)
        }
      }
      return newTabs
    })
  }, [confirmCloseDirtyTab])

  // 选择文件
  const handleFileSelect = useCallback(async (file: FileInfo, lineNumber?: number, keyword?: string) => {
    if (file.isDirectory) return
    if (pendingFileSelectPathRef.current) return
    if (!confirmLeaveDirtyActiveTab(file.path)) return
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (!lifecycle) return
    pendingFileSelectPathRef.current = file.path
    const existingTab = tabsRef.current.find(tab => tab.file.path === file.path)
    try {
      if (existingTab) {
        const targetRatio = lineNumber || keyword ? undefined : await resolveReadPositionRatio(file.path)
        if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
        setScrollToLine(lineNumber)
        setScrollToRatio(targetRatio)
        setHighlightKeyword(keyword)
        await refreshExistingTabContent(existingTab, () => readPreviewContentWithCache(file.path))
        return
      }
      try {
        const content = await readPreviewContentWithCache(file.path)
        if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
        const targetRatio = lineNumber || keyword ? undefined : await resolveReadPositionRatio(file.path)
        if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
        setScrollToLine(lineNumber)
        setScrollToRatio(targetRatio)
        setHighlightKeyword(keyword)
        const operation = getActiveWorkspaceOperationContext()
        if (!operation) return
        const isPinned = await window.api.isTabPinned(file.path, operation)
        if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          content,
          isPinned
        }
        setTabs(prev => [...prev, newTab])
        setActiveTabId(newTab.id)
        const currentFolderPath = useFileStore.getState().folderPath
        if (currentFolderPath) {
          if (isActiveWorkspaceLifecycleKey(lifecycle)) {
            window.api.addRecentFile({ path: file.path, name: file.name, folderPath: currentFolderPath }).catch(err => console.error('Failed to add to recent files:', err))
          }
        }
        if (isActiveWorkspaceLifecycleKey(lifecycle)) {
          window.api.watchFile(file.path, lifecycle.workspaceId, lifecycle.lifecycleEpoch)
            .catch(err => console.error('Failed to watch file:', err))
        }
      } catch (error) {
        console.error('Failed to read file:', error)
        toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
      }
    } finally {
      if (pendingFileSelectPathRef.current === file.path) pendingFileSelectPathRef.current = null
    }
  }, [activeWorkspaceId, confirmLeaveDirtyActiveTab, refreshExistingTabContent, resolveReadPositionRatio, toast, workspaces])

  const handleOpenDocumentCommand = useCallback(async (command: OpenDocumentCommand, file: FileInfo) => {
    if (command.dirtyPolicy === 'block' && !confirmLeaveDirtyActiveTab(command.filePath)) return
    const previousActiveTabId = useTabStore.getState().activeTabId
    const wasAlreadyActive = tabsRef.current.some(tab => tab.id === previousActiveTabId && tab.file.path === file.path)
    const targetLine = command.target?.kind === 'line' || command.target?.kind === 'match'
      ? command.target.lineNumber
      : undefined
    await handleFileSelect(file, targetLine, command.target?.highlightText)
    const currentActiveTabId = useTabStore.getState().activeTabId
    if (wasAlreadyActive && tabsRef.current.some(tab => tab.id === currentActiveTabId && tab.file.path === file.path)) {
      requestFileTreeReveal(file.path)
    }
  }, [confirmLeaveDirtyActiveTab, handleFileSelect, requestFileTreeReveal])

  const handleBacklinkSelect = useCallback(async (item: BacklinkItem, sourceFilePath: string) => {
    const file: FileInfo = {
      name: item.sourceDisplayName,
      path: sourceFilePath,
      isDirectory: false,
    }
    await handleOpenDocumentCommand(createOpenDocumentCommand({
      source: 'backlink',
      filePath: sourceFilePath,
      canonicalPath: sourceFilePath,
      target: { kind: 'line', lineNumber: item.lineStart },
      preserveFilter: true,
      fallback: 'top',
    }), file)
  }, [handleOpenDocumentCommand])

  // 打开外部文件。搜索结果携带 opaque id 时先安全激活所属工作区，再由文件树定位。
  const handleExternalFileOpen = useCallback(async (
    filePath: string,
    options: ExternalDocumentOpenOptions = {},
  ) => {
    if (options.recentFileId) {
      await handleSelectRecentFile(options.recentFileId, options)
      return
    }

    if (options.historyId) {
      if (!confirmLeaveDirtyActiveTab(filePath)) return
      await archiveCurrentFolderTabs()
      try {
        const activation = await window.api.activateHistoryFolder(options.historyId)
        if (!isPathInsideFolder(filePath, activation.path)) {
          throw new Error('搜索结果不属于目标工作区')
        }
        upsertWorkspace({
          ...activation.workspace,
          name: activation.workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
        })
        setFolderPath(activation.path)
        keepPinnedTabsForFolderSwitch()
        setActiveTabId(null)
        await restoreFolderTabSession(activation.path)
        await handleFileSelect(
          { name: getFileNameFromPath(filePath), path: filePath, isDirectory: false },
          options.lineNumber,
          options.highlightKeyword,
        )
      } catch (error) {
        toast.error(`无法打开搜索结果：${error instanceof Error ? error.message : '未知错误'}`)
      }
      return
    }

    if (!confirmLeaveDirtyActiveTab(filePath)) return
    const fileName = getFileNameFromPath(filePath)
    const existingTab = tabsRef.current.find(tab => tab.file.path === filePath)
    if (existingTab) {
      setScrollToLine(options.lineNumber)
      setScrollToRatio(undefined)
      setHighlightKeyword(options.highlightKeyword)
      await refreshExistingTabContent(existingTab, async () =>
        buildPreviewContentForFile(filePath, await window.api.searchReadFile(filePath))
      )
      return
    }
    try {
      const content = buildPreviewContentForFile(filePath, await window.api.searchReadFile(filePath))
      setScrollToLine(options.lineNumber)
      setScrollToRatio(undefined)
      setHighlightKeyword(options.highlightKeyword)
      const newTab: Tab = {
        id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file: { name: fileName, path: filePath, isDirectory: false },
        content,
        isPinned: false
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newTab.id)
      const operation = getActiveWorkspaceOperationContext()
      if (operation) {
        void window.api.watchFile(filePath, operation.workspaceId, operation.lifecycleEpoch)
          .catch(err => console.error('Failed to watch external file:', err))
      }
      const fileFolder = filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')))
      window.api.addRecentFile({ path: filePath, name: fileName, folderPath: fileFolder }).catch(() => {})
    } catch (error) {
      toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [archiveCurrentFolderTabs, confirmLeaveDirtyActiveTab, handleFileSelect, handleSelectRecentFile, keepPinnedTabsForFolderSwitch, refreshExistingTabContent, restoreFolderTabSession, setHighlightKeyword, setScrollToLine, setScrollToRatio, toast, upsertWorkspace])

  const handleMarkdownLinkClick = useCallback(async (href: string, currentFilePath: string) => {
    try {
      const result = await window.api.resolveMdLink(currentFilePath, href)
      if (!result.success || !result.targetPath) {
        toast.error(`链接跳转失败：${result.error || '文件不存在'}`)
        return
      }

      const targetFile = {
        name: getFileNameFromPath(result.targetPath),
        path: result.targetPath,
        isDirectory: false
      }

      if (folderPath && isPathInsideFolder(result.targetPath, folderPath)) {
        await handleFileSelect(targetFile, result.targetLine)
      } else {
        await handleExternalFileOpen(result.targetPath, { lineNumber: result.targetLine })
      }
    } catch (error) {
      toast.error(`链接跳转失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [folderPath, handleExternalFileOpen, handleFileSelect, toast])

  // 切换标签
  const handleTabClick = useCallback((tabId: string) => {
    const nextTab = tabsRef.current.find(tab => tab.id === tabId)
    if (!confirmLeaveDirtyActiveTab(nextTab?.file.path)) return
    setActiveTabId(tabId)
  }, [confirmLeaveDirtyActiveTab, setActiveTabId])

  // 获取当前活动标签
  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeTabId), [tabs, activeTabId])
  useEffect(() => {
    if (activeTab?.file.path) requestFileTreeReveal(activeTab.file.path)
  }, [activeTab?.file.path, activeWorkspaceEpoch, activeWorkspaceId, folderPath, requestFileTreeReveal])
  const activeViewState = activeTab ? documentViews[`${SINGLE_LEAF_ID}:${activeTab.id}`] ?? getDocumentViewState(SINGLE_LEAF_ID, activeTab.id) : null
  const editSessionList = useMemo(() => Object.values(editSessions), [editSessions])
  const getQuickEditCanonicalPath = useCallback((tab: Tab): string | null => {
    const session = editSessionList.find(item =>
      item.displayPath === tab.file.path || item.canonicalPath === tab.file.path
    )
    return session?.canonicalPath || null
  }, [editSessionList])
  const getQuickEditTarget = useCallback((tab: Tab, leafId: string): QuickEditTarget | null => {
    const target = quickEditPlacements[leafId]
    if (!target || target.tabId !== tab.id) return null
    return target
  }, [quickEditPlacements])
  const activeQuickEditSession = activeTab ? findEditSessionForPath(editSessions, activeTab.file.path) : undefined
  const activeQuickEditTarget = quickEditPlacements.single || null
  const activeQuickEditCanonicalPath = activeQuickEditTarget?.canonicalPath || null
  const activeRawContent = activeTab ? (activeQuickEditSession?.draft ?? activeTab.content) : ''
  const isActiveContentLoading = activeTab != null && activeRawContent == null
  const activePreviewContent = activeRawContent ?? ''
  const isActiveDraftPreview = Boolean(activeQuickEditSession?.dirty)

  // 懒加载触发：当且仅当某 tab 是活动 tab 或出现在分屏叶子中时，才读入其内容
  useEffect(() => {
    const ids = new Set<string>()
    if (activeTabId) ids.add(activeTabId)
    if (splitState.root) {
      for (const leaf of getAllLeaves(splitState.root)) {
        if (leaf.tabId) ids.add(leaf.tabId)
      }
    }
    for (const id of ids) {
      const tab = tabs.find(item => item.id === id)
      if (!tab?.missing) void ensureTabContentLoaded(id)
    }
  }, [activeTabId, splitState, tabs])

  const updateTabsForEditSession = useCallback((session: EditSession, content: string) => {
    setTabs(prev => prev.map(tab =>
      tab.file.path === session.displayPath || tab.file.path === session.canonicalPath
        ? { ...tab, content }
        : tab
    ))
  }, [setTabs])

  const handleOpenMarkdownEdit = useCallback(async (tab: Tab, leafId = SINGLE_LEAF_ID, target?: Partial<QuickEditTarget>) => {
    if (!isMarkdownFile(tab.file.path)) {
      toast.error('当前文件不是 Markdown，不能编辑文档')
      return
    }
    try {
      const operation = getActiveWorkspaceOperationContext()
      if (!operation) throw new Error('工作区尚未就绪')
      const result = await window.api.openEditableMarkdown(tab.file.path, operation)
      openEditSession({ ...result, workspaceId: operation.workspaceId, lifecycleEpoch: operation.lifecycleEpoch })
      setDocumentViewMode(leafId, tab.id, 'compare')
      setDocumentViewTarget(leafId, tab.id, target
        ? {
            filePath: tab.file.path,
            tabId: tab.id,
            leafId,
            mode: 'document',
            ...target,
            canonicalPath: result.canonicalPath,
          }
        : null)
    } catch (error) {
      toast.error(`无法打开编辑器：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [openEditSession, setDocumentViewMode, setDocumentViewTarget, toast])

  const handleOpenQuickEdit = useCallback(async (tab: Tab, target?: Partial<QuickEditTarget>) => {
    await handleOpenMarkdownEdit(tab, target?.leafId || SINGLE_LEAF_ID, target)
  }, [handleOpenMarkdownEdit])

  const handleSaveQuickEdit = useCallback(async (
    canonicalPath: string,
    content: string,
    expectedRevisionToken: string,
    force: boolean,
    draftVersion?: number
  ) => {
    const editSession = useEditSessionStore.getState().sessions[canonicalPath]
    const result = await window.api.saveEditableMarkdown({
      canonicalPath,
      content,
      expectedRevisionToken,
      workspace: editSession?.workspaceId && Number.isInteger(editSession.lifecycleEpoch)
        ? { workspaceId: editSession.workspaceId, lifecycleEpoch: editSession.lifecycleEpoch as number }
        : (() => { throw new Error('编辑会话所属工作区已失效') })(),
      force
    })

    if (!result.success) {
      markEditSessionConflict(
        canonicalPath,
        normalizeConflictReason(result.conflict?.reason),
        result.conflict?.diskRevisionToken
      )
      return
    }

    const savedSession = useEditSessionStore.getState().sessions[canonicalPath]
    markEditSessionSaved(canonicalPath, content, result.revisionToken ?? expectedRevisionToken, draftVersion)
    if (savedSession) {
      clearFileCache(savedSession.displayPath)
      clearFileCache(savedSession.canonicalPath)
      updateTabsForEditSession(savedSession, content)
    }
  }, [markEditSessionConflict, markEditSessionSaved, updateTabsForEditSession])

  const handleSaveQuickEditBeforeExport = useCallback(async (canonicalPath: string) => {
    const session = useEditSessionStore.getState().sessions[canonicalPath]
    if (!session) return false

    const snapshot = useEditSessionStore.getState().createSaveSnapshot(canonicalPath)
    await handleSaveQuickEdit(canonicalPath, snapshot.content, snapshot.expectedRevisionToken, false, snapshot.draftVersion)
    const nextSession = useEditSessionStore.getState().sessions[canonicalPath]
    if (nextSession?.dirty || nextSession?.conflictReason) {
      toast.error('保存编辑草稿失败，已取消导出')
      return false
    }
    return true
  }, [handleSaveQuickEdit, toast])

  const { handleExportHTML, handleExportPDF, handleExportDOCX } = useExport({
    splitState,
    tabs,
    activeTabId,
    folderPath,
    toast,
    saveBeforeExport: handleSaveQuickEditBeforeExport,
  })

  const handleReloadQuickEdit = useCallback(async (canonicalPath: string) => {
    const session = useEditSessionStore.getState().sessions[canonicalPath]
    if (!session) return
    if (!window.confirm('重新载入磁盘版本会丢弃当前草稿，是否继续？')) return

    try {
      if (!session.workspaceId || !Number.isInteger(session.lifecycleEpoch)) {
        throw new Error('编辑会话所属工作区已失效')
      }
      const result = await window.api.openEditableMarkdown(session.displayPath, {
        workspaceId: session.workspaceId,
        lifecycleEpoch: session.lifecycleEpoch as number,
      })
      replaceEditSessionFromDisk(canonicalPath, result.content, result.revisionToken)
      updateTabsForEditSession(session, result.content)
      clearFileCache(session.displayPath)
      clearFileCache(session.canonicalPath)
    } catch (error) {
      toast.error(`重新载入失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [replaceEditSessionFromDisk, toast, updateTabsForEditSession])

  const handleCopyQuickEditDraft = useCallback((content: string) => {
    navigator.clipboard?.writeText(content)
      .then(() => toast.success('已复制草稿'))
      .catch(() => toast.error('复制草稿失败'))
  }, [toast])

  const handleCloseQuickEditPlacement = useCallback((placementKey: string) => {
    closeQuickEditPlacement(placementKey)
  }, [closeQuickEditPlacement])

  useEffect(() => {
    if (!window.api.onQuickEditFromPreview) return

    return window.api.onQuickEditFromPreview((target) => {
      const tab = target.tabId
        ? tabsRef.current.find(item => item.id === target.tabId)
        : tabsRef.current.find(item => item.file.path === target.filePath)
      if (!tab) {
        toast.error('无法打开快速编辑：未找到当前文件标签')
        return
      }
      handleOpenQuickEdit(tab, target)
    })
  }, [handleOpenQuickEdit, toast])

  // 切换文件时重置滚动位置
  useEffect(() => {
    if (previewRef.current && activeTabId) previewRef.current.scrollTop = 0
  }, [activeTabId])

  // 分屏模式下：activeTabId 变化时自动同步到活跃叶子面板
  useEffect(() => {
    if (!activeTabId) return
    setSplitState(prev => {
      if (!prev.root || !prev.activeLeafId) return prev
      const currentLeaf = findLeaf(prev.root, prev.activeLeafId)
      if (currentLeaf?.tabId === activeTabId) return prev
      // 如果该 tabId 已经在某个面板中显示，则切换活跃面板到那个面板
      const existingLeaf = findLeafByTabId(prev.root, activeTabId)
      if (existingLeaf) {
        if (existingLeaf.id === prev.activeLeafId) return prev
        return { ...prev, activeLeafId: existingLeaf.id }
      }
      // 否则更新活跃面板显示的内容
      return {
        ...prev,
        root: updateLeafTab(prev.root, prev.activeLeafId, activeTabId)
      }
    })
  }, [activeTabId])

  // 书签操作函数
  const handleBookmarkPanelWidthChange = useCallback((newWidth: number) => {
    setBookmarkPanelWidth(newWidth)
    window.api.updateAppSettings({ bookmarkPanelWidth: newWidth }).catch(err => {
      console.error('[App] Failed to save bookmark panel width:', err)
    })
  }, [setBookmarkPanelWidth])

  const handleBookmarkPanelToggle = useCallback(() => {
    useBookmarkStore.getState().togglePanel()
  }, [])

  const handleBookmarkBarToggle = useCallback(() => {
    useBookmarkStore.getState().toggleBar()
  }, [])

  const handleShowBookmarkBar = useCallback(() => {
    setBookmarkBarCollapsed(false)
    window.api.updateAppSettings({ bookmarkBarCollapsed: false }).catch(err => {
      console.error('[App] Failed to save bookmark bar collapsed state:', err)
    })
  }, [setBookmarkBarCollapsed])

  const handleShowMoreBookmarks = useCallback(() => {
    if (bookmarkPanelCollapsed) {
      setBookmarkPanelCollapsed(false)
      window.api.updateAppSettings({ bookmarkPanelCollapsed: false }).catch(err => {
        console.error('[App] Failed to save bookmark panel collapsed state:', err)
      })
    }
  }, [bookmarkPanelCollapsed])

  const handleSelectBookmark = useCallback(async (bookmark: Bookmark) => {
    try {
      await archiveCurrentFolderTabs()
      const activation = await window.api.activateBookmark(bookmark.id)
      upsertWorkspace({
        ...activation.workspace,
        name: activation.workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
      })
      setFolderPath(activation.path)
      keepPinnedTabsForFolderSwitch()
      setActiveTabId(null)

      const content = await readPreviewContentWithCache(activation.filePath)
      let targetId: string | null = null
      setTabs(prev => {
        const existing = prev.find(tab => tab.file.path === activation.filePath)
        if (existing) {
          targetId = existing.id
          return prev.map(tab => tab.id === existing.id ? { ...tab, content } : tab)
        }
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file: { name: activation.fileName, path: activation.filePath, isDirectory: false },
          content
        }
        targetId = newTab.id
        return [...prev, newTab]
      })
      if (targetId) setActiveTabId(targetId)
      setTimeout(() => navigateToBookmarkPosition(bookmark), 0)
    } catch (error) {
      toast.error(`无法打开书签：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [archiveCurrentFolderTabs, keepPinnedTabsForFolderSwitch, toast, upsertWorkspace])

  const navigateToBookmarkPosition = useCallback((bookmark: Bookmark) => {
    if (!previewRef.current) return
    if (bookmark.headingId) {
      const element = document.getElementById(bookmark.headingId)
      if (element) { element.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    }
    if (bookmark.headingText) {
      const headings = previewRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
      const bestMatch = findBestHeadingMatch(bookmark.headingText, Array.from(headings))
      if (bestMatch) { bestMatch.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    }
    if (bookmark.scrollPosition !== undefined && bookmark.scrollPosition > 0) {
      const container = previewRef.current
      container.scrollTo({ top: container.scrollHeight * bookmark.scrollPosition, behavior: 'smooth' })
      return
    }
    if (!bookmark.headingId && !bookmark.headingText) {
      previewRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    toast.warning('书签位置可能已失效')
  }, [toast])

  const findBestHeadingMatch = (targetText: string, headings: Element[]): Element | null => {
    if (headings.length === 0) return null
    const normalize = (text: string) => text.toLowerCase().trim().replace(/\s+/g, ' ')
    const normalizedTarget = normalize(targetText)
    let bestMatch: Element | null = null
    let bestScore = 0
    for (const heading of headings) {
      const headingText = normalize(heading.textContent || '')
      if (headingText === normalizedTarget) return heading
      if (headingText.includes(normalizedTarget) || normalizedTarget.includes(headingText)) {
        const score = Math.min(headingText.length, normalizedTarget.length) / Math.max(headingText.length, normalizedTarget.length)
        if (score > bestScore) { bestScore = score; bestMatch = heading }
      }
    }
    return bestScore > 0.6 ? bestMatch : null
  }

  // 文件监听 - 自动刷新功能
  useEffect(() => {
    const hasWorkspaceBootstrap = Object.hasOwn(window.api, 'getWorkspaceBootstrap')
    // 未提供 workspace bootstrap 的旧 renderer/test bridge 保持原有监听语义。
    if (
      (!workspaceBootstrapReady && hasWorkspaceBootstrap) ||
      !folderPath ||
      (activeWorkspaceRoot !== undefined && activeWorkspaceRoot !== folderPath)
    ) return

    const workspaceId = activeWorkspaceId
    const lifecycleEpoch = activeWorkspaceEpoch
    const hasWorkspaceContext = Boolean(workspaceId && Number.isInteger(lifecycleEpoch))

    if (hasWorkspaceContext) {
      window.api.watchFolder(folderPath, workspaceId ?? undefined, lifecycleEpoch).catch(error => {
        console.error('Failed to watch folder:', error)
      })
    } else {
      window.api.watchFolder(folderPath).catch(error => {
        console.error('Failed to watch folder:', error)
      })
    }

    const isCurrentSubscription = (): boolean => {
      if (!hasWorkspaceContext) return useFileStore.getState().folderPath === folderPath
      const currentWorkspaceState = useWorkspaceStore.getState()
      const currentWorkspace = currentWorkspaceState.workspaces.find(item => item.id === workspaceId)
      return currentWorkspaceState.activeWorkspaceId === workspaceId &&
        currentWorkspace?.lifecycleEpoch === lifecycleEpoch &&
        currentWorkspace?.primaryRoot === folderPath &&
        useFileStore.getState().folderPath === folderPath
    }

    // 严格工作区 payload 是新协议；字符串分支只保留给尚未升级的测试/旧 bridge。
    const acceptsEvent = (event: unknown): event is { workspaceId: string; lifecycleEpoch: number; path?: string; oldPath?: string; newPath?: string } => {
      if (typeof event === 'string') return !hasWorkspaceContext && isCurrentSubscription()
      if (!event || typeof event !== 'object') return false
      const data = event as { workspaceId?: unknown; lifecycleEpoch?: unknown }
      return data.workspaceId === workspaceId &&
        data.lifecycleEpoch === lifecycleEpoch &&
        isCurrentSubscription()
    }
    const eventPath = (event: unknown): string | null => {
      if (typeof event === 'string') return event
      if (event && typeof event === 'object' && typeof (event as { path?: unknown }).path === 'string') {
        return (event as { path: string }).path
      }
      return null
    }

    const unsubscribeChanged = window.api.onFileChanged(async (event) => {
      if (!acceptsEvent(event)) return
      const changedPath = eventPath(event)
      if (!changedPath) return
      clearFileCache(changedPath)
      for (const tab of tabsRef.current) {
        if (tab.file.path === changedPath) invalidateTabContentLoad(tab.id)
      }
      const editSession = findEditSessionForPath(useEditSessionStore.getState().sessions, changedPath)
      if (editSession && hasLocalEditActivity(editSession)) {
        useEditSessionStore.getState().markConflict(editSession.canonicalPath, 'external_changed')
        return
      }
      if (editSession) {
        try {
          if (!editSession.workspaceId || !Number.isInteger(editSession.lifecycleEpoch)) return
          const result = await window.api.openEditableMarkdown(editSession.displayPath, {
            workspaceId: editSession.workspaceId,
            lifecycleEpoch: editSession.lifecycleEpoch as number,
          })
          const currentSession = useEditSessionStore.getState().sessions[editSession.canonicalPath]
          if (!isCurrentSubscription() || !currentSession || hasLocalEditActivity(currentSession)) return
          replaceEditSessionFromDisk(editSession.canonicalPath, result.content, result.revisionToken)
          setTabs(prev => prev.map(tab =>
            tab.file.path === editSession.displayPath || tab.file.path === editSession.canonicalPath
              ? { ...tab, content: result.content }
              : tab
          ))
        } catch (error) {
          console.error('Failed to reload clean edit session:', error)
        }
        return
      }
      const currentTabs = tabsRef.current
      const affectedTab = currentTabs.find(tab => tab.file.path === changedPath)
      if (affectedTab && affectedTab.content !== null) {
        // 壳 tab（content===null）尚未 materialize，不 eager 回写；激活时会读到最新内容
        try {
          const newContent = await window.api.readFile(changedPath)
          if (!isCurrentSubscription()) return
          setTabs(prev => prev.map(tab => tab.id === affectedTab.id && tab.file.path === changedPath
            ? { ...tab, content: newContent, missing: false, renameCandidatePath: undefined }
            : tab))
        } catch (error) {
          console.error('Failed to reload file:', error)
        }
      }
    })

    const refreshFiles = async () => {
      try {
        const fileList = await window.api.readDir(folderPath)
        if (!isCurrentSubscription()) return
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    }

    const unsubscribeAdded = window.api.onFileAdded(async (event) => {
      if (!acceptsEvent(event)) return
      const addedPath = eventPath(event)
      if (!addedPath) return
      clearFileCache(addedPath)
      for (const tab of tabsRef.current) {
        if (tab.file.path === addedPath) invalidateTabContentLoad(tab.id)
      }
      const editSession = findEditSessionForPath(useEditSessionStore.getState().sessions, addedPath)
      const hasLocalActivity = hasLocalEditActivity(editSession)
      if (hasLocalActivity && editSession) useEditSessionStore.getState().markConflict(editSession.canonicalPath, 'external_changed')
      const affectedTab = tabsRef.current.find(tab => tab.file.path === addedPath)
      if (affectedTab?.missing && !hasLocalActivity) {
        try {
          const newContent = await window.api.readFile(addedPath)
          if (!isCurrentSubscription()) return
          setTabs(prev => prev.map(tab => tab.id === affectedTab.id && tab.file.path === addedPath
            ? { ...tab, content: newContent, missing: false, renameCandidatePath: undefined }
            : tab))
        } catch (error) {
          console.error('Failed to recover recreated file:', error)
        }
      } else if (editSession && !hasLocalActivity) {
        try {
          if (!editSession.workspaceId || !Number.isInteger(editSession.lifecycleEpoch)) return
          const result = await window.api.openEditableMarkdown(editSession.displayPath, {
            workspaceId: editSession.workspaceId,
            lifecycleEpoch: editSession.lifecycleEpoch as number,
          })
          const currentSession = useEditSessionStore.getState().sessions[editSession.canonicalPath]
          if (!isCurrentSubscription() || !currentSession || hasLocalEditActivity(currentSession)) return
          replaceEditSessionFromDisk(editSession.canonicalPath, result.content, result.revisionToken)
          setTabs(prev => prev.map(tab =>
            tab.file.path === editSession.displayPath || tab.file.path === editSession.canonicalPath
              ? { ...tab, content: result.content }
              : tab
          ))
        } catch (error) {
          console.error('Failed to reload clean edit session after add:', error)
        }
      } else if (affectedTab && affectedTab.content !== null && !hasLocalActivity) {
        try {
          const newContent = await window.api.readFile(addedPath)
          if (!isCurrentSubscription()) return
          setTabs(prev => prev.map(tab => tab.id === affectedTab.id && tab.file.path === addedPath
            ? { ...tab, content: newContent }
            : tab))
        } catch (error) {
          console.error('Failed to reload added file:', error)
        }
      }
      await refreshFiles()
    })

    const unsubscribeRemoved = window.api.onFileRemoved(async (event) => {
      if (!acceptsEvent(event)) return
      const removedPath = eventPath(event)
      if (!removedPath) return
      clearFileCache(removedPath)
      for (const tab of tabsRef.current) {
        if (tab.file.path === removedPath) invalidateTabContentLoad(tab.id)
      }
      const editSession = findEditSessionForPath(useEditSessionStore.getState().sessions, removedPath)
      if (editSession && hasLocalEditActivity(editSession)) {
        useEditSessionStore.getState().markConflict(editSession.canonicalPath, 'missing')
      } else {
        setTabs(prev => prev.map(tab => tab.file.path === removedPath
          ? { ...tab, missing: true, renameCandidatePath: undefined }
          : tab))
      }
      await refreshFiles()
    })

    const unsubscribeFolderAdded = window.api.onFolderAdded(async (event) => {
      if (acceptsEvent(event)) await refreshFiles()
    })

    const unsubscribeFolderRemoved = window.api.onFolderRemoved(async (event) => {
      if (!acceptsEvent(event)) return
      const dirPath = eventPath(event)
      if (!dirPath) return
      removeTabsFromSession(tab => !isPathInsideFolder(tab.file.path, dirPath))
      await refreshFiles()
    })

    const unsubscribeRenamed = window.api.onFileRenamed(async (event) => {
      if (!acceptsEvent(event) || typeof event === 'string') return
      const { oldPath, newPath } = event
      if (!oldPath || !newPath) return
      clearFileCache(oldPath)
      clearFileCache(newPath)
      for (const tab of tabsRef.current) {
        if (tab.file.path === oldPath || tab.file.path === newPath) invalidateTabContentLoad(tab.id)
      }
      const editSession = findEditSessionForPath(useEditSessionStore.getState().sessions, oldPath)
      const hasLocalActivity = hasLocalEditActivity(editSession)
      if (hasLocalActivity && editSession) {
        useEditSessionStore.getState().markConflict(editSession.canonicalPath, 'renamed')
      }
      const affectedTab = tabsRef.current.find(tab => tab.file.path === oldPath)
      if (affectedTab && !hasLocalActivity) {
        setTabs(prev => prev.map(tab => tab.id === affectedTab.id && tab.file.path === oldPath
          ? { ...tab, missing: true, renameCandidatePath: newPath }
          : tab))
      }
      await refreshFiles()
    })

    return () => {
      if (hasWorkspaceContext) {
        window.api.unwatchFolder(workspaceId ?? undefined, lifecycleEpoch)
          .catch(error => { console.error('Failed to unwatch folder:', error) })
      } else {
        window.api.unwatchFolder().catch(error => { console.error('Failed to unwatch folder:', error) })
      }
      unsubscribeChanged()
      unsubscribeAdded()
      unsubscribeRemoved()
      unsubscribeFolderAdded()
      unsubscribeFolderRemoved()
      unsubscribeRenamed()
    }
  }, [activeWorkspaceEpoch, activeWorkspaceId, activeWorkspaceRoot, folderPath, removeTabsFromSession, setFiles, setTabs, workspaceBootstrapReady])


  // 标签切换
  const handleNextTab = useCallback(() => {
    const currentTabs = tabsRef.current
    if (currentTabs.length === 0) return
    const currentIndex = currentTabs.findIndex(tab => tab.id === activeTabId)
    const nextIndex = (currentIndex + 1) % currentTabs.length
    setActiveTabId(currentTabs[nextIndex].id)
  }, [activeTabId])

  const handlePrevTab = useCallback(() => {
    const currentTabs = tabsRef.current
    if (currentTabs.length === 0) return
    const currentIndex = currentTabs.findIndex(tab => tab.id === activeTabId)
    const prevIndex = (currentIndex - 1 + currentTabs.length) % currentTabs.length
    setActiveTabId(currentTabs[prevIndex].id)
  }, [activeTabId])

  const handleSwitchTab = useCallback((tabIndex: number) => {
    const currentTabs = tabsRef.current
    if (tabIndex < 0 || tabIndex >= currentTabs.length) return
    setActiveTabId(currentTabs[tabIndex].id)
  }, [])

  const handleFocusSearch = useCallback(() => {
    searchBarRef.current?.focus()
  }, [])

  // v1.5.1：页内搜索快捷键
  useEffect(() => {
    if (!window.api.onOpenInPageSearch) return
    const unsubscribe = window.api.onOpenInPageSearch(() => {
      window.dispatchEvent(new CustomEvent('open-in-page-search'))
    })
    return unsubscribe
  }, [activeTabId, folderPath])

  // v1.5.1：分屏操作处理函数
  const handleSplitPanel = useCallback((leafId: string, direction: 'horizontal' | 'vertical', tabId: string) => {
    setSplitState(prev => {
      if (!prev.root) return prev
      if (getTreeDepth(prev.root) >= MAX_SPLIT_DEPTH) return prev
      const { root: newRoot, newLeafId } = splitLeaf(prev.root, leafId, direction, tabId)
      return { root: newRoot, activeLeafId: newLeafId }
    })
  }, [])

  const handleClosePanel = useCallback((leafId: string) => {
    const leaf = splitStateRef.current.root ? findLeaf(splitStateRef.current.root, leafId) : null
    const tab = leaf?.tabId ? tabsRef.current.find(item => item.id === leaf.tabId) : null
    if (tab && !confirmCloseDirtyTab(tab)) return

    setSplitState(prev => {
      if (!prev.root) return prev
      const newRoot = closeLeaf(prev.root, leafId)
      if (!newRoot) return { root: null, activeLeafId: '' }
      if (prev.activeLeafId === leafId) {
        const leaves = getAllLeaves(newRoot)
        return { root: newRoot, activeLeafId: leaves[0]?.id || '' }
      }
      return { ...prev, root: newRoot }
    })
  }, [confirmCloseDirtyTab])

  const handleResizePanel = useCallback((splitId: string, ratio: number) => {
    setSplitState(prev => {
      if (!prev.root) return prev
      return { ...prev, root: updateRatio(prev.root, splitId, ratio) }
    })
  }, [])

  const handleSetActiveLeaf = useCallback((leafId: string) => {
    setSplitState(prev => {
      const leaf = prev.root ? findLeaf(prev.root, leafId) : null
      if (!leaf) return prev
      setActiveTabId(leaf.tabId)
      return { ...prev, activeLeafId: leafId }
    })
  }, [setActiveTabId])

  const handleDropTab = useCallback((leafId: string, tabId: string, position: 'center' | 'left' | 'right' | 'top' | 'bottom') => {
    setSplitState(prev => {
      if (!prev.root) return prev
      if (position === 'center') {
        return { ...prev, root: updateLeafTab(prev.root, leafId, tabId) }
      }
      if (getTreeDepth(prev.root) >= MAX_SPLIT_DEPTH) return prev
      const directionMap: Record<string, 'horizontal' | 'vertical'> = {
        left: 'horizontal', right: 'horizontal', top: 'vertical', bottom: 'vertical'
      }
      const direction = directionMap[position]
      const { root: newRoot, newLeafId } = splitLeaf(prev.root, leafId, direction, tabId)
      if (position === 'left' || position === 'top') {
        const swapFirstSecond = (node: PanelNode): PanelNode => {
          if (node.type === 'leaf') return node
          const newLeafInSecond = findLeaf(node.second, newLeafId)
          if (newLeafInSecond && node.second.type === 'leaf' && node.second.id === newLeafId) {
            return { ...node, first: node.second, second: node.first }
          }
          return { ...node, first: swapFirstSecond(node.first), second: swapFirstSecond(node.second) }
        }
        return { root: swapFirstSecond(newRoot), activeLeafId: newLeafId }
      }
      return { root: newRoot, activeLeafId: newLeafId }
    })
  }, [])

  const handleSwapPanels = useCallback((leafIdA: string, leafIdB: string) => {
    setSplitState(prev => {
      if (!prev.root) return prev
      return { ...prev, root: swapLeaves(prev.root, leafIdA, leafIdB) }
    })
  }, [])

  // 侧边栏拖拽调整宽度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (sidebarCollapsed) return
    e.preventDefault()
    setIsResizing(true)
  }, [sidebarCollapsed, setIsResizing])

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 180), 500)
      setSidebarWidth(newWidth)
    }
    const handleMouseUp = () => {
      setIsResizing(false)
      void persistSidebarWidth()
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setIsResizing, setSidebarWidth, persistSidebarWidth])

  // v1.6.0: IPC 事件监听（集中管理）
  useIPC({
    toast,
    handleOpenFolder,
    handleRefreshFiles,
    handleTabClose,
    handleExportHTML,
    handleExportPDF,
    handleExportDOCX,
    handleFocusSearch,
    handleNextTab,
    handlePrevTab,
    handleSwitchTab,
    handleFileSelect,
    loadBookmarks,
    previewRef,
    onMoveToRequest: setMoveToSources
  })

  return (
    <ErrorBoundary>
      <div className={`app ${isFullscreen ? 'fullscreen' : ''}`}>
      <ToastContainer messages={toast.messages} onClose={toast.close} />
      <ExportTaskView
        onShowInFolder={async (p) => { try { await window.api.showItemInFolder(p) } catch {} }}
        onOpenSettings={() => openSettings()}
      />
      <PreflightPanel />
      {pendingTransferNonce && <>
        <div className="workspace-transfer-guard" aria-hidden="true" />
        <div className="workspace-transfer-status">正在转移工作区，请稍候…</div>
      </>}

      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <div className="drag-overlay-icon">📂</div>
            <div className="drag-overlay-text">释放以打开文件</div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          onClose={closeSettings}
          initialTab={settingsInitialTab}
          initialChartsView={settingsChartsView}
          insertionSession={settingsInsertionSession}
          onOpenChartExamples={async () => {
            if (typeof window.api.installChartExamples !== 'function') {
              return {
                canceled: false,
                error: {
                  code: 'RESTART_REQUIRED',
                  message: '应用后台功能尚未更新，请完全退出并重新启动 MD Viewer 后再试。',
                },
              }
            }
            if (!confirmLeaveDirtyActiveTab()) return { canceled: true }
            await archiveCurrentFolderTabs()
            const result = await window.api.installChartExamples()
            if (result.canceled || 'error' in result) return result

            await applyFolderActivation(result.activation)
            await handleFileSelect({
              name: 'README.md',
              path: result.entryFilePath,
              treePath: 'README.md',
              isDirectory: false,
            })
            closeSettings()
            return result
          }}
        />
      )}
      <ShortcutsHelpDialog
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />

      <MoveToDialog
        isOpen={moveToSources !== null}
        sources={moveToSources ?? []}
        onClose={() => setMoveToSources(null)}
        onMoveSuccess={(msg) => toast.success(msg)}
        onMoveError={(msg) => toast.error(msg)}
      />
      {renameRepairRequest && (
        <RenameRepairDialog
          {...renameRepairRequest}
          onMoved={async (newPath) => {
            setTabs(prev => prev.map(tab =>
              tab.file.path === renameRepairRequest.oldPath
                ? { ...tab, file: { ...tab.file, name: renameRepairRequest.newName, path: newPath } }
                : tab
            ))
            await handleRefreshFiles()
          }}
          onClose={() => setRenameRepairRequest(null)}
        />
      )}

      <main className="main-content">
        {!folderPath ? (
          <div className="welcome">
            <Header>
              <NavigationBar
                folderPath={null}
                files={[]}
                theme={theme}
                searchBarRef={searchBarRef}
                isAlwaysOnTop={isAlwaysOnTop}
                onToggleAlwaysOnTop={toggleAlwaysOnTop}
                onOpenFolder={handleOpenFolder}
                onSelectHistoryFolder={handleSelectHistoryFolder}
                onSelectRecentFile={handleSelectRecentFile}
                onFileSelect={handleFileSelect}
                onExternalFileOpen={handleExternalFileOpen}
                onOpenDocumentCommand={handleOpenDocumentCommand}
                onSettingsClick={() => openSettings()}
                onThemeChange={setTheme}
                onRefreshFiles={handleRefreshFiles}
                isLoading={isLoading}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={toggleSidebar}
                bookmarkPanelCollapsed={bookmarkPanelCollapsed}
                onToggleBookmarkPanel={handleBookmarkPanelToggle}
                lastExportedFilePath={lastExportedFilePath}
                lastExportedTime={lastExportedTime}
                onOpenLastExport={handleOpenLastExport}
              />
            </Header>
            <div className="welcome-content">
              <div className="welcome-icon">📁</div>
              <h2>欢迎使用 MD Viewer</h2>
              <p>一个简洁的 Markdown 预览工具</p>
              <div className="welcome-actions">
                <button className="open-folder-btn" onClick={handleOpenFolder}>
                  打开文件夹
                </button>
                <FolderHistoryDropdown
                  onSelectFolder={handleSelectHistoryFolder}
                  onOpenFolder={handleOpenFolder}
                />
                <RecentFilesDropdown onSelectFile={handleSelectRecentFile} />
              </div>
              <button
                type="button"
                className="welcome-charts-card"
                onClick={() => openSettings({ tab: 'charts', chartsView: 'examples' })}
              >
                <span className="welcome-charts-card-icon">📊</span>
                <span>
                  <strong>图表与架构图</strong>
                  <small>查看支持能力，获取内置离线示例包</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="workspace-container">
            <Header>
              <NavigationBar
                folderPath={folderPath}
                files={files}
                theme={theme}
                searchBarRef={searchBarRef}
                isAlwaysOnTop={isAlwaysOnTop}
                onToggleAlwaysOnTop={toggleAlwaysOnTop}
                onOpenFolder={handleOpenFolder}
                onSelectHistoryFolder={handleSelectHistoryFolder}
                onSelectRecentFile={handleSelectRecentFile}
                onFileSelect={handleFileSelect}
                onExternalFileOpen={handleExternalFileOpen}
                onOpenDocumentCommand={handleOpenDocumentCommand}
                onSettingsClick={() => openSettings()}
                onThemeChange={setTheme}
                onRefreshFiles={handleRefreshFiles}
                isLoading={isLoading}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={toggleSidebar}
                bookmarkPanelCollapsed={bookmarkPanelCollapsed}
                onToggleBookmarkPanel={handleBookmarkPanelToggle}
                lastExportedFilePath={lastExportedFilePath}
                lastExportedTime={lastExportedTime}
                onOpenLastExport={handleOpenLastExport}
              />
              {(tabs.length > 0 || visibleWorkspaceCount >= 2 || hasWorkspaceMergeSources || (bookmarkBarCollapsed && bookmarks.length > 0)) && (
                <TabBar
                  tabs={tabs}
                  activeTabId={activeTabId}
                  onTabClick={handleTabClick}
                  onTabClose={handleTabClose}
                  basePath={folderPath || undefined}
                  bookmarkBarCollapsed={bookmarkBarCollapsed}
                  bookmarkCount={bookmarks.length}
                  onShowBookmarkBar={handleShowBookmarkBar}
                  leading={<div className="workspace-controls">
                    {visibleWorkspaceCount >= 2 ? <>
                      <WorkspaceSwitcher
                        workspaces={workspaces}
                        activeWorkspaceId={activeWorkspaceId}
                        summaries={workspaceSummaries}
                        onSelect={(workspaceId) => { void switchWorkspace(workspaceId) }}
                        onCloseActive={() => { void closeActiveWorkspace() }}
                        onSplitActive={() => { void requestWorkspaceSplit() }}
                        onMergeOtherWindows={(anchor) => {
                          setWorkspaceImportAnchor(anchor)
                          setIsWorkspaceImportOpen(true)
                        }}
                        canMergeOtherWindows={hasWorkspaceMergeSources}
                      />
                      <WorkspaceImportControl
                        open={isWorkspaceImportOpen}
                        onOpenChange={setIsWorkspaceImportOpen}
                        anchorElement={workspaceImportAnchor}
                        hideTrigger
                        onBegin={requestWorkspaceMerge}
                        isTransferring={pendingTransferNonce !== null}
                      />
                    </> : workspaceBootstrapReady && <WorkspaceImportControl
                      onBegin={requestWorkspaceMerge}
                      isTransferring={pendingTransferNonce !== null}
                      sourcesAvailable={hasWorkspaceMergeSources}
                    />}
                  </div>}
                />
              )}
              {bookmarks.length > 0 && (
                <BookmarkBar
                  bookmarks={bookmarks}
                  isLoading={bookmarksLoading}
                  isCollapsed={bookmarkBarCollapsed}
                  onToggleCollapse={handleBookmarkBarToggle}
                  onSelectBookmark={handleSelectBookmark}
                  onShowMoreClick={handleShowMoreBookmarks}
                  currentFilePath={activeTab?.file.path}
                />
              )}
            </Header>

            <div className={`workspace ${isResizing ? 'resizing' : ''}`}>
              {sidebarCollapsed ? null : (
                <aside className="sidebar" style={{ width: sidebarWidth }}>
                  <div id="file-tree-panel" className="file-tree-container">
                  {isLoading ? (
                    <p className="placeholder">加载中...</p>
                  ) : (
                    <FileTree
                      files={files}
                      onFileSelect={handleFileSelect}
                      selectedPath={activeTab?.file.path}
                      revealRequest={fileTreeRevealRequest}
                      basePath={folderPath}
                      onFileRenamed={handleFileRenamed}
                      selectedPaths={selectedPaths}
                      onSelectionChange={setSelectedPaths}
                      onMoveSuccess={(msg) => toast.success(msg)}
                      onMoveError={(msg) => toast.error(msg)}
                    />
                  )}
                  </div>
                </aside>
              )}

              {!sidebarCollapsed && <div className="resize-handle" onMouseDown={handleResizeStart} />}

              <section className="content-area">
                {splitState.root ? (
                  <SplitPanel
                    node={splitState.root}
                    tabs={tabs}
                    activeLeafId={splitState.activeLeafId}
                    onSplitPanel={handleSplitPanel}
                    onClosePanel={handleClosePanel}
                    onResizePanel={handleResizePanel}
                    onSetActiveLeaf={handleSetActiveLeaf}
                    onImageClick={setLightbox}
                    onDropTab={handleDropTab}
                    onSwapPanels={handleSwapPanels}
                    getDocumentViewMode={(leafId, tabId) => getDocumentViewState(leafId, tabId).mode}
                    getDocumentCompareRatio={(leafId, tabId) => getDocumentViewState(leafId, tabId).compareRatio}
                    getDocumentViewTarget={(leafId, tabId) => getDocumentViewState(leafId, tabId).target}
                    onDocumentViewModeChange={setDocumentViewMode}
                    onDocumentCompareRatioChange={setDocumentCompareRatio}
                    onDocumentLocateComplete={(leafId, tabId, located) => {
                      if (located) toast.success('已定位到源码附近')
                      else toast.info('未能精确定位，已打开编辑器')
                      setDocumentViewTarget(leafId, tabId, null)
                    }}
                    getQuickEditCanonicalPath={getQuickEditCanonicalPath}
                    getQuickEditTarget={getQuickEditTarget}
                    onSaveQuickEdit={handleSaveQuickEdit}
                    onCloseQuickEdit={handleCloseQuickEditPlacement}
                    onReloadQuickEdit={handleReloadQuickEdit}
                    onCopyDraft={handleCopyQuickEditDraft}
                    onOpenChartSettings={handleOpenChartSettings}
                    scrollToLine={scrollToLine}
                    onScrollToLineComplete={() => setScrollToLine(undefined)}
                    scrollToRatio={scrollToRatio}
                    onScrollToRatioComplete={() => setScrollToRatio(undefined)}
                    getRestoredLeafViewState={getRestoredSplitLeafViewState}
                    onRestoredLeafViewStateComplete={clearRestoredSplitLeafViewState}
                    onReadPositionChange={handleSplitReadPositionChange}
                    onMarkdownLinkClick={handleMarkdownLinkClick}
                    onBacklinkSelect={handleBacklinkSelect}
                    onRecoverMissingTab={(tabId, candidatePath) => void recoverMissingTab(tabId, candidatePath)}
                    onCloseTab={handleTabClose}
                  />
                ) : (
                  <div className={`preview-container ${activeQuickEditCanonicalPath && activeViewState?.mode === 'preview' ? 'with-quick-edit' : ''}`}>
                    {activeTab && !activeTab.missing && activeViewState && activeViewState.mode !== 'preview' && activeQuickEditSession ? (
                      <MarkdownEditWorkbench
                        tab={activeTab}
                        leafId={SINGLE_LEAF_ID}
                        canonicalPath={activeQuickEditSession.canonicalPath}
                        mode={activeViewState.mode}
                        compareRatio={activeViewState.compareRatio}
                        target={activeViewState.target}
                        onModeChange={(mode: DocumentViewMode) => setDocumentViewMode(SINGLE_LEAF_ID, activeTab.id, mode)}
                        onCompareRatioChange={(ratio) => setDocumentCompareRatio(SINGLE_LEAF_ID, activeTab.id, ratio)}
                        onSave={handleSaveQuickEdit}
                        onCopyDraft={handleCopyQuickEditDraft}
                        onReloadFromDisk={handleReloadQuickEdit}
                        onOpenChartSettings={handleOpenChartSettings}
                        onLocateComplete={(located) => {
                          if (located) toast.success('已定位到源码附近')
                          else toast.info('未能精确定位，已打开编辑器')
                          setDocumentViewTarget(SINGLE_LEAF_ID, activeTab.id, null)
                        }}
                      />
                    ) : (
                      <>
                        <div className="preview-body">
                          <div className="preview-pane">
                            {isActiveDraftPreview && (
                              <div className="quick-edit-preview-banner" role="status">草稿预览，未保存</div>
                            )}
                            <div className="preview" ref={setPreviewNode}>
                              {activeTab ? (
                                activeTab.missing ? (
                                  <MissingFilePlaceholder
                                    candidatePath={activeTab.renameCandidatePath}
                                    onRetry={() => void recoverMissingTab(activeTab.id)}
                                    onUseCandidate={activeTab.renameCandidatePath
                                      ? () => void recoverMissingTab(activeTab.id, activeTab.renameCandidatePath)
                                      : undefined}
                                    onClose={() => handleTabClose(activeTab.id)}
                                  />
                                ) : isActiveContentLoading ? (
                                  <LoadingPlaceholder />
                                ) : (
                                <VirtualizedMarkdown
                                  key={activeTab.file.path}
                                  content={activePreviewContent}
                                  filePath={activeTab.file.path}
                                  tabId={activeTab.id}
                                  renderDebounceMs={getDraftPreviewDebounceMs(activePreviewContent, Boolean(activeQuickEditSession))}
                                  scrollToLine={scrollToLine}
                                  onScrollToLineComplete={() => setScrollToLine(undefined)}
                                  scrollToRatio={scrollToRatio}
                                  onScrollToRatioComplete={() => setScrollToRatio(undefined)}
                                  highlightKeyword={highlightKeyword}
                                  onHighlightKeywordComplete={() => setHighlightKeyword(undefined)}
                                  onImageClick={setLightbox}
                                  onReadPositionChange={(position) => handleReadPositionChange(activeTab.file.path, position)}
                                  onMarkdownLinkClick={handleMarkdownLinkClick}
                                />
                                )
                              ) : (
                                <p className="placeholder">选择一个 Markdown 文件开始预览</p>
                              )}
                            </div>
                            {activeTab && isMarkdownFile(activeTab.file.path) && (
                              <FloatingNav
                                containerRef={previewRef}
                                markdown={activePreviewContent}
                                filePath={activeTab.file.path}
                                onBacklinkSelect={handleBacklinkSelect}
                              />
                            )}
                            {activeTab && isMarkdownFile(activeTab.file.path) && (
                              <ReadAloudBar
                                containerRef={previewRef}
                                filePath={activeTab.file.path}
                                contentKey={activePreviewContent}
                              />
                            )}
                          </div>
                          {activeQuickEditCanonicalPath && activeViewState?.mode === 'preview' && (
                            <QuickEditDrawer
                              canonicalPath={activeQuickEditCanonicalPath}
                              placementKey="single"
                              previewElement={previewElement}
                              target={activeQuickEditTarget}
                              onSave={handleSaveQuickEdit}
                              onClose={() => closeQuickEditPlacement('single')}
                              onReloadFromDisk={handleReloadQuickEdit}
                              onCopyDraft={handleCopyQuickEditDraft}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>

              {!bookmarkPanelCollapsed && (
                <BookmarkPanel
                  bookmarks={bookmarks}
                  isLoading={bookmarksLoading}
                  isCollapsed={false}
                  width={bookmarkPanelWidth}
                  onToggleCollapse={handleBookmarkPanelToggle}
                  onWidthChange={handleBookmarkPanelWidthChange}
                  onSelectBookmark={handleSelectBookmark}
                  onBookmarksChange={loadBookmarks}
                  currentFilePath={activeTab?.file.path}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {lightbox && (
        <ImageLightbox
          state={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => {
            const current = useLayoutStore.getState().lightbox
            if (current) {
              setLightbox({
                ...current,
                src: current.images[index] || current.src,
                currentIndex: index
              })
            }
          }}
        />
      )}
      </div>
    </ErrorBoundary>
  )
}

export default App
