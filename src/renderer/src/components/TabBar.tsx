import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FileInfo } from './FileTree'

export interface Tab {
  id: string
  file: FileInfo
  content: string
  isPinned?: boolean  // v1.3.6 新增：是否固定
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string | null
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabPin?: (tabId: string) => void      // v1.3.6 新增
  onTabUnpin?: (tabId: string) => void    // v1.3.6 新增
  basePath?: string
  // v1.3.6 Phase 3：书签栏触发按钮
  bookmarkBarCollapsed?: boolean
  bookmarkCount?: number
  onShowBookmarkBar?: () => void
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onTabPin, onTabUnpin, basePath, bookmarkBarCollapsed, bookmarkCount, onShowBookmarkBar }: TabBarProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [scrollState, setScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false
  })

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current
    if (!element) return

    const hasOverflow = element.scrollWidth > element.clientWidth + 1
    const canScrollLeft = element.scrollLeft > 0
    const canScrollRight = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    setScrollState(prev => {
      if (
        prev.hasOverflow === hasOverflow &&
        prev.canScrollLeft === canScrollLeft &&
        prev.canScrollRight === canScrollRight
      ) {
        return prev
      }
      return { hasOverflow, canScrollLeft, canScrollRight }
    })
  }, [])

  const scrollTabs = useCallback((direction: 'left' | 'right') => {
    const element = scrollRef.current
    if (!element) return
    element.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' })
    window.setTimeout(updateScrollState, 120)
  }, [updateScrollState])

  const handleMoreTabClick = useCallback((tabId: string) => {
    onTabClick(tabId)
    setShowMoreMenu(false)
  }, [onTabClick])

  const handleMoreTabClose = useCallback((e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation()
    if (tab.isPinned) return
    onTabClose(tab.id)
  }, [onTabClose])

  // v1.3.6 Day 7.6：无标签时，如果没有书签，完全不渲染（避免空 TabBar）
  if (tabs.length === 0) {
    // 只有书签数量 > 0 时才显示触发按钮
    if (!bookmarkBarCollapsed || !bookmarkCount || bookmarkCount === 0) {
      return <></>  // 完全不渲染
    }

    return (
      <div className="tabs">
        {/* 书签触发按钮（折叠状态显示） */}
        <button
          className="tab-bar-bookmark-trigger"
          onClick={onShowBookmarkBar}
          title={`显示书签栏 (${bookmarkCount} 个书签)`}
          aria-label="显示书签栏"
          aria-expanded="false"
        >
          <span className="tab-bar-bookmark-icon">⭐</span>
          <span className="tab-bar-bookmark-badge">{bookmarkCount}</span>
        </button>
      </div>
    )
  }

  // v1.3.6：对标签排序，固定的在前面
  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return 0
  })

  const handleCloseClick = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation()
    // v1.3.6：固定标签不显示关闭按钮，但如果点击了也要处理
    if (tab.isPinned) return
    onTabClose(tab.id)
  }

  // v1.3 新增：右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, tab: Tab, index: number) => {
    e.preventDefault()
    e.stopPropagation()

    if (!basePath) return

    window.api.showTabContextMenu({
      tabId: tab.id,
      filePath: tab.file.path,
      basePath,
      tabCount: tabs.length,
      tabIndex: index,
      isPinned: tab.isPinned  // v1.3.6 新增
    }).catch(error => {
      console.error('[TabBar] Failed to show context menu:', error)
    })
  }, [tabs.length, basePath])

  useLayoutEffect(() => {
    updateScrollState()
  }, [sortedTabs.length, activeTabId, bookmarkBarCollapsed, bookmarkCount, updateScrollState])

  useLayoutEffect(() => {
    if (!activeTabId) return
    const element = scrollRef.current?.querySelector(`[data-tab-id="${activeTabId}"]`)
    if (element instanceof HTMLElement && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    updateScrollState()
  }, [activeTabId, updateScrollState])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollState)
      : null
    resizeObserver?.observe(element)
    window.addEventListener('resize', updateScrollState)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateScrollState)
    }
  }, [updateScrollState])

  useEffect(() => {
    if (!showMoreMenu) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) {
        setShowMoreMenu(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMoreMenu(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showMoreMenu])

  return (
    <div className="tabs">
      {scrollState.hasOverflow && (
        <button
          type="button"
          className="tab-scroll-btn tab-scroll-btn-left"
          onClick={() => scrollTabs('left')}
          disabled={!scrollState.canScrollLeft}
          aria-label="向左滚动标签"
          title="向左滚动标签"
        >
          ‹
        </button>
      )}

      <div className="tabs-scroll" ref={scrollRef} onScroll={updateScrollState}>
        {sortedTabs.map((tab, index) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''} ${tab.isPinned ? 'pinned' : ''}`}
            onClick={() => onTabClick(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab, index)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/tab-id', tab.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            role="tab"
            aria-selected={tab.id === activeTabId}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onTabClick(tab.id)
              }
            }}
          >
            {/* v1.3.6：固定标签显示图钉图标 */}
            {tab.isPinned ? (
              <span className="tab-pin-icon" title="已固定">📌</span>
            ) : (
              <span className="tab-icon">📄</span>
            )}
            <span className="tab-name" title={tab.file.path}>
              {tab.file.name}
            </span>
            {/* v1.3.6：固定标签不显示关闭按钮 */}
            {!tab.isPinned && (
              <button
                className="tab-close"
                onClick={(e) => handleCloseClick(e, tab)}
                aria-label={`关闭 ${tab.file.name}`}
                title="关闭标签"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {scrollState.hasOverflow && (
        <button
          type="button"
          className="tab-scroll-btn tab-scroll-btn-right"
          onClick={() => scrollTabs('right')}
          disabled={!scrollState.canScrollRight}
          aria-label="向右滚动标签"
          title="向右滚动标签"
        >
          ›
        </button>
      )}

      {scrollState.hasOverflow && (
        <div className="tab-more-menu-wrap" ref={moreMenuRef}>
          <button
            type="button"
            className="tab-more-btn"
            onClick={() => setShowMoreMenu(prev => !prev)}
            aria-label="显示全部打开文档"
            aria-haspopup="menu"
            aria-expanded={showMoreMenu}
            title="显示全部打开文档"
          >
            ⋯
          </button>
          {showMoreMenu && (
            <div className="tab-more-menu" role="menu" aria-label="全部打开文档">
              <div className="tab-more-menu-title">全部打开文档</div>
              <div className="tab-more-menu-list">
                {sortedTabs.map(tab => (
                  <div
                    key={tab.id}
                    className={`tab-more-menu-item ${tab.id === activeTabId ? 'active' : ''}`}
                    role="menuitemradio"
                    aria-label={tab.file.name}
                    aria-checked={tab.id === activeTabId}
                    tabIndex={0}
                    title={tab.file.path}
                    onClick={() => handleMoreTabClick(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleMoreTabClick(tab.id)
                      }
                    }}
                  >
                    <span className="tab-more-check" aria-hidden="true">{tab.id === activeTabId ? '✓' : ''}</span>
                    <span className="tab-more-name">{tab.file.name}</span>
                    {tab.isPinned ? (
                      <span className="tab-more-pin" title="已固定" aria-label="已固定">📌</span>
                    ) : (
                      <button
                        type="button"
                        className="tab-more-close"
                        onClick={(event) => handleMoreTabClose(event, tab)}
                        aria-label={`从更多菜单关闭 ${tab.file.name}`}
                        title="关闭标签"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* v1.3.6 Phase 3：书签栏触发按钮（折叠状态显示） */}
      {bookmarkBarCollapsed && onShowBookmarkBar && (
        <button
          className="tab-bar-bookmark-trigger"
          onClick={onShowBookmarkBar}
          title={
            bookmarkCount && bookmarkCount > 0
              ? `显示书签栏 (${bookmarkCount} 个书签)`
              : '显示书签栏（右键标签添加书签）'
          }
          aria-label="显示书签栏"
          aria-expanded="false"
        >
          <span className="tab-bar-bookmark-icon">⭐</span>
          {/* 只有书签数量 > 0 时才显示 Badge */}
          {bookmarkCount && bookmarkCount > 0 && (
            <span className="tab-bar-bookmark-badge">{bookmarkCount}</span>
          )}
        </button>
      )}
    </div>
  )
}
