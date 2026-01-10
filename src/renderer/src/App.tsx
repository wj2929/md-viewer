import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FileTree, FileInfo, VirtualizedMarkdown, TabBar, Tab, SearchBar, SearchBarHandle, ErrorBoundary, ToastContainer, ThemeToggle, FolderHistoryDropdown, RecentFilesDropdown, SettingsPanel, FloatingNav, BookmarkPanel, Bookmark, BookmarkBar, Header, NavigationBar, ShortcutsHelpDialog } from './components'
import { readFileWithCache, clearFileCache, invalidateAndReload } from './utils/fileCache'
import { createMarkdownRenderer } from './utils/markdownRenderer'
import { processMermaidInHtml } from './utils/mermaidRenderer'
import { useToast } from './hooks/useToast'
import { useTheme } from './hooks/useTheme'
import { useClipboardStore } from './stores/clipboardStore'

function App(): JSX.Element {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // v1.3 阶段 5：多选状态
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  // 侧边栏宽度（可拖拽调整）
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [isResizing, setIsResizing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // v1.4.0：快捷键帮助弹窗状态
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)
  // v1.3.6：书签面板状态（Day 7.6: 0 书签时默认折叠）
  const [bookmarkPanelCollapsed, setBookmarkPanelCollapsed] = useState(true)
  const [bookmarkPanelWidth, setBookmarkPanelWidth] = useState(240)
  // v1.3.6：书签栏状态（混合方案 - 默认折叠保持简洁）
  const [bookmarkBarCollapsed, setBookmarkBarCollapsed] = useState(true)
  // v1.3.6：统一书签数据（共享给 BookmarkBar 和 BookmarkPanel）
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [bookmarksLoading, setBookmarksLoading] = useState(true)
  const toast = useToast()
  const { theme, setTheme } = useTheme()

  // 剪贴板 Store (v1.2 阶段 2)
  const { copy, cut, paste } = useClipboardStore()

  // 使用 ref 来存储最新的 tabs，避免闭包陷阱
  const tabsRef = useRef<Tab[]>([])
  tabsRef.current = tabs

  // 搜索栏 ref (用于快捷键聚焦)
  const searchBarRef = useRef<SearchBarHandle>(null)
  // 预览区域 ref (用于滚动重置)
  const previewRef = useRef<HTMLDivElement>(null)
  // v1.3.6：书签面板和书签栏现在由 App 统一管理数据，不再需要 ref

  // v1.3.6：加载书签设置（面板 + 栏）
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await window.api.getAppSettings()
        setBookmarkPanelCollapsed(settings.bookmarkPanelCollapsed)
        setBookmarkPanelWidth(settings.bookmarkPanelWidth)
        // 书签栏折叠状态（默认折叠）
        if (settings.bookmarkBarCollapsed !== undefined) {
          setBookmarkBarCollapsed(settings.bookmarkBarCollapsed)
        }
      } catch (error) {
        console.error('[App] Failed to load settings:', error)
      }
    }
    loadSettings()
  }, [])

  // v1.3.6：加载书签数据（统一管理）
  const loadBookmarks = useCallback(async () => {
    setBookmarksLoading(true)
    try {
      const items = await window.api.getBookmarks()
      setBookmarks(items.sort((a, b) => a.order - b.order))
    } catch (error) {
      console.error('[App] Failed to load bookmarks:', error)
    } finally {
      setBookmarksLoading(false)
    }
  }, [])

  // 初始加载书签
  useEffect(() => {
    loadBookmarks()
  }, [loadBookmarks])

  // v1.3.6 Day 7.6：监听书签数量变化，首次添加书签时自动展开 BookmarkPanel（可选增强体验）
  useEffect(() => {
    // 如果书签从 0 → 1，自动展开右侧面板（让用户发现新功能）
    if (bookmarks.length === 1 && bookmarkPanelCollapsed) {
      setBookmarkPanelCollapsed(false)
      window.api.updateAppSettings({ bookmarkPanelCollapsed: false }).catch(err => {
        console.error('[App] Failed to save bookmark panel state:', err)
      })
    }
  }, [bookmarks.length, bookmarkPanelCollapsed])

  // v1.3.6：响应式布局 - 窗口小于 1200px 时自动折叠书签栏和书签面板
  useEffect(() => {
    const BREAKPOINT = 1200
    const mediaQuery = window.matchMedia(`(max-width: ${BREAKPOINT}px)`)

    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        // 小屏幕：自动折叠
        setBookmarkBarCollapsed(true)
        setBookmarkPanelCollapsed(true)
      }
      // 大屏幕时不自动展开，保持用户手动设置的状态
    }

    // 初始检查
    handleMediaChange(mediaQuery)

    // 监听变化
    mediaQuery.addEventListener('change', handleMediaChange)
    return () => mediaQuery.removeEventListener('change', handleMediaChange)
  }, [])

  // 监听恢复文件夹事件
  useEffect(() => {
    const cleanup = window.api.onRestoreFolder(async (restoredFolderPath) => {
      setFolderPath(restoredFolderPath)
      // v1.3.6：恢复该文件夹的固定标签
      try {
        const pinnedTabs = await window.api.getPinnedTabsForFolder(restoredFolderPath)
        if (pinnedTabs.length > 0) {
          const newTabs: Tab[] = []
          for (const pinned of pinnedTabs) {
            try {
              const content = await readFileWithCache(pinned.path)
              const fileName = pinned.path.split('/').pop() || ''
              newTabs.push({
                id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                file: { name: fileName, path: pinned.path, isDirectory: false },
                content,
                isPinned: true
              })
            } catch { /* 忽略 */ }
          }
          if (newTabs.length > 0) {
            setTabs(newTabs)
            setActiveTabId(newTabs[0].id)
          }
        }
      } catch (err) {
        console.error('[App] Failed to restore pinned tabs on folder restore:', err)
      }
    })
    return cleanup
  }, [])

  // 监听右键菜单事件 (v1.2 阶段 1)
  useEffect(() => {
    // 文件删除事件
    const unsubscribeDeleted = window.api.onFileDeleted((filePath: string) => {
      // 关闭已删除文件的标签
      setTabs(prev => prev.filter(tab => tab.file.path !== filePath))
      // 刷新文件树
      if (folderPath) {
        window.api.readDir(folderPath).then(setFiles).catch(console.error)
      }
    })

    // 文件重命名事件
    const unsubscribeRename = window.api.onFileStartRename((filePath: string) => {
      // FileTree 组件内部已监听此事件，这里仅做日志记录
      console.log('Start rename:', filePath)
    })

    // 文件导出请求事件
    const unsubscribeExport = window.api.onFileExportRequest(
      async (data: { path: string; type: 'html' | 'pdf' }) => {
        try {
          // 读取文件内容
          const content = await window.api.readFile(data.path)
          const md = createMarkdownRenderer()
          let htmlContent = md.render(content)
          const fileName = data.path.split('/').pop() || 'export'

          // 将 Mermaid 代码块转换为 SVG
          htmlContent = await processMermaidInHtml(htmlContent)

          // 调用导出 API
          if (data.type === 'html') {
            const result = await window.api.exportHTML(htmlContent, fileName)
            if (result) {
              toast.success('HTML 已导出', {
                action: {
                  label: '点击查看',
                  onClick: async () => {
                    try {
                      await window.api.showItemInFolder(result)
                    } catch (error) {
                      console.error('Failed to show item:', error)
                    }
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
                    try {
                      await window.api.showItemInFolder(result)
                    } catch (error) {
                      console.error('Failed to show item:', error)
                    }
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

    // 错误事件
    const unsubscribeError = window.api.onError((error: { message: string }) => {
      toast.error(error.message)
    })

    // 剪贴板事件 (v1.2 阶段 2, v1.3 阶段 5 多选支持)
    const unsubscribeCopy = window.api.onClipboardCopy((paths: string[]) => {
      // v1.3：如果有多选，使用多选的路径；否则使用传入的路径
      const pathsToCopy = selectedPaths.size > 0 ? Array.from(selectedPaths) : paths
      copy(pathsToCopy)
      toast.success(`已复制 ${pathsToCopy.length} 个文件`)
      // 复制后清空多选
      setSelectedPaths(new Set())
    })

    const unsubscribeCut = window.api.onClipboardCut((paths: string[]) => {
      // v1.3：如果有多选，使用多选的路径；否则使用传入的路径
      const pathsToCut = selectedPaths.size > 0 ? Array.from(selectedPaths) : paths
      cut(pathsToCut)
      toast.success(`已剪切 ${pathsToCut.length} 个文件`)
      // 剪切后清空多选
      setSelectedPaths(new Set())
    })

    const unsubscribePaste = window.api.onClipboardPaste(async (targetDir: string) => {
      try {
        await paste(targetDir)
        toast.success('粘贴成功')
        // 刷新文件树
        if (folderPath) {
          const fileList = await window.api.readDir(folderPath)
          setFiles(fileList)
        }
      } catch (error) {
        console.error('粘贴失败:', error)
        toast.error(`粘贴失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    })

    return () => {
      unsubscribeDeleted()
      unsubscribeRename()
      unsubscribeExport()
      unsubscribeError()
      unsubscribeCopy()
      unsubscribeCut()
      unsubscribePaste()
    }
  }, [folderPath, copy, cut, paste, toast, selectedPaths])

  // v1.3.6：恢复固定标签
  const restorePinnedTabs = useCallback(async (targetFolderPath: string) => {
    try {
      const pinnedTabs = await window.api.getPinnedTabsForFolder(targetFolderPath)
      if (pinnedTabs.length === 0) return

      const newTabs: Tab[] = []
      for (const pinned of pinnedTabs) {
        try {
          const content = await readFileWithCache(pinned.path)
          const fileName = pinned.path.split('/').pop() || ''
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
        setTabs(newTabs)
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
        setTabs([])
        setActiveTabId(null)
        // v1.3.6：恢复该文件夹的固定标签
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
    setTabs([])
    setActiveTabId(null)
    // v1.3.6：恢复该文件夹的固定标签
    await restorePinnedTabs(path)
  }, [restorePinnedTabs])

  // v1.3.6：从最近文件选择
  const handleSelectRecentFile = useCallback(async (filePath: string) => {
    // 提取文件夹路径
    const parts = filePath.split('/')
    const fileName = parts.pop() || ''
    const fileFolder = parts.join('/')

    // 如果当前没有打开文件夹，或者文件不在当前文件夹中
    if (!folderPath || !filePath.startsWith(folderPath)) {
      // 先切换到文件所在的文件夹
      await window.api.setFolderPath(fileFolder)
      setFolderPath(fileFolder)
      setTabs([])
      setActiveTabId(null)

      // 等待文件树加载完成后恢复固定标签并打开文件
      setTimeout(async () => {
        try {
          // 先恢复固定标签
          const pinnedTabs = await window.api.getPinnedTabsForFolder(fileFolder)
          const restoredTabs: Tab[] = []

          for (const pinned of pinnedTabs) {
            if (pinned.path === filePath) continue // 跳过目标文件，后面单独处理
            try {
              const content = await readFileWithCache(pinned.path)
              const name = pinned.path.split('/').pop() || ''
              restoredTabs.push({
                id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                file: { name, path: pinned.path, isDirectory: false },
                content,
                isPinned: true
              })
            } catch { /* 忽略无法读取的文件 */ }
          }

          // 打开目标文件
          const content = await readFileWithCache(filePath)
          const isPinned = pinnedTabs.some(t => t.path === filePath)
          const newTab: Tab = {
            id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file: { name: fileName, path: filePath, isDirectory: false },
            content,
            isPinned
          }

          setTabs([...restoredTabs, newTab])
          setActiveTabId(newTab.id)

          // 添加到最近文件
          window.api.addRecentFile({
            path: filePath,
            name: fileName,
            folderPath: fileFolder
          }).catch(err => console.error('Failed to add to recent files:', err))
        } catch (error) {
          toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
        }
      }, 500)
    } else {
      // 文件在当前文件夹中，直接打开
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

        // 添加到最近文件
        window.api.addRecentFile({
          path: filePath,
          name: fileName,
          folderPath: folderPath
        }).catch(err => console.error('Failed to add to recent files:', err))
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

  // 手动刷新文件树 (v1.2 阶段 1)
  const handleRefreshFiles = useCallback(async () => {
    if (!folderPath) return
    setIsLoading(true)
    try {
      const fileList = await window.api.readDir(folderPath)
      setFiles(fileList)
    } catch (error) {
      console.error('Failed to refresh files:', error)
    } finally {
      setIsLoading(false)
    }
  }, [folderPath])

  // 文件重命名处理 (v1.2 阶段 1)
  const handleFileRenamed = useCallback(async (oldPath: string, newName: string) => {
    try {
      // 调用主进程 API 重命名文件
      const newPath = await window.api.renameFile(oldPath, newName)

      if (!newPath) {
        throw new Error('重命名失败')
      }

      // 更新标签页中的文件路径
      setTabs(prev => prev.map(tab =>
        tab.file.path === oldPath
          ? { ...tab, file: { ...tab.file, name: newName, path: newPath } }
          : tab
      ))

      // 刷新文件树
      await handleRefreshFiles()
    } catch (error) {
      console.error('Failed to rename file:', error)
      toast.error(`重命名失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [handleRefreshFiles, toast])

  // 关闭标签 (必须在 useEffect 文件监听之前定义)
  const handleTabClose = useCallback((tabId: string) => {
    setTabs(prev => {
      // 找到要关闭的 tab，清除其缓存
      const closingTab = prev.find(tab => tab.id === tabId)
      if (closingTab) {
        clearFileCache(closingTab.file.path)
      }

      const newTabs = prev.filter(tab => tab.id !== tabId)

      // 如果关闭的是当前标签，切换到下一个或上一个
      if (tabId === activeTabId) {
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
  }, [activeTabId])

  // v1.3 新增：Tab 右键菜单事件监听
  useEffect(() => {
    // 检查 API 是否存在（兼容旧版本）
    if (!window.api.onTabClose) return

    const unsubscribeTabClose = window.api.onTabClose((tabId: string) => {
      handleTabClose(tabId)
    })

    const unsubscribeTabCloseOthers = window.api.onTabCloseOthers((tabId: string) => {
      // v1.3.6：保留固定标签和当前标签
      setTabs(prev => prev.filter(tab => tab.id === tabId || tab.isPinned))
      setActiveTabId(tabId)
    })

    const unsubscribeTabCloseAll = window.api.onTabCloseAll(() => {
      // v1.3.6：保留固定标签
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

    // v1.3.6：固定标签
    const unsubscribeTabPin = window.api.onTabPin((tabId: string) => {
      setTabs(prev => prev.map(tab =>
        tab.id === tabId ? { ...tab, isPinned: true } : tab
      ))
      // 持久化到主进程
      const tab = tabsRef.current.find(t => t.id === tabId)
      if (tab) {
        window.api.addPinnedTab(tab.file.path).catch(err => {
          console.error('Failed to persist pinned tab:', err)
        })
      }
    })

    // v1.3.6：取消固定标签
    const unsubscribeTabUnpin = window.api.onTabUnpin((tabId: string) => {
      setTabs(prev => prev.map(tab =>
        tab.id === tabId ? { ...tab, isPinned: false } : tab
      ))
      // 从主进程移除
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
  }, [handleTabClose])

  // v1.3.6：书签面板事件处理
  useEffect(() => {
    if (!window.api.onTabAddBookmark) return

    const unsubscribeAddBookmark = window.api.onTabAddBookmark(async ({ tabId, filePath }) => {
      const tab = tabsRef.current.find(t => t.id === tabId)
      if (!tab) return

      try {
        await window.api.addBookmark({
          filePath: tab.file.path,
          fileName: tab.file.name
        })
        toast.success('已添加到书签')
        // 刷新书签数据（统一管理）
        loadBookmarks()
      } catch (error) {
        console.error('[App] Failed to add bookmark:', error)
        toast.error(`添加书签失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    })

    return () => {
      unsubscribeAddBookmark()
    }
  }, [toast, loadBookmarks])

  // v1.3.6：快捷键添加书签
  useEffect(() => {
    if (!window.api.onShortcutAddBookmark) return

    const unsubscribe = window.api.onShortcutAddBookmark(async () => {
      if (!activeTabId) return

      const tab = tabsRef.current.find(t => t.id === activeTabId)
      if (!tab) return

      try {
        await window.api.addBookmark({
          filePath: tab.file.path,
          fileName: tab.file.name
        })
        toast.success('已添加到书签')
        // 刷新书签数据（统一管理）
        loadBookmarks()
      } catch (error) {
        console.error('[App] Failed to add bookmark:', error)
        toast.error(`添加书签失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    })

    return unsubscribe
  }, [activeTabId, toast, loadBookmarks])

  // v1.3.7：文件树右键添加书签
  useEffect(() => {
    if (!window.api.onAddBookmarkFromFileTree) return

    const unsubscribe = window.api.onAddBookmarkFromFileTree(async (params) => {
      const { filePath, fileName } = params

      try {
        // 添加文件书签（不包含标题信息）
        await window.api.addBookmark({
          filePath,
          fileName
        })

        // 刷新书签列表
        await loadBookmarks()

        // 提示用户
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

    const unsubscribe = window.api.onAddBookmarkFromPreview(async (params) => {
      const { filePath, headingId, headingText } = params

      try {
        // 获取文件名
        const fileName = filePath.split('/').pop() || ''

        // 获取滚动位置（如果没有标题信息）
        let scrollPosition: number | undefined
        if (previewRef.current && !headingId) {
          const container = previewRef.current
          scrollPosition = container.scrollTop / container.scrollHeight
        }

        // 调用 API 添加书签
        await window.api.addBookmark({
          filePath,
          fileName,
          headingId: headingId || undefined,
          headingText: headingText || undefined,
          scrollPosition
        })

        // 刷新书签列表
        await loadBookmarks()

        // 提示用户
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
  }, [loadBookmarks, toast])

  // v1.4.0：快捷键帮助弹窗事件监听
  useEffect(() => {
    if (!window.api.onOpenShortcutsHelp) return

    const unsubscribe = window.api.onOpenShortcutsHelp(() => {
      setShowShortcutsHelp(true)
    })

    return unsubscribe
  }, [])

  // v1.3.6：书签面板宽度变化时保存
  const handleBookmarkPanelWidthChange = useCallback((newWidth: number) => {
    setBookmarkPanelWidth(newWidth)
    window.api.updateAppSettings({ bookmarkPanelWidth: newWidth }).catch(err => {
      console.error('[App] Failed to save bookmark panel width:', err)
    })
  }, [])

  // v1.3.6：书签面板折叠状态变化时保存
  const handleBookmarkPanelToggle = useCallback(() => {
    const newState = !bookmarkPanelCollapsed
    setBookmarkPanelCollapsed(newState)
    window.api.updateAppSettings({ bookmarkPanelCollapsed: newState }).catch(err => {
      console.error('[App] Failed to save bookmark panel collapsed state:', err)
    })
  }, [bookmarkPanelCollapsed])

  // v1.3.6：书签栏折叠状态变化时保存（混合方案）
  const handleBookmarkBarToggle = useCallback(() => {
    const newState = !bookmarkBarCollapsed
    setBookmarkBarCollapsed(newState)
    window.api.updateAppSettings({ bookmarkBarCollapsed: newState }).catch(err => {
      console.error('[App] Failed to save bookmark bar collapsed state:', err)
    })
  }, [bookmarkBarCollapsed])

  // v1.3.6 Phase 3：展开书签栏（从 TabBar 触发）
  const handleShowBookmarkBar = useCallback(() => {
    setBookmarkBarCollapsed(false)
    window.api.updateAppSettings({ bookmarkBarCollapsed: false }).catch(err => {
      console.error('[App] Failed to save bookmark bar collapsed state:', err)
    })
  }, [])

  // v1.3.6：点击"更多"按钮时，展开右侧书签面板
  const handleShowMoreBookmarks = useCallback(() => {
    if (bookmarkPanelCollapsed) {
      setBookmarkPanelCollapsed(false)
      window.api.updateAppSettings({ bookmarkPanelCollapsed: false }).catch(err => {
        console.error('[App] Failed to save bookmark panel collapsed state:', err)
      })
    }
  }, [bookmarkPanelCollapsed])

  // v1.3.6：书签跳转（带容错）
  const handleSelectBookmark = useCallback(async (bookmark: Bookmark) => {
    // 1. 检查文件是否已打开
    const existingTab = tabsRef.current.find(tab => tab.file.path === bookmark.filePath)

    if (!existingTab) {
      // 打开文件
      try {
        const content = await readFileWithCache(bookmark.filePath)
        const newTab: Tab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file: { name: bookmark.fileName, path: bookmark.filePath, isDirectory: false },
          content
        }
        setTabs(prev => [...prev, newTab])
        setActiveTabId(newTab.id)

        // 等待渲染完成后跳转
        setTimeout(() => navigateToBookmarkPosition(bookmark), 300)
      } catch (error) {
        toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
      }
    } else {
      // 切换到已打开的标签
      setActiveTabId(existingTab.id)
      // 等待切换完成后跳转
      setTimeout(() => navigateToBookmarkPosition(bookmark), 100)
    }
  }, [toast])

  // v1.3.6：跳转到书签位置（容错逻辑）
  const navigateToBookmarkPosition = useCallback((bookmark: Bookmark) => {
    if (!previewRef.current) return

    // 优先级 1: 尝试通过锚点 ID 跳转
    if (bookmark.headingId) {
      const element = document.getElementById(bookmark.headingId)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }

    // 优先级 2: 尝试通过标题文本模糊匹配
    if (bookmark.headingText) {
      const headings = previewRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
      const bestMatch = findBestHeadingMatch(bookmark.headingText, Array.from(headings))
      if (bestMatch) {
        bestMatch.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }

    // 优先级 3: 尝试通过滚动位置
    if (bookmark.scrollPosition !== undefined && bookmark.scrollPosition > 0) {
      const container = previewRef.current
      const scrollTop = container.scrollHeight * bookmark.scrollPosition
      container.scrollTo({ top: scrollTop, behavior: 'smooth' })
      return
    }

    // 优先级 4: 如果是文件书签（无标题），跳转到顶部
    if (!bookmark.headingId && !bookmark.headingText) {
      previewRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    // 如果都失败，提示用户
    toast.warning('书签位置可能已失效')
  }, [toast])

  // 模糊匹配标题（简单的相似度算法）
  const findBestHeadingMatch = (targetText: string, headings: Element[]): Element | null => {
    if (headings.length === 0) return null

    const normalize = (text: string) => text.toLowerCase().trim().replace(/\s+/g, ' ')
    const normalizedTarget = normalize(targetText)

    let bestMatch: Element | null = null
    let bestScore = 0

    for (const heading of headings) {
      const headingText = normalize(heading.textContent || '')

      // 完全匹配
      if (headingText === normalizedTarget) {
        return heading
      }

      // 包含匹配
      if (headingText.includes(normalizedTarget) || normalizedTarget.includes(headingText)) {
        const score = Math.min(headingText.length, normalizedTarget.length) / Math.max(headingText.length, normalizedTarget.length)
        if (score > bestScore) {
          bestScore = score
          bestMatch = heading
        }
      }
    }

    // 只有相似度超过 60% 才返回
    return bestScore > 0.6 ? bestMatch : null
  }

  // 文件监听 - 自动刷新功能
  // 只在 folderPath 改变时重新订阅，使用 ref 访问最新的 tabs
  useEffect(() => {
    if (!folderPath) return

    // 开始监听文件夹
    window.api.watchFolder(folderPath).catch(error => {
      console.error('Failed to watch folder:', error)
    })

    // 监听文件变化 - 刷新已打开的标签页
    const unsubscribeChanged = window.api.onFileChanged(async (changedPath: string) => {
      // 清除该文件的缓存
      clearFileCache(changedPath)

      // 使用 ref 获取最新的 tabs，避免闭包陷阱
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

    // 监听文件添加 - 刷新文件树
    const unsubscribeAdded = window.api.onFileAdded(async () => {
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    // 监听文件删除 - 刷新文件树并关闭已删除文件的标签
    const unsubscribeRemoved = window.api.onFileRemoved(async (removedPath: string) => {
      // 使用函数式更新来关闭标签，避免依赖外部状态
      setTabs(prev => prev.filter(tab => tab.file.path !== removedPath))

      // 刷新文件树
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    // v1.3 新增：监听文件夹添加 - 刷新文件树
    const unsubscribeFolderAdded = window.api.onFolderAdded(async (dirPath: string) => {
      console.log('[App] Folder added:', dirPath)
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    // v1.3 新增：监听文件夹删除 - 刷新文件树 + 关闭相关标签
    const unsubscribeFolderRemoved = window.api.onFolderRemoved(async (dirPath: string) => {
      console.log('[App] Folder removed:', dirPath)
      // 关闭该文件夹下的所有标签
      setTabs(prev => prev.filter(tab => !tab.file.path.startsWith(dirPath + '/')))

      // 刷新文件树
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    // v1.3 新增：监听文件重命名 - 刷新文件树 + 更新标签
    const unsubscribeRenamed = window.api.onFileRenamed(async ({ oldPath, newPath }) => {
      console.log('[App] File renamed:', oldPath, '->', newPath)
      // 更新标签中的文件路径
      setTabs(prev => prev.map(tab => {
        if (tab.file.path === oldPath) {
          return {
            ...tab,
            file: {
              ...tab.file,
              path: newPath,
              name: newPath.split('/').pop() || tab.file.name
            }
          }
        }
        return tab
      }))

      // 刷新文件树
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    // 清理：停止监听
    return () => {
      window.api.unwatchFolder().catch(error => {
        console.error('Failed to unwatch folder:', error)
      })
      unsubscribeChanged()
      unsubscribeAdded()
      unsubscribeRemoved()
      unsubscribeFolderAdded()
      unsubscribeFolderRemoved()
      unsubscribeRenamed()
    }
  }, [folderPath])  // 只依赖 folderPath！

  // 选择文件 - 打开新标签或切换到已有标签
  const handleFileSelect = useCallback(async (file: FileInfo) => {
    if (file.isDirectory) return

    // 检查是否已经打开（使用 ref 获取最新状态）
    const existingTab = tabsRef.current.find(tab => tab.file.path === file.path)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    // 读取文件内容
    try {
      const content = await readFileWithCache(file.path)

      // v1.3.6：检查是否是固定标签
      const isPinned = await window.api.isTabPinned(file.path)

      const newTab: Tab = {
        id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        content,
        isPinned
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newTab.id)

      // v1.3.6：添加到最近文件
      window.api.addRecentFile({
        path: file.path,
        name: file.name,
        folderPath: folderPath
      }).catch(err => {
        console.error('Failed to add to recent files:', err)
      })

      // 将文件添加到监听列表（只监听已打开的文件）
      window.api.watchFile(file.path).catch(err => {
        console.error('Failed to watch file:', err)
      })
    } catch (error) {
      console.error('Failed to read file:', error)
      toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [toast, folderPath])

  // v1.3.4：监听打开特定文件事件
  useEffect(() => {
    const cleanup = window.api.onOpenSpecificFile(async (filePath: string) => {
      console.log('[App] Open specific file:', filePath)
      const fileName = filePath.split('/').pop() || filePath
      const file: FileInfo = { name: fileName, path: filePath, isDirectory: false }
      await handleFileSelect(file)
    })
    return cleanup
  }, [handleFileSelect])

  // 切换标签
  const handleTabClick = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  // 获取当前活动标签 - 使用 useMemo 避免不必要的重新渲染
  const activeTab = useMemo(() => {
    return tabs.find(tab => tab.id === activeTabId)
  }, [tabs, activeTabId])

  // ✅ 切换文件时重置滚动位置
  useEffect(() => {
    if (previewRef.current && activeTabId) {
      previewRef.current.scrollTop = 0
    }
  }, [activeTabId])

  // 导出 HTML
  const handleExportHTML = useCallback(async () => {
    if (!activeTab) return

    try {
      // 使用完整配置的 markdown 渲染器（包含 KaTeX 和 Prism）
      const md = createMarkdownRenderer()
      let htmlContent = md.render(activeTab.content)

      // 将 Mermaid 代码块转换为 SVG（用于静态 HTML 导出）
      htmlContent = await processMermaidInHtml(htmlContent)

      const filePath = await window.api.exportHTML(htmlContent, activeTab.file.name)
      if (filePath) {
        toast.success(`HTML 已导出`, {
          action: {
            label: '点击查看',
            onClick: async () => {
              try {
                await window.api.showItemInFolder(filePath)
              } catch (error) {
                console.error('Failed to show item:', error)
              }
            }
          }
        })
      }
    } catch (error) {
      console.error('导出 HTML 失败:', error)
      toast.error(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeTab, toast])

  // 导出 PDF
  const handleExportPDF = useCallback(async () => {
    if (!activeTab) return

    try {
      // 使用完整配置的 markdown 渲染器（包含 KaTeX 和 Prism）
      const md = createMarkdownRenderer()
      let htmlContent = md.render(activeTab.content)

      // 将 Mermaid 代码块转换为 SVG（用于静态 PDF 导出）
      htmlContent = await processMermaidInHtml(htmlContent)

      const filePath = await window.api.exportPDF(htmlContent, activeTab.file.name)
      if (filePath) {
        toast.success(`PDF 已导出`, {
          action: {
            label: '点击查看',
            onClick: async () => {
              try {
                await window.api.showItemInFolder(filePath)
              } catch (error) {
                console.error('Failed to show item:', error)
              }
            }
          }
        })
      }
    } catch (error) {
      console.error('导出 PDF 失败:', error)
      toast.error(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeTab, toast])

  // 切换到下一个标签
  const handleNextTab = useCallback(() => {
    const currentTabs = tabsRef.current
    if (currentTabs.length === 0) return

    const currentIndex = currentTabs.findIndex(tab => tab.id === activeTabId)
    const nextIndex = (currentIndex + 1) % currentTabs.length
    setActiveTabId(currentTabs[nextIndex].id)
  }, [activeTabId])

  // 切换到上一个标签
  const handlePrevTab = useCallback(() => {
    const currentTabs = tabsRef.current
    if (currentTabs.length === 0) return

    const currentIndex = currentTabs.findIndex(tab => tab.id === activeTabId)
    const prevIndex = (currentIndex - 1 + currentTabs.length) % currentTabs.length
    setActiveTabId(currentTabs[prevIndex].id)
  }, [activeTabId])

  // 切换到指定标签
  const handleSwitchTab = useCallback((tabIndex: number) => {
    const currentTabs = tabsRef.current
    if (tabIndex < 0 || tabIndex >= currentTabs.length) return
    setActiveTabId(currentTabs[tabIndex].id)
  }, [])

  // 聚焦搜索栏
  const handleFocusSearch = useCallback(() => {
    searchBarRef.current?.focus()
  }, [])

  // 监听快捷键事件 (v1.2.1)
  useEffect(() => {
    // 检查 API 是否存在（兼容旧版本）
    if (!window.api.onShortcutOpenFolder) return

    const unsubscribeOpenFolder = window.api.onShortcutOpenFolder(handleOpenFolder)
    const unsubscribeRefresh = window.api.onShortcutRefresh(handleRefreshFiles)
    const unsubscribeCloseTab = window.api.onShortcutCloseTab(() => {
      if (activeTabId) handleTabClose(activeTabId)
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
    handleOpenFolder,
    handleRefreshFiles,
    handleTabClose,
    handleExportHTML,
    handleExportPDF,
    handleFocusSearch,
    handleNextTab,
    handlePrevTab,
    handleSwitchTab,
    activeTabId
  ])

  // v1.3 阶段 2：Markdown 右键菜单事件监听
  useEffect(() => {
    // 检查 API 是否存在
    if (!window.api.onMarkdownExportHTML) return

    const unsubscribeExportHTML = window.api.onMarkdownExportHTML(() => {
      handleExportHTML()
    })

    const unsubscribeExportPDF = window.api.onMarkdownExportPDF(() => {
      handleExportPDF()
    })

    const unsubscribeCopySource = window.api.onMarkdownCopySource(() => {
      if (activeTab) {
        navigator.clipboard.writeText(activeTab.content)
        toast.success('已复制 Markdown 源码')
      }
    })

    const unsubscribeCopyPlainText = window.api.onMarkdownCopyPlainText(() => {
      if (activeTab) {
        // 简单移除 Markdown 标记获取纯文本
        const plainText = activeTab.content
          .replace(/#{1,6}\s+/g, '')  // 标题
          .replace(/\*\*([^*]+)\*\*/g, '$1')  // 粗体
          .replace(/\*([^*]+)\*/g, '$1')  // 斜体
          .replace(/`([^`]+)`/g, '$1')  // 行内代码
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // 链接
          .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')  // 图片
        navigator.clipboard.writeText(plainText)
        toast.success('已复制纯文本')
      }
    })

    const unsubscribeCopyHTML = window.api.onMarkdownCopyHTML(() => {
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
      unsubscribeCopySource()
      unsubscribeCopyPlainText()
      unsubscribeCopyHTML()
    }
  }, [activeTab, handleExportHTML, handleExportPDF, toast])

  // 侧边栏拖拽调整宽度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 180), 500) // 限制 180-500px
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  return (
    <ErrorBoundary>
      <div className="app">
      <ToastContainer messages={toast.messages} onClose={toast.close} />
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {/* v1.4.0：快捷键帮助弹窗 */}
      <ShortcutsHelpDialog
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />

      {/* 主内容区 */}
      <main className="main-content">
        {!folderPath ? (
          /* 欢迎页：无 Header，保持原样 */
          <div className="welcome">
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
        ) : (
          /* 工作区：Header + 主内容 */
          <div className="workspace-container">
            {/* v1.3.6：新 Header（NavigationBar + TabBar） */}
            <Header>
              <NavigationBar
                folderPath={folderPath}
                files={files}
                theme={theme}
                searchBarRef={searchBarRef}
                onOpenFolder={handleOpenFolder}
                onSelectHistoryFolder={handleSelectHistoryFolder}
                onSelectRecentFile={handleSelectRecentFile}
                onFileSelect={handleFileSelect}
                onSettingsClick={() => setShowSettings(true)}
                onThemeChange={setTheme}
                onRefreshFiles={handleRefreshFiles}
                isLoading={isLoading}
              />
              {/* v1.3.6 Phase 3：渐进式展示 */}
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
              {/* v1.3.6 Day 7.6: 只有书签数量 > 0 时才显示 BookmarkBar */}
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

            {/* 工作区主体 */}
            <div className={`workspace ${isResizing ? 'resizing' : ''}`}>
              {/* 左侧边栏：文件树 */}
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

              {/* 左侧分隔条 */}
              <div className="resize-handle" onMouseDown={handleResizeStart} />

              {/* 内容区（中间） */}
              <section className="content-area">
                <div className="preview-container">
                  <div className="preview" ref={previewRef}>
                    {activeTab ? (
                      <VirtualizedMarkdown
                        key={activeTab.file.path}
                        content={activeTab.content}
                        filePath={activeTab.file.path}
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
              </section>

              {/* v1.3.6：右侧书签面板 */}
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
      </div>
    </ErrorBoundary>
  )
}

export default App
