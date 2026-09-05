import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { extractFilePreview } from '../utils/filePreviewSummary'
import {
  getActiveWorkspaceLifecycleKey,
  isActiveWorkspaceLifecycleKey,
  type WorkspaceLifecycleKey,
} from '../utils/workspaceOperationContext'

type IndexState = 'detached' | 'building' | 'ready' | 'updating' | 'degraded' | 'error' | 'read-only'
type BacklinkPlacement = 'prose' | 'standalone-link' | 'table'

interface IndexStatus {
  state: IndexState
  generation: number
  indexedDocuments: number
  totalDocuments: number
  pendingDocuments: number
  errors: number
}

export interface BacklinkItem {
  sourceRelativePath: string
  sourceDisplayName: string
  lineStart: number
  rawTarget: string
  context: string
  placement?: BacklinkPlacement
  sourceRange: {
    startOffset: number
    endOffset: number
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
}

export interface BacklinkStats {
  sourceDocuments: number
  occurrences: number
}

interface BacklinksPanelProps {
  targetRelativePath: string
  onSelect: (item: BacklinkItem) => void
  onClose: () => void
  onCountChange?: (stats: BacklinkStats) => void
}

const unavailableStates = new Set<IndexState>(['detached', 'error'])

interface BacklinkGroup {
  sourceRelativePath: string
  sourceDisplayName: string
  sourceDirectory: string
  items: BacklinkItem[]
  showDirectory: boolean
}

function splitRelativePath(relativePath: string): { name: string; directory: string } {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  return {
    name: segments.at(-1) ?? relativePath,
    directory: segments.length > 1 ? `${segments.slice(0, -1).join('/')}/` : '根目录',
  }
}

function readableContext(context: string): string {
  if (!context.trim()) return ''
  const preview = extractFilePreview(context)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .trim()
  if (preview === '（未找到可预览的正文）' || !/[\p{L}\p{N}]/u.test(preview)) return ''
  return preview
}

function placementOf(item: BacklinkItem): BacklinkPlacement {
  return item.placement ?? (readableContext(item.context) ? 'prose' : 'standalone-link')
}

function groupItems(
  items: BacklinkItem[],
  targetName: string,
  allItems: BacklinkItem[],
): BacklinkGroup[] {
  const basenameCounts = new Map<string, number>()
  new Set(allItems.map(item => item.sourceRelativePath)).forEach(relativePath => {
    const name = splitRelativePath(relativePath).name
    basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1)
  })

  const grouped = new Map<string, BacklinkGroup>()
  items.forEach(item => {
    const existing = grouped.get(item.sourceRelativePath)
    if (existing) {
      existing.items.push(item)
      return
    }
    const path = splitRelativePath(item.sourceRelativePath)
    grouped.set(item.sourceRelativePath, {
      sourceRelativePath: item.sourceRelativePath,
      sourceDisplayName: item.sourceDisplayName || path.name,
      sourceDirectory: path.directory,
      items: [item],
      showDirectory: path.name === targetName || (basenameCounts.get(path.name) ?? 0) > 1,
    })
  })
  return Array.from(grouped.values())
}

