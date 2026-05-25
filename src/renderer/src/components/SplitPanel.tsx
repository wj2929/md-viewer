/**
 * SplitPanel 递归分屏渲染组件
 * @module SplitPanel
 * @description v1.5.1 分屏增强 - 支持 N 面板递归分屏（水平/垂直）
 */

import React, { useCallback, useRef, useState, useEffect } from 'react'
import { VirtualizedMarkdown } from './VirtualizedMarkdown'
import FloatingNav from './FloatingNav'
import { QuickEditDrawer } from './QuickEditDrawer'
import { MarkdownEditWorkbench } from './editor'
import { Tab } from './TabBar'
import { PanelNode, LeafNode, SplitNode } from '../utils/splitTree'
import { LightboxState } from './ImageLightbox'
import { useEditSessionStore } from '../stores/editSessionStore'
import type { EditSession } from '../stores/editSessionStore'
import type { DocumentViewMode } from '../stores/documentViewModeStore'
import type { QuickEditTarget } from '../utils/quickEditTarget'
import './SplitPanel.css'

function findEditSessionForPath(sessions: Record<string, EditSession>, filePath: string): EditSession | undefined {
  return Object.values(sessions).find(session =>
    session.displayPath === filePath || session.canonicalPath === filePath
  )
}

function getDraftPreviewDebounceMs(content: string, hasEditSession: boolean): number | undefined {
  if (!hasEditSession) return undefined
  return /```(?:mermaid|echarts|js|json|drawio|plantuml|dot|graphviz|markmap|infographic)\b/i.test(content)
    ? 900
    : 250
}

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
  getDocumentViewMode?: (leafId: string, tabId: string) => DocumentViewMode
  getDocumentCompareRatio?: (leafId: string, tabId: string) => number
  getDocumentViewTarget?: (leafId: string, tabId: string) => QuickEditTarget | null
  onDocumentViewModeChange?: (leafId: string, tabId: string, mode: DocumentViewMode) => void
  onDocumentCompareRatioChange?: (leafId: string, tabId: string, ratio: number) => void
  onDocumentLocateComplete?: (leafId: string, tabId: string, located: boolean) => void
  getQuickEditCanonicalPath?: (tab: Tab) => string | null
  getQuickEditTarget?: (tab: Tab, leafId: string) => QuickEditTarget | null
  onSaveQuickEdit?: (canonicalPath: string, content: string, expectedRevisionToken: string, force: boolean, draftVersion?: number) => Promise<void>
  onCloseQuickEdit?: (placementKey: string, canonicalPath: string) => void
  onReloadQuickEdit?: (canonicalPath: string) => Promise<void>
  onCopyDraft?: (content: string) => void
  scrollToLine?: number
  onScrollToLineComplete?: () => void
  scrollToRatio?: number
  onScrollToRatioComplete?: () => void
  onReadPositionChange?: (filePath: string, position: { scrollRatio: number; headingId?: string }) => void
  onMarkdownLinkClick?: (href: string, currentFilePath: string) => void | Promise<void>
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
  getDocumentViewMode,
  getDocumentCompareRatio,
  getDocumentViewTarget,
  onDocumentViewModeChange,
  onDocumentCompareRatioChange,
  onDocumentLocateComplete,
  getQuickEditCanonicalPath,
  getQuickEditTarget,
  onSaveQuickEdit,
  onCloseQuickEdit,
  onReloadQuickEdit,
  onCopyDraft,
  scrollToLine,
  onScrollToLineComplete,
  scrollToRatio,
  onScrollToRatioComplete,
  onReadPositionChange,
  onMarkdownLinkClick
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
  getDocumentViewMode?: SplitPanelProps['getDocumentViewMode']
  getDocumentCompareRatio?: SplitPanelProps['getDocumentCompareRatio']
  getDocumentViewTarget?: SplitPanelProps['getDocumentViewTarget']
  onDocumentViewModeChange?: SplitPanelProps['onDocumentViewModeChange']
  onDocumentCompareRatioChange?: SplitPanelProps['onDocumentCompareRatioChange']
  onDocumentLocateComplete?: SplitPanelProps['onDocumentLocateComplete']
  getQuickEditCanonicalPath?: SplitPanelProps['getQuickEditCanonicalPath']
  getQuickEditTarget?: SplitPanelProps['getQuickEditTarget']
  onSaveQuickEdit?: SplitPanelProps['onSaveQuickEdit']
  onCloseQuickEdit?: SplitPanelProps['onCloseQuickEdit']
  onReloadQuickEdit?: SplitPanelProps['onReloadQuickEdit']
  onCopyDraft?: SplitPanelProps['onCopyDraft']
  scrollToLine?: number
  onScrollToLineComplete?: () => void
  scrollToRatio?: number
  onScrollToRatioComplete?: () => void
  onReadPositionChange?: SplitPanelProps['onReadPositionChange']
  onMarkdownLinkClick?: SplitPanelProps['onMarkdownLinkClick']
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [previewElement, setPreviewElement] = useState<HTMLDivElement | null>(null)
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
  const quickEditSession = useEditSessionStore(state => tab ? findEditSessionForPath(state.sessions, tab.file.path) : undefined)
  const quickEditTarget = tab ? getQuickEditTarget?.(tab, node.id) : null
  const quickEditCanonicalPath = quickEditTarget?.canonicalPath || (tab ? getQuickEditCanonicalPath?.(tab) : null)
  const previewContent = tab ? quickEditSession?.draft ?? tab.content : ''
  const isDraftPreview = Boolean(quickEditSession?.dirty)
  const documentMode = tab ? getDocumentViewMode?.(node.id, tab.id) ?? 'preview' : 'preview'
  const documentTarget = tab ? getDocumentViewTarget?.(node.id, tab.id) ?? null : null
  const showWorkbench = Boolean(tab && quickEditSession && documentMode !== 'preview')
  const showLegacyQuickEdit = Boolean(quickEditCanonicalPath && documentMode === 'preview')
  const setPreviewNode = useCallback((element: HTMLDivElement | null) => {
    previewRef.current = element
    setPreviewElement(element)
  }, [])

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
      <div className={`split-panel-content ${showLegacyQuickEdit ? 'with-quick-edit' : ''}`}>
        {showWorkbench && tab && quickEditSession && onSaveQuickEdit && onReloadQuickEdit && onCopyDraft ? (
          <MarkdownEditWorkbench
            tab={tab}
            leafId={node.id}
            canonicalPath={quickEditSession.canonicalPath}
            mode={documentMode}
            compareRatio={getDocumentCompareRatio?.(node.id, tab.id) ?? 0.5}
            target={documentTarget}
            onModeChange={(mode) => onDocumentViewModeChange?.(node.id, tab.id, mode)}
            onCompareRatioChange={(ratio) => onDocumentCompareRatioChange?.(node.id, tab.id, ratio)}
            onSave={onSaveQuickEdit}
            onCopyDraft={onCopyDraft}
            onReloadFromDisk={onReloadQuickEdit}
            onLocateComplete={(located) => onDocumentLocateComplete?.(node.id, tab.id, located)}
          />
        ) : (
          <>
            <div className="split-preview-stack">
              <div className="split-preview-pane">
                {isDraftPreview && (
                  <div className="quick-edit-preview-banner" role="status">草稿预览，未保存</div>
                )}
                <div className="preview" ref={setPreviewNode}>
                  {tab ? (
                    <VirtualizedMarkdown
                      key={tab.file.path}
                      content={previewContent}
                      filePath={tab.file.path}
                      tabId={tab.id}
                      leafId={node.id}
                      renderDebounceMs={getDraftPreviewDebounceMs(previewContent, Boolean(quickEditSession))}
                      scrollToLine={isActive ? scrollToLine : undefined}
                      onScrollToLineComplete={isActive ? onScrollToLineComplete : undefined}
                      scrollToRatio={isActive ? scrollToRatio : undefined}
                      onScrollToRatioComplete={isActive ? onScrollToRatioComplete : undefined}
                      onImageClick={onImageClick}
                      onReadPositionChange={(position) => tab && onReadPositionChange?.(tab.file.path, position)}
                      onMarkdownLinkClick={onMarkdownLinkClick}
                    />
                  ) : (
                    <p className="placeholder">选择文件开始预览</p>
                  )}
                </div>
                {tab && (
                  <FloatingNav
                    containerRef={previewRef}
                    markdown={previewContent}
                  />
                )}
              </div>
            </div>
            {showLegacyQuickEdit && quickEditCanonicalPath && onSaveQuickEdit && onCloseQuickEdit && (
              <QuickEditDrawer
                canonicalPath={quickEditCanonicalPath}
                placementKey={node.id}
                previewElement={previewElement}
                target={quickEditTarget}
                onSave={onSaveQuickEdit}
                onClose={() => onCloseQuickEdit(node.id, quickEditCanonicalPath)}
                onReloadFromDisk={onReloadQuickEdit}
                onCopyDraft={onCopyDraft}
              />
            )}
          </>
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
        getDocumentViewMode={props.getDocumentViewMode}
        getDocumentCompareRatio={props.getDocumentCompareRatio}
        getDocumentViewTarget={props.getDocumentViewTarget}
        onDocumentViewModeChange={props.onDocumentViewModeChange}
        onDocumentCompareRatioChange={props.onDocumentCompareRatioChange}
        onDocumentLocateComplete={props.onDocumentLocateComplete}
        getQuickEditCanonicalPath={props.getQuickEditCanonicalPath}
        getQuickEditTarget={props.getQuickEditTarget}
        onSaveQuickEdit={props.onSaveQuickEdit}
        onCloseQuickEdit={props.onCloseQuickEdit}
        onReloadQuickEdit={props.onReloadQuickEdit}
        onCopyDraft={props.onCopyDraft}
        scrollToLine={props.scrollToLine}
        onScrollToLineComplete={props.onScrollToLineComplete}
        scrollToRatio={props.scrollToRatio}
        onScrollToRatioComplete={props.onScrollToRatioComplete}
        onReadPositionChange={props.onReadPositionChange}
        onMarkdownLinkClick={props.onMarkdownLinkClick}
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
