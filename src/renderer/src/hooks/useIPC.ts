import { useEffect, useCallback, useRef } from 'react'
import { useFileStore, useTabStore, useBookmarkStore, useLayoutStore, useClipboardStore, useWindowStore, useUIStore } from '../stores'
import type { Tab } from '../components'
import { readFileWithCache, clearFileCache } from '../utils/fileCache'
import { createMarkdownRenderer } from '../utils/markdownRenderer'
import { processMermaidInHtml } from '../utils/mermaidRenderer'
import { createLeaf, splitLeaf, getTreeDepth, MAX_SPLIT_DEPTH, findLeafByTabId, PanelNode } from '../utils/splitTree'
import type { useToast } from './useToast'

type UseToastReturn = ReturnType<typeof useToast>

interface UseIPCOptions {
  toast: UseToastReturn
  handleOpenFolder: () => Promise<void>
  handleRefreshFiles: () => Promise<void>
  handleTabClose: (tabId: string) => void
  handleExportHTML: () => Promise<void>
  handleExportPDF: () => Promise<void>
  handleExportDOCX: (docStyle?: string) => Promise<void>
  handleFocusSearch: () => void
  handleNextTab: () => void
  handlePrevTab: () => void
  handleSwitchTab: (tabIndex: number) => void
  handleFileSelect: (file: { name: string; path: string; isDirectory: boolean }, lineNumber?: number, keyword?: string) => Promise<void>
  loadBookmarks: () => Promise<void>
  previewRef: React.RefObject<HTMLDivElement | null>
}

/**
 * IPC 事件监听 hook
 * 集中管理所有 window.api.on* 事件监听
 */
