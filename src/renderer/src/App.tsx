import React, { useEffect, useLayoutEffect, useCallback, useMemo, useRef, useState } from 'react'
import { FileTree, FileInfo, VirtualizedMarkdown, TabBar, Tab, SearchBar, SearchBarHandle, ErrorBoundary, ToastContainer, ThemeToggle, FolderHistoryDropdown, RecentFilesDropdown, SettingsPanel, FloatingNav, ReadAloudBar, BookmarkPanel, Bookmark, BookmarkBar, Header, NavigationBar, ShortcutsHelpDialog, ImageLightbox, LightboxState, SplitPanel, ExportTaskView, QuickEditDrawer, MarkdownEditWorkbench, PreflightPanel, MoveToDialog, RenameRepairDialog, WorkspaceSwitcher, WorkspaceImportControl, LoadingPlaceholder, MissingFilePlaceholder } from './components'
import { reconcileLoadedDocuments } from './utils/reconcileLoadedDocuments'
import { readTabPreviewContent, registerLinkedDocumentReader } from './utils/tabDocumentReader'
import { linkedReadErrorMessages, type PreparedLinkedDocument, type LinkedReadRequest } from '../../shared/linkRead'
import type { FolderActivation } from '../../shared/workspace'
import { normalizeTabSessionReferences } from '../../shared/tabSessionReferences'
import type { WatchReconcileResult } from '../../shared/workspaceWatch'
import type { DiagnosticSource, PaneDiagnosticCause } from '../../shared/diagnostics'
import { recordPaneHydration } from './utils/paneDiagnostics'
import type { ChartsSettingsView, EditorInsertionSession, OpenChartSettingsRequest } from './components/settings/chartSettingsTypes'
import { SplitState, PanelNode, createLeaf, splitLeaf, closeLeaf, updateRatio, updateLeafTab, findLeaf, getAllLeaves, findLeafByTabId, getTreeDepth, MAX_SPLIT_DEPTH, swapLeaves, reconcileSplitState } from './utils/splitTree'
import { readFileWithCache, readPreviewContentWithCache, clearFileCache } from './utils/fileCache'
import {
  recordClockAnchor,
  recordFileTerminal,
  recordFolderTreeReady,
  startFileDiagnostic,
  type RendererFileDiagnosticOperation,
} from './utils/diagnostics'
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
import type { ExternalDocumentOpenOptions, OpenDocumentCommand, OpenDocumentResult } from './utils/v24WorkflowContracts'
import { createOpenDocumentCommand } from './utils/v24WorkflowContracts'
import { inspectMarkdownBlock } from '../../shared/markdown/blocks'
import { appendLinkVisit, bindLinkVisits, createRootNavigation, reconcileLinkPanels, type LinkLeafNavigation, type LinkPanelLayout, type LinkVisit, type PreviewLinkContext, type LinkOrigin } from './utils/linkNavigation'
import { LocalAttachmentDialog, type LocalAttachmentDialogHandle } from './components/LocalAttachmentDialog'
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
import {
  collectLocalResourceDependencies,
  isRefreshableLocalResourcePath,
  localResourceDependenciesContainPath,
  type LocalResourceDependency,
} from '../../shared/markdown/resourceDependencies'

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

