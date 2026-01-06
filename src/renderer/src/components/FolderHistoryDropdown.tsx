import { useState, useEffect, useRef } from 'react'

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
  }

  const handleRemove = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    await window.api.removeFolderFromHistory(path)
    setHistory(prev => prev.filter(item => item.path !== path))
  }

  const handleOpenClick = () => {
    onOpenFolder()
    setIsOpen(false)
  }

  return (
    <div className="folder-history-dropdown" ref={dropdownRef}>
      <button className="folder-btn" onClick={handleOpenClick} title="切换文件夹">
        📂
      </button>
      <button
        className="history-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="最近打开的文件夹"
      >
        ▼
      </button>
      {isOpen && (
        <div className="history-menu">
          <div className="history-header">最近打开</div>
          {history.length === 0 ? (
            <div className="history-empty">暂无历史记录</div>
          ) : (
            history.map(item => (
              <div
                key={item.path}
                className="history-item"
                onClick={() => handleSelect(item.path)}
              >
                <span className="history-name" title={item.path}>
                  {item.name}
                </span>
                <button
                  className="history-remove-btn"
                  onClick={(e) => handleRemove(e, item.path)}
                  title="从历史中移除"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
