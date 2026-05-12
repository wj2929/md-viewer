import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { FileTree, FileInfo, VirtualizedMarkdown, TabBar, Tab, SearchBar, SearchBarHandle, ErrorBoundary, ToastContainer, ThemeToggle, FolderHistoryDropdown, RecentFilesDropdown, SettingsPanel, FloatingNav, BookmarkPanel, Bookmark, BookmarkBar, Header, NavigationBar, ShortcutsHelpDialog, ImageLightbox, LightboxState, SplitPanel, ExportTaskView, QuickEditDrawer, MarkdownEditWorkbench } from './components'
import { SplitState, PanelNode, createLeaf, splitLeaf, closeLeaf, updateRatio, updateLeafTab, findLeaf, getAllLeaves, findLeafByTabId, getTreeDepth, MAX_SPLIT_DEPTH, swapLeaves } from './utils/splitTree'
import { readPreviewContentWithCache, clearFileCache } from './utils/fileCache'
import { buildPreviewContentForFile, isMarkdownFile } from './utils/previewableFiles'
import { useToast } from './hooks/useToast'
import { useTheme } from './hooks/useTheme'
import { useDragDrop } from './hooks/useDragDrop'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useIPC } from './hooks/useIPC'
import { useExport } from './hooks/useExport'
import { useClipboardStore, useWindowStore, useUIStore, useFileStore, useTabStore, useBookmarkStore, useLayoutStore, useEditSessionStore, useQuickEditPlacementStore, useDocumentViewModeStore } from './stores'
import type { DocumentViewMode, EditConflictReason, EditSession } from './stores'
import { useExportTaskStore } from './stores/exportTaskStore'
import type { QuickEditTarget } from './utils/quickEditTarget'

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

