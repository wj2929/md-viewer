import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { VirtualizedMarkdown } from '../VirtualizedMarkdown'
import FloatingNav from '../FloatingNav'
import type { Tab } from '../TabBar'
import { useEditSessionStore } from '../../stores/editSessionStore'
import type { DocumentViewMode } from '../../stores/documentViewModeStore'
import type { QuickEditTarget } from '../../utils/quickEditTarget'
import { DocumentModeSwitch } from './DocumentModeSwitch'
import { MarkdownFormatToolbar } from './MarkdownFormatToolbar'
import { MarkdownEditorPane, type MarkdownEditorPaneHandle } from './MarkdownEditorPane'
import type { MarkdownFormatCommand } from './markdownFormatCommands'
import './MarkdownEditWorkbench.css'

interface MarkdownEditWorkbenchProps {
  tab: Tab
  leafId: string
  canonicalPath: string
  mode: DocumentViewMode
  compareRatio: number
  target: QuickEditTarget | null
  onModeChange: (mode: DocumentViewMode) => void
  onCompareRatioChange: (ratio: number) => void
  onSave: (
    canonicalPath: string,
    content: string,
    expectedRevisionToken: string,
    force: boolean,
    draftVersion?: number
  ) => Promise<void>
  onCopyDraft: (content: string) => void
  onReloadFromDisk: (canonicalPath: string) => Promise<void>
  onLocateComplete: (located: boolean) => void
}

