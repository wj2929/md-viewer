/**
 * 浮动导航组件
 * 提供到顶/到底/目录大纲功能
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTableOfContents } from '../hooks/useTableOfContents'
import { useActiveHeading } from '../hooks/useActiveHeading'
import TocPanel from './TocPanel'

interface FloatingNavProps {
  /** 预览区容器 ref */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Markdown 源文本 */
  markdown: string
}

/**
 * 浮动导航组件
 */
const FloatingNav: React.FC<FloatingNavProps> = ({ containerRef, markdown }) => {
  const [showToc, setShowToc] = useState(false)
  const tocButtonRef = useRef<HTMLButtonElement>(null)

  const { toc, scrollToHeading } = useTableOfContents(markdown)
  const activeId = useActiveHeading(toc, containerRef.current)

  // 滚动到顶部
  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [containerRef])

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [containerRef])

  // ESC 关闭目录
  useEffect(() => {
    if (!showToc) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowToc(false)
        tocButtonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [showToc])

  // 处理目录项点击（不关闭面板，保持展开状态）
  const handleTocSelect = useCallback((id: string) => {
    scrollToHeading(id, containerRef.current)
    // 不再自动关闭目录面板
  }, [scrollToHeading, containerRef])

  return (
    <nav className="floating-nav" aria-label="文档导航">
      {/* 到顶部按钮 */}
      <button
        className="floating-nav-btn"
        onClick={scrollToTop}
        aria-label="返回顶部"
        title="返回顶部"
      >
        ▲
      </button>

      {/* 目录按钮 */}
      {toc.length > 0 && (
        <button
          ref={tocButtonRef}
          className="floating-nav-btn"
          onClick={() => setShowToc(!showToc)}
          aria-label="目录"
          aria-expanded={showToc}
          aria-controls="toc-panel"
          title="目录"
        >
          ≡
        </button>
      )}

      {/* 到底部按钮 */}
      <button
        className="floating-nav-btn"
        onClick={scrollToBottom}
        aria-label="跳到底部"
        title="跳到底部"
      >
        ▼
      </button>

      {/* 目录面板 */}
      {showToc && toc.length > 0 && (
        <TocPanel
          toc={toc}
          activeId={activeId}
          onSelect={handleTocSelect}
          onClose={() => {
            setShowToc(false)
            tocButtonRef.current?.focus()
          }}
        />
      )}
    </nav>
  )
}

export default FloatingNav
