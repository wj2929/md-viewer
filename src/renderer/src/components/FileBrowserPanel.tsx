import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type MouseEvent } from 'react'
import type { WorkspaceOperationContext } from '../../../shared/workspace'
import { isBrowserPathAffected, type WorkspaceDirectoryEntry, type WorkspaceBrowserSelection } from '../../../shared/directoryBrowser'
import { classifyWikiResource } from '../../../shared/localMedia'
import './FileBrowserPanel.css'

function BrowserEntryIcon({ entry, expanded }: { entry: WorkspaceDirectoryEntry; expanded: boolean }): JSX.Element {
  const kind = entry.kind === 'directory' ? 'folder' : entry.kind === 'link' ? 'link'
    : /\.(xlsx?|csv|ods)$/i.test(entry.name) ? 'table' : classifyWikiResource(entry.name)
  return <svg className={`browser-entry-icon browser-icon-${kind}`} data-kind={kind} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    {kind === 'folder' ? <>
      <path className="browser-folder-body" d="M2 5a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9H2Z" />
      {expanded && <path className="browser-folder-body" d="M2 9h16l-2 7H2Z" />}
    </> : kind === 'image' ? <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" /><circle cx="7" cy="7" r="1" /><path d="m3 14 4-4 3 3 3-5 4 6" />
    </> : kind === 'audio' ? <>
      <path d="M8 14V5l8-2v9M8 8l8-2" /><ellipse cx="5.5" cy="14.5" rx="2.5" ry="2" /><ellipse cx="13.5" cy="12.5" rx="2.5" ry="2" />
    </> : kind === 'video' ? <>
      <rect x="2" y="4" width="16" height="12" rx="1.5" /><path d="m8 7 5 3-5 3Z" />
    </> : kind === 'table' ? <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M3 7h14M3 12h14M8 7v10" />
    </> : kind === 'link' ? <>
      <path d="m8 6 2-2a3 3 0 0 1 4 4l-2 2M8 10l-2 2a3 3 0 0 0 4 4l2-2M7 13l6-6" />
    </> : <>
      <path d="M4 2h8l4 4v12H4Z" /><path d="M12 2v5h4M7 10h6M7 13h6" />
    </>}
  </svg>
}

type Directory = { entries?: WorkspaceDirectoryEntry[]; loading?: boolean; error?: string }

export interface FileBrowserPanelHandle { refresh: (mutation?: { oldRelativePath: string; newRelativePath?: string }) => void }

