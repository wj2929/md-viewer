import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isLargeDocumentSize, type LargeDocumentSize } from '../../../shared/largeDocumentApproval'
import { recordPreviewState, type RendererFileDiagnosticOperation } from '../utils/diagnostics'
import { getActiveWorkspaceOperationContext } from '../utils/workspaceOperationContext'

const CHARACTER_BUDGET = 1_500_000
const LINE_BUDGET = 20_000

export function LargeDocumentPreview({ content, filePath, children, diagnosticPreviewId, diagnosticOperation, diagnosticPanelKind = 'main' }: {
  content: string
  filePath?: string
  children: ReactNode
  diagnosticPreviewId?: string
  diagnosticOperation?: RendererFileDiagnosticOperation
  diagnosticPanelKind?: 'main' | 'split' | 'editor'
}): JSX.Element {
  const size = useMemo(() => {
    let lines = 1
    for (let i = 0; i < content.length; i += 1) {
      if (content.charCodeAt(i) === 10) lines += 1
    }
    return { characters: content.length, lines }
  }, [content])
  const [approval, setApproval] = useState<LargeDocumentSize | null>(null)
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const [previousPath, setPreviousPath] = useState(filePath)
  const writeVersion = useRef(0)
  const writeQueue = useRef(Promise.resolve())
  if (previousPath !== filePath) {
    setPreviousPath(filePath)
    setApproval(null)
    setLoadedPath(null)
    setRemember(false)
    setShowSource(false)
    setStorageFailed(false)
    writeVersion.current += 1
  }
  const oversized = size.characters > CHARACTER_BUDGET || size.lines > LINE_BUDGET
  useEffect(() => {
    if (!oversized || !filePath) return
    let current = true
    void (async () => {
      try {
        const stored = await window.api.getLargeDocumentApproval(filePath)
        if (current) setApproval(isLargeDocumentSize(stored) ? stored : null)
      } catch {
        // 无法读取本地选择时保守地重新提示，不自动放行。
      } finally {
        if (current) setLoadedPath(filePath)
      }
    })()
    return () => { current = false }
  }, [filePath, oversized])
  useEffect(() => () => { writeVersion.current += 1 }, [])

  const loadingApproval = oversized && Boolean(filePath) && loadedPath !== filePath
  // 按确认时的规模判断，避免每次小幅更新都扩大自动放行范围。
  const approved = approval !== null
    && size.characters <= Math.max(CHARACTER_BUDGET, approval.characters * 1.25)
    && size.lines <= Math.max(LINE_BUDGET, approval.lines * 1.25)

  const previewState = loadingApproval ? 'loading-approval'
    : oversized && !approved ? showSource ? 'source-ready' : 'awaiting-choice' : 'render-requested'
  const operationId = diagnosticOperation?.context.operationId
  const source = diagnosticOperation?.context.source ?? 'unknown'
  useLayoutEffect(() => {
    if (!diagnosticPreviewId) return
    recordPreviewState(diagnosticPreviewId, previewState, operationId ? { operationId, source } : undefined, diagnosticPanelKind)
  }, [diagnosticPreviewId, previewState, operationId, source, diagnosticPanelKind])
  useLayoutEffect(() => () => {
    if (!diagnosticPreviewId) return
    recordPreviewState(diagnosticPreviewId, 'unmounted', operationId ? { operationId, source } : undefined, diagnosticPanelKind)
  }, [diagnosticPreviewId, operationId, source, diagnosticPanelKind])

  const persistApproval = (value: LargeDocumentSize | null) => {
    if (!filePath) return
    const operation = getActiveWorkspaceOperationContext()
    const version = ++writeVersion.current
    // 按用户操作顺序保存，避免“记住后立即撤销”被较慢的旧请求覆盖。
    writeQueue.current = writeQueue.current.then(async () => {
      try {
        if (!operation) throw new Error('工作区尚未就绪')
        await window.api.setLargeDocumentApproval(filePath, value, operation)
        if (writeVersion.current === version) setStorageFailed(false)
      } catch {
        if (writeVersion.current === version) setStorageFailed(true)
      }
    })
  }
  const renderFully = () => {
    setApproval(size)
    setShowSource(false)
    if (remember) persistApproval(size)
  }
  const reset = () => {
    persistApproval(null)
    setApproval(null)
    setRemember(false)
    setShowSource(false)
  }

  if (!oversized) return <>{children}</>
  if (loadingApproval) return <section className="large-document-notice no-export" role="status">正在读取大文档预览选择…</section>

  return (
    <>
      <section className="large-document-notice no-export" aria-label="大文档预览">
        {approved ? (
          <>
            <span>已选择完整渲染大文档，不截断正文。</span>
            <button type="button" onClick={reset}>恢复大文档提示</button>
          </>
        ) : (
          <>
            <strong>文档较大，请选择预览方式</strong>
            <p>内容长度：{(size.characters / 1000).toFixed(2)} K 字符，共 {size.lines.toLocaleString()} 行。默认直接预览预算为 1,500 K 字符、20,000 行。</p>
            <p>完整渲染可能占用较多内存并导致界面卡顿；同步渲染期间可能无法立即取消。查看源码不解析 Markdown 或图表。</p>
            {filePath && (
              <label>
                <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
                记住此文档的完整渲染选择（字符数或行数比本次增加超过 25% 且超出默认预算时重新提示）
              </label>
            )}
            <div className="large-document-actions">
              <button type="button" onClick={renderFully}>完整渲染</button>
              <button type="button" onClick={() => setShowSource(value => !value)}>{showSource ? '收起源码' : '查看源码'}</button>
            </div>
          </>
        )}
        {storageFailed && <p role="status">无法保存本地选择；当前操作仍然有效，重新打开时可能再次提示。</p>}
      </section>
      {approved ? children : showSource ? (
        <textarea className="large-document-source no-export" aria-label="Markdown 源码（只读）" value={content} readOnly spellCheck={false} wrap="off" />
      ) : null}
    </>
  )
}
