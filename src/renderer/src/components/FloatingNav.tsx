/**
 * 浮动导航组件
 * 提供到顶/到底/目录大纲功能
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTableOfContents } from '../hooks/useTableOfContents'
import { useActiveHeading } from '../hooks/useActiveHeading'
import { getActiveWorkspaceLifecycleKey, isActiveWorkspaceLifecycleKey } from '../utils/workspaceOperationContext'
import TocPanel from './TocPanel'
import BacklinksPanel, { type BacklinkItem, type BacklinkStats } from './BacklinksPanel'

type NavigationPanel = 'none' | 'toc' | 'backlinks'

interface FloatingNavProps {
  /** 预览区容器 ref */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Markdown 源文本 */
  markdown: string
  /** 当前文档绝对路径；提供后显示工作区反向链接入口 */
  filePath?: string
  /** 打开反链来源文档并显式定位 */
  onBacklinkSelect?: (item: BacklinkItem, sourceFilePath: string) => void
}

/**
 * 浮动导航组件
 */
const FloatingNav: React.FC<FloatingNavProps> = ({ containerRef, markdown, filePath, onBacklinkSelect }) => {
  const [panel, setPanel] = useState<NavigationPanel>('none')
  const [backlinkStats, setBacklinkStats] = useState<BacklinkStats>({
    sourceDocuments: 0,
    occurrences: 0,
  })
  const [showBacklinks, setShowBacklinks] = useState(false)
  const tocButtonRef = useRef<HTMLButtonElement>(null)
  const backlinksButtonRef = useRef<HTMLButtonElement>(null)

  const { toc, scrollToHeading } = useTableOfContents(markdown)
  const activeId = useActiveHeading(toc, containerRef.current)
  const workspace = getActiveWorkspaceLifecycleKey()
  const targetRelativePath = useMemo(() => {
    if (!filePath || !workspace?.primaryRoot) return null
    const root = workspace.primaryRoot.replace(/[\\/]+$/, '')
    if (filePath === root || (!filePath.startsWith(`${root}/`) && !filePath.startsWith(`${root}\\`))) return null
    const relativePath = filePath.slice(root.length + 1).replace(/\\/g, '/')
    return relativePath && !relativePath.split('/').includes('..') ? relativePath : null
  }, [filePath, workspace?.primaryRoot])

  useEffect(() => {
    const lifecycle = getActiveWorkspaceLifecycleKey()
    setPanel(current => current === 'backlinks' ? 'none' : current)
    setBacklinkStats({ sourceDocuments: 0, occurrences: 0 })
    setShowBacklinks(false)
    if (!targetRelativePath || !onBacklinkSelect || !lifecycle?.primaryRoot || !window.api.getWorkspaceBacklinks) return

    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const items = await window.api.getWorkspaceBacklinks(lifecycle, targetRelativePath)
        if (cancelled || !isActiveWorkspaceLifecycleKey(lifecycle)) return
        const sourceDocuments = new Set(items.map(item => item.sourceRelativePath)).size
        setBacklinkStats({ sourceDocuments, occurrences: items.length })
        setShowBacklinks(items.length > 0)
      } catch {
        if (cancelled || !isActiveWorkspaceLifecycleKey(lifecycle)) return
        setShowBacklinks(true)
      }
    }
    void refresh()
    const unsubscribe = window.api.subscribeWorkspaceIndexStatus?.(lifecycle, status => {
      if (status.state === 'ready' || status.state === 'degraded' || status.state === 'read-only') void refresh()
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [onBacklinkSelect, targetRelativePath])

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

  // ESC 关闭当前面板并回焦触发按钮
  useEffect(() => {
    if (panel === 'none') return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const activePanel = panel
        setPanel('none')
        if (activePanel === 'toc') tocButtonRef.current?.focus()
        else backlinksButtonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [panel])

  // 处理目录项点击（不关闭面板，保持展开状态）
  const handleTocSelect = useCallback((id: string) => {
    scrollToHeading(id, containerRef.current)
    // 不再自动关闭目录面板
  }, [scrollToHeading, containerRef])

  const handleBacklinkStatsChange = useCallback((stats: BacklinkStats) => {
    setBacklinkStats(stats)
    setShowBacklinks(stats.occurrences > 0)
  }, [])

  return (
    <nav className={`floating-nav ${panel !== 'none' ? 'panel-open' : ''}`} aria-label="文档导航">
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
          onClick={() => setPanel(current => current === 'toc' ? 'none' : 'toc')}
          aria-label="目录"
          aria-expanded={panel === 'toc'}
          aria-controls="toc-panel"
          title="目录"
        >
          ≡
        </button>
      )}

      {showBacklinks && targetRelativePath && onBacklinkSelect && (
        <button
          ref={backlinksButtonRef}
          className="floating-nav-btn"
          onClick={() => setPanel(current => current === 'backlinks' ? 'none' : 'backlinks')}
          aria-label={`链接到这里，${backlinkStats.sourceDocuments} 个文档`}
          aria-expanded={panel === 'backlinks'}
          aria-controls="backlinks-panel"
          title="链接到这里"
        >
          ⇐{backlinkStats.sourceDocuments > 0 && (
            <span className="floating-nav-count">{backlinkStats.sourceDocuments}</span>
          )}
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

      {/* 目录与反向链接共用同一面板锚点，保持互斥 */}
      {panel === 'toc' && toc.length > 0 && (
        <TocPanel
          toc={toc}
          activeId={activeId}
          onSelect={handleTocSelect}
          onClose={() => {
            setPanel('none')
            tocButtonRef.current?.focus()
          }}
        />
      )}
      {panel === 'backlinks' && targetRelativePath && filePath && onBacklinkSelect && (
        <BacklinksPanel
          targetRelativePath={targetRelativePath}
          onCountChange={handleBacklinkStatsChange}
          onSelect={(item) => {
            const root = getActiveWorkspaceLifecycleKey()?.primaryRoot?.replace(/[\\/]+$/, '')
            if (!root) return
            const sourceFilePath = `${root}/${item.sourceRelativePath}`.replace(/\/+/g, '/')
            setPanel('none')
            onBacklinkSelect(item, sourceFilePath)
          }}
          onClose={() => {
            setPanel('none')
            backlinksButtonRef.current?.focus()
          }}
        />
      )}
    </nav>
  )
}

export default FloatingNav
