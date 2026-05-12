import { useCallback, useEffect, useMemo, useRef } from 'react'
import { VirtualizedMarkdown } from '../VirtualizedMarkdown'
import FloatingNav from '../FloatingNav'
import type { Tab } from '../TabBar'
import { useEditSessionStore } from '../../stores/editSessionStore'
import type { DocumentViewMode } from '../../stores/documentViewModeStore'
import type { QuickEditTarget } from '../../utils/quickEditTarget'
import { DocumentModeSwitch } from './DocumentModeSwitch'
import { MarkdownEditorPane, type MarkdownEditorPaneHandle } from './MarkdownEditorPane'
import './MarkdownEditWorkbench.css'

interface MarkdownEditWorkbenchProps {
  tab: Tab
  leafId: string
  canonicalPath: string
  mode: DocumentViewMode
  target: QuickEditTarget | null
  onModeChange: (mode: DocumentViewMode) => void
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

export function MarkdownEditWorkbench({
  tab,
  leafId,
  canonicalPath,
  mode,
  target,
  onModeChange,
  onSave,
  onCopyDraft,
  onReloadFromDisk,
  onLocateComplete,
}: MarkdownEditWorkbenchProps): JSX.Element {
  const writerId = `${leafId}:${tab.id}`
  const editorRef = useRef<MarkdownEditorPaneHandle | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
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
    <section className={`markdown-edit-workbench mode-${mode}`} aria-label={`${tab.file.name} 编辑工作区`}>
      <header className="markdown-workbench-toolbar">
        <DocumentModeSwitch mode={mode} dirty={dirty} onChange={onModeChange} />
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

      <div className="markdown-workbench-body">
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
        {mode !== 'edit' && previewPane}
      </div>
    </section>
  )
}