function App(): React.JSX.Element {
  // v1.6.0: Zustand stores
  const { folderPath, setFolderPath, files, setFiles, isLoading, setIsLoading, selectedPaths, setSelectedPaths } = useFileStore()
  const { tabs, setTabs, activeTabId, setActiveTabId, splitState, setSplitState, scrollToLine, setScrollToLine, highlightKeyword, setHighlightKeyword } = useTabStore()
  const { bookmarks, bookmarksLoading, bookmarkPanelCollapsed, setBookmarkPanelCollapsed, bookmarkPanelWidth, setBookmarkPanelWidth, bookmarkBarCollapsed, setBookmarkBarCollapsed, loadBookmarks, loadSettings: loadBookmarkSettings } = useBookmarkStore()
  const { sidebarWidth, setSidebarWidth, isResizing, setIsResizing, showSettings, setShowSettings, showShortcutsHelp, setShowShortcutsHelp, isFullscreen, isDragOver, lightbox, setLightbox } = useLayoutStore()
  const editSessions = useEditSessionStore(state => state.sessions)
  const openEditSession = useEditSessionStore(state => state.openSession)
  const markEditSessionSaved = useEditSessionStore(state => state.markSaved)
  const markEditSessionConflict = useEditSessionStore(state => state.markConflict)
  const replaceEditSessionFromDisk = useEditSessionStore(state => state.replaceFromDisk)
  const quickEditPlacements = useQuickEditPlacementStore(state => state.placements)
  const closeQuickEditPlacement = useQuickEditPlacementStore(state => state.closePlacement)
  const getDocumentViewState = useDocumentViewModeStore(state => state.getViewState)
  const setDocumentViewMode = useDocumentViewModeStore(state => state.setMode)
  const setDocumentViewTarget = useDocumentViewModeStore(state => state.setTarget)
  const setDocumentCompareRatio = useDocumentViewModeStore(state => state.setCompareRatio)

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
  const searchBarRef = useRef<SearchBarHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [previewElement, setPreviewElement] = useState<HTMLDivElement | null>(null)
  const setPreviewNode = useCallback((element: HTMLDivElement | null) => {
    previewRef.current = element
    setPreviewElement(element)
  }, [])

  // v1.6.0: 提取的 hooks
  useDragDrop()
  useKeyboardShortcuts()

  // v1.3.6：加载书签设置
  useEffect(() => { loadBookmarkSettings() }, [])


  // v1.4.2：初始化 Zustand stores
  useEffect(() => {
    const platform = window.api?.platform || 'darwin'
    document.body.setAttribute('data-platform', platform)
    initWindowStore()
    applyCSSVariable()
    const cleanupAlwaysOnTop = window.api.onAlwaysOnTopChanged(syncAlwaysOnTop)
    return () => { cleanupAlwaysOnTop() }
  }, [initWindowStore, applyCSSVariable, syncAlwaysOnTop])

  // 初始加载书签
  useEffect(() => { loadBookmarks() }, [loadBookmarks])

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
    const cleanup = window.api.onRestoreFolder(async (restoredFolderPath) => {
      setFolderPath(restoredFolderPath)
      try {
        const pinnedTabs = await window.api.getPinnedTabsForFolder(restoredFolderPath)
        if (pinnedTabs.length > 0) {
          const newTabs: Tab[] = []
          for (const pinned of pinnedTabs) {
            try {
              const content = await readPreviewContentWithCache(pinned.path)
              const fileName = pinned.path.split(/[/\\]/).pop() || ''
              newTabs.push({
                id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                file: { name: fileName, path: pinned.path, isDirectory: false },
                content,
                isPinned: true
              })
            } catch { /* 忽略 */ }
          }
          if (newTabs.length > 0) {
            setTabs(prev => [...prev, ...newTabs])
            setActiveTabId(newTabs[0].id)
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
      const newTabs: Tab[] = []
      for (const pinned of pinnedTabs) {
        try {
          const content = await readPreviewContentWithCache(pinned.path)
          const fileName = pinned.path.split(/[/\\]/).pop() || ''
          newTabs.push({
            id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file: { name: fileName, path: pinned.path, isDirectory: false },
            content,
            isPinned: true
          })
        } catch (err) {
          console.warn('[App] Failed to restore pinned tab:', pinned.path, err)
        }
      }
      if (newTabs.length > 0) {
        setTabs(prev => [...prev, ...newTabs])
        setActiveTabId(newTabs[0].id)
      }
    } catch (error) {
      console.error('[App] Failed to restore pinned tabs:', error)
    }
  }, [])

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

  // 打开文件夹
  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await window.api.openFolder()
      if (path) {
        setFolderPath(path)
        const splitTabIds = new Set(
          splitStateRef.current.root
            ? getAllLeaves(splitStateRef.current.root).map(l => l.tabId).filter(Boolean)
            : []
        )
        setTabs(prev => prev.filter(t => splitTabIds.has(t.id)))
        setActiveTabId(null)
        await restorePinnedTabs(path)
      }
    } catch (error) {
      console.error('Failed to open folder:', error)
    }
  }, [restorePinnedTabs])

  // 从历史选择文件夹
  const handleSelectHistoryFolder = useCallback(async (path: string) => {
    await window.api.setFolderPath(path)
    setFolderPath(path)
    const splitTabIds = new Set(
      splitStateRef.current.root
        ? getAllLeaves(splitStateRef.current.root).map(l => l.tabId).filter(Boolean)
        : []
    )
    setTabs(prev => prev.filter(t => splitTabIds.has(t.id)))
    setActiveTabId(null)
    await restorePinnedTabs(path)
  }, [restorePinnedTabs])

  // v1.3.6：从最近文件选择
  const handleSelectRecentFile = useCallback(async (filePath: string) => {
    const sepIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    const fileName = sepIndex >= 0 ? filePath.slice(sepIndex + 1) : filePath
    const fileFolder = sepIndex >= 0 ? filePath.slice(0, sepIndex) : ''

    if (!folderPath || !filePath.startsWith(folderPath)) {
      await window.api.setFolderPath(fileFolder)
      setFolderPath(fileFolder)
      const splitTabIds = new Set(
        splitStateRef.current.root
          ? getAllLeaves(splitStateRef.current.root).map(l => l.tabId).filter(Boolean)
          : []
      )
      setTabs(prev => prev.filter(t => splitTabIds.has(t.id)))
      setActiveTabId(null)

      setTimeout(async () => {
        try {
          const pinnedTabs = await window.api.getPinnedTabsForFolder(fileFolder)
          const restoredTabs: Tab[] = []
          for (const pinned of pinnedTabs) {
            if (pinned.path === filePath) continue
            try {
              const content = await readPreviewContentWithCache(pinned.path)
              const name = pinned.path.split(/[/\\]/).pop() || ''
              restoredTabs.push({
                id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                file: { name, path: pinned.path, isDirectory: false },
                content,
                isPinned: true
              })
            } catch { /* 忽略无法读取的文件 */ }
          }
          const content = await readPreviewContentWithCache(filePath)
          const isPinned = pinnedTabs.some(t => t.path === filePath)
          const newTab: Tab = {
            id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file: { name: fileName, path: filePath, isDirectory: false },
            content,
            isPinned
          }
          setTabs(prev => [...prev, ...restoredTabs, newTab])
          setActiveTabId(newTab.id)
          window.api.addRecentFile({ path: filePath, name: fileName, folderPath: fileFolder }).catch(err => console.error('Failed to add to recent files:', err))
        } catch (error) {
          toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
        }
      }, 500)
    } else {
      const existingTab = tabsRef.current.find(tab => tab.file.path === filePath)
      if (existingTab) {
        await refreshExistingTabContent(existingTab, () => readPreviewContentWithCache(filePath))
        return
      }
      try {
        const content = await readPreviewContentWithCache(filePath)
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file: { name: fileName, path: filePath, isDirectory: false },
          content
        }
        setTabs(prev => [...prev, newTab])
        setActiveTabId(newTab.id)
        window.api.addRecentFile({ path: filePath, name: fileName, folderPath: folderPath }).catch(err => console.error('Failed to add to recent files:', err))
      } catch (error) {
        toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
      }
    }
  }, [folderPath, refreshExistingTabContent, toast])

  // 加载文件列表
  useEffect(() => {
    if (!folderPath) return
    const loadFiles = async () => {
      setIsLoading(true)
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to load files:', error)
        setFiles([])
      } finally {
        setIsLoading(false)
      }
    }
    loadFiles()
  }, [folderPath])

  // 手动刷新文件树
  const handleRefreshFiles = useCallback(async () => {
    const currentFolderPath = useFileStore.getState().folderPath
    if (!currentFolderPath) return
    setIsLoading(true)
    try {
      const fileList = await window.api.readDir(currentFolderPath)
      setFiles(fileList)
    } catch (error) {
      console.error('Failed to refresh files:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 文件重命名处理
  const handleFileRenamed = useCallback(async (oldPath: string, newName: string) => {
    try {
      const newPath = await window.api.renameFile(oldPath, newName)
      if (!newPath) throw new Error('重命名失败')
      setTabs(prev => prev.map(tab =>
        tab.file.path === oldPath
          ? { ...tab, file: { ...tab.file, name: newName, path: newPath } }
          : tab
      ))
      await handleRefreshFiles()
    } catch (error) {
      console.error('Failed to rename file:', error)
      toast.error(`重命名失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [handleRefreshFiles, toast])

  const confirmCloseDirtyTab = useCallback((tab: Tab): boolean => {
    const session = findEditSessionForPath(useEditSessionStore.getState().sessions, tab.file.path)
    if (!session?.dirty) return true
    return window.confirm(`"${tab.file.name}" 有未保存编辑草稿，关闭会保留内存草稿但不会写入磁盘。是否继续关闭标签？`)
  }, [])

  // 关闭标签
  const handleTabClose = useCallback((tabId: string) => {
    const closingTab = tabsRef.current.find(tab => tab.id === tabId)
    if (closingTab && !confirmCloseDirtyTab(closingTab)) return

    setTabs(prev => {
      const closingTab = prev.find(tab => tab.id === tabId)
      if (closingTab) clearFileCache(closingTab.file.path)
      const newTabs = prev.filter(tab => tab.id !== tabId)
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
    setScrollToLine(lineNumber)
    setHighlightKeyword(keyword)
    const existingTab = tabsRef.current.find(tab => tab.file.path === file.path)
    if (existingTab) {
      await refreshExistingTabContent(existingTab, () => readPreviewContentWithCache(file.path))
      return
    }
    try {
      const content = await readPreviewContentWithCache(file.path)
      const isPinned = await window.api.isTabPinned(file.path)
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
        window.api.addRecentFile({ path: file.path, name: file.name, folderPath: currentFolderPath }).catch(err => console.error('Failed to add to recent files:', err))
      }
      window.api.watchFile(file.path).catch(err => console.error('Failed to watch file:', err))
    } catch (error) {
      console.error('Failed to read file:', error)
      toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [refreshExistingTabContent, toast])

  // 打开外部文件（跨文件夹搜索结果）：直接打开到 tab，不切换文件夹
  const handleExternalFileOpen = useCallback(async (filePath: string) => {
    const fileName = filePath.split(/[/\\]/).pop() || filePath
    const existingTab = tabsRef.current.find(tab => tab.file.path === filePath)
    if (existingTab) {
      await refreshExistingTabContent(existingTab, async () =>
        buildPreviewContentForFile(filePath, await window.api.searchReadFile(filePath))
      )
      return
    }
    try {
      const content = buildPreviewContentForFile(filePath, await window.api.searchReadFile(filePath))
      const newTab: Tab = {
        id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file: { name: fileName, path: filePath, isDirectory: false },
        content,
        isPinned: false
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newTab.id)
      const fileFolder = filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')))
      window.api.addRecentFile({ path: filePath, name: fileName, folderPath: fileFolder }).catch(() => {})
    } catch (error) {
      toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [refreshExistingTabContent, toast])

  // 切换标签
  const handleTabClick = useCallback((tabId: string) => { setActiveTabId(tabId) }, [])

  // 获取当前活动标签
  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeTabId), [tabs, activeTabId])
  const activeViewState = activeTab ? getDocumentViewState(SINGLE_LEAF_ID, activeTab.id) : null
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
  const activePreviewContent = activeTab ? activeQuickEditSession?.draft ?? activeTab.content : ''
  const isActiveDraftPreview = Boolean(activeQuickEditSession?.dirty)

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
      const result = await window.api.openEditableMarkdown(tab.file.path)
      openEditSession(result)
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
    const result = await window.api.saveEditableMarkdown({
      canonicalPath,
      content,
      expectedRevisionToken,
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

    const session = useEditSessionStore.getState().sessions[canonicalPath]
    markEditSessionSaved(canonicalPath, content, result.revisionToken ?? expectedRevisionToken, draftVersion)
    if (session) {
      clearFileCache(session.displayPath)
      clearFileCache(session.canonicalPath)
      updateTabsForEditSession(session, content)
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
      const result = await window.api.openEditableMarkdown(session.displayPath)
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
    const bookmarkDir = bookmark.filePath.substring(0, bookmark.filePath.lastIndexOf('/'))
    const needSwitchFolder = folderPath && !bookmark.filePath.startsWith(folderPath)

    if (needSwitchFolder) {
      toast.info(`正在切换到：${bookmarkDir.split(/[/\\]/).pop()}`)
      try {
        await window.api.setFolderPath(bookmarkDir)
        const newFiles = await window.api.readDir(bookmarkDir)
        setFolderPath(bookmarkDir)
        setFiles(newFiles)
        const splitTabIds = new Set(
          splitStateRef.current.root
            ? getAllLeaves(splitStateRef.current.root).map(l => l.tabId).filter(Boolean)
            : []
        )
        setTabs(prev => prev.filter(t => splitTabIds.has(t.id)))
        setActiveTabId(null)

        setTimeout(async () => {
          try {
            const content = await readPreviewContentWithCache(bookmark.filePath)
            const newTab: Tab = {
              id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              file: { name: bookmark.fileName, path: bookmark.filePath, isDirectory: false },
              content
            }
            setTabs(prev => [...prev, newTab])
            setActiveTabId(newTab.id)
            setTimeout(() => navigateToBookmarkPosition(bookmark), 300)
          } catch (error) {
            toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
          }
        }, 100)
        return
      } catch (error) {
        toast.error(`切换文件夹失败：${error instanceof Error ? error.message : '未知错误'}`)
        return
      }
    }

    const existingTab = tabsRef.current.find(tab => tab.file.path === bookmark.filePath)
    if (!existingTab) {
      try {
        const content = await readPreviewContentWithCache(bookmark.filePath)
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file: { name: bookmark.fileName, path: bookmark.filePath, isDirectory: false },
          content
        }
        setTabs(prev => [...prev, newTab])
        setActiveTabId(newTab.id)
        setTimeout(() => navigateToBookmarkPosition(bookmark), 300)
      } catch (error) {
        toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
      }
    } else {
      await refreshExistingTabContent(existingTab, () => readPreviewContentWithCache(bookmark.filePath), '无法刷新文件')
      setTimeout(() => navigateToBookmarkPosition(bookmark), 100)
    }
  }, [folderPath, refreshExistingTabContent, toast])

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
    if (!folderPath) return

    window.api.watchFolder(folderPath).catch(error => {
      console.error('Failed to watch folder:', error)
    })

    const unsubscribeChanged = window.api.onFileChanged(async (changedPath: string) => {
      clearFileCache(changedPath)
      const editSession = findEditSessionForPath(useEditSessionStore.getState().sessions, changedPath)
      if (editSession?.dirty) {
        useEditSessionStore.getState().markConflict(editSession.canonicalPath, 'external_changed')
        return
      }
      if (editSession) {
        try {
          const result = await window.api.openEditableMarkdown(editSession.displayPath)
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
      if (affectedTab) {
        try {
          const newContent = await window.api.readFile(changedPath)
          setTabs(prev => prev.map(tab =>
            tab.file.path === changedPath ? { ...tab, content: newContent } : tab
          ))
        } catch (error) {
          console.error('Failed to reload file:', error)
        }
      }
    })

    const unsubscribeAdded = window.api.onFileAdded(async (addedPath: string) => {
      // 如果新增文件匹配已打开的 tab，重新读取内容（覆盖原子写入超时场景）
      clearFileCache(addedPath)
      const editSession = findEditSessionForPath(useEditSessionStore.getState().sessions, addedPath)
      if (editSession?.dirty) {
        useEditSessionStore.getState().markConflict(editSession.canonicalPath, 'external_changed')
      }
      const currentTabs = tabsRef.current
      const affectedTab = currentTabs.find(tab => tab.file.path === addedPath)
      if (editSession && !editSession.dirty) {
        try {
          const result = await window.api.openEditableMarkdown(editSession.displayPath)
          replaceEditSessionFromDisk(editSession.canonicalPath, result.content, result.revisionToken)
          setTabs(prev => prev.map(tab =>
            tab.file.path === editSession.displayPath || tab.file.path === editSession.canonicalPath
              ? { ...tab, content: result.content }
              : tab
          ))
        } catch (error) {
          console.error('Failed to reload clean edit session after add:', error)
        }
      } else if (affectedTab && !editSession?.dirty) {
        try {
          const newContent = await window.api.readFile(addedPath)
          setTabs(prev => prev.map(tab =>
            tab.file.path === addedPath ? { ...tab, content: newContent } : tab
          ))
        } catch (error) {
          console.error('Failed to reload added file:', error)
        }
      }
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    const unsubscribeRemoved = window.api.onFileRemoved(async (removedPath: string) => {
      const dirtySession = findEditSessionForPath(useEditSessionStore.getState().sessions, removedPath)
      if (dirtySession?.dirty) {
        useEditSessionStore.getState().markConflict(dirtySession.canonicalPath, 'missing')
      } else {
        setTabs(prev => prev.filter(tab => tab.file.path !== removedPath))
      }
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    const unsubscribeFolderAdded = window.api.onFolderAdded(async () => {
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    const unsubscribeFolderRemoved = window.api.onFolderRemoved(async (dirPath: string) => {
      setTabs(prev => prev.filter(tab => !tab.file.path.startsWith(dirPath + '/')))
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    const unsubscribeRenamed = window.api.onFileRenamed(async ({ oldPath, newPath }) => {
      clearFileCache(newPath)
      const dirtySession = findEditSessionForPath(useEditSessionStore.getState().sessions, oldPath)
      if (dirtySession?.dirty) {
        useEditSessionStore.getState().markConflict(dirtySession.canonicalPath, 'renamed')
      }
      const currentTabs = tabsRef.current
      const affectedTab = currentTabs.find(tab => tab.file.path === oldPath)
      if (affectedTab && !dirtySession?.dirty) {
        try {
          const newContent = await window.api.readFile(newPath)
          setTabs(prev => prev.map(tab => {
            if (tab.file.path === oldPath) {
              return { ...tab, content: newContent, file: { ...tab.file, path: newPath, name: newPath.split(/[/\\]/).pop() || tab.file.name } }
            }
            return tab
          }))
        } catch (error) {
          console.error('Failed to reload renamed file:', error)
          // 回退：至少更新路径
          setTabs(prev => prev.map(tab => {
            if (tab.file.path === oldPath) {
              return { ...tab, file: { ...tab.file, path: newPath, name: newPath.split(/[/\\]/).pop() || tab.file.name } }
            }
            return tab
          }))
        }
      }
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    return () => {
      window.api.unwatchFolder().catch(error => { console.error('Failed to unwatch folder:', error) })
      unsubscribeChanged()
      unsubscribeAdded()
      unsubscribeRemoved()
      unsubscribeFolderAdded()
      unsubscribeFolderRemoved()
      unsubscribeRenamed()
    }
  }, [folderPath])


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
    setSplitState(prev => ({ ...prev, activeLeafId: leafId }))
  }, [])

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
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 180), 500)
      setSidebarWidth(newWidth)
    }
    const handleMouseUp = () => { setIsResizing(false) }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

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
    previewRef
  })

  return (
    <ErrorBoundary>
      <div className={`app ${isFullscreen ? 'fullscreen' : ''}`}>
      <ToastContainer messages={toast.messages} onClose={toast.close} />
      <ExportTaskView
        onShowInFolder={async (p) => { try { await window.api.showItemInFolder(p) } catch {} }}
        onOpenSettings={() => setShowSettings(true)}
      />

      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <div className="drag-overlay-icon">📂</div>
            <div className="drag-overlay-text">释放以打开文件</div>
          </div>
        </div>
      )}

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <ShortcutsHelpDialog
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />

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
                onSettingsClick={() => setShowSettings(true)}
                onThemeChange={setTheme}
                onRefreshFiles={handleRefreshFiles}
                isLoading={isLoading}
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
                onSettingsClick={() => setShowSettings(true)}
                onThemeChange={setTheme}
                onRefreshFiles={handleRefreshFiles}
                isLoading={isLoading}
                lastExportedFilePath={lastExportedFilePath}
                lastExportedTime={lastExportedTime}
                onOpenLastExport={handleOpenLastExport}
              />
              {tabs.length > 0 && (
                <TabBar
                  tabs={tabs}
                  activeTabId={activeTabId}
                  onTabClick={handleTabClick}
                  onTabClose={handleTabClose}
                  basePath={folderPath || undefined}
                  bookmarkBarCollapsed={bookmarkBarCollapsed}
                  bookmarkCount={bookmarks.length}
                  onShowBookmarkBar={handleShowBookmarkBar}
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
              <aside className="sidebar" style={{ width: sidebarWidth }}>
                <div className="file-tree-container">
                  {isLoading ? (
                    <p className="placeholder">加载中...</p>
                  ) : (
                    <FileTree
                      files={files}
                      onFileSelect={handleFileSelect}
                      selectedPath={activeTab?.file.path}
                      basePath={folderPath}
                      onFileRenamed={handleFileRenamed}
                      selectedPaths={selectedPaths}
                      onSelectionChange={setSelectedPaths}
                    />
                  )}
                </div>
              </aside>

              <div className="resize-handle" onMouseDown={handleResizeStart} />

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
                    onOpenMarkdownEdit={handleOpenMarkdownEdit}
                    getQuickEditCanonicalPath={getQuickEditCanonicalPath}
                    getQuickEditTarget={getQuickEditTarget}
                    onSaveQuickEdit={handleSaveQuickEdit}
                    onCloseQuickEdit={handleCloseQuickEditPlacement}
                    onReloadQuickEdit={handleReloadQuickEdit}
                    onCopyDraft={handleCopyQuickEditDraft}
                    scrollToLine={scrollToLine}
                    onScrollToLineComplete={() => setScrollToLine(undefined)}
                  />
                ) : (
                  <div className={`preview-container ${activeQuickEditCanonicalPath && activeViewState?.mode === 'preview' ? 'with-quick-edit' : ''}`}>
                    {activeTab && activeViewState && activeViewState.mode !== 'preview' && activeQuickEditSession ? (
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
                        onLocateComplete={(located) => {
                          if (located) toast.success('已定位到源码附近')
                          else toast.info('未能精确定位，已打开编辑器')
                          setDocumentViewTarget(SINGLE_LEAF_ID, activeTab.id, null)
                        }}
                      />
                    ) : (
                      <>
                        <div className="document-preview-toolbar">
                          {activeTab && isMarkdownFile(activeTab.file.path) && (
                            <button type="button" onClick={() => handleOpenMarkdownEdit(activeTab)} aria-label="编辑文档">
                              编辑文档
                            </button>
                          )}
                        </div>
                        <div className="preview-body">
                          <div className="preview-pane">
                            {isActiveDraftPreview && (
                              <div className="quick-edit-preview-banner" role="status">草稿预览，未保存</div>
                            )}
                            <div className="preview" ref={setPreviewNode}>
                              {activeTab ? (
                                <VirtualizedMarkdown
                                  key={activeTab.file.path}
                                  content={activePreviewContent}
                                  filePath={activeTab.file.path}
                                  tabId={activeTab.id}
                                  renderDebounceMs={getDraftPreviewDebounceMs(activePreviewContent, Boolean(activeQuickEditSession))}
                                  scrollToLine={scrollToLine}
                                  onScrollToLineComplete={() => setScrollToLine(undefined)}
                                  highlightKeyword={highlightKeyword}
                                  onHighlightKeywordComplete={() => setHighlightKeyword(undefined)}
                                  onImageClick={setLightbox}
                                />
                              ) : (
                                <p className="placeholder">选择一个 Markdown 文件开始预览</p>
                              )}
                            </div>
                            {activeTab && isMarkdownFile(activeTab.file.path) && (
                              <FloatingNav
                                containerRef={previewRef}
                                markdown={activePreviewContent}
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

              <BookmarkPanel
                bookmarks={bookmarks}
                isLoading={bookmarksLoading}
                isCollapsed={bookmarkPanelCollapsed}
                width={bookmarkPanelWidth}
                onToggleCollapse={handleBookmarkPanelToggle}
                onWidthChange={handleBookmarkPanelWidthChange}
                onSelectBookmark={handleSelectBookmark}
                onBookmarksChange={loadBookmarks}
                currentFilePath={activeTab?.file.path}
              />
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
