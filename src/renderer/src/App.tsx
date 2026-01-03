import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FileTree, FileInfo, VirtualizedMarkdown, TabBar, Tab, SearchBar, ErrorBoundary, ToastContainer, ThemeToggle } from './components'
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
  const toast = useToast()
  const { theme, setTheme } = useTheme()

  // 剪贴板 Store (v1.2 阶段 2)
  const { copy, cut, paste } = useClipboardStore()

  // 使用 ref 来存储最新的 tabs，避免闭包陷阱
  const tabsRef = useRef<Tab[]>([])
  tabsRef.current = tabs

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
            if (result) toast.success(`HTML 已导出到：${result}`)
          } else {
            const result = await window.api.exportPDF(htmlContent, fileName)
            if (result) toast.success(`PDF 已导出到：${result}`)
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

    // 剪贴板事件 (v1.2 阶段 2)
    const unsubscribeCopy = window.api.onClipboardCopy((paths: string[]) => {
      copy(paths)
      toast.success(`已复制 ${paths.length} 个文件`)
    })

    const unsubscribeCut = window.api.onClipboardCut((paths: string[]) => {
      cut(paths)
      toast.success(`已剪切 ${paths.length} 个文件`)
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
  }, [folderPath, copy, cut, paste, toast])

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

    // 清理：停止监听
    return () => {
      window.api.unwatchFolder().catch(error => {
        console.error('Failed to unwatch folder:', error)
      })
      unsubscribeChanged()
      unsubscribeAdded()
      unsubscribeRemoved()
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

  // 导出 HTML
  const handleExportHTML = useCallback(async () => {
    if (!activeTab) return

    try {
      // 使用完整配置的 markdown 渲染器（包含 KaTeX 和 Prism）
      const md = createMarkdownRenderer()
      const htmlContent = md.render(activeTab.content)

      const filePath = await window.api.exportHTML(htmlContent, activeTab.file.name)
      if (filePath) {
        toast.success(`HTML 已导出到：${filePath}`)
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
        toast.success(`PDF 已导出到：${filePath}`)
      }
    } catch (error) {
      console.error('导出 PDF 失败:', error)
      toast.error(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeTab, toast])

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
            <button className="open-folder-btn" onClick={handleOpenFolder}>
              打开文件夹
            </button>
          </div>
        ) : (
          <div className="workspace">
            <aside className="sidebar">
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
                    <button className="change-folder-btn" onClick={handleOpenFolder}>
                      切换
                    </button>
                  </div>
                </div>
                <SearchBar files={files} onFileSelect={handleFileSelect} />
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
                  />
                )}
              </div>
            </aside>
            <section className="editor-area">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onTabClick={handleTabClick}
                onTabClose={handleTabClose}
              />
              <div className="preview">
                {activeTab ? (
                  <>
                    <div className="preview-toolbar">
                      <button onClick={handleExportHTML} className="export-btn">
                        导出 HTML
                      </button>
                      <button onClick={handleExportPDF} className="export-btn">
                        导出 PDF
                      </button>
                    </div>
                    <VirtualizedMarkdown content={activeTab.content} />
                  </>
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