const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  targetRelativePath,
  onSelect,
  onClose,
  onCountChange,
}) => {
  const [items, setItems] = useState<BacklinkItem[]>([])
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [otherLinksExpanded, setOtherLinksExpanded] = useState(false)
  const [expandedSources, setExpandedSources] = useState<Set<string>>(() => new Set())
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const otherLinksId = useId()
  const targetPath = useMemo(
    () => splitRelativePath(targetRelativePath),
    [targetRelativePath]
  )
  const proseItems = useMemo(
    () => items.filter(item => placementOf(item) === 'prose'),
    [items]
  )
  const otherItems = useMemo(
    () => items.filter(item => placementOf(item) !== 'prose'),
    [items]
  )
  const sourceDocumentCount = useMemo(
    () => new Set(items.map(item => item.sourceRelativePath)).size,
    [items]
  )
  const proseGroups = useMemo(
    () => groupItems(proseItems, targetPath.name, items),
    [items, proseItems, targetPath.name]
  )
  const otherGroups = useMemo(
    () => groupItems(otherItems, targetPath.name, items),
    [items, otherItems, targetPath.name]
  )

  const load = useCallback(async (lifecycle: WorkspaceLifecycleKey, silent = false) => {
    if (!window.api.getWorkspaceBacklinks || !window.api.getWorkspaceIndexStatus) {
      setLoading(false)
      setStatus(null)
      return
    }
    if (!silent) setLoading(true)
    try {
      const [nextItems, nextStatus] = await Promise.all([
        window.api.getWorkspaceBacklinks(lifecycle, targetRelativePath),
        window.api.getWorkspaceIndexStatus(lifecycle),
      ])
      if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
      setItems(nextItems)
      setStatus(nextStatus)
      onCountChange?.({
        sourceDocuments: new Set(nextItems.map(item => item.sourceRelativePath)).size,
        occurrences: nextItems.length,
      })
    } catch {
      if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
      setItems([])
      setStatus({
        state: 'error',
        generation: 0,
        indexedDocuments: 0,
        totalDocuments: 0,
        pendingDocuments: 0,
        errors: 1,
      })
      onCountChange?.({ sourceDocuments: 0, occurrences: 0 })
    } finally {
      if (!silent && isActiveWorkspaceLifecycleKey(lifecycle)) setLoading(false)
    }
  }, [onCountChange, targetRelativePath])

  useEffect(() => {
    setOtherLinksExpanded(false)
    setExpandedSources(new Set())
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (!lifecycle?.primaryRoot) {
      setLoading(false)
      setStatus(null)
      setItems([])
      onCountChange?.({ sourceDocuments: 0, occurrences: 0 })
      return
    }
    void load(lifecycle)
  }, [load, onCountChange, targetRelativePath])

  useEffect(() => {
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (!lifecycle?.primaryRoot || !window.api.subscribeWorkspaceIndexStatus) return
    return window.api.subscribeWorkspaceIndexStatus(lifecycle, nextStatus => {
      if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
      setStatus(nextStatus)
      void load(lifecycle, true)
    })
  }, [load])

  useEffect(() => {
    if (!loading && items.length > 0) firstActionRef.current?.focus()
  }, [items.length, loading])

  const handleRebuild = useCallback(async () => {
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (!lifecycle?.primaryRoot || !window.api.rebuildWorkspaceIndex) return
    setRebuilding(true)
    try {
      await window.api.rebuildWorkspaceIndex(lifecycle)
      if (isActiveWorkspaceLifecycleKey(lifecycle)) await load(lifecycle)
    } finally {
      if (isActiveWorkspaceLifecycleKey(lifecycle)) setRebuilding(false)
    }
  }, [load])

  const toggleSource = (sourceRelativePath: string) => {
    setExpandedSources(current => {
      const next = new Set(current)
      if (next.has(sourceRelativePath)) next.delete(sourceRelativePath)
      else next.add(sourceRelativePath)
      return next
    })
  }

  const isIndexing = status?.state === 'building' || status?.state === 'updating'
  const isUnavailable = !status || unavailableStates.has(status.state)
  const isDegraded = status?.state === 'degraded'
  const isReadOnly = status?.state === 'read-only'

  return (
    <aside
      id="backlinks-panel"
      className="toc-panel backlinks-panel"
      role="complementary"
      aria-labelledby={headingId}
    >
      <div className="toc-panel-header backlinks-panel-header">
        <div className="backlinks-panel-heading">
          <h2 id={headingId} className="toc-panel-title">链接到这里</h2>
          <span className="backlinks-target" title={targetRelativePath}>{targetPath.name}</span>
          <span className="backlinks-target-directory">{targetPath.directory}</span>
          {items.length > 0 && (
            <span className="backlinks-summary" aria-live="polite">
              {sourceDocumentCount} 个文档 · {items.length} 处链接
            </span>
          )}
        </div>
        <button className="toc-panel-close" onClick={onClose} aria-label="关闭链接到这里">✕</button>
      </div>

      <div className="toc-panel-content backlinks-panel-content">
        {loading ? (
          <div className="backlinks-panel-status" role="status">正在读取链接…</div>
        ) : isUnavailable ? (
          <div className="backlinks-panel-status" role="status">
            <strong>⚠ 链接信息暂不可用</strong>
            <span>仅影响搜索和链接关系，文档未损坏。</span>
            <button type="button" onClick={() => void handleRebuild()} disabled={rebuilding}>
              {rebuilding ? '正在重建…' : '重建索引'}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="backlinks-panel-status" role="status">
            {isIndexing ? (
              <>
                <strong>正在建立内容索引…</strong>
                <span>{status.indexedDocuments} / {status.totalDocuments || '?'}</span>
                <span>结果会随索引进度逐步补充。</span>
              </>
            ) : isDegraded ? (
              <>
                <strong>还没有文档链接到这里</strong>
                <span>部分文件未建立索引，结果可能不完整。</span>
                <button type="button" onClick={() => void handleRebuild()} disabled={rebuilding}>
                  {rebuilding ? '正在重建…' : '重建索引'}
                </button>
              </>
            ) : isReadOnly ? (
              <>
                <strong>还没有文档链接到这里</strong>
                <span>索引正以只读模式运行；结果可用，但不会保存到磁盘。</span>
              </>
            ) : (
              <>
                <strong>还没有文档链接到这里</strong>
                <span>没有其他已索引 Markdown 文档包含指向当前文档的链接。</span>
              </>
            )}
          </div>
        ) : (
          <>
            {(isIndexing || isDegraded || isReadOnly) && (
              <div className="backlinks-indexing" role="status">
                {isDegraded
                  ? '部分文件未建立索引，结果可能不完整'
                  : isReadOnly
                    ? '索引正以只读模式运行；结果可用，但不会保存到磁盘'
                    : '正在建立内容索引，结果可能不完整'}
              </div>
            )}

            {proseItems.length > 0 ? (
              <section className="backlinks-section" aria-labelledby={`${headingId}-mentions`}>
                <h3 id={`${headingId}-mentions`} className="backlinks-section-title">
                  正文提及 <span>{proseItems.length}</span>
                </h3>
                {proseGroups.flatMap(group => group.items.map((item, itemIndex) => {
                  const context = readableContext(item.context)
                  return (
                    <button
                      key={`${item.sourceRelativePath}:${item.sourceRange.startOffset}`}
                      ref={group === proseGroups[0] && itemIndex === 0 ? firstActionRef : undefined}
                      type="button"
                      className="backlink-mention"
                      aria-label={`打开 ${group.sourceDisplayName} 第 ${item.lineStart} 行：${context}`}
                      onClick={() => onSelect(item)}
                    >
                      <span className="backlink-mention-context">“{context}”</span>
                      <span className="backlink-mention-meta">
                        <span>
                          <strong>{group.sourceDisplayName}</strong>
                          {group.showDirectory && <small>{group.sourceDirectory}</small>}
                        </span>
                        <span>第 {item.lineStart} 行 <b aria-hidden="true">→</b></span>
                      </span>
                    </button>
                  )
                }))}
              </section>
            ) : (
              <div className="backlinks-no-mentions">
                <strong>没有正文提及</strong>
                <span>其余链接独立成行或位于表格中，已收起以减少干扰。</span>
              </div>
            )}

            {otherItems.length > 0 && (
              <section className="backlinks-other-section">
                <button
                  ref={proseItems.length === 0 ? firstActionRef : undefined}
                  type="button"
                  className="backlinks-disclosure"
                  aria-expanded={otherLinksExpanded}
                  aria-controls={otherLinksId}
                  onClick={() => setOtherLinksExpanded(current => !current)}
                >
                  <span>其他链接</span>
                  <span>{otherItems.length} 处 <b aria-hidden="true">›</b></span>
                </button>
                {otherLinksExpanded && (
                  <div id={otherLinksId} className="backlinks-other-groups">
                    {otherGroups.map((group, groupIndex) => {
                      const onlyItem = group.items.length === 1 ? group.items[0] : null
                      if (onlyItem) {
                        const typeLabel = placementOf(onlyItem) === 'table' ? '表格' : '独立链接'
                        const context = readableContext(onlyItem.context)
                        return (
                          <button
                            key={group.sourceRelativePath}
                            type="button"
                            className="backlink-source-direct"
                            aria-label={`打开 ${group.sourceDisplayName} 的${typeLabel}，第 ${onlyItem.lineStart} 行`}
                            onClick={() => onSelect(onlyItem)}
                          >
                            <span className="backlink-group-identity">
                              <strong className="backlink-source">{group.sourceDisplayName}</strong>
                              {group.showDirectory && (
                                <span className="backlink-directory">{group.sourceDirectory}</span>
                              )}
                            </span>
                            <span className="backlink-direct-location">
                              {typeLabel} · 第 {onlyItem.lineStart} 行 <b aria-hidden="true">→</b>
                            </span>
                            {context && <span className="backlink-position-context">{context}</span>}
                          </button>
                        )
                      }

                      const expanded = expandedSources.has(group.sourceRelativePath)
                      const groupId = `${otherLinksId}-source-${groupIndex}`
                      return (
                        <div className="backlink-other-group" key={group.sourceRelativePath}>
                          <button
                            type="button"
                            className="backlink-source-disclosure"
                            aria-expanded={expanded}
                            aria-controls={groupId}
                            onClick={() => toggleSource(group.sourceRelativePath)}
                          >
                            <span className="backlink-group-identity">
                              <strong className="backlink-source">{group.sourceDisplayName}</strong>
                              {group.showDirectory && (
                                <span className="backlink-directory">{group.sourceDirectory}</span>
                              )}
                            </span>
                            <span>{group.items.length} 处 <b aria-hidden="true">›</b></span>
                          </button>
                          {expanded && (
                            <div id={groupId} className="backlink-positions">
                              {group.items.map(item => {
                                const placement = placementOf(item)
                                const context = readableContext(item.context)
                                const typeLabel = placement === 'table' ? '表格' : '独立链接'
                                return (
                                  <button
                                    key={`${item.sourceRelativePath}:${item.sourceRange.startOffset}`}
                                    type="button"
                                    className="backlink-position"
                                    aria-label={`打开 ${group.sourceDisplayName} 的${typeLabel}，第 ${item.lineStart} 行`}
                                    onClick={() => onSelect(item)}
                                  >
                                    <span className="backlink-position-meta">
                                      {typeLabel} · 第 {item.lineStart} 行 <b aria-hidden="true">→</b>
                                    </span>
                                    {context && <span className="backlink-position-context">{context}</span>}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

export default BacklinksPanel
