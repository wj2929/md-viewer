import { useState, useEffect, useMemo, useRef } from 'react'

interface FolderHistoryItem {
  path: string
  name: string
  lastOpened: number
}

interface Props {
  onSelectFolder: (path: string) => void
  onOpenFolder: () => void
}

export function FolderHistoryDropdown({ onSelectFolder, onOpenFolder }: Props): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [history, setHistory] = useState<FolderHistoryItem[]>([])
  const [query, setQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 加载历史
  useEffect(() => {
    const loadHistory = async () => {
      const items = await window.api.getFolderHistory()
      setHistory(items)
    }
    loadHistory()
  }, [isOpen])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (path: string) => {
    onSelectFolder(path)
    setIsOpen(false)
    setQuery('')
  }

  const handleRemove = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    await window.api.removeFolderFromHistory(path)
    setHistory(prev => prev.filter(item => item.path !== path))
  }

  const handleOpenClick = () => {
    onOpenFolder()
    setIsOpen(false)
    setQuery('')
  }

  const handleClearAll = async () => {
    await window.api.clearFolderHistory()
    setHistory([])
    setQuery('')
  }

  const filteredHistory = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return history

    return history.filter(item => {
      return item.name.toLowerCase().includes(normalizedQuery)
        || item.path.toLowerCase().includes(normalizedQuery)
    })
  }, [history, query])

  const formatPath = (fullPath: string): string => {
    const homeDir = fullPath.match(/^\/Users\/[^/]+/)?.[0] || ''
    if (homeDir && fullPath.startsWith(homeDir)) {
      return '~' + fullPath.slice(homeDir.length)
    }
    return fullPath
  }

  const formatTime = (timestamp: number): string => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    if (hours < 24) return `${hours} 小时前`
    if (days < 7) return `${days} 天前`
    return new Date(timestamp).toLocaleDateString()
  }

  return (
    <div className="folder-history-dropdown" ref={dropdownRef}>
      <button className="folder-btn" onClick={handleOpenClick} title="切换文件夹">
        📂
      </button>
      <button
        className="history-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="最近打开的文件夹"
        title="最近打开的文件夹"
      >
        ▼
      </button>
      {isOpen && (
        <div className="history-menu">
          <div className="history-header">
            <span>最近打开</span>
            {history.length > 0 && (
              <button
                className="history-clear-btn"
                onClick={handleClearAll}
                title="清空历史"
                aria-label="清空最近文件夹"
              >
                清空
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="history-empty">暂无最近打开的文件夹</div>
          ) : (
            <>
              <div className="history-search">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索最近文件夹..."
                  aria-label="搜索最近文件夹"
                />
              </div>
              {filteredHistory.length === 0 ? (
                <div className="history-empty">未找到匹配文件夹</div>
              ) : (
                <div className="history-list">
                  {filteredHistory.map(item => (
                    <div
                      key={item.path}
                      className="history-item"
                      onClick={() => handleSelect(item.path)}
                    >
                      <div className="history-info">
                        <span className="history-icon">📁</span>
                        <div className="history-details">
                          <span className="history-name" title={item.path}>
                            {item.name}
                          </span>
                          <span className="history-path" title={item.path}>
                            {formatPath(item.path)}
                          </span>
                        </div>
                      </div>
                      <div className="history-actions">
                        <span className="history-time">{formatTime(item.lastOpened)}</span>
                        <button
                          className="history-remove-btn"
                          onClick={(e) => handleRemove(e, item.path)}
                          title="从历史中移除"
                          aria-label={`从历史中移除 ${item.name}`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
