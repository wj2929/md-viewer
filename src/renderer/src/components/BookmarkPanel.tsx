/**
 * 书签面板组件
 * v1.3.6 Phase 3 - 右侧面板
 *
 * 功能：
 * - 侧边栏书签列表
 * - 拖拽排序
 * - 点击跳转（带容错：锚点 → 模糊匹配 → 滚动位置）
 * - 可折叠/展开
 * - 宽度可调整
 *
 * 数据由父组件（App.tsx）统一管理
 */

import { useState, useEffect, useRef } from 'react'
import './BookmarkPanel.css'

interface Bookmark {
  id: string
  filePath: string
  fileName: string
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
  createdAt: number
  order: number
}

interface Props {
  bookmarks: Bookmark[]        // 由父组件传入
  isLoading: boolean           // 由父组件传入
  isCollapsed: boolean
  width: number
  onToggleCollapse: () => void
  onWidthChange: (width: number) => void
  onSelectBookmark: (bookmark: Bookmark) => void
  onBookmarksChange: () => void // 书签变化后通知父组件刷新
  currentFilePath?: string
}

export function BookmarkPanel({
  bookmarks,
  isLoading,
  isCollapsed,
  width,
  onToggleCollapse,
  onWidthChange,
  onSelectBookmark,
  onBookmarksChange,
  currentFilePath
}: Props): JSX.Element {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // 删除书签
  const handleRemove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await window.api.removeBookmark(id)
      // 通知父组件刷新
      onBookmarksChange()
    } catch (error) {
      console.error('[BookmarkPanel] Failed to remove bookmark:', error)
    }
  }

  // 拖拽开始
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  // 拖拽经过
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== draggedId) {
      setDragOverId(id)
    }
  }

  // 拖拽离开
  const handleDragLeave = () => {
    setDragOverId(null)
  }

  // 拖拽结束
  const handleDragEnd = () => {
    setDraggedId(null)
    setDragOverId(null)
  }

  // 放置
  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain')

    if (sourceId === targetId) {
      setDragOverId(null)
      return
    }

    // 计算新顺序
    const newBookmarks = [...bookmarks]
    const sourceIndex = newBookmarks.findIndex(b => b.id === sourceId)
    const targetIndex = newBookmarks.findIndex(b => b.id === targetId)

    if (sourceIndex === -1 || targetIndex === -1) {
      setDragOverId(null)
      return
    }

    // 移动元素
    const [removed] = newBookmarks.splice(sourceIndex, 1)
    newBookmarks.splice(targetIndex, 0, removed)

    // 更新 order
    const reordered = newBookmarks.map((b, i) => ({ ...b, order: i }))

    // 保存到存储
    try {
      await window.api.updateAllBookmarks(reordered)
      // 通知父组件刷新
      onBookmarksChange()
    } catch (error) {
      console.error('[BookmarkPanel] Failed to save bookmarks:', error)
    }

    setDragOverId(null)
  }

  // 宽度调整
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return
      const rect = panelRef.current.getBoundingClientRect()
      // 右侧面板：从右边缘减去鼠标位置计算宽度
      const newWidth = rect.right - e.clientX
      // 限制范围 200-400px
      const clampedWidth = Math.min(Math.max(newWidth, 200), 400)
      onWidthChange(clampedWidth)
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
  }, [isResizing, onWidthChange])

  // 格式化路径显示
  const formatPath = (fullPath: string): string => {
    const homeDir = fullPath.match(/^\/Users\/[^/]+/)?.[0] || ''
    if (homeDir && fullPath.startsWith(homeDir)) {
      return '~' + fullPath.slice(homeDir.length)
    }
    return fullPath
  }

  // 获取显示标题
  const getDisplayTitle = (bookmark: Bookmark): string => {
    return bookmark.title || bookmark.headingText || bookmark.fileName
  }

  // 获取显示副标题
  const getDisplaySubtitle = (bookmark: Bookmark): string => {
    if (bookmark.headingText && bookmark.title !== bookmark.headingText) {
      return `${bookmark.fileName} → ${bookmark.headingText}`
    }
    return formatPath(bookmark.filePath)
  }

  if (isCollapsed) {
    return (
      <div className="bookmark-panel collapsed" ref={panelRef}>
        <button
          className="bookmark-toggle-btn"
          onClick={onToggleCollapse}
          title="展开书签"
        >
          ⭐
        </button>
      </div>
    )
  }

  return (
    <div
      className={`bookmark-panel ${isResizing ? 'resizing' : ''}`}
      style={{ width }}
      ref={panelRef}
    >
      <div className="bookmark-header">
        <span className="bookmark-title">⭐ 书签</span>
        <button
          className="bookmark-collapse-btn"
          onClick={onToggleCollapse}
          title="折叠书签"
        >
          ▶
        </button>
      </div>

      <div className="bookmark-content">
        {isLoading ? (
          <div className="bookmark-loading">加载中...</div>
        ) : bookmarks.length === 0 ? (
          <div className="bookmark-empty">
            <span className="bookmark-empty-icon">📑</span>
            <span>暂无书签</span>
            <span className="bookmark-empty-hint">
              右键点击标签或目录添加书签
            </span>
          </div>
        ) : (
          <div className="bookmark-list">
            {bookmarks.map(bookmark => (
              <div
                key={bookmark.id}
                className={`bookmark-item ${
                  draggedId === bookmark.id ? 'dragging' : ''
                } ${dragOverId === bookmark.id ? 'drag-over' : ''} ${
                  currentFilePath === bookmark.filePath ? 'active' : ''
                }`}
                draggable
                onDragStart={(e) => handleDragStart(e, bookmark.id)}
                onDragOver={(e) => handleDragOver(e, bookmark.id)}
                onDragLeave={handleDragLeave}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, bookmark.id)}
                onClick={() => onSelectBookmark(bookmark)}
                title={bookmark.filePath}
              >
                <div className="bookmark-item-icon">
                  {bookmark.headingId ? '🔖' : '📄'}
                </div>
                <div className="bookmark-item-info">
                  <span className="bookmark-item-title">
                    {getDisplayTitle(bookmark)}
                  </span>
                  <span className="bookmark-item-path">
                    {getDisplaySubtitle(bookmark)}
                  </span>
                </div>
                <button
                  className="bookmark-item-remove"
                  onClick={(e) => handleRemove(e, bookmark.id)}
                  title="删除书签"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 宽度调整手柄 */}
      <div className="bookmark-resize-handle" onMouseDown={handleResizeStart} />
    </div>
  )
}

// 导出书签类型供其他组件使用
export type { Bookmark }
