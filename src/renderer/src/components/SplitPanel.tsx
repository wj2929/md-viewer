/**
 * SplitPanel 递归分屏渲染组件
 * @module SplitPanel
 * @description v1.5.1 分屏增强 - 支持 N 面板递归分屏（水平/垂直）
 */

import React, { useCallback, useRef, useState, useEffect } from 'react'
import { VirtualizedMarkdown } from './VirtualizedMarkdown'
import FloatingNav from './FloatingNav'
import { Tab } from './TabBar'
import { PanelNode, LeafNode, SplitNode } from '../utils/splitTree'
import { LightboxState } from './ImageLightbox'
import './SplitPanel.css'

export interface SplitPanelProps {
  node: PanelNode
  tabs: Tab[]
  activeLeafId: string
  onSplitPanel: (leafId: string, direction: 'horizontal' | 'vertical', tabId: string) => void
  onClosePanel: (leafId: string) => void
  onResizePanel: (splitId: string, ratio: number) => void
  onSetActiveLeaf: (leafId: string) => void
  onImageClick: (data: LightboxState) => void
  onDropTab: (leafId: string, tabId: string, position: 'center' | 'left' | 'right' | 'top' | 'bottom') => void
  onSwapPanels?: (leafIdA: string, leafIdB: string) => void
  scrollToLine?: number
  onScrollToLineComplete?: () => void
}

type DragPosition = 'center' | 'left' | 'right' | 'top' | 'bottom' | null

function getDragPosition(e: React.DragEvent, el: HTMLElement): DragPosition {
  const rect = el.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height

  const edgeThreshold = 0.22

  if (x < edgeThreshold) return 'left'
  if (x > 1 - edgeThreshold) return 'right'
  if (y < edgeThreshold) return 'top'
  if (y > 1 - edgeThreshold) return 'bottom'
  return 'center'
}

