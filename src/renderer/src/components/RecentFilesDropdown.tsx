/**
 * 最近文件下拉菜单组件
 * v1.3.6 新增
 */

import { useState, useEffect, useMemo, useRef, useId } from 'react'
import { useFolderHistorySearch } from '../hooks/useFolderHistorySearch'
import { useFilePreview } from '../hooks/useFilePreview'
import { FilePreviewTooltip } from './FilePreviewTooltip'
import './RecentFilesDropdown.css'

interface RecentFile {
  id: string
  path: string
  name: string
  folderPath: string
  lastOpened: number
}

interface Props {
  onSelectFile: (recentId: string) => void
}

export function RecentFilesDropdown({ onSelectFile }: Props): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [files, setFiles] = useState<RecentFile[]>([])
  const [query, setQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pinyinListRef = useRef<HTMLDivElement>(null)
  const pinyinToggleRef = useRef<HTMLButtonElement>(null)
  const limitRef = useRef<HTMLButtonElement>(null)
  const pinyinId = useId()
  const [composing, setComposing] = useState(false)
  const [pinyinExpanded, setPinyinExpanded] = useState(false)
  const [showAllPinyin, setShowAllPinyin] = useState(false)
  const { tooltipProps, handleMouseEnter, handleMouseLeave } = useFilePreview()

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

  // 监听主进程右键菜单"从历史中移除"事件
  useEffect(() => {
    const cleanup = window.api.onRecentFileRemove((filePath: string) => {
      window.api.removeRecentFile(filePath)
      setFiles(prev => prev.filter(item => item.path !== filePath))
    })
    return cleanup
  }, [])

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
    onSelectFile(file.id)
    setQuery('')
    setIsOpen(false)
  }

  const handleRemove = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    await window.api.removeRecentFile(path)
    setFiles(prev => prev.filter(item => item.path !== path))
  }

  const handleContextMenu = (e: React.MouseEvent, file: RecentFile) => {
    e.preventDefault()
    e.stopPropagation()
    void window.api.showRecentFileContextMenu(file.id).catch(error => {
      console.error('Failed to show recent file context menu:', error)
    })
  }

  const handleClearAll = async () => {
    await window.api.clearRecentFiles()
    setFiles([])
    setQuery('')
  }

  const filteredFiles = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return files
    return files.filter(file => {
      return [file.name, file.path, file.folderPath].some(value =>
        value.toLowerCase().includes(keyword)
      )
    })
  }, [files, query])

  const fileSearch = useFolderHistorySearch({
    open: isOpen, query, history: files, directMatches: filteredFiles, composing,
  })
  const { settings } = fileSearch
  const pinyinOpen = filteredFiles.length === 0 || pinyinExpanded
  const visiblePinyin = showAllPinyin ? fileSearch.pinyin : fileSearch.pinyin.slice(0, 5)

  useEffect(() => {
    if (!isOpen) setComposing(false)
    setPinyinExpanded(false)
    setShowAllPinyin(false)
  }, [query, isOpen, fileSearch.enabled])

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

  const renderFileItem = (file: RecentFile): JSX.Element => (
    <div
      key={file.path}
      className="recent-file-item"
      role="button"
      tabIndex={0}
      aria-label={`打开文件 ${file.name}，${formatPath(file.folderPath)}`}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || composing || event.nativeEvent.isComposing) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleSelect(file)
        }
      }}
      onClick={() => handleSelect(file)}
      onContextMenu={(e) => handleContextMenu(e, file)}
      onMouseEnter={(e) => handleMouseEnter(file.path, e)}
      onMouseLeave={handleMouseLeave}
      aria-describedby="file-preview-tooltip"
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
          aria-label={`从历史中移除 ${file.name}`}
        >
          ×
        </button>
      </div>
    </div>
  )

  return (
    <div className="recent-files-dropdown" ref={dropdownRef} onKeyDown={(event) => {
      if (event.key === 'Escape' && isOpen) {
        event.stopPropagation()
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }}>
      <button
        className="recent-files-btn nav-instant-tooltip"
        ref={triggerRef}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        data-tooltip="最近打开的文件"
        aria-label="最近打开的文件"
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
                aria-label="清空最近文件"
              >
                清空
              </button>
            )}
          </div>

          <div className="recent-files-search">
            {files.length > 0 && <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              placeholder="搜索最近文件..."
              aria-label="搜索最近文件"
              autoFocus
            />}
            <div className="folder-search-option">
              <label><input
                type="checkbox"
                checked={settings.pending ?? settings.enabled}
                disabled={settings.hydration !== 'ready' || settings.saving}
                onChange={(event) => void settings.setEnabled(event.target.checked)}
              />拼音搜索</label>
              <span role="status">{settings.saving ? '保存中…' : settings.hydration === 'loading' ? '读取中…' : settings.error}</span>
            </div>
          </div>
          {files.length === 0 ? (
            <div className="recent-files-empty">暂无最近打开的文件</div>
          ) : (
            <div className="recent-files-results">
              {filteredFiles.length > 0 && <div className="recent-files-list">{filteredFiles.map(renderFileItem)}</div>}
              {fileSearch.loading && <div className="folder-pinyin-status" role="status">拼音加载中…</div>}
              {fileSearch.error && <div className="folder-pinyin-status" role="status">{fileSearch.error}</div>}
              {fileSearch.pinyin.length > 0 && <div className="folder-pinyin-group">
                <button
                  ref={pinyinToggleRef}
                  className="folder-pinyin-heading"
                  aria-expanded={pinyinOpen}
                  aria-controls={pinyinId}
                  onClick={() => {
                    if (pinyinListRef.current?.contains(document.activeElement)) pinyinToggleRef.current?.focus()
                    setPinyinExpanded(!pinyinOpen)
                  }}
                  disabled={filteredFiles.length === 0}
                >
                  {pinyinOpen ? '▾' : '▸'} {filteredFiles.length > 0 ? '拼音补充' : '拼音匹配'} · {
                    pinyinOpen && !showAllPinyin && fileSearch.pinyin.length > 5
                      ? `前 5 / ${fileSearch.pinyin.length}` : fileSearch.pinyin.length
                  }
                </button>
                {pinyinOpen && <>
                  <div id={pinyinId} ref={pinyinListRef} className="folder-pinyin-list">{visiblePinyin.map(renderFileItem)}</div>
                  {fileSearch.pinyin.length > 5 && <button
                    ref={limitRef}
                    className="folder-pinyin-more"
                    onClick={() => {
                      if (pinyinListRef.current?.contains(document.activeElement)) limitRef.current?.focus()
                      setShowAllPinyin(!showAllPinyin)
                    }}
                  >{showAllPinyin ? '仅显示前 5 项' : `显示其余 ${fileSearch.pinyin.length - 5} 项`}</button>}
                </>}
              </div>}
              {filteredFiles.length === 0 && fileSearch.pinyin.length === 0 && !fileSearch.loading && !fileSearch.error && <div className="recent-files-empty">
                未找到匹配文件
                {fileSearch.showHint && <div className="folder-pinyin-hint">可输入文件名拼音的前几个字母（至少3个，如 yan），或直接输入中文。</div>}
              </div>}
            </div>
          )}
        </div>
      )}
      <FilePreviewTooltip {...tooltipProps} />
    </div>
  )
}
