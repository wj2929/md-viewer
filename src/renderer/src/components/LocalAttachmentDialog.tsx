import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { linkedReadErrorMessages, type LinkedAttachmentResult, type LinkedReadRequest } from '../../../shared/linkRead'
import type { WorkspaceResourceRequest, WorkspaceResourceResult } from '../../../shared/directoryBrowser'
import { MarkdownEditorPane, type MarkdownEditorPaneHandle } from './editor/MarkdownEditorPane'
import { attachmentErrorMessages, attachmentNoticeMessages, formatAttachmentJson, formatAttachmentJsonLines } from '../utils/localAttachmentText'
import type { Extension } from '@codemirror/state'
import { attachmentLanguage, loadAttachmentHighlight, withinAttachmentHighlightBudget } from '../utils/localAttachmentHighlight'
import { requestAttachmentSqlFormat, type SqlFormatResult } from '../utils/localAttachmentSql'
import './LocalAttachmentDialog.css'

export interface LocalAttachmentDialogHandle {
  search: () => void
}

type AttachmentViewProps = {
  isCurrent: () => boolean
  onClose: () => void
} & ({ readRequest: LinkedReadRequest; workspaceRequest?: never; initialResult?: never }
  | { readRequest?: never; workspaceRequest: WorkspaceResourceRequest; initialResult: WorkspaceResourceResult })

export const LocalAttachmentDialog = forwardRef<LocalAttachmentDialogHandle, AttachmentViewProps>(function LocalAttachmentDialog(props, ref) {
  return <LocalAttachmentContent {...props} ref={ref} />
})

