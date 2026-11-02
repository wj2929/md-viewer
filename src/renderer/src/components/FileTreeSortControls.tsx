import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_FILE_TREE_SORT, FILE_TREE_SORT_OPTIONS, defaultFileTreeSortDirection, fileTreeSortDirectionLabel, needsFileTreeMetadata, type FileTreeSort, type FileTreeSortBy } from '../../../shared/fileTreeSort'
import { useFileTreeSortStore } from '../stores/fileTreeSortStore'

export function FileTreeSortControls({ compact = false }: { compact?: boolean }): JSX.Element {
  const { value, ready, saving, error, connect, reload, save } = useFileTreeSortStore()
  const id = useId()
  useEffect(connect, [connect])
  const defaultSort = value.by === 'name' && value.direction === 'asc'
  const restoreFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (saving || !restoreFocus.current) return
    if (document.activeElement === document.body && restoreFocus.current.isConnected) restoreFocus.current.focus()
    restoreFocus.current = null
  }, [saving])
  const commit = (next: FileTreeSort) => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void save(next)
  }
  const direction = (next: FileTreeSort['direction']) => commit({ ...value, direction: next })
  const by = (next: FileTreeSortBy) => commit({ by: next, direction: defaultFileTreeSortDirection(next) })
  const preview = value.by === 'name' ? ['1.md', '10.md', '2.md']
    : value.by === 'natural' ? ['1.md', '2.md', '10.md']
      : value.by === 'type' ? ['图.excalidraw', '说明.md', '笔记.mdown']
        : value.by === 'modified' ? ['较早修改', '较晚修改'] : ['1 KB', '10 KB']
  return <div className="file-tree-sort-controls">
    <p className="file-tree-sort-hint">{compact ? '适用于所有目录和窗口 · 自动保存' : '全局排序 · 适用于所有目录和窗口 · 自动保存'}</p>
    {compact ? <fieldset aria-label="排序依据" disabled={!ready || saving}>
      {FILE_TREE_SORT_OPTIONS.map(option => <label key={option.by}>
        <input type="radio" name={`${id}-by`} checked={value.by === option.by} onChange={() => by(option.by)} />
        {option.label}
      </label>)}
    </fieldset> : <label className="file-tree-sort-field">排序依据
      <select value={value.by} disabled={!ready || saving} onChange={event => by(event.target.value as FileTreeSortBy)}>
        {FILE_TREE_SORT_OPTIONS.map(option => <option key={option.by} value={option.by}>{option.label}</option>)}
      </select>
    </label>}
    <label className="file-tree-sort-field">排序方向
      <select value={value.direction} disabled={!ready || saving} onChange={event => direction(event.target.value as FileTreeSort['direction'])}>
        {(['asc', 'desc'] as const).map(order => <option key={order} value={order}>{fileTreeSortDirectionLabel({ ...value, direction: order })}</option>)}
      </select>
    </label>
    <div className="file-tree-sort-notes">
      <p className="file-tree-sort-hint">文件夹优先，每层分别排序</p>
      {value.by === 'type' && <p className="file-tree-sort-hint">文件夹同属目录类型，按名称排序</p>}
      {needsFileTreeMetadata(value.by) && <p className="file-tree-sort-hint">{value.by === 'modified'
        ? '文件夹按内部文档最近修改时间' : '文件夹按内部文档总大小'}</p>}
      {!compact && needsFileTreeMetadata(value.by) && <p className="file-tree-sort-hint">包含折叠子目录，仅统计目录树收录的文档，不包含 CSV、PDF、媒体等文件；首次汇总时同步盘可能稍慢。</p>}
    </div>
    {!compact && <p className="file-tree-sort-preview">预览：{(value.direction === 'desc' ? [...preview].reverse() : preview).join(' → ')}</p>}
    {saving && <p role="status">正在保存排序设置…</p>}
    {error && <p role="alert">{error} <button type="button" disabled={saving} onClick={() => void reload()}>重新读取设置</button></p>}
    <button type="button" className="file-tree-sort-reset" aria-label="恢复默认排序" disabled={!ready || saving || defaultSort} onClick={() => void save({ ...DEFAULT_FILE_TREE_SORT })}>{compact ? '恢复默认' : '恢复默认排序'}</button>
  </div>
}

export function FileTreeSortButton(): JSX.Element {
  const { value } = useFileTreeSortStore()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 500 })
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const title = `目录树排序：${FILE_TREE_SORT_OPTIONS.find(option => option.by === value.by)?.label}，${fileTreeSortDirectionLabel(value)}（全局）`
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = button.current?.getBoundingClientRect()
      if (!rect) return
      const height = panel.current?.getBoundingClientRect().height ?? 400
      const top = rect.bottom + 4 + height <= innerHeight - 12 ? rect.bottom + 4 : Math.max(12, rect.top - height - 4)
      setPosition({ left: Math.max(12, Math.min(rect.right - 270, innerWidth - 282)), top, maxHeight: innerHeight - top - 12 })
    }
    place()
    window.addEventListener('resize', place)
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])
  return <>
    <button ref={button} type="button" className={`file-tree-sort-button ${value.by !== 'name' || value.direction !== 'asc' ? 'active' : ''}`}
      title={title} aria-label={title} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h7M2 8h5M2 12h3M12 3v10m-2-2 2 2 2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && createPortal(<div id={id} ref={panel} className="file-tree-sort-popover" role="dialog" aria-label="目录树全局排序" style={position}>
      <div className="file-tree-sort-header"><strong>目录树排序</strong><span>全局</span></div>
      <FileTreeSortControls compact />
    </div>, document.body)}
  </>
}
