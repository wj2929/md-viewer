/**
 * BookmarkBar 组件 - 横向书签栏
 * v1.3.6 混合方案 Phase 3
 *
 * 功能：
 * - 横向显示收藏的书签（最多显示 10 个）
 * - 超过 10 个显示"更多"按钮
 * - 可折叠/展开
 * - 点击书签跳转到对应文件
 *
 * 数据由父组件（App.tsx）统一管理
 */

import type { Bookmark } from './BookmarkPanel'
import './BookmarkBar.css'

interface Props {
  bookmarks: Bookmark[]        // 由父组件传入
  isLoading: boolean           // 由父组件传入
  isCollapsed: boolean
  onToggleCollapse: () => void
  onSelectBookmark: (bookmark: Bookmark) => void
  onShowMoreClick: () => void  // 点击"更多"按钮时触发
  currentFilePath?: string
}

// 最多显示的书签数量
const MAX_VISIBLE_BOOKMARKS = 10

export function BookmarkBar({
  bookmarks,
  isLoading,
  isCollapsed,
  onToggleCollapse,
  onSelectBookmark,
  onShowMoreClick,
  currentFilePath
}: Props): JSX.Element {
  // 获取显示标题（简短版本）
  const getDisplayTitle = (bookmark: Bookmark): string => {
    const title = bookmark.title || bookmark.headingText || bookmark.fileName
    // 限制长度
    return title.length > 20 ? title.slice(0, 18) + '...' : title
  }

  // 可见的书签（前 10 个）
  const visibleBookmarks = bookmarks.slice(0, MAX_VISIBLE_BOOKMARKS)
  // 剩余的书签数量
  const remainingCount = Math.max(0, bookmarks.length - MAX_VISIBLE_BOOKMARKS)

  // 折叠状态
  if (isCollapsed) {
    return (
      <div className="bookmark-bar collapsed">
        <button
          className="bookmark-bar-toggle"
          onClick={onToggleCollapse}
          title="展开书签栏"
        >
          <span className="bookmark-bar-toggle-icon">⭐</span>
          <span className="bookmark-bar-toggle-count">{bookmarks.length}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="bookmark-bar">
      {/* 折叠按钮 */}
      <button
        className="bookmark-bar-toggle"
        onClick={onToggleCollapse}
        title="折叠书签栏"
      >
        <span className="bookmark-bar-toggle-icon">⭐</span>
      </button>

      {/* 书签列表 */}
      <div className="bookmark-bar-list">
        {isLoading ? (
          <span className="bookmark-bar-loading">加载中...</span>
        ) : bookmarks.length === 0 ? (
          <span className="bookmark-bar-empty">暂无书签，右键标签添加</span>
        ) : (
          <>
            {visibleBookmarks.map(bookmark => (
              <button
                key={bookmark.id}
                className={`bookmark-bar-item ${
                  currentFilePath === bookmark.filePath ? 'active' : ''
                }`}
                onClick={() => onSelectBookmark(bookmark)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  window.api.showBookmarkContextMenu({
                    id: bookmark.id,
                    filePath: bookmark.filePath,
                    fileName: bookmark.fileName,
                    headingText: bookmark.headingText
                  })
                }}
                title={`${bookmark.fileName}${bookmark.headingText ? ' → ' + bookmark.headingText : ''}`}
              >
                <span className="bookmark-bar-item-icon">
                  {bookmark.headingId ? '🔖' : '📄'}
                </span>
                <span className="bookmark-bar-item-title">
                  {getDisplayTitle(bookmark)}
                </span>
              </button>
            ))}

            {/* 更多按钮 */}
            {remainingCount > 0 && (
              <button
                className="bookmark-bar-more"
                onClick={onShowMoreClick}
                title={`还有 ${remainingCount} 个书签`}
              >
                更多 {remainingCount} ▼
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
