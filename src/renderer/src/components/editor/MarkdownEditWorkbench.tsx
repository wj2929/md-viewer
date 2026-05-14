import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { VirtualizedMarkdown, type PreviewBlockEdit } from '../VirtualizedMarkdown'
import FloatingNav from '../FloatingNav'
import type { Tab } from '../TabBar'
import { useEditSessionStore } from '../../stores/editSessionStore'
import type { DocumentViewMode } from '../../stores/documentViewModeStore'
import { useMarkdownWorkbenchScrollSync } from '../../hooks/useMarkdownWorkbenchScrollSync'
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

function applyRenderedBlockText(sourceLine: string, nextText: string): string {
  const headingMatch = sourceLine.match(/^(\s{0,3}#{1,6}\s+).*/)
  if (headingMatch) return `${headingMatch[1]}${nextText}`

  const quoteMatch = sourceLine.match(/^(\s*>\s?).*/)
  if (quoteMatch) return `${quoteMatch[1]}${nextText}`

  const listMatch = sourceLine.match(/^(\s*(?:[-*+]\s+|\d+[.)]\s+)).*/)
  if (listMatch) return `${listMatch[1]}${nextText}`

  return nextText
}

function applyRenderedTableCellText(sourceLine: string, nextText: string, tableCellIndex: number): string {
  const indent = sourceLine.match(/^\s*/)?.[0] ?? ''
  const trimmed = sourceLine.trim()
  const hasLeadingPipe = trimmed.startsWith('|')
  const hasTrailingPipe = trimmed.endsWith('|')
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells = body.split(/(?<!\\)\|/)

  if (tableCellIndex < 0 || tableCellIndex >= cells.length) return sourceLine

  const currentCell = cells[tableCellIndex]
  const leadingSpace = currentCell.match(/^\s*/)?.[0] || ' '
  const trailingSpace = currentCell.match(/\s*$/)?.[0] || ' '
  cells[tableCellIndex] = `${leadingSpace}${nextText}${trailingSpace}`

  return `${indent}${hasLeadingPipe ? '|' : ''}${cells.join('|')}${hasTrailingPipe ? '|' : ''}`
}

function applyRenderedCodeBlockText(lines: string[], edit: PreviewBlockEdit): boolean {
  if (!edit.sourceEndLine) return false
  const startIndex = edit.sourceLine - 1
  const endIndex = edit.sourceEndLine - 1
  if (startIndex < 0 || endIndex <= startIndex || endIndex >= lines.length) return false

  lines.splice(startIndex + 1, endIndex - startIndex - 1, ...edit.nextText.split('\n'))
  return true
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
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const pendingFormatUndoDraftRef = useRef<string | null>(null)
  const pendingRenderedEditScrollTopRef = useRef<number | null>(null)
  const [previewResetVersion, setPreviewResetVersion] = useState(0)
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(true)
  const session = useEditSessionStore(state => state.sessions[canonicalPath])
  const updateDraft = useEditSessionStore(state => state.updateDraft)
  const undoDraft = useEditSessionStore(state => state.undoDraft)
  const redoDraft = useEditSessionStore(state => state.redoDraft)
  const claimWriter = useEditSessionStore(state => state.claimWriter)
  const releaseWriter = useEditSessionStore(state => state.releaseWriter)
  const closeSession = useEditSessionStore(state => state.closeSession)
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
  const { status: scrollSyncStatus } = useMarkdownWorkbenchScrollSync({
    enabled: scrollSyncEnabled,
    mode,
    previewElement: previewRef.current,
    editorRef,
    content,
  })

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

  const handleChange = useCallback((nextContent: string) => {
    const recordUndo = pendingFormatUndoDraftRef.current !== null && pendingFormatUndoDraftRef.current !== nextContent
    pendingFormatUndoDraftRef.current = null
    updateDraft(canonicalPath, nextContent, { writerId, recordUndo })
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
    pendingFormatUndoDraftRef.current = editorRef.current?.getCurrentDoc() ?? content
    editorRef.current?.applyFormat(command)
  }, [content, readOnly])

  const rememberRenderedEditScrollTop = useCallback(() => {
    pendingRenderedEditScrollTopRef.current = previewRef.current?.scrollTop ?? null
  }, [])

  useEffect(() => {
    const targetTop = pendingRenderedEditScrollTopRef.current
    if (targetTop === null) return

    const restore = () => {
      const preview = previewRef.current
      if (!preview) return
      preview.scrollTop = Math.min(targetTop, Math.max(0, preview.scrollHeight - preview.clientHeight))
    }

    const frame = window.requestAnimationFrame(restore)
    const shortTimer = window.setTimeout(restore, 60)
    const renderTimer = window.setTimeout(() => {
      restore()
      pendingRenderedEditScrollTopRef.current = null
    }, getDraftPreviewDebounceMs(content) + 120)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(shortTimer)
      window.clearTimeout(renderTimer)
    }
  }, [content])

  const handlePreviewBlockEdit = useCallback((edit: PreviewBlockEdit) => {
    if (readOnly || mode === 'preview') return
    const currentContent = editorRef.current?.getCurrentDoc() ?? content
    const lines = currentContent.split('\n')
    const lineIndex = edit.sourceLine - 1
    if (lineIndex < 0 || lineIndex >= lines.length) return

    if (edit.editKind === 'code-block') {
      if (!applyRenderedCodeBlockText(lines, edit)) return
      rememberRenderedEditScrollTop()
      updateDraft(canonicalPath, lines.join('\n'), { writerId, recordUndo: true })
      return
    }

    const nextLine = edit.editKind === 'table-cell' && Number.isFinite(edit.tableCellIndex)
      ? applyRenderedTableCellText(lines[lineIndex], edit.nextText, edit.tableCellIndex as number)
      : applyRenderedBlockText(lines[lineIndex], edit.nextText)
    if (nextLine === lines[lineIndex]) return
    lines[lineIndex] = nextLine
    rememberRenderedEditScrollTop()
    updateDraft(canonicalPath, lines.join('\n'), { writerId, recordUndo: true })
  }, [canonicalPath, content, mode, readOnly, rememberRenderedEditScrollTop, updateDraft, writerId])

  const handleUndo = useCallback(() => {
    if (readOnly) return
    if (undoDraft(canonicalPath)) setPreviewResetVersion(version => version + 1)
  }, [canonicalPath, readOnly, undoDraft])

  const handleRedo = useCallback(() => {
    if (readOnly) return
    if (redoDraft(canonicalPath)) setPreviewResetVersion(version => version + 1)
  }, [canonicalPath, readOnly, redoDraft])

  useEffect(() => {
    if (mode === 'preview' || readOnly) return

    const handleWorkbenchKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.cm-editor')) return
      if (target?.closest('[contenteditable="true"]')) return
      if (!event.metaKey && !event.ctrlKey) return

      const key = event.key.toLowerCase()
      const shouldRedo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey)
      const shouldUndo = key === 'z' && !event.shiftKey
      if (!shouldUndo && !shouldRedo) return

      event.preventDefault()
      const changed = shouldRedo ? redoDraft(canonicalPath) : undoDraft(canonicalPath)
      if (changed) setPreviewResetVersion(version => version + 1)
    }

    window.addEventListener('keydown', handleWorkbenchKeyDown)
    return () => window.removeEventListener('keydown', handleWorkbenchKeyDown)
  }, [canonicalPath, mode, readOnly, redoDraft, undoDraft])

  const handleExitEditMode = useCallback(() => {
    window.setTimeout(() => onModeChange('preview'), 0)
  }, [onModeChange])

  const handleDiscardEdit = useCallback(() => {
    if (readOnly) return
    if (!window.confirm('放弃未保存的编辑草稿？此操作不可撤销。')) return

    window.setTimeout(() => {
      closeSession(canonicalPath)
      onModeChange('preview')
    }, 0)
  }, [canonicalPath, closeSession, onModeChange, readOnly])

  const previewPane = useMemo(() => (
    <div className="markdown-workbench-preview-pane">
      <div className="markdown-workbench-preview-status" role="status">
        {dirty ? '草稿预览，未保存到磁盘' : '预览已更新'}
      </div>
      <div className="preview" ref={previewRef}>
        <VirtualizedMarkdown
          key={previewResetVersion}
          content={content}
          filePath={tab.file.path}
          tabId={tab.id}
          leafId={leafId}
          renderDebounceMs={getDraftPreviewDebounceMs(content)}
          previewEditingEnabled={mode !== 'preview' && !readOnly}
          onPreviewBlockEdit={handlePreviewBlockEdit}
        />
      </div>
      <FloatingNav containerRef={previewRef} markdown={content} />
    </div>
  ), [content, dirty, handlePreviewBlockEdit, leafId, mode, previewResetVersion, readOnly, tab.file.path, tab.id])

  return (
    <section className={`markdown-edit-workbench mode-${mode}`} aria-label={`${tab.file.name} 编辑工作区`}>
      <header className="markdown-workbench-toolbar">
        <div className="markdown-workbench-toolbar-left">
          <DocumentModeSwitch mode={mode} dirty={dirty} onChange={onModeChange} />
          <MarkdownFormatToolbar disabled={readOnly || mode === 'preview'} onCommand={handleFormatCommand} />
          {mode === 'compare' && (
            <label className="markdown-workbench-scroll-sync" title={`同步状态：${scrollSyncStatus}`}>
              <input
                type="checkbox"
                aria-label="同步编辑区与预览区滚动"
                checked={scrollSyncEnabled}
                onChange={event => setScrollSyncEnabled(event.target.checked)}
              />
              <span>同步滚动</span>
            </label>
          )}
        </div>
        <div className="markdown-workbench-actions">
          {mode !== 'preview' && (
            <>
              <button
                type="button"
                onClick={handleUndo}
                disabled={readOnly || !session?.undoStack.length}
                aria-label="撤销编辑"
                title="撤销编辑"
              >
                撤销
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={readOnly || !session?.redoStack.length}
                aria-label="重做编辑"
                title="重做编辑"
              >
                重做
              </button>
            </>
          )}
          {mode !== 'preview' && (
            <button type="button" onMouseDown={handleExitEditMode} onClick={handleExitEditMode} aria-label="退出编辑模式">
              退出编辑
            </button>
          )}
          {mode !== 'preview' && !readOnly && (
            <button
              type="button"
              className="danger"
              onMouseDown={event => event.preventDefault()}
              onClick={handleDiscardEdit}
              disabled={session?.saving}
              aria-label="放弃编辑"
            >
              放弃编辑
            </button>
          )}
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
