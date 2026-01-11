/**
 * 目录面板组件
 * 显示文档大纲，支持点击跳转、键盘导航和自动滚动到当前章节
 * @version 1.4.4
 */

import React, { useRef, useEffect } from 'react'
import type { TocItem } from '../utils/tocExtractor'

interface TocPanelProps {
  /** 目录项数组 */
  toc: TocItem[]
  /** 当前活动标题 ID */
  activeId: string
  /** 选择目录项回调 */
  onSelect: (id: string) => void
  /** 关闭面板回调 */
  onClose: () => void
}

/**
 * 目录面板组件
 *
 * v1.4.4 新增特性：
 * - 自动滚动到当前高亮的章节
 * - 可见性检测（只在不可见时才滚动）
 * - 用户操作保护（300ms 延迟防冲突）
 * - 内存安全（自动清理定时器）
 * - XSS 防护（CSS.escape 转义）
 */
const TocPanel: React.FC<TocPanelProps> = ({ toc, activeId, onSelect, onClose }) => {
  const panelRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLAnchorElement>(null)
  const activeItemRef = useRef<HTMLAnchorElement>(null)
  const scrollTimeoutRef = useRef<number | undefined>(undefined)
  const ignoreScrollRef = useRef(false)
  const isFirstOpenRef = useRef(true)

  // 打开时焦点移到第一个项目
  useEffect(() => {
    firstItemRef.current?.focus()
  }, [])

  // 监听 activeId 变化，自动滚动到激活项
  useEffect(() => {
    if (!activeId || ignoreScrollRef.current) return

    const activeElement = activeItemRef.current
    const contentElement = contentRef.current
    if (!activeElement || !contentElement) return

    // 首次打开时，立即滚动到中央位置
    if (isFirstOpenRef.current) {
      activeElement.scrollIntoView({
        behavior: 'auto',  // 不使用动画，立即定位
        block: 'center'
      })
      isFirstOpenRef.current = false
      return
    }

    // 可见性检测：只在元素不可见时才滚动
    const contentRect = contentElement.getBoundingClientRect()
    const itemRect = activeElement.getBoundingClientRect()

    const isVisible = (
      itemRect.top >= contentRect.top &&
      itemRect.bottom <= contentRect.bottom
    )

    // 如果已经在可视区域内，不需要滚动
    if (!isVisible) {
      activeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',   // 优先保持当前滚动位置，只做最小移动
        inline: 'nearest'
      })
    }
  }, [activeId])

  // 目录项动态变化时，重置状态
  useEffect(() => {
    ignoreScrollRef.current = false
    isFirstOpenRef.current = true
  }, [toc])

  // 清理定时器（防止内存泄漏）
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleTocSelect(id)
    }
  }

  // 统一的选择处理函数（防止用户点击时的冲突）
  const handleTocSelect = (id: string) => {
    // 标记为用户主动点击，暂停自动滚动
    ignoreScrollRef.current = true
    onSelect(id)

    // 清除之前的定时器
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // 300ms 后恢复自动滚动
    // 原因：scrollIntoView 动画 ~200ms + React 状态更新 ~50-100ms
    scrollTimeoutRef.current = window.setTimeout(() => {
      ignoreScrollRef.current = false
    }, 300)
  }

  return (
    <aside
      id="toc-panel"
      ref={panelRef}
      className="toc-panel"
      role="navigation"
      aria-label="文档目录"
    >
      <div className="toc-panel-header">
        <span className="toc-panel-title">目录</span>
        <button
          className="toc-panel-close"
          onClick={onClose}
          aria-label="关闭目录"
        >
          ✕
        </button>
      </div>

      <div className="toc-panel-content" ref={contentRef}>
        {toc.map((item, index) => (
          <a
            key={item.id}
            ref={(el) => {
              // 动态绑定 ref
              if (index === 0) firstItemRef.current = el
              if (activeId === item.id) activeItemRef.current = el
            }}
            href={`#${CSS.escape(item.id)}`}
            className={`toc-item ${activeId === item.id ? 'toc-item-active' : ''}`}
            data-level={item.level}
            onClick={(e) => {
              e.preventDefault()
              handleTocSelect(item.id)
            }}
            onKeyDown={(e) => handleKeyDown(e, item.id)}
            aria-current={activeId === item.id ? 'location' : undefined}
          >
            {item.text}
          </a>
        ))}
      </div>
    </aside>
  )
}

export default TocPanel