function getDraftPreviewDebounceMs(content: string): number {
  return /```(?:mermaid|echarts|js|json|drawio|plantuml|dot|graphviz|markmap|infographic|excalidraw)\b/i.test(content)
    ? 900
    : 250
}

function getConflictMessage(reason: string | null | undefined): string | null {
  if (!reason) return null
  if (reason === 'missing') return '磁盘文件已被删除或不可访问，当前草稿仍保留。请复制草稿或另存后再处理。'
  if (reason === 'renamed') return '磁盘文件可能已被重命名，当前草稿仍保留。请复制草稿或重新载入确认路径。'
  if (reason === 'external_changed') return '磁盘文件已被外部修改，当前草稿仍保留。建议先复制草稿，再决定重新载入或保存并覆盖。'
  return '磁盘文件版本已变化，当前草稿仍保留。建议先复制草稿，再决定重新载入或保存并覆盖。'
}

export function MarkdownEditWorkbench({
  tab,
  leafId,
  canonicalPath,
  mode,
  compareRatio,
  target,
  onModeChange,
  onCompareRatioChange,
  onSave,
  onCopyDraft,
  onReloadFromDisk,
  onLocateComplete,
}: MarkdownEditWorkbenchProps): JSX.Element {
  const writerId = `${leafId}:${tab.id}`
  const editorRef = useRef<MarkdownEditorPaneHandle | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const workbenchRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const narrowModeAppliedRef = useRef(false)
  const session = useEditSessionStore(state => state.sessions[canonicalPath])
  const updateDraft = useEditSessionStore(state => state.updateDraft)
  const claimWriter = useEditSessionStore(state => state.claimWriter)
  const releaseWriter = useEditSessionStore(state => state.releaseWriter)
  const createSaveSnapshot = useEditSessionStore(state => state.createSaveSnapshot)
  const setSaving = useEditSessionStore(state => state.setSaving)
  const setError = useEditSessionStore(state => state.setError)

  useEffect(() => {
    claimWriter(canonicalPath, writerId)
    return () => releaseWriter(canonicalPath, writerId)
  }, [canonicalPath, claimWriter, releaseWriter, writerId])

  const isWriter = !session?.writerId || session.writerId === writerId
  const readOnly = !isWriter
  const content = session?.draft ?? tab.content
  const dirty = Boolean(session?.dirty)
  const hasConflict = Boolean(session?.conflictReason)
  const conflictMessage = getConflictMessage(session?.conflictReason)
  const boundedCompareRatio = Math.min(0.8, Math.max(0.2, compareRatio))

  const updateCompareRatioFromPointer = useCallback((clientX: number, clientY: number) => {
    const body = bodyRef.current
    if (!body) return
    const rect = body.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const nextRatio = rect.width < 900
      ? (clientY - rect.top) / rect.height
      : (clientX - rect.left) / rect.width
    onCompareRatioChange(Math.min(0.8, Math.max(0.2, nextRatio)))
  }, [onCompareRatioChange])

  const handleDividerMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      updateCompareRatioFromPointer(moveEvent.clientX, moveEvent.clientY)
    }
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [updateCompareRatioFromPointer])

  const handleDividerKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.05
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -step : step
    onCompareRatioChange(Math.min(0.8, Math.max(0.2, boundedCompareRatio + delta)))
  }, [boundedCompareRatio, onCompareRatioChange])

  useEffect(() => {
    if (mode !== 'compare' || narrowModeAppliedRef.current) return
    const element = workbenchRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      if (!entry || narrowModeAppliedRef.current) return
      if (entry.contentRect.width > 0 && entry.contentRect.width < 680) {
        narrowModeAppliedRef.current = true
        onModeChange('edit')
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [mode, onModeChange])

  const handleChange = useCallback((nextContent: string) => {
    updateDraft(canonicalPath, nextContent, { writerId })
  }, [canonicalPath, updateDraft, writerId])

  const handleSave = useCallback(async (contentFromEditor?: string, force = false) => {
    if (!session || readOnly) return
    const contentToSave = contentFromEditor ?? editorRef.current?.getCurrentDoc() ?? session.draft
    updateDraft(canonicalPath, contentToSave, { writerId })
    const snapshot = createSaveSnapshot(canonicalPath, contentToSave)
    setSaving(canonicalPath, true)

    try {
      await onSave(canonicalPath, snapshot.content, snapshot.expectedRevisionToken, force, snapshot.draftVersion)
    } catch (error) {
      setError(canonicalPath, error instanceof Error ? error.message : '保存失败')
      setSaving(canonicalPath, false)
    }
  }, [canonicalPath, createSaveSnapshot, onSave, readOnly, session, setError, setSaving, updateDraft, writerId])

  const handleFormatCommand = useCallback((command: MarkdownFormatCommand) => {
    if (readOnly) return
    editorRef.current?.applyFormat(command)
  }, [readOnly])

  const previewPane = useMemo(() => (
    <div className="markdown-workbench-preview-pane">
      <div className="markdown-workbench-preview-status" role="status">
        {dirty ? '草稿预览，未保存到磁盘' : '预览已更新'}
      </div>
      <div className="preview" ref={previewRef}>
        <VirtualizedMarkdown
          content={content}
          filePath={tab.file.path}
          tabId={tab.id}
          leafId={leafId}
          renderDebounceMs={getDraftPreviewDebounceMs(content)}
        />
      </div>
      <FloatingNav containerRef={previewRef} markdown={content} />
    </div>
  ), [content, dirty, leafId, tab.file.path, tab.id])

  return (
    <section ref={workbenchRef} className={`markdown-edit-workbench mode-${mode}`} aria-label={`${tab.file.name} 编辑工作区`}>
      <header className="markdown-workbench-toolbar">
        <div className="markdown-workbench-toolbar-left">
          <DocumentModeSwitch mode={mode} dirty={dirty} onChange={onModeChange} />
          <MarkdownFormatToolbar disabled={readOnly || mode === 'preview'} onCommand={handleFormatCommand} />
        </div>
        <div className="markdown-workbench-actions">
          <button type="button" onClick={() => handleSave()} disabled={!dirty || session?.saving || readOnly} aria-label="保存修改">
            {session?.saving ? '保存中...' : '保存'}
          </button>
          <button type="button" onClick={() => onCopyDraft(content)}>复制草稿</button>
          {hasConflict && (
            <button type="button" className="danger" onClick={() => handleSave(undefined, true)}>
              保存并覆盖
            </button>
          )}
          <button type="button" onClick={() => onReloadFromDisk(canonicalPath)}>重新载入</button>
        </div>
      </header>

      {!isWriter && (
        <div className="markdown-workbench-readonly-banner" role="status">
          此文件已在另一个面板编辑，当前为只读镜像。
        </div>
      )}

      {session?.error && (
        <div className="markdown-workbench-error" role="alert">
          {session.error}
        </div>
      )}

      {conflictMessage && (
        <div className="markdown-workbench-conflict" role="alert">
          <strong>保存冲突</strong>
          <span>{conflictMessage}</span>
          {session?.lastKnownDiskRevisionToken && (
            <span className="markdown-workbench-conflict-meta">
              磁盘版本：{session.lastKnownDiskRevisionToken}
            </span>
          )}
        </div>
      )}

      <div
        ref={bodyRef}
        className={`markdown-workbench-body ${mode === 'compare' ? 'compare' : ''}`}
        style={{
          '--editor-size': `${boundedCompareRatio}fr`,
          '--preview-size': `${1 - boundedCompareRatio}fr`,
        } as CSSProperties}
      >
        {mode !== 'preview' && (
          <MarkdownEditorPane
            ref={editorRef}
            content={content}
            readOnly={readOnly}
            target={target}
            onChange={handleChange}
            onSave={(nextContent) => handleSave(nextContent)}
            onLocateComplete={onLocateComplete}
          />
        )}
        {mode === 'compare' && (
          <div
            className="markdown-workbench-divider"
            role="separator"
            aria-label="调整编辑和预览宽度"
            aria-orientation="vertical"
            aria-valuemin={20}
            aria-valuemax={80}
            aria-valuenow={Math.round(boundedCompareRatio * 100)}
            tabIndex={0}
            onMouseDown={handleDividerMouseDown}
            onKeyDown={handleDividerKeyDown}
          />
        )}
        {mode !== 'edit' && previewPane}
      </div>
    </section>
  )
}