export const FileBrowserPanel = forwardRef<FileBrowserPanelHandle, {
  open: boolean
  operation: WorkspaceOperationContext
  rootName: string
  width?: number
  drawer?: boolean
  onClose: () => void
  onSelect: (entry: WorkspaceDirectoryEntry) => void
  onAction?: (selection: WorkspaceBrowserSelection) => Promise<void>
}>(function FileBrowserPanel({ open, operation, rootName, width = 280, drawer = false, onClose, onSelect, onAction }, ref) {
  const [directories, setDirectories] = useState<Record<string, Directory>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<string>()
  const [menuError, setMenuError] = useState<string>()
  const menuSequence = useRef(0)
  const requests = useRef(new Map<string, Promise<void>>())
  const generation = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { workspaceId, lifecycleEpoch } = operation
  const lifecycle = `${workspaceId}:${lifecycleEpoch}`
  const load = useCallback((relativePath: string) => {
    const pending = requests.current.get(relativePath)
    if (pending) return pending
    const version = generation.current
    setDirectories(prev => ({ ...prev, [relativePath]: { ...prev[relativePath], loading: true, error: undefined } }))
    const request = window.api.listWorkspaceDirectory({ workspaceId, lifecycleEpoch }, relativePath).then(entries => {
      if (generation.current === version) setDirectories(prev => ({ ...prev, [relativePath]: { entries } }))
    }).catch(() => {
      if (generation.current === version) setDirectories(prev => ({ ...prev, [relativePath]: { error: '无法读取目录，请重试' } }))
    }).finally(() => { if (requests.current.get(relativePath) === request) requests.current.delete(relativePath) })
    requests.current.set(relativePath, request)
    return request
  }, [workspaceId, lifecycleEpoch])

  useEffect(() => () => { generation.current++; menuSequence.current++; requests.current.clear() }, [])
  useEffect(() => {
    if (open) for (const relativePath of expanded) void load(relativePath)
    // Expanded directories are read by explicit toggles; filtering never starts IO.
  }, [open, load])

  const menuRef = useRef<HTMLDetailsElement>(null)
  const refresh: FileBrowserPanelHandle['refresh'] = mutation => {
    generation.current++; requests.current.clear()
    const remap = (value: string): string | undefined => !mutation || !isBrowserPathAffected(value, mutation.oldRelativePath, true)
      ? value : mutation.newRelativePath === undefined ? undefined : mutation.newRelativePath + value.slice(mutation.oldRelativePath.length)
    const paths = Object.keys(directories).map(remap).filter((value): value is string => value !== undefined)
    if (mutation) {
      setDirectories({})
      setExpanded(prev => new Set([...prev].map(remap).filter((value): value is string => value !== undefined)))
      setSelected(prev => prev === undefined ? prev : remap(prev))
    }
    for (const relativePath of paths.length ? paths : ['']) void load(relativePath)
  }
  useImperativeHandle(ref, () => ({ refresh }))
  const showContextMenu = async (event: MouseEvent, entry?: WorkspaceDirectoryEntry) => {
    event.preventDefault(); event.stopPropagation()
    if (entry && entry.kind !== 'file' && entry.kind !== 'directory') return
    const sequence = ++menuSequence.current
    setMenuError(undefined)
    if (entry) setSelected(entry.relativePath)
    try {
      const selection = await window.api.showWorkspaceContextMenu(operation, entry?.relativePath ?? '')
      if (!selection || sequence !== menuSequence.current) return
      if (selection.action === 'refresh') refresh()
      else await onAction?.(selection)
    } catch (cause) {
      if (sequence === menuSequence.current) setMenuError(cause instanceof Error ? cause.message : '操作失败，请重试')
    }
  }
  const toggle = (relativePath: string) => {
    if (!expanded.has(relativePath)) void load(relativePath)
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(relativePath)) next.delete(relativePath)
      else next.add(relativePath)
      return next
    })
  }
  const filter = query.trim().toLocaleLowerCase()
  const matches = (entry: WorkspaceDirectoryEntry): boolean => {
    if (!showHidden && entry.name.startsWith('.')) return false
    return !filter || entry.relativePath.toLocaleLowerCase().includes(filter)
      || (entry.kind === 'directory' && Boolean(directories[entry.relativePath]?.entries?.some(matches)))
  }
  const renderDirectory = (relativePath: string): JSX.Element => {
    const state = directories[relativePath]
    const entries = state?.entries?.filter(matches) ?? []
    const limit = limits[relativePath] ?? 200
    return <>
      {state?.loading && <div role="status">正在读取…</div>}
      {state?.error && <div role="status">{state.error} <button onClick={() => void load(relativePath)}>重试</button></div>}
      {state?.entries && !state.loading && entries.length === 0 && <div className="browser-empty" role="status">{filter ? '没有匹配的已加载项' : state.entries.length === 0 ? '空文件夹' : '没有可见条目'}</div>}
      {entries.slice(0, limit).map(entry => {
        const directory = entry.kind === 'directory'
        const isExpanded = expanded.has(entry.relativePath) || Boolean(filter && directory)
        return <div role="treeitem" key={entry.relativePath} onContextMenu={event => void showContextMenu(event, entry)} aria-expanded={directory ? isExpanded : undefined} aria-selected={selected === entry.relativePath}>
          <button className="browser-entry" title={entry.relativePath} disabled={entry.kind === 'link' || entry.kind === 'other'} onClick={() => {
            if (directory) toggle(entry.relativePath)
            else { setSelected(entry.relativePath); onSelect(entry) }
          }}><span className="browser-entry-chevron" aria-hidden="true">{directory && <svg viewBox="0 0 10 10" className={isExpanded ? 'expanded' : ''}><path d="m3 2 3 3-3 3" /></svg>}</span>
            <BrowserEntryIcon entry={entry} expanded={isExpanded} /><span>{entry.name}</span></button>
          {directory && isExpanded && directories[entry.relativePath] && <div role="group" className="browser-children">{renderDirectory(entry.relativePath)}</div>}
        </div>
      })}
      {entries.length > limit && <button onClick={() => setLimits(prev => ({ ...prev, [relativePath]: limit + 200 }))}>显示更多（{entries.length - limit}）</button>}
    </>
  }
  return <aside className={`file-browser-panel${drawer ? ' browser-drawer' : ''}`} style={{ width, flexBasis: width }} hidden={!open} aria-label="工作区文件" data-lifecycle={lifecycle} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); if (menuRef.current?.open) menuRef.current.open = false; else onClose() }
    if ((event.metaKey || event.ctrlKey) && ['x', 'v'].includes(event.key.toLowerCase())) {
      if (!(event.target instanceof HTMLInputElement && event.target.type === 'text')) event.preventDefault()
      event.stopPropagation()
    }
  }} onPaste={event => {
    if (!(event.target instanceof HTMLInputElement && event.target.type === 'text')) event.preventDefault()
    event.stopPropagation()
  }}>
    <header><strong>工作区文件</strong>{drawer && <button onClick={onClose}>查看内容</button>}<details className="browser-menu" ref={menuRef}>
      <summary aria-label="工作区文件操作" title="工作区文件操作">⋯</summary>
      <div className="browser-options"><label><input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)} />显示隐藏文件</label>
        <button aria-label="刷新工作区文件" onClick={() => { refresh(); if (menuRef.current) menuRef.current.open = false }}>刷新</button>
        <button onClick={() => { setExpanded(new Set([''])); if (menuRef.current) menuRef.current.open = false }}>折叠全部</button></div>
    </details><button aria-label="关闭工作区文件" onClick={onClose}>×</button></header>
    <div className="browser-root" title={rootName} onContextMenu={event => void showContextMenu(event)}>{rootName}</div>
    <input aria-label="过滤已加载项" placeholder="过滤已加载项" value={query} onChange={event => setQuery(event.target.value)} />
    <small>仅筛选已加载项</small>
    {menuError && <div role="alert" className="browser-action-error">{menuError}</div>}
    <div ref={scrollRef} role="tree" aria-label="完整目录" className="browser-tree" onContextMenu={event => void showContextMenu(event)}>{renderDirectory('')}</div>
  </aside>
})
