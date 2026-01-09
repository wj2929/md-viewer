/**
 * 最近文件下拉菜单组件
 * v1.3.6 新增
 */

import { useState, useEffect, useRef } from 'react'
import './RecentFilesDropdown.css'

interface RecentFile {
  path: string
  name: string
  folderPath: string
  lastOpened: number
}

interface Props {
  onSelectFile: (path: string) => void
}

export function RecentFilesDropdown({ onSelectFile }: Props): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [files, setFiles] = useState<RecentFile[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 加载最近文件
  useEffect(() => {
    if (isOpen) {
      const loadFiles = async () => {
        const items = await window.api.getRecentFiles()
        setFiles(items)
      }
      loadFiles()
    }
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

  const handleSelect = (file: RecentFile) => {
    onSelectFile(file.path)
    setIsOpen(false)
  }

  const handleRemove = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    await window.api.removeRecentFile(path)
    setFiles(prev => prev.filter(item => item.path !== path))
  }

  const handleClearAll = async () => {
    await window.api.clearRecentFiles()
    setFiles([])
  }

  // 格式化路径显示（缩短为 ~/... 形式）
  const formatPath = (fullPath: string): string => {
    const homeDir = fullPath.match(/^\/Users\/[^/]+/)?.[0] || ''
    if (homeDir && fullPath.startsWith(homeDir)) {
      return '~' + fullPath.slice(homeDir.length)
    }
    return fullPath
  }

  // 格式化时间显示
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
    <div className="recent-files-dropdown" ref={dropdownRef}>
      <button
        className="recent-files-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="最近打开的文件"
      >
        🕐
      </button>

      {isOpen && (
        <div className="recent-files-menu">
          <div className="recent-files-header">
            <span>最近文件</span>
            {files.length > 0 && (
              <button
                className="clear-all-btn"
                onClick={handleClearAll}
                title="清空历史"
              >
                清空
              </button>
            )}
          </div>

          {files.length === 0 ? (
            <div className="recent-files-empty">
              暂无最近打开的文件
            </div>
          ) : (
            <div className="recent-files-list">
              {files.map(file => (
                <div
                  key={file.path}
                  className="recent-file-item"
                  onClick={() => handleSelect(file)}
                  title={file.path}
                >
                  <div className="recent-file-info">
                    <span className="recent-file-icon">📄</span>
                    <div className="recent-file-details">
                      <span className="recent-file-name">{file.name}</span>
                      <span className="recent-file-path">{formatPath(file.folderPath)}</span>
                    </div>
                  </div>
                  <div className="recent-file-actions">
                    <span className="recent-file-time">{formatTime(file.lastOpened)}</span>
                    <button
                      className="recent-file-remove-btn"
                      onClick={(e) => handleRemove(e, file.path)}
                      title="从历史中移除"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
