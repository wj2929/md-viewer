import React, { useEffect, useCallback, useMemo, useRef } from 'react'
import { FileTree, FileInfo, VirtualizedMarkdown, TabBar, Tab, SearchBar, SearchBarHandle, ErrorBoundary, ToastContainer, ThemeToggle, FolderHistoryDropdown, RecentFilesDropdown, SettingsPanel, FloatingNav, BookmarkPanel, Bookmark, BookmarkBar, Header, NavigationBar, ShortcutsHelpDialog, ImageLightbox, LightboxState, SplitPanel } from './components'
import { SplitState, PanelNode, createLeaf, splitLeaf, closeLeaf, updateRatio, updateLeafTab, findLeaf, getAllLeaves, findLeafByTabId, getTreeDepth, MAX_SPLIT_DEPTH, swapLeaves } from './utils/splitTree'
import { readFileWithCache, clearFileCache } from './utils/fileCache'
import { useToast } from './hooks/useToast'
import { useTheme } from './hooks/useTheme'
import { useDragDrop } from './hooks/useDragDrop'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useIPC } from './hooks/useIPC'
import { useExport } from './hooks/useExport'
import { useClipboardStore, useWindowStore, useUIStore, useFileStore, useTabStore, useBookmarkStore, useLayoutStore } from './stores'

function App(): React.JSX.Element {
  // v1.6.0: Zustand stores
  const { folderPath, setFolderPath, files, setFiles, isLoading, setIsLoading, selectedPaths, setSelectedPaths } = useFileStore()
  const { tabs, setTabs, activeTabId, setActiveTabId, splitState, setSplitState, scrollToLine, setScrollToLine, highlightKeyword, setHighlightKeyword } = useTabStore()
  const { bookmarks, bookmarksLoading, bookmarkPanelCollapsed, setBookmarkPanelCollapsed, bookmarkPanelWidth, setBookmarkPanelWidth, bookmarkBarCollapsed, setBookmarkBarCollapsed, loadBookmarks, loadSettings: loadBookmarkSettings } = useBookmarkStore()
  const { sidebarWidth, setSidebarWidth, isResizing, setIsResizing, showSettings, setShowSettings, showShortcutsHelp, setShowShortcutsHelp, isFullscreen, isDragOver, lightbox, setLightbox } = useLayoutStore()

  const toast = useToast()
  const { theme, setTheme } = useTheme()
  const { isAlwaysOnTop, toggleAlwaysOnTop, initialize: initWindowStore, syncFromMain: syncAlwaysOnTop } = useWindowStore()
  const { applyCSSVariable } = useUIStore()

  // Refs
  const tabsRef = useRef<Tab[]>([])
  tabsRef.current = tabs
  const splitStateRef = useRef<SplitState>(splitState)
  splitStateRef.current = splitState
  const searchBarRef = useRef<SearchBarHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // v1.6.0: 提取的 hooks
  useDragDrop()
  useKeyboardShortcuts()
  const { handleExportHTML, handleExportPDF, handleExportDOCX } = useExport({ splitState, tabs, activeTabId, folderPath, toast })

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
              const content = await readFileWithCache(pinned.path)
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
          const content = await readFileWithCache(pinned.path)
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
              const content = await readFileWithCache(pinned.path)
              const name = pinned.path.split(/[/\\]/).pop() || ''
              restoredTabs.push({
                id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                file: { name, path: pinned.path, isDirectory: false },
                content,
                isPinned: true
              })
            } catch { /* 忽略无法读取的文件 */ }
          }
          const content = await readFileWithCache(filePath)
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
        setActiveTabId(existingTab.id)
        return
      }
      try {
        const content = await readFileWithCache(filePath)
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
  }, [folderPath, toast])

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

  // 关闭标签
  const handleTabClose = useCallback((tabId: string) => {
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
  }, [])

  // 选择文件
  const handleFileSelect = useCallback(async (file: FileInfo, lineNumber?: number, keyword?: string) => {
    if (file.isDirectory) return
    setScrollToLine(lineNumber)
    setHighlightKeyword(keyword)
    const existingTab = tabsRef.current.find(tab => tab.file.path === file.path)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }
    try {
      const content = await readFileWithCache(file.path)
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
  }, [toast])

  // 打开外部文件（跨文件夹搜索结果）：直接打开到 tab，不切换文件夹
  const handleExternalFileOpen = useCallback(async (filePath: string) => {
    const fileName = filePath.split(/[/\\]/).pop() || filePath
    const existingTab = tabsRef.current.find(tab => tab.file.path === filePath)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }
    try {
      const content = await window.api.searchReadFile(filePath)
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
  }, [toast])

  // 切换标签
  const handleTabClick = useCallback((tabId: string) => { setActiveTabId(tabId) }, [])

  // 获取当前活动标签
  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeTabId), [tabs, activeTabId])

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
            const content = await readFileWithCache(bookmark.filePath)
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
        const content = await readFileWithCache(bookmark.filePath)
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
      setActiveTabId(existingTab.id)
      setTimeout(() => navigateToBookmarkPosition(bookmark), 100)
    }
  }, [toast, folderPath])

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
      const currentTabs = tabsRef.current
      const affectedTab = currentTabs.find(tab => tab.file.path === addedPath)
      if (affectedTab) {
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
      setTabs(prev => prev.filter(tab => tab.file.path !== removedPath))
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
      const currentTabs = tabsRef.current
      const affectedTab = currentTabs.find(tab => tab.file.path === oldPath)
      if (affectedTab) {
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
  }, [])

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
                    scrollToLine={scrollToLine}
                    onScrollToLineComplete={() => setScrollToLine(undefined)}
                  />
                ) : (
                  <div className="preview-container">
                    <div className="preview" ref={previewRef}>
                      {activeTab ? (
                        <VirtualizedMarkdown
                          key={activeTab.file.path}
                          content={activeTab.content}
                          filePath={activeTab.file.path}
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
                    {activeTab && (
                      <FloatingNav
                        containerRef={previewRef}
                        markdown={activeTab.content}
                      />
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
