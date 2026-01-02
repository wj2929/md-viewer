import { useState, useEffect, useCallback } from 'react'
import { FileTree, FileInfo, MarkdownRenderer, TabBar, Tab, SearchBar, ErrorBoundary } from './components'
import { readFileWithCache } from './utils/fileCache'
import { createMarkdownRenderer } from './utils/markdownRenderer'

function App(): JSX.Element {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 监听恢复文件夹事件
  useEffect(() => {
    const cleanup = window.api.onRestoreFolder((folderPath) => {
      setFolderPath(folderPath)
    })
    return cleanup
  }, [])

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

  // 文件监听 - 自动刷新功能
  useEffect(() => {
    if (!folderPath) return

    // 开始监听文件夹
    window.api.watchFolder(folderPath).catch(error => {
      console.error('Failed to watch folder:', error)
    })

    // 监听文件变化 - 刷新已打开的标签页
    const unsubscribeChanged = window.api.onFileChanged(async (filePath: string) => {
      console.log('File changed:', filePath)

      // 查找受影响的标签页
      const affectedTab = tabs.find(tab => tab.file.path === filePath)
      if (affectedTab) {
        try {
          const newContent = await window.api.readFile(filePath)
          setTabs(prev => prev.map(tab =>
            tab.id === affectedTab.id
              ? { ...tab, content: newContent }
              : tab
          ))
        } catch (error) {
          console.error('Failed to reload file:', error)
        }
      }
    })

    // 监听文件添加 - 刷新文件树
    const unsubscribeAdded = window.api.onFileAdded(async () => {
      console.log('File added, refreshing file list')
      try {
        const fileList = await window.api.readDir(folderPath)
        setFiles(fileList)
      } catch (error) {
        console.error('Failed to refresh file list:', error)
      }
    })

    // 监听文件删除 - 刷新文件树并关闭已删除文件的标签
    const unsubscribeRemoved = window.api.onFileRemoved(async (filePath: string) => {
      console.log('File removed:', filePath)

      // 关闭已删除文件的标签
      const removedTab = tabs.find(tab => tab.file.path === filePath)
      if (removedTab) {
        handleTabClose(removedTab.id)
      }

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
  }, [folderPath, tabs, handleTabClose])

  // 选择文件 - 打开新标签或切换到已有标签
  const handleFileSelect = useCallback(async (file: FileInfo) => {
    if (file.isDirectory) return

    // 检查是否已经打开
    const existingTab = tabs.find(tab => tab.file.path === file.path)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    // 使用缓存读取文件内容
    try {
      const content = await readFileWithCache(file.path)
      const newTab: Tab = {
        id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        content
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newTab.id)
    } catch (error) {
      console.error('Failed to read file:', error)
      alert(`无法打开文件：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [tabs])

  // 切换标签
  const handleTabClick = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  // 关闭标签
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

  // 获取当前活动标签
  const activeTab = tabs.find(tab => tab.id === activeTabId)

  // 导出 HTML
  const handleExportHTML = useCallback(async () => {
    if (!activeTab) return

    try {
      // 使用完整配置的 markdown 渲染器（包含 KaTeX 和 Prism）
      const md = createMarkdownRenderer()
      const htmlContent = md.render(activeTab.content)

      const filePath = await window.api.exportHTML(htmlContent, activeTab.file.name)
      if (filePath) {
        alert(`HTML 已导出到：${filePath}`)
      }
    } catch (error) {
      console.error('导出 HTML 失败:', error)
      alert(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeTab])

  // 导出 PDF
  const handleExportPDF = useCallback(async () => {
    if (!activeTab) return

    try {
      // 使用完整配置的 markdown 渲染器（包含 KaTeX 和 Prism）
      const md = createMarkdownRenderer()
      const htmlContent = md.render(activeTab.content)

      const filePath = await window.api.exportPDF(htmlContent, activeTab.file.name)
      if (filePath) {
        alert(`PDF 已导出到：${filePath}`)
      }
    } catch (error) {
      console.error('导出 PDF 失败:', error)
      alert(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeTab])

  return (
    <ErrorBoundary>
      <div className="app">
      {/* 标题栏 (macOS 拖拽区域) */}
      <header className="titlebar">
        <div className="titlebar-drag-region" />
        <h1 className="app-title">MD Viewer</h1>
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
                  <button className="change-folder-btn" onClick={handleOpenFolder}>
                    切换
                  </button>
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
                    <MarkdownRenderer content={activeTab.content} />
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