function persistentTabSession(runtime: { tabs: Tab[]; activeTabId: string | null; splitState: SplitState }, root: string | null) {
  const tabs = runtime.tabs.filter(tab => !tab.linkedReadOnly && root && isPathInsideFolder(tab.file.path, root))
  return { tabs, ...normalizeTabSessionReferences(tabs, runtime.activeTabId, runtime.splitState), skipped: runtime.tabs.length - tabs.length }
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
  const toast = useToast()
  const { workspaces, activeWorkspaceId, setWorkspaces, upsertWorkspace, replaceWorkspace, removeWorkspace, removeWorkspaces, setActiveWorkspaceId, saveRuntime, getRuntime } = workspaceStore
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [activeWorkspaceId, workspaces]
  )
  const activeWorkspaceEpoch = activeWorkspace?.lifecycleEpoch
  const activeWorkspaceRoot = activeWorkspace?.primaryRoot
  const watchRefreshRef = useRef<(() => Promise<void>) | null>(null)
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
  const linkedReadGenerationRef = useRef(0)
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

  useEffect(() => {
    recordClockAnchor()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') recordClockAnchor()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  const handleOpenChartSettings = useCallback((request: OpenChartSettingsRequest) => {
    openSettings({
      tab: 'charts',
      chartsView: request.initialView,
      insertionSession: request.insertionSession,
    })
  }, [openSettings])
  const fileTreeRevealSequenceRef = useRef(0)
  const [folderDiagnosticSequence, setFolderDiagnosticSequence] = useState(0)
  const pendingFolderDiagnosticRef = useRef<{
    operationId: string
    folderPath: string
    source: NonNullable<FolderActivation['diagnosticSource']>
    startedMonotonicMs: number
  } | null>(null)
  const beginFolderDiagnostic = useCallback((activation: FolderActivation) => {
    const previousDiagnostic = pendingFolderDiagnosticRef.current
    if (previousDiagnostic && previousDiagnostic.operationId !== activation.diagnosticOperationId) {
      recordFolderTreeReady({
        operationId: previousDiagnostic.operationId,
        startedMonotonicMs: previousDiagnostic.startedMonotonicMs,
        source: previousDiagnostic.source,
        resultApplied: false,
        rootNodeCount: 0,
        outcome: 'superseded',
      })
    }
    pendingFolderDiagnosticRef.current = activation.diagnosticOperationId
      ? {
          operationId: activation.diagnosticOperationId,
          folderPath: activation.path,
          source: activation.diagnosticSource ?? 'unknown',
          startedMonotonicMs: performance.now(),
        }
      : null
    if (activation.diagnosticOperationId) setFolderDiagnosticSequence(sequence => sequence + 1)
  }, [])
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
    linkedReadGenerationRef.current++
    recordPaneHydration(workspaceId)
    const runtime = getRuntime(workspaceId)
    const workspace = workspaces.find((item) => item.id === workspaceId)
    setFolderPath(runtime.folderPath ?? fallbackRoot ?? workspace?.primaryRoot ?? null)
    setFiles(runtime.files)
    setSelectedPaths(new Set(runtime.selectedPaths))
    for (const tab of runtime.tabs) if (tab.linkedReadOnly) invalidateTabContentLoad(tab.id)
    setTabs(runtime.tabs.map(tab => tab.linkedReadOnly ? { ...tab, content: null, missing: false } : tab))
    setActiveTabId(runtime.activeTabId, { source: 'workspace-hydrate' })
    setSplitState(runtime.splitState, { source: 'workspace-hydrate' })
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
        return { descriptor, runtime: persistentTabSession(runtime, descriptor.primaryRoot), dirtyCount }
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
      const skipped = planned.reduce((total, item) => total + (item?.runtime.skipped ?? 0), 0)
      if (skipped) toast.info(`窗口合并将跳过 ${skipped} 个根外临时标签；请在目标窗口从来源链接重新打开。`)
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
  }, [activeWorkspaceId, captureWorkspaceRuntime, getRuntime, setPendingWorkspaceTransfer, toast, workspaces])

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
      const session = persistentTabSession(runtime, descriptor.primaryRoot)
      if (session.skipped) toast.info(`工作区转移将跳过 ${session.skipped} 个根外临时标签；请在目标窗口从来源链接重新打开。`)
      setPendingWorkspaceTransfer(nonce)
      void window.api.submitWorkspaceTransferSnapshot(nonce, {
        workspaceId,
        name: descriptor.name || '未命名工作区',
        primaryRoot: descriptor.primaryRoot,
        lifecycleEpoch: descriptor.lifecycleEpoch,
        tabs: session.tabs.map((tab) => ({ id: tab.id, filePath: tab.file.path, isPinned: tab.isPinned })),
        activeTabId: session.activeTabId,
        splitState: session.splitState,
      }).catch((error) => {
        setPendingWorkspaceTransfer(null)
        console.error('[Workspace] Failed to export workspace:', error)
        void window.api.cancelWorkspaceTransfer(nonce)
      })
    })
  }, [activeWorkspaceId, captureWorkspaceRuntime, getRuntime, setPendingWorkspaceTransfer, toast, workspaces])

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
  const resourceDependencyCacheRef = useRef(new Map<string, {
    content: string
    dependencies: LocalResourceDependency[]
  }>())
  useEffect(() => {
    const currentTabIds = new Set(tabs.map(tab => tab.id))
    for (const tabId of resourceDependencyCacheRef.current.keys()) {
      if (!currentTabIds.has(tabId)) resourceDependencyCacheRef.current.delete(tabId)
    }
  }, [tabs])
  const splitStateRef = useRef<SplitState>(splitState)
  splitStateRef.current = splitState
  const splitLeafPositionsRef = useRef<FolderSplitLeafPositions>({})
  const pendingSplitLeafViewStatesRef = useRef<FolderSplitLeafPositions>({})
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

  const [attachmentRequest, setAttachmentRequest] = useState<{
    id: string
    source: string
    readRequest: LinkedReadRequest
    isCurrent: () => boolean
    context: PreviewLinkContext
    lifecycle: NonNullable<ReturnType<typeof getActiveWorkspaceLifecycleKey>>
  } | null>(null)
  const attachmentRequestRef = useRef(attachmentRequest)
  const attachmentDialogRef = useRef<LocalAttachmentDialogHandle>(null)
  const displayedTabForLeaf = useCallback((leafId: string) => {
    const state = useTabStore.getState()
    const tabId = leafId === SINGLE_LEAF_ID && !state.splitState.root ? state.activeTabId
      : state.splitState.root ? findLeaf(state.splitState.root, leafId)?.tabId : undefined
    return state.tabs.find(tab => tab.id === tabId)
  }, [])
  const closeAttachment = useCallback(() => {
    const request = attachmentRequestRef.current
    if (!request) return
    const focusWasInDialog = document.activeElement === document.body ||
      Boolean(document.activeElement?.closest('.local-attachment-dialog'))
    attachmentRequestRef.current = null
    void window.api.cancelLinkedRead(request.readRequest.operation, request.readRequest.leafId, request.id).catch(() => {})
    setAttachmentRequest(null)
    queueMicrotask(() => {
      if (!attachmentRequestRef.current && focusWasInDialog && document.hasFocus() &&
        isActiveWorkspaceLifecycleKey(request.lifecycle) && request.context.anchor.isConnected &&
        (useTabStore.getState().splitState.root ? useTabStore.getState().splitState.activeLeafId : SINGLE_LEAF_ID) === request.context.leafId &&
        displayedTabForLeaf(request.context.leafId)?.id === request.context.tabId) {
        request.context.anchor.focus({ preventScroll: true })
      }
    })
  }, [displayedTabForLeaf])
  const handleAttachmentLinkClick = useCallback((resourceRef: string, source: string, context: PreviewLinkContext) => {
    const lifecycle = getActiveWorkspaceLifecycleKey()
    const tab = displayedTabForLeaf(context.leafId)
    if (!lifecycle || !tab || tab.id !== context.tabId || tab.file.path !== source) return
    const memory = linkWorkspacesRef.current.get(lifecycle.workspaceId)
    const binding = memory?.documents.get(tab.id)
    if (tab.linkedReadOnly && binding?.filePath !== source) return
    const generation = linkedReadGenerationRef.current
    const session = tab.linkedReadOnly ? undefined : findEditSessionForPath(useEditSessionStore.getState().sessions, source)
    const id = crypto.randomUUID()
    const operation = { workspaceId: lifecycle.workspaceId, lifecycleEpoch: lifecycle.lifecycleEpoch }
    const panel = memory?.panels.get(context.leafId)
    if (panel) {
      if (panel.requestId) void window.api.cancelLinkedRead(operation, context.leafId, panel.requestId).catch(() => {})
      panel.requestId = undefined; panel.pending = false; panel.positionRequest = undefined
      refreshLinkNavigation(version => version + 1)
    }
    const isCurrent = () => {
      const current = displayedTabForLeaf(context.leafId)
      const currentSession = tab.linkedReadOnly ? undefined : findEditSessionForPath(useEditSessionStore.getState().sessions, source)
      return attachmentRequestRef.current?.id === id && generation === linkedReadGenerationRef.current
        && !workspaceTransitionRef.current && isActiveWorkspaceLifecycleKey(lifecycle)
        && current?.id === tab.id && current.file.path === source && current.content === tab.content && current.linkedReadOnly === tab.linkedReadOnly
        && current.resourceRevision === tab.resourceRevision && current.missing === tab.missing
        && currentSession?.canonicalPath === session?.canonicalPath
        && currentSession?.draftVersion === session?.draftVersion && currentSession?.dirty === session?.dirty
    }
    const readRequest: LinkedReadRequest = { operation, source: { filePath: source, documentId: binding?.documentId },
      href: resourceRef, leafId: context.leafId, requestId: id }
    const request = { id, source, readRequest, isCurrent, context, lifecycle }
    attachmentRequestRef.current = request
    setAttachmentRequest(request)
  }, [displayedTabForLeaf])
  const handleAttachmentShortcut = useCallback((action: 'close' | 'search'): boolean => {
    if (!attachmentRequestRef.current) return false
    if (action === 'close') closeAttachment()
    else attachmentDialogRef.current?.search()
    return true
  }, [closeAttachment])
  useEffect(() => {
    const request = attachmentRequestRef.current
    if (request && !request.isCurrent()) closeAttachment()
  }, [activeWorkspaceId, activeWorkspaceEpoch, activeWorkspaceRoot, activeTabId, splitState, tabs, editSessions, closeAttachment])

  // 本次来路只存在于当前窗口内存；不进入workspace runtime、设置或诊断日志。
  const linkWorkspacesRef = useRef(new Map<string, {
    primaryRoot: string | null
    lifecycleEpoch: number
    documents: Map<string, { documentId: string; filePath: string }>
    issuedIds: Set<string>
    panels: Map<string, LinkLeafNavigation>
    layout?: LinkPanelLayout
  }>())
  const [, refreshLinkNavigation] = useState(0)
  const syncLinkNavigation = useCallback(() => {
    if (workspaceTransitionRef.current) return
    const workspaceState = useWorkspaceStore.getState()
    const workspace = workspaceState.workspaces.find(item => item.id === workspaceState.activeWorkspaceId)
    for (const [id, memory] of linkWorkspacesRef.current) {
      if (id === workspaceState.activeWorkspaceId) continue
      for (const panel of memory.panels.values()) {
        panel.requestId = undefined; panel.pending = false; panel.positionRequest = undefined
      }
    }
    if (!workspace) return
    const state = useTabStore.getState()
    let memory = linkWorkspacesRef.current.get(workspace.id)
    if (!memory || memory.primaryRoot !== workspace.primaryRoot || memory.lifecycleEpoch !== workspace.lifecycleEpoch) {
      if (memory?.issuedIds.size) void window.api.releaseLinkedReads([...memory.issuedIds]).catch(() => {})
      memory = { primaryRoot: workspace.primaryRoot, lifecycleEpoch: workspace.lifecycleEpoch,
        documents: new Map(), issuedIds: new Set(), panels: new Map() }
      linkWorkspacesRef.current.set(workspace.id, memory)
    }
    const leafTabs = state.splitState.root ? getAllLeaves(state.splitState.root)
      : state.activeTabId ? [{ id: SINGLE_LEAF_ID, tabId: state.activeTabId }] : []
    const layout: LinkPanelLayout = {
      split: Boolean(state.splitState.root), activeLeafId: state.splitState.activeLeafId || SINGLE_LEAF_ID,
      leaves: leafTabs.flatMap(leaf => {
        const tab = state.tabs.find(item => item.id === leaf.tabId)
        return tab ? [{ id: leaf.id, tabId: tab.id, filePath: tab.file.path }] : []
      }),
    }
    const previousRequests = [...memory.panels].flatMap(([leafId, panel]) => panel.requestId ? [{ leafId, requestId: panel.requestId }] : [])
    const changed = reconcileLinkPanels(memory.panels, memory.layout, layout, new Set(state.tabs.map(tab => tab.id)))
    for (const request of previousRequests) if (memory.panels.get(request.leafId)?.requestId !== request.requestId) {
      void window.api.cancelLinkedRead({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }, request.leafId, request.requestId).catch(() => {})
    }
    memory.layout = layout
    const tabIds = new Set(state.tabs.map(tab => tab.id))
    for (const tabId of memory.documents.keys()) if (!tabIds.has(tabId)) memory.documents.delete(tabId)
    const retained = new Set([...memory.documents.values()].map(item => item.documentId))
    for (const panel of memory.panels.values()) for (const visit of panel.chain.visits) {
      const binding = visit.tabId ? memory.documents.get(visit.tabId) : undefined
      if (!visit.documentId && binding?.filePath === visit.filePath) visit.documentId = binding.documentId
      if (visit.documentId) retained.add(visit.documentId)
    }
    const released = [...memory.issuedIds].filter(id => !retained.has(id))
    for (const id of released) memory.issuedIds.delete(id)
    if (released.length) void window.api.releaseLinkedReads(released).catch(() => {})
    if (changed) refreshLinkNavigation(version => version + 1)
  }, [])
  useEffect(() => useTabStore.subscribe(syncLinkNavigation), [syncLinkNavigation])
  useEffect(() => {
    const ids = new Set(workspaces.map(workspace => workspace.id))
    for (const [id, memory] of linkWorkspacesRef.current) if (!ids.has(id)) {
      if (memory.issuedIds.size) void window.api.releaseLinkedReads([...memory.issuedIds]).catch(() => {})
      linkWorkspacesRef.current.delete(id)
    }
    syncLinkNavigation()
  }, [activeWorkspaceId, activeWorkspaceEpoch, activeWorkspaceRoot, workspaces, activeTabId, tabs, splitState, syncLinkNavigation])
  const linkPanelForLeaf = useCallback((leafId: string) => {
    const id = useWorkspaceStore.getState().activeWorkspaceId
    return id ? linkWorkspacesRef.current.get(id)?.panels.get(leafId) : undefined
  }, [])
  const invalidateLinkRequest = useCallback(() => {
    const state = useTabStore.getState()
    const leafId = state.splitState.root ? state.splitState.activeLeafId : SINGLE_LEAF_ID
    const panel = linkPanelForLeaf(leafId)
    if (panel) {
      const operation = getActiveWorkspaceOperationContext()
      if (operation && panel.requestId) void window.api.cancelLinkedRead(operation, leafId, panel.requestId).catch(() => {})
      panel.requestId = undefined; panel.pending = false; refreshLinkNavigation(version => version + 1)
    }
  }, [linkPanelForLeaf])
  const resetLinkRoot = useCallback((tab: Tab) => {
    syncLinkNavigation()
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
    const state = useTabStore.getState()
    const leafId = state.splitState.root
      ? (findLeaf(state.splitState.root, state.splitState.activeLeafId)?.tabId === tab.id
        ? state.splitState.activeLeafId : findLeafByTabId(state.splitState.root, tab.id)?.id ?? state.splitState.activeLeafId)
      : SINGLE_LEAF_ID
    const panels = workspaceId ? linkWorkspacesRef.current.get(workspaceId)?.panels : undefined
    if (panels) {
      const panel = createRootNavigation({ tabId: tab.id, filePath: tab.file.path })
      const document = workspaceId ? linkWorkspacesRef.current.get(workspaceId)?.documents.get(tab.id) : undefined
      if (document?.filePath === tab.file.path) panel.chain.visits[0].documentId = document.documentId
      panels.set(leafId, panel)
      refreshLinkNavigation(version => version + 1)
    }
  }, [syncLinkNavigation])

  const readLinkedTabContent = useCallback(async (tab: Tab): Promise<string> => {
    const generation = linkedReadGenerationRef.current
    const lifecycle = getActiveWorkspaceLifecycleKey()
    const memory = lifecycle && linkWorkspacesRef.current.get(lifecycle.workspaceId)
    const binding = memory?.documents.get(tab.id)
    if (!lifecycle || !memory || memory.lifecycleEpoch !== lifecycle.lifecycleEpoch
      || memory.primaryRoot !== lifecycle.primaryRoot || !binding || binding.filePath !== tab.file.path) {
      throw new Error('临时文件读取许可不可用，请从来源链接重新打开。')
    }
    const operation = { workspaceId: lifecycle.workspaceId, lifecycleEpoch: lifecycle.lifecycleEpoch }
    const leafId = `reload:${tab.id}`
    const requestId = crypto.randomUUID()
    let prepared: PreparedLinkedDocument | undefined
    const isCurrent = () => generation === linkedReadGenerationRef.current && !workspaceTransitionRef.current
      && isActiveWorkspaceLifecycleKey(lifecycle)
      && linkWorkspacesRef.current.get(lifecycle.workspaceId) === memory
      && memory.documents.get(tab.id) === binding
      && useTabStore.getState().tabs.some(current => current.id === tab.id && current.file.path === tab.file.path)
    try {
      const result = await window.api.prepareLinkedDocumentRefresh(operation, binding.documentId, leafId, requestId)
      if (!result.success) throw new Error(linkedReadErrorMessages[result.code])
      prepared = result
      if (!isCurrent()) throw new Error(linkedReadErrorMessages.stale)
      const committed = await window.api.commitLinkedDocument(result.batchId)
      if (!committed.success) throw new Error(linkedReadErrorMessages[committed.code])
      if (!isCurrent()) throw new Error(linkedReadErrorMessages.stale)
      return buildPreviewContentForFile(result.targetPath, result.content)
    } finally {
      if (prepared) void window.api.releaseLinkedReads([prepared.batchId]).catch(() => {})
      void window.api.cancelLinkedRead(operation, leafId, requestId).catch(() => {})
    }
  }, [])
  useLayoutEffect(() => {
    const unregister = registerLinkedDocumentReader(readLinkedTabContent)
    return () => { linkedReadGenerationRef.current++; unregister() }
  }, [readLinkedTabContent])
  useEffect(() => () => {
    const ids = new Set<string>()
    for (const memory of linkWorkspacesRef.current.values()) for (const id of memory.issuedIds) ids.add(id)
    if (ids.size) void window.api.releaseLinkedReads([...ids]).catch(() => {})
  }, [])

  // v1.6.0: 提取的 hooks
  useDragDrop()
  useKeyboardShortcuts()
  useEditDraftPersistence()

  const confirmLeaveDirtyActiveTab = useCallback((nextFilePath?: string): boolean => {
    const currentActiveTabId = useTabStore.getState().activeTabId
    const active = tabsRef.current.find(tab => tab.id === currentActiveTabId)
    if (!active || active.linkedReadOnly || active.file.path === nextFilePath) return true

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
          const snapshot = persistentTabSession(runtimeFor(workspace.id), workspace.primaryRoot)
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
      beginFolderDiagnostic(activation)
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
              setActiveTabId(newTabs[0].id, { source: 'restore-pinned' })
            }
          }
        }
      } catch (err) {
        console.error('[App] Failed to restore pinned tabs on folder restore:', err)
      }
    })
    return cleanup
  }, [beginFolderDiagnostic])

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
        if (firstAddedTabId) setActiveTabId(firstAddedTabId, { source: 'restore-pinned' })
      }
    } catch (error) {
      console.error('[App] Failed to restore pinned tabs:', error)
    }
  }, [])

  const keepPinnedTabsForFolderSwitch = useCallback(() => {
    setTabs(prev => prev.filter(tab => tab.isPinned))
    setSplitState({ root: null, activeLeafId: '' }, { source: 'folder-switch' })
    splitLeafPositionsRef.current = {}
    pendingSplitLeafViewStatesRef.current = {}
  }, [setSplitState, setTabs])

  // v2.8.0：切走当前文件夹前，把实时 tab 列表 + 当前文档归档到 folderTabSessions。
  // 必须在触发切换的 activation IPC（会替换主进程工作区根）之前调用，否则旧路径会按新根校验被拒。
  const archiveCurrentFolderTabs = useCallback(async () => {
    const oldFolderPath = useFileStore.getState().folderPath
    if (!oldFolderPath) return
    const operation = getActiveWorkspaceOperationContext()
    if (!operation) return
    const session = persistentTabSession({ tabs: tabsRef.current, activeTabId: useTabStore.getState().activeTabId,
      splitState: splitStateRef.current }, oldFolderPath)
    const currentTabs = session.tabs
    const activeId = session.activeTabId
    const activeTab = currentTabs.find(tab => tab.id === activeId)
    try {
      await window.api.saveFolderTabSession(
        {
          tabs: currentTabs.map(tab => ({ filePath: tab.file.path, isPinned: tab.isPinned })),
          activeFilePath: activeTab?.file.path ?? null,
          splitLayout: serializeFolderSplitLayout(
            session.splitState,
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
        pendingSplitLeafViewStatesRef.current = {}
        setSplitState({ root: null, activeLeafId: '' }, { source: 'restore-folder-session' })
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
        pendingSplitLeafViewStatesRef.current = { ...splitLeafPositionsRef.current }
        setSplitState(restoredSplit.splitState, { source: 'restore-folder-session' })
        const activeLeaf = findLeaf(restoredSplit.splitState.root, restoredSplit.splitState.activeLeafId)
        if (activeLeaf) activeId = activeLeaf.tabId
      } else {
        splitLeafPositionsRef.current = {}
        pendingSplitLeafViewStatesRef.current = {}
        setSplitState({ root: null, activeLeafId: '' }, { source: 'restore-folder-session' })
      }
      if (activeId) setActiveTabId(activeId, { source: 'restore-folder-session' })
    } catch (error) {
      console.error('[App] Failed to restore folder tab session:', error)
      await restorePinnedTabs(targetFolderPath)
    }
  }, [restorePinnedTabs])

  const refreshExistingTabContent = useCallback(async (
    tab: Tab,
    loadContent: () => Promise<string>,
    errorPrefix = '无法打开文件',
    diagnosticOperation?: RendererFileDiagnosticOperation,
  ) => {
    const dirtySession = findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path)
    setActiveTabId(tab.id, { source: 'refresh-existing-tab', operationId: diagnosticOperation?.context.operationId })
    if (dirtySession?.dirty) {
      if (diagnosticOperation) recordFileTerminal(diagnosticOperation, 'cancel')
      return true
    }

    try {
      if (!tab.linkedReadOnly) clearFileCache(tab.file.path)
      const content = tab.linkedReadOnly ? await readTabPreviewContent(tab, true, diagnosticOperation) : await loadContent()
      setTabs(prev => prev.map(item =>
        item.id === tab.id
          ? { ...item, content, ...(diagnosticOperation ? { diagnosticOperation } : {}) }
          : item
      ))
      return true
    } catch (error) {
      if (diagnosticOperation) recordFileTerminal(diagnosticOperation, 'error')
      if (!tab.linkedReadOnly) console.error('Failed to refresh existing tab:', error)
      toast.error(`${errorPrefix}：${error instanceof Error ? error.message : '未知错误'}`)
      return false
    }
  }, [setActiveTabId, setTabs, toast])

  const applyFolderActivation = useCallback(async (activation: FolderActivation): Promise<void> => {
    beginFolderDiagnostic(activation)
    upsertWorkspace({
      ...activation.workspace,
      name: activation.workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
    })
    setFolderPath(activation.path)
    keepPinnedTabsForFolderSwitch()
    setActiveTabId(null, { source: 'folder-switch' })
    await restoreFolderTabSession(activation.path)
  }, [beginFolderDiagnostic, keepPinnedTabsForFolderSwitch, restoreFolderTabSession, upsertWorkspace])

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
    await applyFolderActivation(activation)
  }, [applyFolderActivation, archiveCurrentFolderTabs, confirmLeaveDirtyActiveTab])

  // 从主进程持有的最近文件记录激活；renderer 不再推导或授权根目录。
  const handleSelectRecentFile = useCallback(async (recentId: string, options?: ExternalDocumentOpenOptions) => {
    if (!confirmLeaveDirtyActiveTab()) return
    await archiveCurrentFolderTabs()
    try {
      const activation = await window.api.activateRecentFile(recentId)
      await applyFolderActivation(activation)

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
        setActiveTabId(targetId, { source: 'recent-file' })
        void ensureTabContentLoaded(targetId)
      }
    } catch (error) {
      toast.error(`无法打开最近文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [applyFolderActivation, archiveCurrentFolderTabs, confirmLeaveDirtyActiveTab, setHighlightKeyword, setScrollToLine, setScrollToRatio, toast])

  // 加载文件列表
  useEffect(() => {
    const hasWorkspaceBootstrap = Object.hasOwn(window.api, 'getWorkspaceBootstrap')
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (!folderPath || !lifecycle || lifecycle.primaryRoot !== folderPath || (hasWorkspaceBootstrap && !workspaceBootstrapReady)) return
    const loadFiles = async () => {
      setIsLoading(true)
      const folderDiagnostic = pendingFolderDiagnosticRef.current?.folderPath === folderPath
        ? pendingFolderDiagnosticRef.current
        : null
      try {
        const fileList = folderDiagnostic
          ? await window.api.readDir(folderPath, {
              operationId: folderDiagnostic.operationId,
              source: folderDiagnostic.source,
            })
          : await window.api.readDir(folderPath)
        const resultApplied = isActiveWorkspaceLifecycleKey(lifecycle)
        if (resultApplied) setFiles(fileList)
        if (folderDiagnostic) {
          recordFolderTreeReady({
            operationId: folderDiagnostic.operationId,
            startedMonotonicMs: folderDiagnostic.startedMonotonicMs,
            source: folderDiagnostic.source,
            resultApplied,
            rootNodeCount: fileList.length,
            outcome: resultApplied ? 'success' : 'superseded',
          })
        }
      } catch (error) {
        console.error('Failed to load files:', error)
        const resultApplied = isActiveWorkspaceLifecycleKey(lifecycle)
        if (resultApplied) setFiles([])
        if (folderDiagnostic) {
          recordFolderTreeReady({
            operationId: folderDiagnostic.operationId,
            startedMonotonicMs: folderDiagnostic.startedMonotonicMs,
            source: folderDiagnostic.source,
            resultApplied,
            rootNodeCount: 0,
            outcome: 'error',
          })
        }
      } finally {
        if (folderDiagnostic && pendingFolderDiagnosticRef.current?.operationId === folderDiagnostic.operationId) {
          pendingFolderDiagnosticRef.current = null
        }
        if (isActiveWorkspaceLifecycleKey(lifecycle)) setIsLoading(false)
      }
    }
    loadFiles()
  }, [folderPath, folderDiagnosticSequence])

  // 手动刷新文件树
  const handleRefreshFiles = useCallback(async () => {
    const currentFolderPath = useFileStore.getState().folderPath
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (!currentFolderPath || !lifecycle || lifecycle.primaryRoot !== currentFolderPath) return
    setIsLoading(true)
    try {
      const fileList = await window.api.readDir(currentFolderPath)
      if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
      setFiles(fileList)
      useFileStore.getState().refreshTreeMetadata()
      await (watchRefreshRef.current?.() ?? reconcileLoadedDocuments())
      if (isActiveWorkspaceLifecycleKey(lifecycle)) {
        await window.api.rebuildWorkspaceIndex?.({ workspaceId: lifecycle.workspaceId, lifecycleEpoch: lifecycle.lifecycleEpoch })
      }
    } catch (error) {
      console.error('Failed to refresh files:', error)
      toast.error('刷新内容未完成，请稍后重试')
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
    if (useTabStore.getState().tabs.some(tab => tab.file.path === filePath && tab.linkedReadOnly)) return
    const workspace = getActiveWorkspaceOperationContext()
    if (!workspace) return
    const store = useTabStore.getState()
    if (store.tabs.some(tab => tab.file.path === filePath && tab.initialScrollRatio !== undefined)) {
      store.setTabs(tabs => tabs.map(tab => tab.file.path === filePath ? { ...tab, initialScrollRatio: undefined } : tab))
    }
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
    // Live scroll reports are for archiving, not new restoration requests.
    const state = pendingSplitLeafViewStatesRef.current[leafId]
    return state?.filePath === filePath ? state : undefined
  }, [])

  const clearRestoredSplitLeafViewState = useCallback((leafId: string) => {
    delete pendingSplitLeafViewStatesRef.current[leafId]
  }, [])

  const removeTabsFromSession = useCallback((predicate: (tab: Tab) => boolean) => {
    setTabs(prev => {
      const nextTabs = prev.filter(predicate)
      setSplitState(split => reconcileSplitState(split, new Set(nextTabs.map(tab => tab.id))), { source: 'remove-tabs' })

      const currentActiveTabId = useTabStore.getState().activeTabId
      if (!currentActiveTabId || !nextTabs.some(tab => tab.id === currentActiveTabId)) {
        setActiveTabId(nextTabs[0]?.id ?? null, { source: 'remove-tabs' })
      }
      return nextTabs
    })
  }, [setActiveTabId, setSplitState, setTabs])

  const recoverMissingTab = useCallback(async (tabId: string, candidatePath?: string) => {
    const tab = tabsRef.current.find(item => item.id === tabId)
    if (!tab) return
    if (tab.linkedReadOnly) {
      if (candidatePath && candidatePath !== tab.file.path) { toast.error('临时文件不能自动追随改名，请从来源链接重新打开。'); return }
      try {
        const content = await readTabPreviewContent(tab, true)
        setTabs(previous => previous.map(current => current.id === tab.id && current.file.path === tab.file.path
          ? { ...current, content, missing: false, renameCandidatePath: undefined } : current))
      } catch { toast.error('临时文件不可读取，请从来源链接重新打开。') }
      return
    }
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
  }, [setTabs, toast])

  // 关闭标签
  const handleTabClose = useCallback((tabId: string) => {
    const closingTab = tabsRef.current.find(tab => tab.id === tabId)
    if (closingTab && !confirmCloseDirtyTab(closingTab)) return
    const operation = getActiveWorkspaceOperationContext()
    if (closingTab && !closingTab.linkedReadOnly && operation) {
      void window.api.unwatchFile(
        closingTab.file.path,
        operation.workspaceId,
        operation.lifecycleEpoch
      ).catch(() => {})
    }

    setTabs(prev => {
      const closingTab = prev.find(tab => tab.id === tabId)
      if (closingTab && !closingTab.linkedReadOnly) clearFileCache(closingTab.file.path)
      const newTabs = prev.filter(tab => tab.id !== tabId)
      setSplitState(split => reconcileSplitState(
        split,
        new Set(newTabs.map(tab => tab.id))
      ), { source: 'close-tab' })
      const currentActiveTabId = useTabStore.getState().activeTabId
      if (tabId === currentActiveTabId) {
        const closedIndex = prev.findIndex(tab => tab.id === tabId)
        if (newTabs.length > 0) {
          const nextTab = newTabs[closedIndex] || newTabs[closedIndex - 1]
          setActiveTabId(nextTab.id, { source: 'close-tab' })
        } else {
          setActiveTabId(null, { source: 'close-tab' })
        }
      }
      return newTabs
    })
  }, [confirmCloseDirtyTab])

  // 选择文件
  const handleFileSelect = useCallback(async (
    file: FileInfo,
    lineNumber?: number,
    keyword?: string,
    diagnosticSource: DiagnosticSource = 'user',
  ) => {
    if (file.isDirectory) return
    invalidateLinkRequest()
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
        const diagnosticOperation = startFileDiagnostic(
          diagnosticSource === 'user' ? 'tab' : diagnosticSource,
        )
        const opened = await refreshExistingTabContent(
          existingTab,
          () => readPreviewContentWithCache(file.path, true, diagnosticOperation),
          '无法打开文件',
          diagnosticOperation,
        )
        if (opened && isActiveWorkspaceLifecycleKey(lifecycle) && useTabStore.getState().activeTabId === existingTab.id) {
          resetLinkRoot(existingTab)
          setScrollToLine(lineNumber)
          setScrollToRatio(targetRatio)
          setHighlightKeyword(keyword)
        }
        return
      }
      const diagnosticOperation = startFileDiagnostic(diagnosticSource)
      try {
        const content = await readPreviewContentWithCache(file.path, true, diagnosticOperation)
        if (!isActiveWorkspaceLifecycleKey(lifecycle)) {
          recordFileTerminal(diagnosticOperation, 'superseded')
          return
        }
        const targetRatio = lineNumber || keyword ? undefined : await resolveReadPositionRatio(file.path)
        if (!isActiveWorkspaceLifecycleKey(lifecycle)) {
          recordFileTerminal(diagnosticOperation, 'superseded')
          return
        }
        const operation = getActiveWorkspaceOperationContext()
        if (!operation) {
          recordFileTerminal(diagnosticOperation, 'superseded')
          return
        }
        const isPinned = await window.api.isTabPinned(file.path, operation)
        if (!isActiveWorkspaceLifecycleKey(lifecycle)) {
          recordFileTerminal(diagnosticOperation, 'superseded')
          return
        }
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          content,
          isPinned,
          diagnosticOperation,
        }
        setTabs(prev => [...prev, newTab])
        setActiveTabId(newTab.id, { source: 'file-select', operationId: diagnosticOperation.context.operationId })
        resetLinkRoot(newTab)
        setScrollToLine(lineNumber)
        setScrollToRatio(targetRatio)
        setHighlightKeyword(keyword)
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
        recordFileTerminal(diagnosticOperation, 'error')
        console.error('Failed to read file:', error)
        toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
      }
    } finally {
      if (pendingFileSelectPathRef.current === file.path) pendingFileSelectPathRef.current = null
    }
  }, [activeWorkspaceId, confirmLeaveDirtyActiveTab, invalidateLinkRequest, resetLinkRoot, refreshExistingTabContent, resolveReadPositionRatio, toast, workspaces])

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
    invalidateLinkRequest()
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
        await applyFolderActivation(activation)
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
      const opened = await refreshExistingTabContent(existingTab, async () =>
        buildPreviewContentForFile(filePath, await window.api.searchReadFile(filePath))
      )
      if (opened) resetLinkRoot(existingTab)
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
      setActiveTabId(newTab.id, { source: 'external-file' })
      resetLinkRoot(newTab)
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
  }, [applyFolderActivation, archiveCurrentFolderTabs, confirmLeaveDirtyActiveTab, handleFileSelect, handleSelectRecentFile, invalidateLinkRequest, resetLinkRoot, refreshExistingTabContent, setHighlightKeyword, setScrollToLine, setScrollToRatio, toast])

  const navigateMarkdownLink = useCallback(async (options: {
    leafId: string
    href?: string
    context?: PreviewLinkContext
    returning?: boolean
  }): Promise<OpenDocumentResult> => {
    const { leafId, href, context, returning } = options
    const commandId = crypto.randomUUID()
    const outcome = (status: OpenDocumentResult['status']): OpenDocumentResult => ({ commandId, status, leafId })
    syncLinkNavigation()
    const lifecycle = getActiveWorkspaceLifecycleKey()
    const sourceTab = displayedTabForLeaf(leafId)
    const panel = linkPanelForLeaf(leafId)
    if (!lifecycle || !sourceTab || !panel || (context &&
      (context.tabId !== sourceTab.id || context.filePath !== sourceTab.file.path))) return outcome('stale')
    const sourceVisit = panel.chain.visits[panel.chain.cursor]
    const memory = linkWorkspacesRef.current.get(lifecycle.workspaceId)
    const sourceDocument = memory?.documents.get(sourceTab.id)
    if (!memory || (sourceTab.linkedReadOnly && sourceDocument?.filePath !== sourceTab.file.path)) return outcome('stale')
    const sourceGeneration = linkedReadGenerationRef.current
    const tabsAtStart = useTabStore.getState().tabs
    const sessionsAtStart = useEditSessionStore.getState().sessions
    const readOperation = { workspaceId: lifecycle.workspaceId, lifecycleEpoch: lifecycle.lifecycleEpoch }
    let prepared: PreparedLinkedDocument | undefined
    let attached = false
    const returnCursor = panel.chain.cursor - 1
    const returnVisit = returning ? panel.chain.visits[returnCursor] : undefined
    if (returning && !returnVisit) return outcome('target-missing')
    const requestId = commandId
    panel.requestId = requestId
    panel.pending = true
    if (context) {
      context.anchor.dataset.mdvNavigationRequest = requestId
      context.anchor.setAttribute('aria-busy', 'true')
    }
    refreshLinkNavigation(version => version + 1)
    const sourceSession = sourceTab.linkedReadOnly ? undefined : findEditSessionForPath(useEditSessionStore.getState().sessions, sourceTab.file.path)
    const sourceDraftVersion = sourceSession?.draftVersion
    const sourceDirty = sourceSession?.dirty
    const sourceCanonicalPath = sourceSession?.canonicalPath
    const focusAtStart = document.activeElement
    const sourceStillCurrent = () => {
      const current = displayedTabForLeaf(leafId)
      const session = sourceTab.linkedReadOnly ? undefined : findEditSessionForPath(useEditSessionStore.getState().sessions, sourceTab.file.path)
      return sourceGeneration === linkedReadGenerationRef.current && !workspaceTransitionRef.current && isActiveWorkspaceLifecycleKey(lifecycle) && linkPanelForLeaf(leafId) === panel &&
        panel.requestId === requestId && panel.chain.visits[panel.chain.cursor]?.id === sourceVisit.id &&
        current?.id === sourceTab.id && current.file.path === sourceTab.file.path &&
        current.content === sourceTab.content && current.resourceRevision === sourceTab.resourceRevision && current.linkedReadOnly === sourceTab.linkedReadOnly &&
        current.missing === sourceTab.missing && session?.canonicalPath === sourceCanonicalPath &&
        session?.draftVersion === sourceDraftVersion && session?.dirty === sourceDirty
    }
    const stale = (message = '来源文档已更新，本次跳转已取消，请重新点击链接。') => {
      const current = displayedTabForLeaf(leafId)
      const state = useTabStore.getState()
      const activeLeaf = state.splitState.root ? state.splitState.activeLeafId : SINGLE_LEAF_ID
      if (sourceGeneration === linkedReadGenerationRef.current && !workspaceTransitionRef.current &&
        isActiveWorkspaceLifecycleKey(lifecycle) && linkPanelForLeaf(leafId) === panel &&
        panel.requestId === requestId && panel.chain.visits[panel.chain.cursor]?.id === sourceVisit.id &&
        current?.id === sourceTab.id && current.file.path === sourceTab.file.path && activeLeaf === leafId) {
        toast.info(message)
      }
      return outcome('stale')
    }
    try {
      let targetPath: string
      let targetLine: number | undefined
      let revision: string | undefined
      if (returnVisit?.documentId) {
        const result = await window.api.prepareLinkedDocumentRefresh(readOperation, returnVisit.documentId, leafId, requestId)
        if (result.success) prepared = result
        if (!sourceStillCurrent()) return stale()
        if (!result.success) { toast.error(`无法返回来源：${linkedReadErrorMessages[result.code]}`); return outcome('failed') }
        targetPath = result.targetPath
      } else if (returnVisit) {
        const result = await window.api.prepareLinkedDocument({
          operation: readOperation, source: { filePath: sourceTab.file.path, documentId: sourceDocument?.documentId },
          href: encodeURI(returnVisit.filePath).replace(/[?#]/g, character => encodeURIComponent(character)),
          leafId, requestId, rootOnly: true,
        })
        if (result.success) prepared = result
        if (!sourceStillCurrent()) return stale()
        if (!result.success) { toast.error(`无法返回来源：${linkedReadErrorMessages[result.code]}`); return outcome('failed') }
        targetPath = result.targetPath
      } else if (context?.wikiEmbed) {
        if (!href) return outcome('failed')
        const [resolved, hash] = await Promise.all([window.api.resolveMdLink(sourceTab.file.path, href), context.revision])
        if (!sourceStillCurrent()) return stale()
        if (!resolved.success || !resolved.targetPath) { toast.error('嵌入链接目标不符合原有工作区读取范围。'); return outcome('failed') }
        const result = await window.api.prepareLinkedDocument({
          operation: readOperation, source: { filePath: sourceTab.file.path },
          href: encodeURI(resolved.targetPath).replace(/[?#]/g, character => encodeURIComponent(character))
            + (resolved.headingId ? `#${encodeURIComponent(resolved.headingId)}` : ''),
          leafId, requestId, rootOnly: true,
        })
        if (result.success) prepared = result
        if (!sourceStillCurrent()) return stale()
        if (!result.success) { toast.error('嵌入链接目标不符合原有工作区读取范围。'); return outcome('failed') }
        targetPath = result.targetPath; targetLine = result.targetLine; revision = hash
      } else {
        if (!href) return outcome('failed')
        const request: LinkedReadRequest = {
          operation: readOperation, source: { filePath: sourceTab.file.path, documentId: sourceDocument?.documentId },
          href, leafId, requestId,
        }
        const [result, hash] = await Promise.all([window.api.prepareLinkedDocument(request), context?.revision])
        if (result.success) prepared = result
        if (!sourceStillCurrent()) return stale()
        if (!result.success && result.code === 'wiki-resource' && context) {
          handleAttachmentLinkClick(href, sourceTab.file.path, context)
          return outcome('failed')
        }
        if (!result.success) { toast.error(`链接跳转失败：${linkedReadErrorMessages[result.code]}`); return outcome('failed') }
        targetPath = result.targetPath; targetLine = result.targetLine; revision = hash
      }
      if (!prepared) return outcome('failed')
      const command: OpenDocumentCommand = createOpenDocumentCommand({
        id: commandId, source: returning ? 'link-return' : 'link', filePath: targetPath,
        canonicalPath: targetPath, leafId,
        target: targetLine ? { kind: 'line', lineNumber: targetLine } : { kind: 'top' },
      })
      if (sourceDirty && sourceTab.file.path !== targetPath && !window.confirm(UNSAVED_EDIT_LEAVE_MESSAGE)) {
        return outcome('blocked-by-dirty')
      }
      if (!sourceStillCurrent()) return stale()
      const linkedReadOnly = prepared?.access === 'linked-readonly'
      const targetBefore = tabsAtStart.find(tab => tab.file.path === targetPath)
      const targetSessionBefore = linkedReadOnly ? undefined : findEditSessionForPath(sessionsAtStart, targetPath)
      const targetVersion = targetSessionBefore?.draftVersion
      const targetCanonicalPath = targetSessionBefore?.canonicalPath
      const targetDirty = targetSessionBefore?.dirty
      // 即使复用草稿也走实际读取授权；任何失败都不能先激活目标。
      const content = buildPreviewContentForFile(targetPath, prepared.content)
      if (prepared.blockId) {
        const block = inspectMarkdownBlock(targetSessionBefore?.dirty ? targetSessionBefore.draft : content, prepared.blockId)
        if (block !== 'found') {
          toast.error(block === 'ambiguous' ? `块 ID ^${prepared.blockId} 重复，无法确定位置。`
            : `未找到块 ^${prepared.blockId}${targetSessionBefore?.dirty ? '（当前草稿）' : ''}。`)
          return outcome('failed')
        }
      }
      const ratio = returnVisit?.position?.scrollRatio ?? (targetLine
        ? Math.max(0, targetLine - 1) / Math.max(1, content.split('\n').length)
        : linkedReadOnly ? 0 : await resolveReadPositionRatio(targetPath) ?? 0)
      const operation = getActiveWorkspaceOperationContext()
      const isPinned = targetBefore?.isPinned ?? (operation && lifecycle.primaryRoot && isPathInsideFolder(targetPath, lifecycle.primaryRoot)
        ? await window.api.isTabPinned(targetPath, operation) : false)
      if (!sourceStillCurrent()) return stale()
      if (prepared) {
        const result = await window.api.commitLinkedDocument(prepared.batchId)
        if (!sourceStillCurrent()) return stale()
        if (!result.success) { toast.error(linkedReadErrorMessages[result.code]); return outcome('failed') }
      }
      const currentState = useTabStore.getState()
      const targetNow = currentState.tabs.find(tab => tab.file.path === targetPath)
      const latestTargetSession = linkedReadOnly ? undefined : findEditSessionForPath(useEditSessionStore.getState().sessions, targetPath)
      if (targetBefore && (!targetNow || targetNow.id !== targetBefore.id ||
        (!latestTargetSession?.dirty && (targetNow.content !== targetBefore.content ||
          targetNow.resourceRevision !== targetBefore.resourceRevision || targetNow.missing !== targetBefore.missing ||
          latestTargetSession?.draftVersion !== targetVersion || latestTargetSession?.canonicalPath !== targetCanonicalPath ||
          latestTargetSession?.dirty !== targetDirty)))) return stale('目标文档已更新，本次跳转已取消，请重新点击链接。')
      const targetTab: Tab = targetNow ? {
        ...targetNow,
        // 另一面板新增草稿时，保留其当前base和最新draft；不交付过期磁盘内容。
        content: latestTargetSession?.dirty || !targetBefore ? targetNow.content ?? content : content,
        linkedReadOnly, isPinned: linkedReadOnly ? false : isPinned,
        missing: false, renameCandidatePath: undefined,
      } : {
        id: `tab-${crypto.randomUUID()}`,
        file: { name: getFileNameFromPath(targetPath), path: targetPath, isDirectory: false },
        content, isPinned: linkedReadOnly ? false : isPinned, linkedReadOnly,
      }
      const blockSource = prepared.blockId ? (latestTargetSession?.dirty ? latestTargetSession.draft
        : buildPreviewContentForFile(targetPath, targetTab.content ?? '')) : undefined
      if (prepared.blockId && inspectMarkdownBlock(blockSource!, prepared.blockId) !== 'found') {
        toast.error('目标内容已变化，无法确认指定块，请重新点击链接。')
        return outcome('failed')
      }
      if (prepared?.documentId) {
        memory.documents.set(targetTab.id, { documentId: prepared.documentId, filePath: targetPath })
        memory.issuedIds.add(prepared.documentId)
      } else memory.documents.delete(targetTab.id)
      let chain = panel.chain
      let visit: LinkVisit
      if (returnVisit) {
        visit = { ...returnVisit, tabId: targetTab.id, documentId: prepared?.documentId }
        chain = { visits: chain.visits.map((item, index) => index === returnCursor ? visit : item), cursor: returnCursor }
        bindLinkVisits(panel, chain, [visit])
      } else if (targetPath === sourceTab.file.path) visit = sourceVisit
      else {
        const source = { ...sourceVisit, tabId: sourceTab.id, documentId: sourceVisit.documentId ?? sourceDocument?.documentId,
          ...(context ? { position: { ...context.position, revision } } : {}) }
        visit = { id: crypto.randomUUID(), filePath: targetPath, tabId: targetTab.id, documentId: prepared?.documentId }
        chain = appendLinkVisit(chain, source, visit)
        bindLinkVisits(panel, chain, [source, visit])
      }
      panel.pending = false
      const targetTabId = targetTab.id
      const visitId = visit.id
      panel.positionRequest = {
        id: requestId, filePath: targetPath, position: returnVisit?.position ?? { scrollRatio: ratio },
        ...(prepared.blockId ? { block: { id: prepared.blockId, source: blockSource!, deadline: performance.now() + 2000 } } : {}),
        isCurrent: () => isActiveWorkspaceLifecycleKey(lifecycle) && linkPanelForLeaf(leafId) === panel &&
          panel.requestId === requestId && panel.chain.visits[panel.chain.cursor]?.id === visitId &&
          displayedTabForLeaf(leafId)?.id === targetTabId,
        canFocus: () => {
          const state = useTabStore.getState()
          const focusedLeaf = state.splitState.root ? state.splitState.activeLeafId : SINGLE_LEAF_ID
          return document.hasFocus() && !attachmentRequestRef.current && focusedLeaf === leafId &&
            (document.activeElement === focusAtStart || document.activeElement === document.body)
        },
        onComplete: status => {
          if (panel.positionRequest?.id === requestId) {
            if (panel.positionRequest.block && panel.positionRequest.isCurrent()
              && status && status !== 'positioned' && status !== 'cancelled') {
              toast.error(`文档已打开，但未能定位到块 ^${panel.positionRequest.block.id}。`)
            }
            panel.positionRequest = undefined
            refreshLinkNavigation(version => version + 1)
          }
        },
      }
      const targetTabs = targetNow ? currentState.tabs.map(tab => tab.id === targetTab.id ? targetTab : tab)
        : [...currentState.tabs, targetTab]
      const activeLeaf = currentState.splitState.root ? currentState.splitState.activeLeafId : SINGLE_LEAF_ID
      // 内存visit先就位，视图和tab随后一次store提交；新正文首次可点击时链已经是目标visit。
      useTabStore.setState({
        tabs: targetTabs,
        splitState: currentState.splitState.root ? {
          ...currentState.splitState, root: updateLeafTab(currentState.splitState.root, command.leafId!, targetTab.id),
        } : currentState.splitState,
        activeTabId: activeLeaf === leafId ? targetTab.id : currentState.activeTabId,
        ...(activeLeaf === leafId ? { scrollToLine: undefined, scrollToRatio: undefined, highlightKeyword: undefined } : {}),
      })
      attached = true
      refreshLinkNavigation(version => version + 1)
      if (!targetNow && !linkedReadOnly) {
        void window.api.watchFile(targetPath, lifecycle.workspaceId, lifecycle.lifecycleEpoch).catch(() => {})
        if (lifecycle.primaryRoot) void window.api.addRecentFile({ path: targetPath, name: targetTab.file.name, folderPath: lifecycle.primaryRoot }).catch(() => {})
      }
      return { commandId, status: targetNow ? 'focused' : 'opened', tabId: targetTab.id, leafId, resolvedTarget: command.target }
    } catch {
      if (!sourceStillCurrent()) return stale()
      toast.error(returning ? '无法返回来源：文件不可访问或已失去读取授权。' : '链接跳转失败：文件不可访问或已失去读取授权。')
      return outcome('failed')
    } finally {
      if (prepared) {
        const release = [prepared.batchId]
        if (!attached && prepared.documentId && prepared.documentId !== returnVisit?.documentId) release.push(prepared.documentId)
        void window.api.releaseLinkedReads(release).catch(() => {})
      }
      void window.api.cancelLinkedRead(readOperation, leafId, requestId).catch(() => {})
      if (context?.anchor.dataset.mdvNavigationRequest === requestId) {
        delete context.anchor.dataset.mdvNavigationRequest
        context.anchor.removeAttribute('aria-busy')
      }
      if (panel.requestId === requestId && panel.pending) {
        panel.pending = false
        refreshLinkNavigation(version => version + 1)
      }
    }
  }, [displayedTabForLeaf, handleAttachmentLinkClick, linkPanelForLeaf, resolveReadPositionRatio, syncLinkNavigation, toast])

  const handleMarkdownLinkClick = useCallback(async (href: string, currentFilePath: string, context?: PreviewLinkContext) => {
    const leafId = context?.leafId ?? (useTabStore.getState().splitState.root
      ? useTabStore.getState().splitState.activeLeafId : SINGLE_LEAF_ID)
    if (displayedTabForLeaf(leafId)?.file.path !== currentFilePath) return
    await navigateMarkdownLink({ leafId, href, context })
  }, [displayedTabForLeaf, navigateMarkdownLink])
  const getLinkOrigin = useCallback((leafId: string): LinkOrigin | undefined => {
    const panel = linkPanelForLeaf(leafId)
    const current = panel?.chain.visits[panel.chain.cursor]
    const source = panel?.chain.visits[panel.chain.cursor - 1]
    const tab = displayedTabForLeaf(leafId)
    if (!current || !source || !tab || current.tabId !== tab.id || current.filePath !== tab.file.path) return undefined
    return { name: getFileNameFromPath(source.filePath), busy: Boolean(panel?.pending),
      description: `返回来源：${source.filePath}${source.position?.headingId ? ` · 标题锚点：#${source.position.headingId}` : ' · 原链接位置'}`,
      onReturn: () => { void navigateMarkdownLink({ leafId, returning: true }) } }
  }, [displayedTabForLeaf, linkPanelForLeaf, navigateMarkdownLink])
  const getLinkPositionRequest = useCallback((leafId: string) => linkPanelForLeaf(leafId)?.positionRequest, [linkPanelForLeaf])

  // 切换标签
  const handleTabClick = useCallback((tabId: string) => {
    const nextTab = tabsRef.current.find(tab => tab.id === tabId)
    if (!confirmLeaveDirtyActiveTab(nextTab?.file.path)) return
    setActiveTabId(tabId, { source: 'tab-click' })
  }, [confirmLeaveDirtyActiveTab, setActiveTabId])

  // 获取当前活动标签
  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeTabId), [tabs, activeTabId])
  useEffect(() => {
    if (activeTab?.file.path) requestFileTreeReveal(activeTab.file.path)
  }, [activeTab?.file.path, activeWorkspaceEpoch, activeWorkspaceId, folderPath, requestFileTreeReveal])
  const activeViewState = activeTab?.linkedReadOnly ? { ...getDocumentViewState(SINGLE_LEAF_ID, activeTab.id), mode: 'preview' as const }
    : activeTab ? documentViews[`${SINGLE_LEAF_ID}:${activeTab.id}`] ?? getDocumentViewState(SINGLE_LEAF_ID, activeTab.id) : null
  const editSessionList = useMemo(() => Object.values(editSessions), [editSessions])
  const getQuickEditCanonicalPath = useCallback((tab: Tab): string | null => {
    if (tab.linkedReadOnly) return null
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
  const activeQuickEditSession = activeTab && !activeTab.linkedReadOnly ? findEditSessionForPath(editSessions, activeTab.file.path) : undefined
  const activeQuickEditTarget = activeTab?.linkedReadOnly ? null : quickEditPlacements.single || null
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
    if (tab.linkedReadOnly) { toast.error('外部临时文档仅供只读查看，不能编辑或保存。'); return }
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
      const state = useTabStore.getState()
      const tab = state.tabs.find(item => item.file.path === session.displayPath || item.file.path === canonicalPath)
      if (tab) {
        const activeLeaf = state.splitState.root ? findLeaf(state.splitState.root, state.splitState.activeLeafId) : null
        const leaf = activeLeaf?.tabId === tab.id ? activeLeaf : findLeafByTabId(state.splitState.root, tab.id)
        if (leaf || (!state.splitState.root && state.activeTabId === tab.id)) {
          setDocumentViewMode(leaf?.id ?? SINGLE_LEAF_ID, tab.id, 'compare')
        }
      }
      toast.error(nextSession.conflictReason
        ? '草稿与磁盘版本冲突，已保留草稿并取消导出。请在编辑器中处理冲突。'
        : '保存期间草稿又有修改，已取消导出。请保存最新草稿后重试。')
      return false
    }
    return true
  }, [handleSaveQuickEdit, setDocumentViewMode, toast])

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
    }, { source: 'active-tab-sync' })
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
    let diagnosticOperation: RendererFileDiagnosticOperation | null = null
    try {
      await archiveCurrentFolderTabs()
      const activation = await window.api.activateBookmark(bookmark.id)
      beginFolderDiagnostic(activation)
      upsertWorkspace({
        ...activation.workspace,
        name: activation.workspace.primaryRoot?.split(/[/\\]/).pop() || '未命名工作区',
      })
      setFolderPath(activation.path)
      keepPinnedTabsForFolderSwitch()
      setActiveTabId(null, { source: 'bookmark' })

      diagnosticOperation = startFileDiagnostic('recent')
      const content = await readPreviewContentWithCache(
        activation.filePath,
        true,
        diagnosticOperation,
      )
      let targetId: string | null = null
      setTabs(prev => {
        const existing = prev.find(tab => tab.file.path === activation.filePath)
        if (existing) {
          targetId = existing.id
          return prev.map(tab => tab.id === existing.id
            ? { ...tab, content, diagnosticOperation: diagnosticOperation ?? undefined }
            : tab)
        }
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file: { name: activation.fileName, path: activation.filePath, isDirectory: false },
          content,
          ...(diagnosticOperation ? { diagnosticOperation } : {}),
        }
        targetId = newTab.id
        return [...prev, newTab]
      })
      if (targetId) setActiveTabId(targetId, { source: 'bookmark' })
      setTimeout(() => navigateToBookmarkPosition(bookmark), 0)
    } catch (error) {
      if (diagnosticOperation) recordFileTerminal(diagnosticOperation, 'error')
      toast.error(`无法打开书签：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [archiveCurrentFolderTabs, beginFolderDiagnostic, keepPinnedTabsForFolderSwitch, toast, upsertWorkspace])

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
    const refreshDependentTabs = (changedPath: string): void => {
      if (!isRefreshableLocalResourcePath(changedPath)) return
      const workspaceState = useWorkspaceStore.getState()
      const editSessions = useEditSessionStore.getState().sessions
      setTabs(prev => {
        let changed = false
        const next = prev.map(tab => {
          if (tab.linkedReadOnly || tab.file.path === changedPath || tab.missing) return tab
          const editSession = findEditSessionForPath(editSessions, tab.file.path)
          const previewContent = editSession?.draft ?? tab.content
          if (previewContent === null || !isMarkdownFile(tab.file.path)) return tab
          const owner = workspaceState.workspaces.find(workspace => (
            workspace.primaryRoot && isPathInsideFolder(tab.file.path, workspace.primaryRoot)
          ))
          const workspaceRoot = owner?.primaryRoot ?? folderPath
          let cached = resourceDependencyCacheRef.current.get(tab.id)
          if (!cached || cached.content !== previewContent) {
            cached = {
              content: previewContent,
              dependencies: collectLocalResourceDependencies(previewContent),
            }
            resourceDependencyCacheRef.current.set(tab.id, cached)
          }
          if (!localResourceDependenciesContainPath(
            cached.dependencies,
            tab.file.path,
            workspaceRoot,
            changedPath,
          )) return tab
          changed = true
          return {
            ...tab,
            resourceRevision: (tab.resourceRevision ?? 0) + 1,
          }
        })
        return changed ? next : prev
      })
    }

    let eventQueue = Promise.resolve()
    let queueFailed = false
    let queuedEvents = 0
    let queueGeneration = 0
    let gapReported = false
    let lossVersion = 0
    let snapshotLossVersion = -1
    const reportGap = (failed = false) => {
      queueFailed ||= failed
      lossVersion++
      if (gapReported) return
      gapReported = true
      queueGeneration++
      void window.api.notifyWatchGap?.(workspaceId ?? undefined, lifecycleEpoch).catch(() => {})
    }
    const enqueueWatchEvent = <T,>(handler: (event: T) => Promise<void>) => (event: T): Promise<void> => {
      if (gapReported || queuedEvents >= 128) { reportGap(); return eventQueue }
      queuedEvents++
      const generation = queueGeneration
      eventQueue = eventQueue.then(() => generation === queueGeneration ? handler(event) : undefined)
        .catch(() => reportGap(true)).finally(() => { queuedEvents-- })
      return eventQueue
    }

    const unsubscribeChanged = window.api.onFileChanged(enqueueWatchEvent(async (event) => {
      if (!acceptsEvent(event)) return
      const changedPath = eventPath(event)
      if (!changedPath) return
      clearFileCache(changedPath, 'watcher')
      refreshDependentTabs(changedPath)
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
          throw error
        }
        return
      }
      const currentTabs = tabsRef.current
      const affectedTab = currentTabs.find(tab => tab.file.path === changedPath)
      if (affectedTab && affectedTab.content !== null) {
        // 壳 tab（content===null）尚未 materialize，不 eager 回写；激活时会读到最新内容
        const diagnosticOperation = startFileDiagnostic('watcher')
        try {
          const newContent = await readFileWithCache(changedPath, true, diagnosticOperation)
          if (
            !isCurrentSubscription()
            || !tabsRef.current.some(tab => tab.id === affectedTab.id && tab.file.path === changedPath)
            || hasLocalEditActivity(findEditSessionForPath(useEditSessionStore.getState().sessions, changedPath))
          ) {
            recordFileTerminal(diagnosticOperation, 'superseded')
            return
          }
          setTabs(prev => prev.map(tab => tab.id === affectedTab.id && tab.file.path === changedPath
            ? {
                ...tab,
                content: newContent,
                missing: false,
                renameCandidatePath: undefined,
                diagnosticOperation,
              }
            : tab))
        } catch (error) {
          recordFileTerminal(diagnosticOperation, 'error')
          console.error('Failed to reload file:', error)
          throw error
        }
      }
    }))

    const refreshFiles = async () => {
      try {
        const fileList = await window.api.readDir(folderPath)
        if (!isCurrentSubscription()) return
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
        throw error
      }
    }

    const unsubscribeAdded = window.api.onFileAdded(enqueueWatchEvent(async (event) => {
      if (!acceptsEvent(event)) return
      const addedPath = eventPath(event)
      if (!addedPath) return
      clearFileCache(addedPath)
      refreshDependentTabs(addedPath)
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
          if (!isCurrentSubscription() || hasLocalEditActivity(findEditSessionForPath(useEditSessionStore.getState().sessions, addedPath))) return
          setTabs(prev => prev.map(tab => tab.id === affectedTab.id && tab.file.path === addedPath
            ? { ...tab, content: newContent, missing: false, renameCandidatePath: undefined }
            : tab))
        } catch (error) {
          console.error('Failed to recover recreated file:', error)
          throw error
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
          throw error
        }
      } else if (affectedTab && affectedTab.content !== null && !hasLocalActivity) {
        try {
          const newContent = await window.api.readFile(addedPath)
          if (!isCurrentSubscription() || hasLocalEditActivity(findEditSessionForPath(useEditSessionStore.getState().sessions, addedPath))) return
          setTabs(prev => prev.map(tab => tab.id === affectedTab.id && tab.file.path === addedPath
            ? { ...tab, content: newContent }
            : tab))
        } catch (error) {
          console.error('Failed to reload added file:', error)
          throw error
        }
      }
      await refreshFiles()
    }))

    const unsubscribeRemoved = window.api.onFileRemoved(enqueueWatchEvent(async (event) => {
      if (!acceptsEvent(event)) return
      const removedPath = eventPath(event)
      if (!removedPath) return
      clearFileCache(removedPath)
      refreshDependentTabs(removedPath)
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
    }))

    const unsubscribeFolderAdded = window.api.onFolderAdded(enqueueWatchEvent(async (event) => {
      if (acceptsEvent(event)) await refreshFiles()
    }))

    const unsubscribeFolderRemoved = window.api.onFolderRemoved(enqueueWatchEvent(async (event) => {
      if (!acceptsEvent(event)) return
      const dirPath = eventPath(event)
      if (!dirPath) return
      for (const tab of tabsRef.current) {
        if (!isPathInsideFolder(tab.file.path, dirPath)) continue
        const session = findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path)
        if (session && hasLocalEditActivity(session)) useEditSessionStore.getState().markConflict(session.canonicalPath, 'missing')
      }
      setTabs(prev => prev.map(tab => isPathInsideFolder(tab.file.path, dirPath) &&
        !hasLocalEditActivity(findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path))
        ? { ...tab, missing: true } : tab))
      await refreshFiles()
    }))

    const unsubscribeRenamed = window.api.onFileRenamed(enqueueWatchEvent(async (event) => {
      if (!acceptsEvent(event) || typeof event === 'string') return
      const { oldPath, newPath } = event
      if (!oldPath || !newPath) return
      clearFileCache(oldPath)
      clearFileCache(newPath)
      refreshDependentTabs(oldPath)
      refreshDependentTabs(newPath)
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
    }))

    const refreshDocuments = (): Promise<void> => {
      const work = eventQueue.then(async () => {
        if (!isCurrentSubscription()) return
        await reconcileLoadedDocuments()
      })
      eventQueue = work.catch(() => reportGap(true))
      return work
    }
    watchRefreshRef.current = refreshDocuments
    const unsubscribeReconcile = window.api.onWatchReconcile?.(request => {
      if (!acceptsEvent(request)) return
      eventQueue = eventQueue.then(async () => {
        let result: WatchReconcileResult = 'superseded'
        try {
          if (!isCurrentSubscription()) return
          if (request.phase === 'refresh') {
            const capturedLoss = lossVersion
            queueFailed = false
            await refreshFiles()
            if (!isCurrentSubscription()) return
            await reconcileLoadedDocuments()
            if (!isCurrentSubscription()) return
            snapshotLossVersion = capturedLoss
          }
          result = queueFailed ? 'failed' : snapshotLossVersion === lossVersion ? 'ok' : 'superseded'
          if (request.phase === 'drain' && result === 'ok') gapReported = false
        } catch { result = 'failed'; queueFailed = true }
        finally { await window.api.acknowledgeWatchReconcile(request.requestId, result) }
      }).catch(() => { queueFailed = true })
    })

    return () => {
      if (watchRefreshRef.current === refreshDocuments) watchRefreshRef.current = null
      unsubscribeReconcile?.()
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
    setActiveTabId(currentTabs[nextIndex].id, { source: 'next-tab' })
  }, [activeTabId])

  const handlePrevTab = useCallback(() => {
    const currentTabs = tabsRef.current
    if (currentTabs.length === 0) return
    const currentIndex = currentTabs.findIndex(tab => tab.id === activeTabId)
    const prevIndex = (currentIndex - 1 + currentTabs.length) % currentTabs.length
    setActiveTabId(currentTabs[prevIndex].id, { source: 'previous-tab' })
  }, [activeTabId])

  const handleSwitchTab = useCallback((tabIndex: number) => {
    const currentTabs = tabsRef.current
    if (tabIndex < 0 || tabIndex >= currentTabs.length) return
    setActiveTabId(currentTabs[tabIndex].id, { source: 'switch-tab' })
  }, [])

  const handleFocusSearch = useCallback(() => {
    searchBarRef.current?.focus()
  }, [])

  // v1.5.1：页内搜索快捷键
  useEffect(() => {
    if (!window.api.onOpenInPageSearch) return
    const unsubscribe = window.api.onOpenInPageSearch(() => {
      if (!handleAttachmentShortcut('search')) window.dispatchEvent(new CustomEvent('open-in-page-search'))
    })
    return unsubscribe
  }, [activeTabId, folderPath, handleAttachmentShortcut])

  // v1.5.1：分屏操作处理函数
  const handleSplitPanel = useCallback((leafId: string, direction: 'horizontal' | 'vertical', tabId: string) => {
    setSplitState(prev => {
      if (!prev.root) return prev
      if (getTreeDepth(prev.root) >= MAX_SPLIT_DEPTH) return prev
      const { root: newRoot, newLeafId } = splitLeaf(prev.root, leafId, direction, tabId)
      setActiveTabId(tabId, { source: 'panel-split' })
      return { root: newRoot, activeLeafId: newLeafId }
    }, { source: 'panel-split' })
  }, [setActiveTabId])

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
    }, { source: 'panel-close' })
  }, [confirmCloseDirtyTab])

  const handleResizePanel = useCallback((splitId: string, ratio: number) => {
    setSplitState(prev => {
      if (!prev.root) return prev
      return { ...prev, root: updateRatio(prev.root, splitId, ratio) }
    }, { source: 'panel-resize' })
  }, [])

  const handleSetActiveLeaf = useCallback((leafId: string, cause: PaneDiagnosticCause = { source: 'unspecified' }) => {
    setSplitState(prev => {
      const leaf = prev.root ? findLeaf(prev.root, leafId) : null
      if (!leaf) return prev
      setActiveTabId(leaf.tabId, cause)
      return { ...prev, activeLeafId: leafId }
    }, cause)
  }, [setActiveTabId])

  const handleDropTab = useCallback((leafId: string, tabId: string, position: 'center' | 'left' | 'right' | 'top' | 'bottom') => {
    setSplitState(prev => {
      if (!prev.root) return prev
      if (position === 'center') {
        const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
        const tab = useTabStore.getState().tabs.find(item => item.id === tabId)
        const panels = workspaceId ? linkWorkspacesRef.current.get(workspaceId)?.panels : undefined
        if (tab && panels) panels.set(leafId, createRootNavigation({ tabId, filePath: tab.file.path }))
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
    }, { source: 'panel-drop' })
  }, [])

  const handleSwapPanels = useCallback((leafIdA: string, leafIdB: string) => {
    setSplitState(prev => {
      if (!prev.root) return prev
      return { ...prev, root: swapLeaves(prev.root, leafIdA, leafIdB) }
    }, { source: 'panel-swap' })
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
    handleAttachmentShortcut,
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
      {attachmentRequest && <LocalAttachmentDialog key={attachmentRequest.id} ref={attachmentDialogRef}
        readRequest={attachmentRequest.readRequest} isCurrent={attachmentRequest.isCurrent} onClose={closeAttachment} />}
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
                workspaceId={activeWorkspaceId}
                lifecycleEpoch={activeWorkspaceEpoch}
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
                    highlightKeyword={highlightKeyword}
                    onHighlightKeywordComplete={() => setHighlightKeyword(undefined)}
                    scrollToRatio={scrollToRatio}
                    onScrollToRatioComplete={() => setScrollToRatio(undefined)}
                    getRestoredLeafViewState={getRestoredSplitLeafViewState}
                    onRestoredLeafViewStateComplete={clearRestoredSplitLeafViewState}
                    onReadPositionChange={handleSplitReadPositionChange}
                    onMarkdownLinkClick={handleMarkdownLinkClick}
                    onAttachmentLinkClick={handleAttachmentLinkClick}
                    getLinkOrigin={getLinkOrigin}
                    getLinkPositionRequest={getLinkPositionRequest}
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
                        scrollToLine={scrollToLine}
                        onScrollToLineComplete={() => setScrollToLine(undefined)}
                        highlightKeyword={highlightKeyword}
                        onHighlightKeywordComplete={() => setHighlightKeyword(undefined)}
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
                        onMarkdownLinkClick={handleMarkdownLinkClick}
                        onAttachmentLinkClick={handleAttachmentLinkClick}
                        linkOrigin={getLinkOrigin(SINGLE_LEAF_ID)}
                        linkPositionRequest={getLinkPositionRequest(SINGLE_LEAF_ID)}
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
                                  key={`${activeTab.file.path}:${activeTab.resourceRevision ?? 0}`}
                                  content={activePreviewContent}
                                  filePath={activeTab.file.path}
                                  tabId={activeTab.id}
                                  initialScrollRatio={activeTab.initialScrollRatio}
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
                                  onAttachmentLinkClick={handleAttachmentLinkClick}
                                  linkPositionRequest={getLinkPositionRequest(SINGLE_LEAF_ID)}
                                  diagnosticOperation={activeTab.diagnosticOperation}
                                  diagnosticPanelKind="main"
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
                                linkOrigin={getLinkOrigin(SINGLE_LEAF_ID)}
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
