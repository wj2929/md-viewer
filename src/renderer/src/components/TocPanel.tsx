/**
 * 目录面板组件
 * 显示文档大纲，支持点击跳转和键盘导航
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
 */
const TocPanel: React.FC<TocPanelProps> = ({ toc, activeId, onSelect, onClose }) => {
  const panelRef = useRef<HTMLElement>(null)
  const firstItemRef = useRef<HTMLAnchorElement>(null)

  // 打开时焦点移到第一个项目
  useEffect(() => {
    firstItemRef.current?.focus()
  }, [])

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(id)
    }
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

      <div className="toc-panel-content">
        {toc.map((item, index) => (
          <a
            key={item.id}
            ref={index === 0 ? firstItemRef : undefined}
            href={`#${item.id}`}
            className={`toc-item ${activeId === item.id ? 'toc-item-active' : ''}`}
            data-level={item.level}
            onClick={(e) => {
              e.preventDefault()
              onSelect(item.id)
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
