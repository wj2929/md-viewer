import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FileTree, FileInfo, VirtualizedMarkdown, TabBar, Tab, SearchBar, SearchBarHandle, ErrorBoundary, ToastContainer, ThemeToggle, FolderHistoryDropdown } from './components'
import { readFileWithCache } from './utils/fileCache'
import { createMarkdownRenderer } from './utils/markdownRenderer'
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

  // 监听恢复文件夹事件
  useEffect(() => {
    const cleanup = window.api.onRestoreFolder((folderPath) => {
      setFolderPath(folderPath)
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
          const htmlContent = md.render(content)
          const fileName = data.path.split('/').pop() || 'export'

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

  // 打开文件夹
  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await window.api.openFolder()
      if (path) {
        setFolderPath(path)
        setTabs([])
        setActiveTabId(null)
      }
    } catch (error) {
      console.error('Failed to open folder:', error)
    }
  }, [])

  // 从历史选择文件夹
  const handleSelectHistoryFolder = useCallback(async (path: string) => {
    await window.api.setFolderPath(path)
    setFolderPath(path)
    setTabs([])
    setActiveTabId(null)
  }, [])

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
      setTabs(prev => prev.filter(tab => tab.id === tabId))
      setActiveTabId(tabId)
    })

    const unsubscribeTabCloseAll = window.api.onTabCloseAll(() => {
      setTabs([])
      setActiveTabId(null)
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

    return () => {
      unsubscribeTabClose()
      unsubscribeTabCloseOthers()
      unsubscribeTabCloseAll()
      unsubscribeTabCloseLeft()
      unsubscribeTabCloseRight()
    }
  }, [handleTabClose])

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
      const newTab: Tab = {
        id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        content
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newTab.id)

      // 将文件添加到监听列表（只监听已打开的文件）
      window.api.watchFile(file.path).catch(err => {
        console.error('Failed to watch file:', err)
      })
    } catch (error) {
      console.error('Failed to read file:', error)
      toast.error(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [toast])

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
      const htmlContent = md.render(activeTab.content)

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
      const htmlContent = md.render(activeTab.content)

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
      {/* 标题栏 (macOS 拖拽区域) */}
      <header className="titlebar">
        <div className="titlebar-drag-region" />
        <h1 className="app-title">MD Viewer</h1>
        <div className="titlebar-actions">
          <ThemeToggle theme={theme} onThemeChange={setTheme} />
        </div>
      </header>

      {/* 主内容区 */}
      <main className="main-content">
        {!folderPath ? (
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
            </div>
          </div>
        ) : (
          <div className={`workspace ${isResizing ? 'resizing' : ''}`}>
            <aside className="sidebar" style={{ width: sidebarWidth }}>
              <div className="sidebar-header">
                <div className="sidebar-header-top">
                  <span className="folder-name">{folderPath.split('/').pop()}</span>
                  <div className="sidebar-header-buttons">
                    <button
                      className="refresh-btn"
                      onClick={handleRefreshFiles}
                      title="刷新文件列表"
                      disabled={isLoading}
                    >
                      🔄
                    </button>
                    <FolderHistoryDropdown
                      onSelectFolder={handleSelectHistoryFolder}
                      onOpenFolder={handleOpenFolder}
                    />
                  </div>
                </div>
                <SearchBar ref={searchBarRef} files={files} onFileSelect={handleFileSelect} />
              </div>
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
            {/* 可拖拽分隔条 */}
            <div className="resize-handle" onMouseDown={handleResizeStart} />
            <section className="editor-area">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onTabClick={handleTabClick}
                onTabClose={handleTabClose}
                basePath={folderPath || undefined}
              />
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
            </section>
          </div>
        )}
      </main>
      </div>
    </ErrorBoundary>
  )
}

export default App