/** 叶子面板：渲染单个标签页内容 */
function LeafPanel({
  node,
  tabs,
  isActive,
  onSplitPanel,
  onClosePanel,
  onSetActiveLeaf,
  onImageClick,
  onDropTab,
  onSwapPanels,
  scrollToLine,
  onScrollToLineComplete
}: {
  node: LeafNode
  tabs: Tab[]
  isActive: boolean
  onSplitPanel: SplitPanelProps['onSplitPanel']
  onClosePanel: SplitPanelProps['onClosePanel']
  onSetActiveLeaf: SplitPanelProps['onSetActiveLeaf']
  onImageClick: SplitPanelProps['onImageClick']
  onDropTab: SplitPanelProps['onDropTab']
  onSwapPanels?: SplitPanelProps['onSwapPanels']
  scrollToLine?: number
  onScrollToLineComplete?: () => void
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [dragPos, setDragPos] = useState<DragPosition>(null)

  const tab = tabs.find(t => t.id === node.tabId)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/tab-id') || e.dataTransfer.types.includes('text/panel-id')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (panelRef.current) {
        // 面板互换只需要 center 反馈
        if (e.dataTransfer.types.includes('text/panel-id')) {
          setDragPos('center')
        } else {
          setDragPos(getDragPosition(e, panelRef.current))
        }
      }
    }
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragPos(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    // 面板互换
    const sourcePanelId = e.dataTransfer.getData('text/panel-id')
    if (sourcePanelId && onSwapPanels) {
      if (sourcePanelId !== node.id) {
        onSwapPanels(sourcePanelId, node.id)
      }
      setDragPos(null)
      return
    }
    // 标签拖拽
    const tabId = e.dataTransfer.getData('text/tab-id')
    if (tabId && dragPos) {
      onDropTab(node.id, tabId, dragPos)
    }
    setDragPos(null)
  }, [node.id, dragPos, onDropTab, onSwapPanels])

  const dragClass = dragPos ? `drag-over drag-over-${dragPos}` : ''

  return (
    <div
      ref={panelRef}
      className={`split-leaf-panel ${isActive ? 'active' : ''} ${dragClass}`}
      onClick={() => onSetActiveLeaf(node.id)}
      onContextMenu={() => onSetActiveLeaf(node.id)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽放置视觉反馈 */}
      <div className="drop-overlay" />

      {/* 面板头部 - 可拖拽互换位置 */}
      <div
        className="split-panel-header"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/panel-id', node.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
      >
        <span className="panel-filename" title={tab?.file.path}>
          {tab?.file.name || '(无文件)'}
        </span>
        <div className="panel-actions">
          {/* 向右分屏 */}
          <button
            className="panel-action-btn"
            title="向右分屏"
            onClick={(e) => {
              e.stopPropagation()
              if (tab) onSplitPanel(node.id, 'horizontal', tab.id)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1" y="1" width="12" height="12" rx="1" />
              <line x1="7" y1="1" x2="7" y2="13" />
            </svg>
          </button>
          {/* 向下分屏 */}
          <button
            className="panel-action-btn"
            title="向下分屏"
            onClick={(e) => {
              e.stopPropagation()
              if (tab) onSplitPanel(node.id, 'vertical', tab.id)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1" y="1" width="12" height="12" rx="1" />
              <line x1="1" y1="7" x2="13" y2="7" />
            </svg>
          </button>
          {/* 关闭面板 */}
          <button
            className="panel-action-btn close-btn"
            title="关闭面板"
            onClick={(e) => {
              e.stopPropagation()
              onClosePanel(node.id)
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* 预览内容 */}
      <div className="split-panel-content">
        <div className="preview" ref={previewRef}>
          {tab ? (
            <VirtualizedMarkdown
              key={tab.file.path}
              content={tab.content}
              filePath={tab.file.path}
              scrollToLine={isActive ? scrollToLine : undefined}
              onScrollToLineComplete={isActive ? onScrollToLineComplete : undefined}
              onImageClick={onImageClick}
            />
          ) : (
            <p className="placeholder">选择文件开始预览</p>
          )}
        </div>
        {tab && (
          <FloatingNav
            containerRef={previewRef}
            markdown={tab.content}
          />
        )}
      </div>
    </div>
  )
}

/** 分割面板拖拽条 */
function ResizeHandle({
  splitId,
  direction,
  onResizePanel
}: {
  splitId: string
  direction: 'horizontal' | 'vertical'
  onResizePanel: (splitId: string, ratio: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const parentRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!parentRef.current) return
      const rect = parentRef.current.getBoundingClientRect()
      let ratio: number
      if (direction === 'horizontal') {
        ratio = (e.clientX - rect.left) / rect.width
      } else {
        ratio = (e.clientY - rect.top) / rect.height
      }
      onResizePanel(splitId, ratio)
    }

    const handleMouseUp = () => {
      setDragging(false)
      document.body.classList.remove('split-resizing-h', 'split-resizing-v')
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, direction, splitId, onResizePanel])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    // 找到父级 split-container
    const handle = e.currentTarget as HTMLElement
    parentRef.current = handle.parentElement
    setDragging(true)
    document.body.classList.add(direction === 'horizontal' ? 'split-resizing-h' : 'split-resizing-v')
  }, [direction])

  return (
    <div
      className={`split-resize-handle ${direction} ${dragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
    />
  )
}

/** 递归分屏面板 */
export function SplitPanel(props: SplitPanelProps): JSX.Element {
  const { node } = props

  if (node.type === 'leaf') {
    return (
      <LeafPanel
        node={node}
        tabs={props.tabs}
        isActive={node.id === props.activeLeafId}
        onSplitPanel={props.onSplitPanel}
        onClosePanel={props.onClosePanel}
        onSetActiveLeaf={props.onSetActiveLeaf}
        onImageClick={props.onImageClick}
        onDropTab={props.onDropTab}
        onSwapPanels={props.onSwapPanels}
        scrollToLine={props.scrollToLine}
        onScrollToLineComplete={props.onScrollToLineComplete}
      />
    )
  }

  // SplitNode: 递归渲染两个子面板
  const splitNode = node as SplitNode
  const firstStyle = direction2Style(splitNode.direction, splitNode.ratio, 'first')
  const secondStyle = direction2Style(splitNode.direction, splitNode.ratio, 'second')

  return (
    <div className={`split-container ${splitNode.direction}`}>
      <div style={firstStyle}>
        <SplitPanel {...props} node={splitNode.first} />
      </div>
      <ResizeHandle
        splitId={splitNode.id}
        direction={splitNode.direction}
        onResizePanel={props.onResizePanel}
      />
      <div style={secondStyle}>
        <SplitPanel {...props} node={splitNode.second} />
      </div>
    </div>
  )
}

function direction2Style(
  direction: 'horizontal' | 'vertical',
  ratio: number,
  which: 'first' | 'second'
): React.CSSProperties {
  const value = which === 'first' ? ratio : 1 - ratio
  return {
    flex: value,
    overflow: 'hidden',
    display: 'flex',
    minWidth: direction === 'horizontal' ? 120 : undefined,
    minHeight: direction === 'vertical' ? 80 : undefined,
    // 垂直分屏时子面板需要撑满宽度，水平分屏时需要撑满高度
    width: direction === 'vertical' ? '100%' : undefined,
    height: direction === 'horizontal' ? '100%' : undefined
  }
}
