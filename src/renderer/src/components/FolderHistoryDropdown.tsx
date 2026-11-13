import { useState, useEffect, useMemo, useRef, useId } from 'react'
import { UiIcon } from './UiIcon'
import { useFolderHistorySearch } from '../hooks/useFolderHistorySearch'

interface FolderHistoryItem {
  id: string
  path: string
  name: string
  lastOpened: number
}

interface Props {
  onSelectFolder: (historyId: string) => void
  onOpenFolder: () => void
}

export function FolderHistoryDropdown({ onSelectFolder, onOpenFolder }: Props): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [history, setHistory] = useState<FolderHistoryItem[]>([])
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

  const handleSelect = (historyId: string) => {
    onSelectFolder(historyId)
    setIsOpen(false)
    setQuery('')
  }

  const handleRemove = async (e: React.MouseEvent, historyId: string) => {
    e.stopPropagation()
    await window.api.removeFolderFromHistory(historyId)
    setHistory(prev => prev.filter(item => item.id !== historyId))
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

  const folderSearch = useFolderHistorySearch({
    open: isOpen, query, history, directMatches: filteredHistory, composing,
  })
  const { settings } = folderSearch
  const pinyinOpen = filteredHistory.length === 0 || pinyinExpanded
  const visiblePinyin = showAllPinyin ? folderSearch.pinyin : folderSearch.pinyin.slice(0, 5)

  useEffect(() => {
    if (!isOpen) setComposing(false)
    setPinyinExpanded(false)
    setShowAllPinyin(false)
  }, [query, isOpen, folderSearch.enabled])

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

  const renderHistoryItem = (item: FolderHistoryItem): JSX.Element => (
    <div
      key={item.id}
      className="history-item"
      role="button"
      tabIndex={0}
      aria-label={`打开文件夹 ${item.name}，${formatPath(item.path)}`}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || composing || event.nativeEvent.isComposing) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleSelect(item.id)
        }
      }}
      onClick={() => handleSelect(item.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void window.api.showRecentFolderContextMenu(item.id).catch(error => {
          console.error('Failed to show recent folder context menu:', error)
        })
      }}
    >
      <div className="history-info">
        <span className="history-icon"><UiIcon name="folder" /></span>
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
          onClick={(e) => handleRemove(e, item.id)}
          title="从历史中移除"
          aria-label={`从历史中移除 ${item.name}`}
        >
          ×
        </button>
      </div>
    </div>
  )

  return (
    <div className="folder-history-dropdown" ref={dropdownRef} onKeyDown={(event) => {
      if (event.key === 'Escape' && isOpen) {
        event.stopPropagation()
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }}>
      <button
        className="folder-btn nav-instant-tooltip"
        onClick={handleOpenClick}
        data-tooltip="切换文件夹"
        aria-label="切换文件夹"
      >
        <UiIcon name="folder-open" />
      </button>
      <button
        className="history-toggle-btn nav-instant-tooltip"
        ref={triggerRef}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="最近打开的文件夹"
        data-tooltip="最近打开的文件夹"
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
          <div className="history-search">
            {history.length > 0 && <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              placeholder="搜索最近文件夹..."
              aria-label="搜索最近文件夹"
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
          {history.length === 0 ? (
            <div className="history-empty">暂无最近打开的文件夹</div>
          ) : (
            <div className="history-results">
              {filteredHistory.length > 0 && <div className="history-list">{filteredHistory.map(renderHistoryItem)}</div>}
              {folderSearch.loading && <div className="folder-pinyin-status" role="status">拼音加载中…</div>}
              {folderSearch.error && <div className="folder-pinyin-status" role="status">{folderSearch.error}</div>}
              {folderSearch.pinyin.length > 0 && <div className="folder-pinyin-group">
                <button
                  ref={pinyinToggleRef}
                  className="folder-pinyin-heading"
                  aria-expanded={pinyinOpen}
                  aria-controls={pinyinId}
                  onClick={() => {
                    if (pinyinListRef.current?.contains(document.activeElement)) pinyinToggleRef.current?.focus()
                    setPinyinExpanded(!pinyinOpen)
                  }}
                  disabled={filteredHistory.length === 0}
                >
                  {pinyinOpen ? '▾' : '▸'} {filteredHistory.length > 0 ? '拼音补充' : '拼音匹配'} · {
                    pinyinOpen && !showAllPinyin && folderSearch.pinyin.length > 5
                      ? `前 5 / ${folderSearch.pinyin.length}` : folderSearch.pinyin.length
                  }
                </button>
                {pinyinOpen && <>
                  <div id={pinyinId} ref={pinyinListRef} className="folder-pinyin-list">{visiblePinyin.map(renderHistoryItem)}</div>
                  {folderSearch.pinyin.length > 5 && <button
                    ref={limitRef}
                    className="folder-pinyin-more"
                    onClick={() => {
                      if (pinyinListRef.current?.contains(document.activeElement)) limitRef.current?.focus()
                      setShowAllPinyin(!showAllPinyin)
                    }}
                  >{showAllPinyin ? '仅显示前 5 项' : `显示其余 ${folderSearch.pinyin.length - 5} 项`}</button>}
                </>}
              </div>}
              {filteredHistory.length === 0 && folderSearch.pinyin.length === 0 && !folderSearch.loading && !folderSearch.error && <div className="history-empty">
                未找到匹配文件夹
                {folderSearch.showHint && <div className="folder-pinyin-hint">可输入名称拼音的前几个字母（至少3个，如 yan），或直接输入中文。</div>}
              </div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
