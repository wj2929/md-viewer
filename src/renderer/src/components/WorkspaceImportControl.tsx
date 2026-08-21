import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import '../assets/workspaceImport.css'

export interface WorkspaceImportSource {
  windowId: number
  title: string
  workspaceCount: number
  summary: string
  workspaces: Array<{ id: string; name: string; summary: string }>
}

interface WorkspaceImportControlProps {
  onBegin: (sourceWindowId: number) => Promise<void>
  isTransferring: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  anchorElement?: HTMLElement | null
  sourcesAvailable?: boolean
}

type PanelState = 'loading' | 'ready' | 'error'

export function WorkspaceImportControl({
  onBegin,
  isTransferring,
  open,
  onOpenChange,
  hideTrigger = false,
  anchorElement = null,
  sourcesAvailable = true,
}: WorkspaceImportControlProps): JSX.Element | null {
  const controlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlled ? open : internalOpen
  const [state, setState] = useState<PanelState>('loading')
  const [sources, setSources] = useState<WorkspaceImportSource[]>([])
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState({ top: 8, left: 8 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const firstOptionRef = useRef<HTMLInputElement>(null)

  const setOpen = useCallback((next: boolean) => {
    if (!controlled) setInternalOpen(next)
    onOpenChange?.(next)
  }, [controlled, onOpenChange])

  const returnFocus = useCallback(() => {
    ;(anchorElement ?? triggerRef.current)?.focus()
  }, [anchorElement])

  const close = useCallback(() => {
    if (isTransferring) return
    setOpen(false)
    setSelectedWindowId(null)
    returnFocus()
  }, [isTransferring, returnFocus, setOpen])

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    setSelectedWindowId(null)
    try {
      const next = await window.api.listWorkspaceMergeSources()
      setSources(next)
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '未知错误')
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (isOpen) void load()
  }, [isOpen, load])

  useLayoutEffect(() => {
    if (!isOpen) return

    const updatePosition = () => {
      const panel = panelRef.current
      if (!panel) return
      const anchor = anchorElement ?? triggerRef.current
      const panelBounds = panel.getBoundingClientRect()
      const anchorBounds = anchor?.getBoundingClientRect()
      const { width, height } = panelBounds
      const proposedLeft = anchorBounds?.left ?? Math.max(8, (window.innerWidth - width) / 2)
      const left = Math.max(8, Math.min(proposedLeft, window.innerWidth - width - 8))
      const below = anchorBounds ? anchorBounds.bottom + 6 : Math.max(8, (window.innerHeight - height) / 2)
      const above = anchorBounds ? anchorBounds.top - height - 6 : below
      const top = anchorBounds && below + height > window.innerHeight - 8 && above >= 8
        ? above
        : Math.max(8, Math.min(below, window.innerHeight - height - 8))
      setPosition({ top, left })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [anchorElement, error, isOpen, sources.length, state])

  useEffect(() => {
    if (!isOpen || state !== 'ready' || sources.length === 0) return
    firstOptionRef.current?.focus()
  }, [isOpen, sources, state])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !(anchorElement ?? triggerRef.current)?.contains(target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anchorElement, close, isOpen])

  const selectedSource = selectedWindowId === null ? undefined : sources.find((source) => source.windowId === selectedWindowId)
  if (!hideTrigger && !sourcesAvailable && !isOpen) return null

  return (
    <div className="workspace-import-control">
      {!hideTrigger && <button
        ref={triggerRef}
        type="button"
        className="workspace-import-trigger"
        aria-label="合并其他窗口"
        aria-expanded={isOpen}
        aria-controls="workspace-import-popover"
        title="合并当前打开的其他窗口"
        onClick={() => setOpen(!isOpen)}
      >
        <span aria-hidden="true">⇥</span>
        <span>合并其他窗口</span>
      </button>}
      {isOpen && <div
        ref={panelRef}
        id="workspace-import-popover"
        className="workspace-import-popover"
        style={{ top: position.top, left: position.left }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-import-title"
      >
        <div className="workspace-import-header">
          <div><h2 id="workspace-import-title">合并其他窗口</h2><p>选择一个窗口合并到当前窗口。</p></div>
          {!isTransferring && <button type="button" className="workspace-import-dismiss" onClick={close} aria-label="关闭合并窗口面板">×</button>}
        </div>
        {state === 'loading' && <p className="workspace-import-status" role="status">正在读取当前打开的窗口…</p>}
        {state === 'error' && <div className="workspace-import-status workspace-import-error" role="alert"><p>无法读取当前打开的窗口：{error}</p><button type="button" onClick={() => void load()}>重试</button></div>}
        {state === 'ready' && sources.length === 0 && <p className="workspace-import-status">没有其他打开的窗口可合并。</p>}
        {state === 'ready' && sources.length > 0 && <fieldset className="workspace-import-list" disabled={isTransferring}>
          <legend className="sr-only">可合并窗口</legend>
          {sources.map((source, sourceIndex) => {
            const checked = selectedWindowId === source.windowId
            return <label key={source.windowId} className={`workspace-import-option workspace-import-window-option ${checked ? 'selected' : ''}`}>
              <input
                ref={sourceIndex === 0 ? firstOptionRef : undefined}
                type="radio"
                name="workspace-import"
                checked={checked}
                onChange={() => setSelectedWindowId(source.windowId)}
              />
              <span className="workspace-import-option-content">
                <span className="workspace-import-option-heading">
                  <strong>{source.title || '空白窗口'}</strong>
                  <small>{source.workspaceCount > 0 ? `${source.workspaceCount} 个会话` : '空窗口'}</small>
                </span>
                <small>{source.summary}</small>
              </span>
            </label>
          })}
        </fieldset>}
        {state === 'ready' && sources.length > 0 && <div className="workspace-import-footer">
          <p>{selectedSource
            ? selectedSource.workspaceCount > 0
              ? `“${selectedSource.title}”中的 ${selectedSource.workspaceCount} 个会话将移入当前窗口，完成后来源窗口将关闭。空白占位不会转移。`
              : `“${selectedSource.title}”没有需要迁移的阅读会话。继续后将关闭该空窗口，目录仍保留在最近文件夹中。`
            : '选择一个窗口以继续。'}</p>
          <div>{!isTransferring && <button type="button" onClick={close}>取消</button>}<button type="button" className="workspace-import-confirm" disabled={!selectedSource || isTransferring} onClick={() => selectedSource && void onBegin(selectedSource.windowId)}>{isTransferring ? '正在合并…' : selectedSource?.workspaceCount === 0 ? '关闭此窗口' : '合并此窗口'}</button></div>
        </div>}
      </div>}
    </div>
  )
}
