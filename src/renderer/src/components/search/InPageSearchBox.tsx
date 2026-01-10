/**
 * 页面内搜索框组件
 * v1.4.0 新增功能
 *
 * 浮动在右上角，用于在当前 Markdown 文档中搜索
 *
 * 快捷键：
 * - Cmd+Shift+F / Ctrl+Shift+F: 打开/关闭搜索框
 * - Enter: 下一个匹配
 * - Shift+Enter: 上一个匹配
 * - Escape: 关闭搜索框
 */

import React, { useRef, useEffect, useState } from 'react'
import './InPageSearchBox.css'

// ============================================================================
// 类型定义
// ============================================================================

export interface InPageSearchBoxProps {
  /** 是否显示搜索框 */
  visible: boolean
  /** 搜索词 */
  query: string
  /** 搜索词变化回调 */
  onQueryChange: (query: string) => void
  /** 当前匹配索引（0-based） */
  currentIndex: number
  /** 总匹配数 */
  totalCount: number
  /** 跳转到下一个匹配 */
  onNext: () => void
  /** 跳转到上一个匹配 */
  onPrev: () => void
  /** 关闭搜索框 */
  onClose: () => void
  /** v1.4.2: 是否区分大小写 */
  caseSensitive?: boolean
  /** v1.4.2: 切换大小写敏感 */
  onToggleCaseSensitive?: () => void
}

// ============================================================================
// 组件实现
// ============================================================================

export function InPageSearchBox({
  visible,
  query,
  onQueryChange,
  currentIndex,
  totalCount,
  onNext,
  onPrev,
  onClose,
  caseSensitive = false,
  onToggleCaseSensitive
}: InPageSearchBoxProps): React.JSX.Element | null {
  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const inputRef = useRef<HTMLInputElement>(null)

  // -------------------------------------------------------------------------
  // 状态
  // -------------------------------------------------------------------------
  const [isClosing, setIsClosing] = useState(false)

  // -------------------------------------------------------------------------
  // 打开时自动聚焦
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (visible && !isClosing) {
      // 延迟聚焦，等待动画开始
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        // 全选文本，方便用户直接输入新搜索词
        inputRef.current?.select()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [visible, isClosing])

  // -------------------------------------------------------------------------
  // 键盘快捷键
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Enter: 下一个匹配
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onNext()
      }
      // Shift+Enter: 上一个匹配
      else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        onPrev()
      }
      // Escape: 关闭搜索框
      else if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    }

    // 只在搜索框可见时监听
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onNext, onPrev])

  // -------------------------------------------------------------------------
  // 关闭动画
  // -------------------------------------------------------------------------
  const handleClose = () => {
    setIsClosing(true)
    // 等待动画完成后关闭
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 150)
  }

  // -------------------------------------------------------------------------
  // 不可见时不渲染
  // -------------------------------------------------------------------------
  if (!visible && !isClosing) {
    return null
  }

  // -------------------------------------------------------------------------
  // 计算显示文本
  // -------------------------------------------------------------------------
  const hasQuery = query.trim().length > 0
  const hasNoResults = hasQuery && totalCount === 0

  let countDisplay: string
  if (!hasQuery) {
    countDisplay = ''
  } else if (totalCount === 0) {
    countDisplay = '0 个结果'
  } else {
    countDisplay = `${currentIndex + 1} / ${totalCount}`
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------
  return (
    <div
      className={`in-page-search-box ${isClosing ? 'closing' : ''}`}
      role="search"
      aria-label="页面内搜索"
    >
      {/* 输入区域 */}
      <div className="in-page-search-input-wrapper">
        {/* 搜索图标 */}
        <svg
          className="in-page-search-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
        </svg>

        {/* 搜索输入框 */}
        <input
          ref={inputRef}
          type="text"
          className={`in-page-search-input ${hasNoResults ? 'no-results' : ''}`}
          placeholder="在当前文档中搜索..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          maxLength={200}
          aria-label="搜索词"
          aria-describedby={hasQuery ? 'search-count' : undefined}
        />

        {/* 匹配计数 */}
        {countDisplay && (
          <span
            id="search-count"
            className={`in-page-search-count ${hasNoResults ? 'no-results' : ''}`}
            aria-live="polite"
          >
            {countDisplay}
          </span>
        )}
      </div>

      {/* 控制按钮 */}
      <div className="in-page-search-controls">
        {/* v1.4.2: 大小写敏感切换按钮 */}
        {onToggleCaseSensitive && (
          <button
            type="button"
            className={`in-page-search-btn case-toggle ${caseSensitive ? 'active' : ''}`}
            onClick={onToggleCaseSensitive}
            title={caseSensitive ? '区分大小写（已开启）' : '区分大小写（已关闭）'}
            aria-label="切换大小写敏感"
            aria-pressed={caseSensitive}
          >
            Aa
          </button>
        )}

        {/* 上一个按钮 */}
        <button
          type="button"
          className="in-page-search-btn"
          onClick={onPrev}
          disabled={totalCount === 0}
          title="上一个 (Shift+Enter)"
          aria-label="上一个匹配"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 2.5l-4 4h8l-4-4z" />
          </svg>
        </button>

        {/* 下一个按钮 */}
        <button
          type="button"
          className="in-page-search-btn"
          onClick={onNext}
          disabled={totalCount === 0}
          title="下一个 (Enter)"
          aria-label="下一个匹配"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 9.5l4-4H2l4 4z" />
          </svg>
        </button>

        {/* 关闭按钮 */}
        <button
          type="button"
          className="in-page-search-btn in-page-search-close-btn"
          onClick={handleClose}
          title="关闭 (Esc)"
          aria-label="关闭搜索"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M9.5 3.205L8.795 2.5 6 5.295 3.205 2.5l-.705.705L5.295 6 2.5 8.795l.705.705L6 6.705 8.795 9.5l.705-.705L6.705 6 9.5 3.205z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default InPageSearchBox