export const LocalAttachmentContent = forwardRef<LocalAttachmentDialogHandle, AttachmentViewProps>(function LocalAttachmentContent({ readRequest, workspaceRequest, initialResult, isCurrent, onClose }, ref) {
  const inline = Boolean(workspaceRequest)
  const request = workspaceRequest ?? readRequest!
  const [result, setResult] = useState<WorkspaceResourceResult | null>(initialResult ?? null)
  const [formatted, setFormatted] = useState(true)
  const [sqlFormatted, setSqlFormatted] = useState(false)
  const [sqlFormatting, setSqlFormatting] = useState(false)
  const [sqlResult, setSqlResult] = useState<{ source: string; value: SqlFormatResult }>()
  const [highlightEnabled, setHighlightEnabled] = useState(true)
  const [syntaxExtension, setSyntaxExtension] = useState<Extension>()
  const [highlightStatus, setHighlightStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const editorRef = useRef<MarkdownEditorPaneHandle>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const aliveRef = useRef(true)
  const resourceRef = useRef<string | undefined>(initialResult?.resourceHandle)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const [previewError, setPreviewError] = useState(false)
  useEffect(() => {
    const media = mediaRef.current
    return () => { if (media) { media.pause(); media.removeAttribute('src'); media.load() } }
  }, [result?.preview?.url])
  const release = (value: LinkedAttachmentResult) => {
    if (value.resourceHandle) void window.api.releaseLinkedReads([value.resourceHandle]).catch(() => {})
  }
  const search = () => editorRef.current?.openSearch()
  useImperativeHandle(ref, () => ({ search }))

  useEffect(() => {
    aliveRef.current = true
    if (!inline) closeRef.current?.focus()
    let current = true
    if (readRequest) window.api.readLinkedAttachment(readRequest).then(value => {
      if (current && isCurrent()) { resourceRef.current = value.resourceHandle; setResult(value) }
      else release(value)
    }).catch(() => { if (current && isCurrent()) setResult({ kind: 'error', code: 'unavailable' }) })
    const wheel = (event: WheelEvent) => {
      if (!dialogRef.current?.contains(event.target as Node)) event.preventDefault()
    }
    if (!inline) document.addEventListener('wheel', wheel, { passive: false })
    return () => {
      current = false
      aliveRef.current = false
      if (resourceRef.current) void window.api.releaseLinkedReads([resourceRef.current]).catch(() => {})
      resourceRef.current = undefined
      void window.api.cancelLinkedRead(request.operation, request.leafId, request.requestId).catch(() => {})
      document.removeEventListener('wheel', wheel)
    }
  }, [readRequest, request, inline, isCurrent])

  const json = result?.kind === 'text' && result.extension === '.json'
  const jsonLines = result?.kind === 'text' && (result.extension === '.jsonl' || result.extension === '.ndjson')
  const display = useMemo(() => {
    const content = result?.kind === 'text' ? result.content ?? '' : ''
    return json ? formatAttachmentJson(content) : jsonLines ? formatAttachmentJsonLines(content) : { content }
  }, [result, json, jsonLines])
  const sql = result?.kind === 'text' && result.extension === '.sql'
  const rawContent = result?.kind === 'text' ? result.content ?? '' : ''
  const sqlDisplay = sqlResult?.source === rawContent ? sqlResult.value : undefined
  useEffect(() => {
    setSqlFormatting(false)
    if (!sql || !sqlFormatted || sqlDisplay) return
    const controller = new AbortController()
    setSqlFormatting(true)
    void requestAttachmentSqlFormat(rawContent, controller.signal).then(value => {
      if (!controller.signal.aborted && isCurrent()) {
        setSqlResult({ source: rawContent, value })
        setSqlFormatting(false)
      }
    })
    return () => controller.abort()
  }, [sql, sqlFormatted, sqlDisplay, rawContent, isCurrent])
  const content = sql ? sqlFormatted ? sqlDisplay?.content ?? rawContent : rawContent : formatted ? display.content : rawContent
  const language = result?.kind === 'text' ? attachmentLanguage(result.extension) : undefined
  const highlightBudget = useMemo(() => !language || withinAttachmentHighlightBudget(content), [content, language])
  useEffect(() => {
    let current = true
    setSyntaxExtension(undefined)
    setHighlightStatus('')
    if (!language || !highlightEnabled || !highlightBudget) return
    setHighlightStatus('高亮加载中…')
    void loadAttachmentHighlight(language).then(extension => {
      if (current && isCurrent()) { setSyntaxExtension(extension); setHighlightStatus('') }
    }).catch(() => {
      if (current && isCurrent()) setHighlightStatus('高亮加载失败，按纯文本显示。')
    })
    return () => { current = false }
  }, [language, highlightEnabled, highlightBudget, isCurrent])
  const name = result && result.kind !== 'error' ? result.name : '本地附件'
  useEffect(() => {
    if (!inline && result?.kind === 'text' && isCurrent() &&
      (document.activeElement === closeRef.current || document.activeElement === document.body)) editorRef.current?.focus()
  }, [result, isCurrent, inline])

  const action = async (kind: 'reveal' | 'open' | 'text') => {
    if (busy || !isCurrent() || !resourceRef.current) return
    setBusy(true)
    setActionError('')
    try {
      if (kind === 'text') {
        const previousHandle = resourceRef.current
        const value = workspaceRequest ? await window.api.readWorkspaceResource(workspaceRequest, true, previousHandle)
          : await window.api.readLinkedAttachment(readRequest!, true, previousHandle)
        void window.api.releaseLinkedReads([previousHandle]).catch(() => {})
        if (aliveRef.current && isCurrent()) { resourceRef.current = value.resourceHandle; setResult(value) }
        else release(value)
      } else if (kind === 'reveal') {
        const response = await window.api.revealLinkedResource(resourceRef.current)
        if (!response.success && aliveRef.current && isCurrent()) setActionError(linkedReadErrorMessages[response.code])
      } else if (workspaceRequest || result?.systemOpenRef) {
        const response = workspaceRequest ? await window.api.openWorkspaceResource(resourceRef.current)
          : await window.api.openLocalAttachment(readRequest!.source.filePath, result!.systemOpenRef!)
        if (!response.success && !response.cancelled && aliveRef.current && isCurrent()) {
          setActionError(attachmentErrorMessages[response.code ?? 'unavailable'])
        }
      }
    } catch { if (aliveRef.current && isCurrent()) setActionError(attachmentErrorMessages.unavailable) }
    finally { if (aliveRef.current && isCurrent()) setBusy(false) }
  }

  return (
    <div className={inline ? 'workspace-resource-preview' : 'local-attachment-backdrop'} onClick={event => { if (!inline && event.target === event.currentTarget) onClose() }}>
      <div className={`local-attachment-dialog${inline ? ' workspace-resource-content' : ''}`} role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : true} aria-labelledby="local-attachment-title"
        ref={dialogRef} onKeyDown={event => {
          if (event.defaultPrevented) { event.stopPropagation(); return }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault(); event.stopPropagation(); search(); return
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault(); event.stopPropagation(); return
          }
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation()
            if (!editorRef.current?.closeSearch()) onClose()
          } else if (!inline && event.key === 'Tab') {
            const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input, [tabindex="0"], [contenteditable="true"]',
            ) ?? []).filter(node => node.getClientRects().length > 0)
            const first = nodes[0], last = nodes.at(-1)
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }}>
        <header><h2 id="local-attachment-title">{inline && '临时预览 · '}{name}{result?.kind === 'text' && <span> · 只读</span>}</h2>
          <button ref={closeRef} aria-label={inline ? '关闭预览' : '关闭附件'} onClick={onClose}>×</button></header>
        {result && result.kind !== 'error' && <>
          <p className="local-attachment-path" title={result.relativePath}>{result.relativePath}</p>
          <p className="local-attachment-meta">类型：{result.extension || '无后缀'} · 大小：{result.size.toLocaleString()} 字节</p>
        </>}
        {!result ? <p role="status">附件读取中…</p> : result.kind === 'error' ?
          <p role="alert">{attachmentErrorMessages[result.code]}</p> : <>
            {result.kind === 'text' ? <>
              <div className="local-attachment-tools">
                {(json || jsonLines || sql) && <><button aria-pressed={sql ? sqlFormatted : formatted}
                  onClick={() => sql ? setSqlFormatted(true) : setFormatted(true)}>格式化</button>
                  <button aria-pressed={sql ? !sqlFormatted : !formatted}
                    onClick={() => sql ? setSqlFormatted(false) : setFormatted(false)}>原文</button></>}
                {language && <label className="local-attachment-highlight"><input type="checkbox"
                  checked={highlightEnabled && highlightBudget} disabled={!highlightBudget}
                  onChange={event => setHighlightEnabled(event.target.checked)} />语法高亮</label>}
                <button onClick={search}>查找 {window.api.platform === 'darwin' ? '⌘F' : 'Ctrl+F'}</button>
              </div>
              {language && !highlightBudget && <p role="status">内容较大、行数较多或单行过长，已按纯文本显示。</p>}
              {language && highlightEnabled && highlightBudget && highlightStatus && <p role="status">{highlightStatus}</p>}
              {sql && sqlFormatted && sqlFormatting && <p role="status">SQL 格式化中，暂时显示原文…</p>}
              {sql && sqlFormatted && sqlDisplay?.reason && <p role="status">{sqlDisplay.reason === 'budget' ?
                '超过 SQL 格式化预算，按原文显示。' : sqlDisplay.reason === 'unsupported' ?
                  '暂不支持可靠格式化此 SQL 结构，按原文显示。' : 'SQL 格式化未完成，按原文显示。'}</p>}
              {(json || jsonLines) && formatted && display.reason && <p role="status">{display.reason === 'invalid' ?
                jsonLines ? `第 ${display.invalidLine} 行不是有效 JSON，按原文显示。` : '不是有效 JSON，按原文显示。' :
                '超过格式化预算，按原文显示。'}</p>}
              {jsonLines && formatted && !display.reason && <p className="local-attachment-meta">
                逐条展开，空行分隔记录；此视图不再是单行记录格式。复制原始 JSONL/NDJSON 请切换“原文”。
              </p>}
              <div className="local-attachment-content"><MarkdownEditorPane ref={editorRef} content={content}
                readOnly plainText syntaxExtension={highlightEnabled && highlightBudget ? syntaxExtension : undefined}
                accessibleLabel="只读附件文本" onChange={() => {}} onSave={() => {}} /></div>
            </> : result.preview && !previewError ? <div className="workspace-resource-media">
              {result.preview.kind === 'image' ? <img src={result.preview.url} alt={result.name} onError={() => setPreviewError(true)} />
                : result.preview.kind === 'audio' ? <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={result.preview.url} controls preload="metadata" onError={() => setPreviewError(true)} />
                  : <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={result.preview.url} controls preload="metadata" onError={() => setPreviewError(true)} />}
            </div> : <p role="status">{previewError ? '无法解码此文件，请使用合适的系统工具查看。' : inline && result.notice === 'unsupported' ? '此格式暂不支持应用内预览。' : result.notice ? attachmentNoticeMessages[result.notice] : '本应用不内置查看此附件类型。'}</p>}
            {inline && !result.canOpenExternally && result.kind === 'file' && !result.preview && <p className="local-attachment-meta">请在文件管理器中选择合适的工具打开。</p>}
            <footer>{inline && <button onClick={() => { void navigator.clipboard.writeText(result.relativePath).catch(() => setActionError('复制路径失败，请重试。')) }}>复制相对路径</button>}{result.canViewAsText && <button disabled={busy} onClick={() => void action('text')}>按文本查看</button>}
              <button disabled={busy} onClick={() => void action('reveal')}>{result.revealLabel}</button>
              {result.canOpenExternally && <button disabled={busy} onClick={() => void action('open')}>用系统应用打开</button>}
              <button onClick={onClose}>关闭</button></footer>
          </>}
        {actionError && <p role="alert">{actionError}</p>}
      </div>
    </div>
  )
})
