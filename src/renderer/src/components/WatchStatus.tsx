import { useEffect, useId, useRef, useState } from 'react'
import { UiIcon } from './UiIcon'
import type { WorkspaceWatchHealth } from '../../../shared/workspaceWatch'
import './WatchStatus.css'

export function WatchStatus({ workspaceId, lifecycleEpoch, onRefresh, isLoading = false }: {
  workspaceId: string | null
  lifecycleEpoch: number | undefined
  onRefresh: () => void | Promise<void>
  isLoading?: boolean
}): React.JSX.Element {
  const [status, setStatus] = useState<WorkspaceWatchHealth | null>(null)
  const [settled, setSettled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    setStatus(null)
    setSettled(false)
    if (!workspaceId || lifecycleEpoch === undefined || !window.api.onWatchStatus || !window.api.getWatchStatus) return
    let active = true
    let version = -1
    const apply = (next: WorkspaceWatchHealth) => {
      if (!active || next.version < version) return
      version = next.version
      setStatus(next)
    }
    const unsubscribe = window.api.onWatchStatus(event => {
      if (event.workspaceId === workspaceId && event.lifecycleEpoch === lifecycleEpoch) apply(event.status)
    })
    void window.api.getWatchStatus(workspaceId, lifecycleEpoch).then(apply).catch(() => {})
    const timer = setTimeout(() => setSettled(true), 1000)
    return () => { active = false; clearTimeout(timer); unsubscribe() }
  }, [workspaceId, lifecycleEpoch])

  const hasStatus = Boolean(status && status.state !== 'detached' &&
    (settled || status.state !== 'starting') && (status.state !== 'healthy' || status.partialCoverage))
  const degraded = hasStatus && status?.state === 'degraded'
  const recovering = hasStatus && (status?.state === 'starting' || status?.state === 'recovering')
  const showDetails = hasStatus || actionError
  const summary = degraded ? '自动刷新暂不可用'
    : recovering ? '正在同步变更'
      : hasStatus ? '自动刷新正常，已忽略构建目录' : actionError ? '刷新未完成' : '刷新文件列表'
  const description = degraded ? '仍可阅读，搜索结果可能滞后。可手动刷新内容，或重试自动刷新。'
    : recovering ? '正在恢复自动刷新并同步变更，仍可继续阅读。'
      : hasStatus ? `已忽略 ${status?.excludedDirectoryCount ?? 0} 个 bin/obj 构建目录。生成目录内未打开文件不自动刷新，搜索结果可能滞后；已打开文件仍会监听，也可手动刷新内容。` : ''

  useEffect(() => {
    if (open && !showDetails) {
      if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus()
      setOpen(false)
    }
  }, [open, showDetails])

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector('button')?.focus()
    const outside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const run = async (action: () => unknown | Promise<unknown>) => {
    setBusy(true)
    setActionError(false)
    try { await action() } catch { setActionError(true); setOpen(true) } finally { setBusy(false) }
  }

  return <div className="watch-refresh no-export" ref={rootRef} data-watch-state={hasStatus ? status?.state : undefined}
    onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
    }}>
    <button type="button" ref={triggerRef}
      className={`nav-refresh-btn nav-instant-tooltip${open ? ' watch-refresh-open' : ''}`}
      aria-label="刷新文件列表" aria-description={showDetails ? `${summary}，点击查看状态和操作` : undefined}
      aria-haspopup={showDetails ? 'dialog' : undefined} aria-expanded={showDetails ? open : undefined}
      aria-controls={open ? panelId : undefined} data-tooltip={showDetails ? `${summary}，点击查看` : summary}
      disabled={!showDetails && (busy || isLoading)}
      onClick={() => { if (showDetails) setOpen(value => !value); else void run(onRefresh) }}>
      <span className={`watch-refresh-icon${recovering || busy || isLoading ? ' is-spinning' : ''}`} aria-hidden="true"><UiIcon name="refresh" /></span>
      {hasStatus && !recovering && <span className={`watch-refresh-mark${degraded ? ' is-degraded' : ''}`} aria-hidden="true">{degraded ? '!' : ''}</span>}
    </button>
    <span className="watch-refresh-announcement" role="status">{hasStatus ? summary : ''}</span>
    {open && <div id={panelId} className="watch-refresh-popover" ref={panelRef}
      role="dialog" aria-label="自动刷新状态">
      <strong>{summary}</strong>
      {description && <p>{description}</p>}
      <div className="watch-refresh-actions">
        <button type="button" disabled={busy || isLoading} onClick={() => { void run(onRefresh) }}>刷新内容</button>
        {degraded && <button type="button" disabled={busy || isLoading} onClick={() => {
          void run(() => window.api.retryWatch(workspaceId ?? undefined, lifecycleEpoch))
        }}>重试自动刷新</button>}
      </div>
      {actionError && <p role="alert">操作未完成，请稍后重试。</p>}
    </div>}
  </div>
}