export function useIPC(options: UseIPCOptions): void {
  const {
    toast, handleOpenFolder, handleRefreshFiles, handleTabClose,
    handleExportHTML, handleExportPDF, handleExportDOCX,
    handleFocusSearch, handleNextTab, handlePrevTab, handleSwitchTab,
    handleFileSelect, loadBookmarks, previewRef
  } = options

  const { folderPath, setFiles, setSelectedPaths } = useFileStore()
  const { tabs, activeTabId, setTabs, setActiveTabId, setSplitState } = useTabStore()
  const { setShowShortcutsHelp } = useLayoutStore()
  const { copy, cut, paste } = useClipboardStore()
  const { toggleAlwaysOnTop } = useWindowStore()
  const { increaseFontSize, decreaseFontSize, resetFontSize } = useUIStore()

  const tabsRef = useRef<Tab[]>([])
  tabsRef.current = tabs

  const selectedPathsRef = useRef<Set<string>>(new Set())
  selectedPathsRef.current = useFileStore.getState().selectedPaths

  // v1.5.1: .md 链接跳转失败 Toast
  useEffect(() => {
    const handleMdLinkError = (e: Event) => {
      const detail = (e as CustomEvent).detail
      toast.error(`链接跳转失败：${detail?.error || '未知错误'}`)
    }
    window.addEventListener('md-link-error', handleMdLinkError)
    return () => window.removeEventListener('md-link-error', handleMdLinkError)
  }, [toast])

  // 监听右键菜单事件 (v1.2 阶段 1)
  useEffect(() => {
    const unsubscribeDeleted = window.api.onFileDeleted((filePath: string) => {
      setTabs(prev => prev.filter(tab => tab.file.path !== filePath))
      const currentFolderPath = useFileStore.getState().folderPath
      if (currentFolderPath) {
        window.api.readDir(currentFolderPath).then(setFiles).catch(console.error)
      }
    })

    const unsubscribeExport = window.api.onFileExportRequest(
      async (data: { path: string; type: 'html' | 'pdf' }) => {
        try {
          const content = await window.api.readFile(data.path)
          const md = createMarkdownRenderer()
          let htmlContent = md.render(content)
          const fileName = data.path.split(/[/\\]/).pop() || 'export'
          htmlContent = await processMermaidInHtml(htmlContent)

          if (data.type === 'html') {
            const result = await window.api.exportHTML(htmlContent, fileName)
            if (result) {
              toast.success('HTML 已导出', {
                action: {
                  label: '点击查看',
                  onClick: async () => {
                    try { await window.api.showItemInFolder(result) } catch (error) { console.error('Failed to show item:', error) }
                  }
                }
              })
            }
          } else {
            const result = await window.api.exportPDF(htmlContent, fileName)
            if (result) {
              toast.success('PDF 已导出', {
                action: {
                  label: '点击查看',
                  onClick: async () => {
                    try { await window.api.showItemInFolder(result) } catch (error) { console.error('Failed to show item:', error) }
                  }
                }
              })
            }
          }
        } catch (error) {
          console.error('导出失败:', error)
          toast.error(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
        }
      }
    )

    const unsubscribeError = window.api.onError((error: { message: string }) => {
      toast.error(error.message)
    })

    const unsubscribeCopy = window.api.onClipboardCopy((paths: string[]) => {
      const currentSelectedPaths = selectedPathsRef.current
      const pathsToCopy = currentSelectedPaths.size > 0 ? Array.from(currentSelectedPaths) : paths
      copy(pathsToCopy)
      toast.success(`已复制 ${pathsToCopy.length} 个文件`)
      setSelectedPaths(new Set())
    })

    const unsubscribeCut = window.api.onClipboardCut((paths: string[]) => {
      const currentSelectedPaths = selectedPathsRef.current
      const pathsToCut = currentSelectedPaths.size > 0 ? Array.from(currentSelectedPaths) : paths
      cut(pathsToCut)
      toast.success(`已剪切 ${pathsToCut.length} 个文件`)
      setSelectedPaths(new Set())
    })

    const unsubscribePaste = window.api.onClipboardPaste(async (targetDir: string) => {
      try {
        await paste(targetDir)
        toast.success('粘贴成功')
        const currentFolderPath = useFileStore.getState().folderPath
        if (currentFolderPath) {
          const fileList = await window.api.readDir(currentFolderPath)
          setFiles(fileList)
        }
      } catch (error) {
        console.error('粘贴失败:', error)
        toast.error(`粘贴失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    })

    return () => {
      unsubscribeDeleted()
      unsubscribeExport()
      unsubscribeError()
      unsubscribeCopy()
      unsubscribeCut()
      unsubscribePaste()
    }
  }, [toast, copy, cut, paste, setTabs, setFiles, setSelectedPaths])

  // v1.3 新增：Tab 右键菜单事件监听
  useEffect(() => {
    if (!window.api.onTabClose) return

    const unsubscribeTabClose = window.api.onTabClose((tabId: string) => {
      handleTabClose(tabId)
    })

    const unsubscribeTabCloseOthers = window.api.onTabCloseOthers((tabId: string) => {
      setTabs(prev => prev.filter(tab => tab.id === tabId || tab.isPinned))
      setActiveTabId(tabId)
    })

    const unsubscribeTabCloseAll = window.api.onTabCloseAll(() => {
      setTabs(prev => {
        const pinnedTabs = prev.filter(tab => tab.isPinned)
        if (pinnedTabs.length > 0) {
          setActiveTabId(pinnedTabs[0].id)
          return pinnedTabs
        }
        setActiveTabId(null)
        return []
      })
    })

    const unsubscribeTabCloseLeft = window.api.onTabCloseLeft((tabId: string) => {
      setTabs(prev => {
        const index = prev.findIndex(tab => tab.id === tabId)
        return index >= 0 ? prev.slice(index) : prev
      })
    })

    const unsubscribeTabCloseRight = window.api.onTabCloseRight((tabId: string) => {
      setTabs(prev => {
        const index = prev.findIndex(tab => tab.id === tabId)
        return index >= 0 ? prev.slice(0, index + 1) : prev
      })
    })

    const unsubscribeTabPin = window.api.onTabPin((tabId: string) => {
      setTabs(prev => prev.map(tab =>
        tab.id === tabId ? { ...tab, isPinned: true } : tab
      ))
      const tab = tabsRef.current.find(t => t.id === tabId)
      if (tab) {
        window.api.addPinnedTab(tab.file.path).catch(err => {
          console.error('Failed to persist pinned tab:', err)
        })
      }
    })

    const unsubscribeTabUnpin = window.api.onTabUnpin((tabId: string) => {
      setTabs(prev => prev.map(tab =>
        tab.id === tabId ? { ...tab, isPinned: false } : tab
      ))
      const tab = tabsRef.current.find(t => t.id === tabId)
      if (tab) {
        window.api.removePinnedTab(tab.file.path).catch(err => {
          console.error('Failed to remove pinned tab:', err)
        })
      }
    })

    return () => {
      unsubscribeTabClose()
      unsubscribeTabCloseOthers()
      unsubscribeTabCloseAll()
      unsubscribeTabCloseLeft()
      unsubscribeTabCloseRight()
      unsubscribeTabPin()
      unsubscribeTabUnpin()
    }
  }, [handleTabClose, setTabs, setActiveTabId])

  // v1.3.6：书签面板事件处理
  useEffect(() => {
    if (!window.api.onTabAddBookmark) return

    const unsubscribeAddBookmark = window.api.onTabAddBookmark(async ({ tabId }: { tabId: string; filePath: string }) => {
      const tab = tabsRef.current.find(t => t.id === tabId)
      if (!tab) return

      try {
        await window.api.addBookmark({
          filePath: tab.file.path,
          fileName: tab.file.name
        })
        toast.success('已添加到书签')
        loadBookmarks()
      } catch (error) {
        console.error('[App] Failed to add bookmark:', error)
        toast.error(`添加书签失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    })

    return () => { unsubscribeAddBookmark() }
  }, [toast, loadBookmarks])

  // v1.3.6：快捷键添加书签
  useEffect(() => {
    if (!window.api.onShortcutAddBookmark) return

    const unsubscribe = window.api.onShortcutAddBookmark(async () => {
      const currentActiveTabId = useTabStore.getState().activeTabId
      if (!currentActiveTabId) return

      const tab = tabsRef.current.find(t => t.id === currentActiveTabId)
      if (!tab) return

      try {
        await window.api.addBookmark({
          filePath: tab.file.path,
          fileName: tab.file.name
        })
        toast.success('已添加到书签')
        loadBookmarks()
      } catch (error) {
        console.error('[App] Failed to add bookmark:', error)
        toast.error(`添加书签失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    })

    return unsubscribe
  }, [toast, loadBookmarks])

  // v1.3.7：文件树右键添加书签
  useEffect(() => {
    if (!window.api.onAddBookmarkFromFileTree) return

    const unsubscribe = window.api.onAddBookmarkFromFileTree(async (params: { filePath: string; fileName: string }) => {
      const { filePath, fileName } = params
      try {
        await window.api.addBookmark({ filePath, fileName })
        await loadBookmarks()
        toast.success(`已添加文件书签：${fileName}`)
      } catch (error) {
        console.error('[App] Failed to add bookmark:', error)
        toast.error('添加书签失败')
      }
    })

    return unsubscribe
  }, [loadBookmarks, toast])

  // v1.3.7：预览区域右键添加书签
  useEffect(() => {
    if (!window.api.onAddBookmarkFromPreview) return

    const unsubscribe = window.api.onAddBookmarkFromPreview(async (params: { filePath: string; headingId: string | null; headingText: string | null }) => {
      const { filePath, headingId, headingText } = params
      try {
        const fileName = filePath.split(/[/\\]/).pop() || ''
        let scrollPosition: number | undefined
        if (previewRef.current && !headingId) {
          const container = previewRef.current
          scrollPosition = container.scrollTop / container.scrollHeight
        }

        await window.api.addBookmark({
          filePath,
          fileName,
          headingId: headingId || undefined,
          headingText: headingText || undefined,
          scrollPosition
        })

        await loadBookmarks()
        if (headingId) {
          toast.success(`已添加标题书签：${headingText}`)
        } else {
          toast.success(`已添加文件书签：${fileName}`)
        }
      } catch (error) {
        console.error('[App] Failed to add bookmark:', error)
        toast.error('添加书签失败')
      }
    })

    return unsubscribe
  }, [loadBookmarks, toast, previewRef])

  // v1.4.0：快捷键帮助弹窗事件监听
  useEffect(() => {
    if (!window.api.onOpenShortcutsHelp) return
    const unsubscribe = window.api.onOpenShortcutsHelp(() => {
      setShowShortcutsHelp(true)
    })
    return unsubscribe
  }, [setShowShortcutsHelp])

  // 监听快捷键事件 (v1.2.1)
  useEffect(() => {
    if (!window.api.onShortcutOpenFolder) return

    const unsubscribeOpenFolder = window.api.onShortcutOpenFolder(handleOpenFolder)
    const unsubscribeRefresh = window.api.onShortcutRefresh(handleRefreshFiles)
    const unsubscribeCloseTab = window.api.onShortcutCloseTab(() => {
      const currentActiveTabId = useTabStore.getState().activeTabId
      if (currentActiveTabId) handleTabClose(currentActiveTabId)
    })
    const unsubscribeExportHTML = window.api.onShortcutExportHTML(handleExportHTML)
    const unsubscribeExportPDF = window.api.onShortcutExportPDF(handleExportPDF)
    const unsubscribeFocusSearch = window.api.onShortcutFocusSearch(handleFocusSearch)
    const unsubscribeNextTab = window.api.onShortcutNextTab(handleNextTab)
    const unsubscribePrevTab = window.api.onShortcutPrevTab(handlePrevTab)
    const unsubscribeSwitchTab = window.api.onShortcutSwitchTab(handleSwitchTab)

    return () => {
      unsubscribeOpenFolder()
      unsubscribeRefresh()
      unsubscribeCloseTab()
      unsubscribeExportHTML()
      unsubscribeExportPDF()
      unsubscribeFocusSearch()
      unsubscribeNextTab()
      unsubscribePrevTab()
      unsubscribeSwitchTab()
    }
  }, [
    handleOpenFolder, handleRefreshFiles, handleTabClose,
    handleExportHTML, handleExportPDF, handleFocusSearch,
    handleNextTab, handlePrevTab, handleSwitchTab
  ])

  // v1.5.1：分屏 IPC 事件（从标签页右键菜单触发）
  useEffect(() => {
    if (!window.api.onTabOpenInSplit) return

    const unsubscribe = window.api.onTabOpenInSplit((data: { tabId: string; direction: 'horizontal' | 'vertical' } | string) => {
      const tabId = typeof data === 'string' ? data : data.tabId
      const direction = typeof data === 'string' ? 'horizontal' : data.direction

      setSplitState(prev => {
        if (!prev.root) {
          const currentActiveTabId = useTabStore.getState().activeTabId
          if (!currentActiveTabId) return prev
          const firstLeaf = createLeaf(currentActiveTabId)
          const secondLeaf = createLeaf(tabId)
          return {
            root: {
              type: 'split',
              id: `panel-split-${Date.now()}`,
              direction,
              ratio: 0.5,
              first: firstLeaf,
              second: secondLeaf
            } as PanelNode,
            activeLeafId: secondLeaf.id
          }
        }
        const targetLeafId = prev.activeLeafId
        if (!targetLeafId || getTreeDepth(prev.root) >= MAX_SPLIT_DEPTH) return prev
        const { root: newRoot, newLeafId } = splitLeaf(prev.root, targetLeafId, direction, tabId)
        return { root: newRoot, activeLeafId: newLeafId }
      })
    })

    return unsubscribe
  }, [setSplitState])

  // v1.5.1：文件树"在分屏中打开" IPC 事件
  useEffect(() => {
    if (!window.api.onFileOpenInSplit) return

    const unsubscribe = window.api.onFileOpenInSplit(async (data: { filePath: string; direction: 'horizontal' | 'vertical' }) => {
      const { filePath, direction } = data
      let tab = tabsRef.current.find(t => t.file.path === filePath)
      if (!tab) {
        try {
          const content = await readFileWithCache(filePath)
          const fileName = filePath.split(/[/\\]/).pop() || filePath
          const isPinned = await window.api.isTabPinned(filePath)
          const newTab: Tab = {
            id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file: { name: fileName, path: filePath, isDirectory: false },
            content,
            isPinned
          }
          setTabs(prev => [...prev, newTab])
          tab = newTab
          const currentFolderPath = useFileStore.getState().folderPath
          if (currentFolderPath) {
            window.api.addRecentFile({ path: filePath, name: fileName, folderPath: currentFolderPath }).catch(() => {})
          }
          window.api.watchFile(filePath).catch(() => {})
        } catch (error) {
          console.error('Failed to read file for split:', error)
          toast.error(`无法在分屏中打开：${error instanceof Error ? error.message : '未知错误'}`)
          return
        }
      }

      const tabId = tab.id
      setSplitState(prev => {
        if (!prev.root) {
          const currentActiveTabId = useTabStore.getState().activeTabId
          if (!currentActiveTabId) {
            // 没有活跃标签页时，直接激活新标签页而不分屏
            setActiveTabId(tabId)
            return prev
          }
          const firstLeaf = createLeaf(currentActiveTabId)
          const secondLeaf = createLeaf(tabId)
          return {
            root: {
              type: 'split',
              id: `panel-split-${Date.now()}`,
              direction,
              ratio: 0.5,
              first: firstLeaf,
              second: secondLeaf
            } as PanelNode,
            activeLeafId: secondLeaf.id
          }
        }
        const targetLeafId = prev.activeLeafId
        if (!targetLeafId || getTreeDepth(prev.root) >= MAX_SPLIT_DEPTH) return prev
        const { root: newRoot, newLeafId } = splitLeaf(prev.root, targetLeafId, direction, tabId)
        return { root: newRoot, activeLeafId: newLeafId }
      })
    })

    return unsubscribe
  }, [setSplitState, setTabs])

  // v1.4.2：字体大小调节快捷键
  useEffect(() => {
    if (!window.api.onShortcutFontIncrease) return

    const unsubscribeIncrease = window.api.onShortcutFontIncrease(increaseFontSize)
    const unsubscribeDecrease = window.api.onShortcutFontDecrease(decreaseFontSize)
    const unsubscribeReset = window.api.onShortcutFontReset(resetFontSize)

    return () => {
      unsubscribeIncrease()
      unsubscribeDecrease()
      unsubscribeReset()
    }
  }, [increaseFontSize, decreaseFontSize, resetFontSize])

  // v1.4.2：窗口置顶快捷键
  useEffect(() => {
    if (!window.api.onShortcutToggleAlwaysOnTop) return

    const unsubscribe = window.api.onShortcutToggleAlwaysOnTop(async () => {
      await toggleAlwaysOnTop()
      const currentState = useWindowStore.getState().isAlwaysOnTop
      toast.success(currentState ? '窗口已置顶' : '已取消置顶')
    })

    return () => unsubscribe()
  }, [toggleAlwaysOnTop, toast])

  // v1.4.2：打印快捷键
  useEffect(() => {
    if (!window.api.onShortcutPrint) return

    const unsubscribe = window.api.onShortcutPrint(async () => {
      const currentTabs = useTabStore.getState().tabs
      const currentActiveTabId = useTabStore.getState().activeTabId
      const activeTab = currentTabs.find(t => t.id === currentActiveTabId)
      if (!activeTab) {
        toast.error('请先打开一个文件')
        return
      }
      await window.api.print()
    })

    return () => unsubscribe()
  }, [toast])

  // v1.3.4：监听打开特定文件事件
  useEffect(() => {
    const cleanup = window.api.onOpenSpecificFile(async (filePath: string) => {
      console.log('[App] Open specific file:', filePath)
      const fileName = filePath.split(/[/\\]/).pop() || filePath
      const file = { name: fileName, path: filePath, isDirectory: false }
      await handleFileSelect(file)
    })
    return cleanup
  }, [handleFileSelect])

  // v1.3 阶段 2：Markdown 右键菜单事件监听
  useEffect(() => {
    if (!window.api.onMarkdownExportHTML) return

    const unsubscribeExportHTML = window.api.onMarkdownExportHTML(() => { handleExportHTML() })
    const unsubscribeExportPDF = window.api.onMarkdownExportPDF(() => { handleExportPDF() })
    const unsubscribeExportDOCX = window.api.onMarkdownExportDOCX((docStyle?: string) => { handleExportDOCX(docStyle) })

    const unsubscribeCopySource = window.api.onMarkdownCopySource(() => {
      const currentTabs = useTabStore.getState().tabs
      const currentActiveTabId = useTabStore.getState().activeTabId
      const activeTab = currentTabs.find(t => t.id === currentActiveTabId)
      if (activeTab) {
        navigator.clipboard.writeText(activeTab.content)
        toast.success('已复制 Markdown 源码')
      }
    })

    const unsubscribeCopyPlainText = window.api.onMarkdownCopyPlainText(() => {
      const currentTabs = useTabStore.getState().tabs
      const currentActiveTabId = useTabStore.getState().activeTabId
      const activeTab = currentTabs.find(t => t.id === currentActiveTabId)
      if (activeTab) {
        const plainText = activeTab.content
          .replace(/#{1,6}\s+/g, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        navigator.clipboard.writeText(plainText)
        toast.success('已复制纯文本')
      }
    })

    const unsubscribeCopyHTML = window.api.onMarkdownCopyHTML(() => {
      const currentTabs = useTabStore.getState().tabs
      const currentActiveTabId = useTabStore.getState().activeTabId
      const activeTab = currentTabs.find(t => t.id === currentActiveTabId)
      if (activeTab) {
        const md = createMarkdownRenderer()
        const html = md.render(activeTab.content)
        navigator.clipboard.writeText(html)
        toast.success('已复制 HTML')
      }
    })

    return () => {
      unsubscribeExportHTML()
      unsubscribeExportPDF()
      unsubscribeExportDOCX()
      unsubscribeCopySource()
      unsubscribeCopyPlainText()
      unsubscribeCopyHTML()
    }
  }, [handleExportHTML, handleExportPDF, handleExportDOCX, toast])

  // v1.6.0: 多窗口快捷键
  useEffect(() => {
    const unsubNewWindow = window.api.onShortcutNewWindow(async () => {
      try {
        await window.api.newWindow()
      } catch (error) {
        console.error('Failed to create new window:', error)
      }
    })

    const unsubNewWindowFolder = window.api.onShortcutNewWindowFolder(async () => {
      try {
        await window.api.newWindowWithFolder()
      } catch (error) {
        console.error('Failed to create new window with folder:', error)
      }
    })

    return () => {
      unsubNewWindow()
      unsubNewWindowFolder()
    }
  }, [])

  // v1.6.0: 书签跨窗口同步 + 书签右键菜单删除
  useEffect(() => {
    const unsubBookmarksChanged = window.api.onBookmarksChanged(() => {
      console.log('[IPC] Bookmarks changed in another window, reloading...')
      loadBookmarks()
    })

    const unsubBookmarkDelete = window.api.onBookmarkDelete?.((bookmarkId: string) => {
      window.api.removeBookmark(bookmarkId)
        .then(() => loadBookmarks())
        .then(() => toast.success('书签已删除'))
        .catch((error) => {
          console.error('Failed to delete bookmark:', error)
          toast.error('删除书签失败')
        })
    })

    return () => {
      unsubBookmarksChanged()
      unsubBookmarkDelete?.()
    }
  }, [loadBookmarks, toast])
}
