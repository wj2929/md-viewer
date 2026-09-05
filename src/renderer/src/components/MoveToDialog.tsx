/**
 * 跨根移动目标选择弹窗。
 * 默认逐层浏览历史目录；搜索框只过滤“最近打开的目录”列表。
 * 移动只发送 opaque targetHistoryId + 相对子路径，绝不传目标绝对路径。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LinkImpactSummary,
  LinkRewriteApplyFileResult,
  LinkRewritePlanView,
} from '../../../main/linking/types'
import type { CrossRootMoveImpactReport } from '../../../shared/crossRootMoveImpact'
import './MoveToDialog.css'
import { getActiveWorkspaceLifecycleKey, getActiveWorkspaceOperationContext } from '../utils/workspaceOperationContext'

interface FolderHistoryItem {
  id: string
  path: string
  name: string
  lastOpened: number
}

interface MoveToDialogProps {
  isOpen: boolean
  sources: string[]
  onClose: () => void
  onMoveSuccess?: (message: string) => void
  onMoveError?: (message: string) => void
}

interface MoveOperationItem {
  sourcePath: string
  status: 'success' | 'failed'
  message?: string
}

interface MoveRepairResult {
  files: LinkRewriteApplyFileResult[]
  skippedChanges: number
}

type MoveStage = 'target' | 'moving' | 'move-result' | 'repair-diff' | 'repair-result'

interface DirNode {
  name: string
  path: string
}

interface SelectedMoveTarget {
  historyId: string
  relPath: string
  displayLabel: string
  absolutePath: string
}

const normSep = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
const baseName = (p: string): string => normSep(p).split('/').pop() ?? p
const dirName = (p: string): string => {
  const n = normSep(p)
  const idx = n.lastIndexOf('/')
  return idx <= 0 ? n : n.slice(0, idx)
}
const relFromRoot = (root: string, target: string): string | null => {
  const r = normSep(root)
  const t = normSep(target)
  if (t === r) return ''
  if (t.startsWith(`${r}/`)) return t.slice(r.length + 1)
  return null
}

const isInvalidTarget = (targetDir: string, sources: string[]): boolean => {
  const t = normSep(targetDir)
  return sources.some(src => {
    const s = normSep(src)
    if (t === s || t.startsWith(`${s}/`)) return true
    return dirName(s) === t
  })
}

interface TreeItemProps {
  node: DirNode
  depth: number
  sources: string[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

const TreeItem: React.FC<TreeItemProps> = ({ node, depth, sources, selectedPath, onSelect }) => {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const disabled = isInvalidTarget(node.path, sources)

  const toggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (children === null) {
      setLoading(true)
      try {
        setChildren(await window.api.listChildDirs(node.path))
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
  }, [expanded, children, node.path])

  return (
    <div className="move-to-tree-node">
      <div
        className={`move-to-tree-row ${selectedPath === node.path ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => !disabled && onSelect(node.path)}
        title={disabled ? '不能移动到源自身、子目录或原目录' : node.path}
      >
        <span
          className="move-to-tree-caret"
          onClick={(event) => {
            event.stopPropagation()
            void toggle()
          }}
        >
          {expanded ? '▾' : '▸'}
        </span>
        <span className="move-to-tree-icon">📁</span>
        <span className="move-to-tree-name">{node.name}</span>
      </div>
      {expanded && (
        <div className="move-to-tree-children">
          {loading && <div className="move-to-tree-hint">加载中…</div>}
          {!loading && children?.length === 0 && (
            <div className="move-to-tree-hint" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              （无子目录）
            </div>
          )}
          {children?.map(child => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              sources={sources}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const MoveToDialog: React.FC<MoveToDialogProps> = ({
  isOpen,
  sources,
  onClose,
  onMoveSuccess,
  onMoveError
}) => {
  const [history, setHistory] = useState<FolderHistoryItem[]>([])
  const [selectedRoot, setSelectedRoot] = useState<FolderHistoryItem | null>(null)
  const [rootChildren, setRootChildren] = useState<DirNode[] | null>(null)
  const [loadingRoot, setLoadingRoot] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<SelectedMoveTarget | null>(null)
  const [moving, setMoving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [stage, setStage] = useState<MoveStage>('target')
  const [impacts, setImpacts] = useState<LinkImpactSummary[]>([])
  const [impactLoading, setImpactLoading] = useState(false)
  const [impactError, setImpactError] = useState<string | null>(null)
  const [crossRootImpact, setCrossRootImpact] = useState<CrossRootMoveImpactReport | null>(null)
  const [moveItems, setMoveItems] = useState<MoveOperationItem[]>([])
  const [repairPlans, setRepairPlans] = useState<LinkRewritePlanView[]>([])
  const [selectedChangeIds, setSelectedChangeIds] = useState<Set<string>>(new Set())
  const [repairResult, setRepairResult] = useState<MoveRepairResult | null>(null)
  const rootRequestId = useRef(0)

  useEffect(() => {
    if (!isOpen) {
      rootRequestId.current += 1
      return
    }
    setSelectedRoot(null)
    setRootChildren(null)
    setSelectedTarget(null)
    setMoving(false)
    setSearchQuery('')
    setStage('target')
    setImpacts([])
    setImpactLoading(false)
    setImpactError(null)
    setCrossRootImpact(null)
    setMoveItems([])
    setRepairPlans([])
    setSelectedChangeIds(new Set())
    setRepairResult(null)
    window.api.getFolderHistory().then(setHistory).catch(() => setHistory([]))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !moving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, moving, onClose])



  const selectRoot = useCallback(async (item: FolderHistoryItem) => {
    const requestId = ++rootRequestId.current
    setSelectedRoot(item)
    setSelectedTarget({
      historyId: item.id,
      relPath: '',
      displayLabel: item.name,
      absolutePath: normSep(item.path)
    })
    setRootChildren(null)
    setLoadingRoot(true)
    try {
      const dirs = await window.api.listChildDirs(item.path)
      if (rootRequestId.current === requestId) setRootChildren(dirs)
    } catch {
      if (rootRequestId.current === requestId) setRootChildren([])
    } finally {
      if (rootRequestId.current === requestId) setLoadingRoot(false)
    }
  }, [])

  const selectTreeTarget = useCallback((absolutePath: string) => {
    if (!selectedRoot) return
    const relPath = relFromRoot(selectedRoot.path, absolutePath)
    if (relPath === null) return
    setSelectedTarget({
      historyId: selectedRoot.id,
      relPath,
      displayLabel: relPath ? `${selectedRoot.name}/${relPath}` : selectedRoot.name,
      absolutePath
    })
  }, [selectedRoot])



  const lifecycle = getActiveWorkspaceLifecycleKey()
  const currentRoot = lifecycle?.primaryRoot ? normSep(lifecycle.primaryRoot) : null
  const targetRoot = selectedRoot ? normSep(selectedRoot.path) : null
  const isSameRoot = Boolean(currentRoot && targetRoot && currentRoot === targetRoot)
  const mappings = isSameRoot && currentRoot && selectedTarget
    ? sources.flatMap(source => {
        const oldRelativePath = relFromRoot(currentRoot, source)
        if (oldRelativePath === null) return []
        return [{
          oldRelativePath,
          newRelativePath: [selectedTarget.relPath, baseName(source)].filter(Boolean).join('/'),
        }]
      })
    : []
  const exactChanges = impacts.reduce((sum, impact) => sum + impact.exactChanges, 0)
  const candidates = impacts.reduce((sum, impact) => sum + impact.candidates, 0)

  useEffect(() => {
    if (!isOpen || !selectedTarget || !isSameRoot || mappings.length === 0) {
      setImpacts([])
      setImpactLoading(false)
      setImpactError(null)
      return
    }
    const operation = getActiveWorkspaceOperationContext()
    if (!operation) return
    let cancelled = false
    setImpacts([])
    setImpactError(null)
    setImpactLoading(true)
    Promise.all(mappings.map(mapping => window.api.createLinkImpact(operation, mapping)))
      .then(result => { if (!cancelled) setImpacts(result) })
      .catch((error) => {
        if (!cancelled) {
          setImpacts([])
          setImpactError(error instanceof Error ? error.message : '链接影响分析失败')
        }
      })
      .finally(() => { if (!cancelled) setImpactLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, selectedTarget?.absolutePath, isSameRoot, sources])

  useEffect(() => {
    if (!isOpen || !selectedTarget || isSameRoot) {
      setCrossRootImpact(null)
      return
    }
    const operation = getActiveWorkspaceOperationContext()
    if (!operation || !window.api.previewCrossRootMoveImpact) return
    let cancelled = false
    setCrossRootImpact(null)
    setImpactError(null)
    setImpactLoading(true)
    window.api.previewCrossRootMoveImpact(
      sources, selectedTarget.historyId, selectedTarget.relPath, operation,
    ).then(report => {
      if (!cancelled) setCrossRootImpact(report)
    }).catch(error => {
      if (!cancelled) setImpactError(error instanceof Error ? error.message : '跨根链接影响分析失败')
    }).finally(() => {
      if (!cancelled) setImpactLoading(false)
    })
    return () => { cancelled = true }
  }, [isOpen, selectedTarget?.absolutePath, isSameRoot, sources])

  const handleMove = useCallback(async () => {
    if (!selectedTarget || impactLoading || (isSameRoot && impacts.length !== mappings.length)) return
    setMoving(true)
    setStage('moving')
    const operation = getActiveWorkspaceOperationContext()
    if (!operation) {
      setMoving(false)
      return
    }
    const succeeded: string[] = []
    const operationReceipts = new Map<string, string>()
    const items: MoveOperationItem[] = []
    for (const [index, src] of sources.entries()) {
      try {
        if (isSameRoot && mappings[index] && impacts[index]) {
          const execution = await window.api.executeLinkRewriteOperation(operation, {
            impactId: impacts[index].impactId,
            mapping: mappings[index],
            reason: 'move',
            confirm: true,
          })
          operationReceipts.set(normSep(src), execution.receipt.operationReceiptId)
        } else {
          await window.api.moveFileToFolder(
            src,
            selectedTarget.historyId,
            selectedTarget.relPath,
            operation
          )
        }
        succeeded.push(src)
        items.push({ sourcePath: src, status: 'success' })
      } catch (error) {
        items.push({
          sourcePath: src,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    setMoving(false)
    setMoveItems(items)
    setStage('move-result')

    if (isSameRoot && exactChanges > 0 && succeeded.length > 0) {
      const repairMappings = mappings.flatMap((mapping, index) => {
        const receiptId = operationReceipts.get(normSep(sources[index]))
        return receiptId ? [{ mapping, receiptId }] : []
      })
      const plans = await Promise.all(repairMappings.map(({ mapping, receiptId }) =>
        window.api.createLinkRepairPlan(operation, mapping, 'move', receiptId)
      ))
      const changes = plans.flatMap(plan => plan.changes)
      setRepairPlans(plans)
      setSelectedChangeIds(new Set(changes.map(change => change.changeId)))
    }
    if (!isSameRoot || exactChanges === 0 || succeeded.length === 0) {
      const failedCount = items.filter(item => item.status === 'failed').length
      if (failedCount === 0) {
        onMoveSuccess?.(`已移动 ${succeeded.length} 项到「${selectedTarget.displayLabel}」`)
      } else if (succeeded.length === 0) {
        onMoveError?.(`移动失败：${items.find(item => item.status === 'failed')?.message}`)
      } else {
        onMoveError?.(`已移动 ${succeeded.length} 项，${failedCount} 项失败`)
      }
    }
  }, [selectedTarget, sources, isSameRoot, mappings, impacts, exactChanges, impactLoading, onMoveSuccess, onMoveError])

  const showRepairDiff = useCallback(() => {
    if (repairPlans.some(plan => plan.changes.length > 0)) setStage('repair-diff')
  }, [repairPlans])

  const skipRepair = useCallback(async () => {
    const operation = getActiveWorkspaceOperationContext()
    if (operation) {
      await Promise.all(repairPlans.map(plan => window.api.discardLinkRepairPlan(operation, plan.planId)))
    }
    setRepairResult({ files: [], skippedChanges: repairPlans.flatMap(plan => plan.changes).length })
    setStage('repair-result')
    onMoveSuccess?.(`文件已移动，链接修复已跳过`)
  }, [repairPlans, onMoveSuccess])

  const applyRepair = useCallback(async () => {
    const operation = getActiveWorkspaceOperationContext()
    if (!operation) return
    const result = await window.api.applyLinkRepairPlans(operation, {
      plans: repairPlans.map(plan => ({
        planId: plan.planId,
        operationReceiptId: plan.operationReceiptId,
        selectedChangeIds: plan.changes
          .filter(change => selectedChangeIds.has(change.changeId))
          .map(change => change.changeId),
      })),
      confirm: true,
    })
    const files = result.files
    const totalChanges = repairPlans.flatMap(plan => plan.changes).length
    setRepairResult({ files, skippedChanges: totalChanges - selectedChangeIds.size })
    setStage('repair-result')
    onMoveSuccess?.(`链接修复完成`)
  }, [repairPlans, selectedChangeIds, onMoveSuccess])

  const regenerateConflictPlans = useCallback(async () => {
    const operation = getActiveWorkspaceOperationContext()
    if (!operation) return
    const regenerated = await Promise.all(repairPlans.map(plan =>
      window.api.regenerateLinkRepairPlan(operation, plan.planId)
    ))
    setRepairPlans(regenerated)
    setSelectedChangeIds(new Set(regenerated.flatMap(plan => plan.changes.map(change => change.changeId))))
    setRepairResult(null)
    setStage('repair-diff')
  }, [repairPlans])

  const toggleRepairChange = useCallback((changeId: string) => {
    setSelectedChangeIds(current => {
      const next = new Set(current)
      if (next.has(changeId)) next.delete(changeId)
      else next.add(changeId)
      return next
    })
  }, [])

  if (!isOpen) return null

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const filteredHistory = normalizedSearch
    ? history.filter(item =>
        item.name.toLocaleLowerCase().includes(normalizedSearch) ||
        item.path.toLocaleLowerCase().includes(normalizedSearch)
      )
    : history
  const selectedPath = selectedTarget?.absolutePath ?? null
  const rootIsInvalid = selectedRoot ? isInvalidTarget(selectedRoot.path, sources) : false
  const canMove = !!selectedTarget && !moving && !impactLoading && !impactError &&
    !isInvalidTarget(selectedTarget.absolutePath, sources) &&
    (isSameRoot ? impacts.length === mappings.length : crossRootImpact !== null)
  const repairChanges = repairPlans.flatMap(plan => plan.changes)
  const repairFileCount = new Set(
    repairChanges.filter(change => selectedChangeIds.has(change.changeId)).map(change => change.sourceRelativePath)
  ).size
  const successfulMoves = moveItems.filter(item => item.status === 'success').length
  const failedMoves = moveItems.filter(item => item.status === 'failed').length
  const updatedFiles = repairResult?.files.filter(file => file.status === 'updated').length ?? 0
  const conflictFiles = repairResult?.files.filter(file => file.status === 'conflict').length ?? 0
  const failedRepairFiles = repairResult?.files.filter(file => file.status === 'failed').length ?? 0

  return (
    <div className="move-to-overlay" onClick={() => stage === 'target' && !moving && onClose()}>
      <div className="move-to-dialog" role="dialog" aria-modal="true" aria-labelledby="move-to-title" onClick={(event) => event.stopPropagation()}>
        <div className="move-to-header">
          <h2 id="move-to-title">📦 {
            stage === 'target' ? '移动到…' :
            stage === 'moving' ? '正在移动' :
            stage === 'move-result' ? '移动结果' :
            stage === 'repair-diff' ? '更新引用' : '链接修复结果'
          }</h2>
          <button className="move-to-close" aria-label="关闭" onClick={() => !moving && onClose()}>×</button>
        </div>

        {stage === 'target' && <>
        <div className="move-to-summary">
          待移动：{sources.length} 项
          {sources.length <= 3 && `（${sources.map(baseName).join('、')}）`}
        </div>

        <div className="move-to-search">
          <span aria-hidden="true">🔍</span>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索最近打开的目录…"
            aria-label="搜索移动目标目录"
            autoFocus
          />
          {searchQuery && (
            <button aria-label="清空目录搜索" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>

        <div className="move-to-section-title">
          最近打开的目录{normalizedSearch ? ` · ${filteredHistory.length}/${history.length}` : ''}
        </div>
        <div className="move-to-roots">
          {history.length === 0 && <div className="move-to-tree-hint">（无历史目录）</div>}
          {history.length > 0 && filteredHistory.length === 0 && (
            <div className="move-to-tree-hint">未找到匹配的最近打开目录</div>
          )}
          {filteredHistory.map(item => (
            <div
              key={item.id}
              className={`move-to-root-row ${selectedRoot?.id === item.id ? 'selected' : ''}`}
              onClick={() => void selectRoot(item)}
              title={item.path}
            >
              <span className="move-to-root-radio">{selectedRoot?.id === item.id ? '●' : '○'}</span>
              <span className="move-to-root-name">{item.name}</span>
              <span className="move-to-root-path">{item.path}</span>
            </div>
          ))}
        </div>

        <div className="move-to-section-title">
          目标子目录{selectedRoot ? ` · ${selectedRoot.name}` : ''}
        </div>
        <div className="move-to-tree">
          <>
            {!selectedRoot && <div className="move-to-tree-hint">请先在上方选择一个目标目录</div>}
            {selectedRoot && (
              <>
                <div
                  className={`move-to-tree-row root-option ${selectedPath === normSep(selectedRoot.path) ? 'selected' : ''} ${rootIsInvalid ? 'disabled' : ''}`}
                  onClick={() => !rootIsInvalid && selectTreeTarget(selectedRoot.path)}
                  title={rootIsInvalid ? '源已在此目录或为其自身' : selectedRoot.path}
                >
                  <span className="move-to-tree-icon">📂</span>
                  <span className="move-to-tree-name">（移动到「{selectedRoot.name}」根）</span>
                </div>
                {loadingRoot && <div className="move-to-tree-hint">加载中…</div>}
                {rootChildren?.map(child => (
                  <TreeItem
                    key={child.path}
                    node={child}
                    depth={1}
                    sources={sources}
                    selectedPath={selectedPath}
                    onSelect={selectTreeTarget}
                  />
                ))}
              </>
            )}
          </>
        </div>

        <div className="move-to-impact" aria-live="polite">
          {selectedTarget && isSameRoot && impactLoading && '正在分析链接影响…'}
          {selectedTarget && isSameRoot && impactError && <>⚠ 链接影响分析失败：{impactError}</>}
          {selectedTarget && isSameRoot && !impactLoading && !impactError && (
            exactChanges + candidates > 0
              ? <>链接影响：{impacts.reduce((sum, impact) => sum + impact.affectedSourceFiles, 0)} 个来源文件，{exactChanges} 处可精确更新，{candidates} 处仅提示。</>
              : '未发现链接影响。'
          )}
          {selectedTarget && !isSameRoot && impactLoading && '正在分析来源与目标工作区的链接影响…'}
          {selectedTarget && !isSameRoot && impactError && <>⚠ 跨根链接影响分析失败：{impactError}</>}
          {selectedTarget && !isSameRoot && crossRootImpact && (
            <>
              <strong>只读影响统计：</strong>
              来源工作区将断开 {crossRootImpact.origin.linksBreakingAfterMove} 处链接；
              移动文档将断开 {crossRootImpact.moved.linksBreakingAfterMove} 处、改变目标 {crossRootImpact.moved.linksChangingResolution} 处；
              目标工作区将新增解析 {crossRootImpact.target.linksResolvingAfterMove} 处。
              <br />不会自动修改来源或目标工作区中的任何链接。
              {crossRootImpact.coverage.uncertainLinks > 0 && <> 有 {crossRootImpact.coverage.uncertainLinks} 处链接无法确定。</>}
            </>
          )}
        </div>

        <div className="move-to-footer">
          <span className="move-to-target">目标：{selectedTarget?.displayLabel ?? '（未选）'}</span>
          <div className="move-to-actions">
            <button className="move-to-btn" onClick={() => !moving && onClose()} disabled={moving}>取消</button>
            <button className="move-to-btn primary" onClick={() => void handleMove()} disabled={!canMove}>
              {impactLoading ? '分析影响中…' : `移动 ${sources.length} 项`}
            </button>
          </div>
        </div>
        </>}

        {stage === 'moving' && (
          <div className="move-to-stage" aria-live="polite">
            <div className="move-to-progress">正在执行物理移动…</div>
            <p>此步骤只移动文件，不修改 Markdown 链接。</p>
          </div>
        )}

        {stage === 'move-result' && (
          <>
            <div className="move-to-stage-list">
              {moveItems.map(item => (
                <div key={item.sourcePath} className={`move-to-result-row ${item.status}`}>
                  <span>{item.status === 'success' ? '✓' : '✕'}</span>
                  <strong>{baseName(item.sourcePath)}</strong>
                  <span>{item.status === 'success' ? '已移动' : item.message}</span>
                </div>
              ))}
            </div>
            <div className="move-to-summary">{successfulMoves} 项成功 · {failedMoves} 项失败</div>
            <div className="move-to-footer">
              <span className="move-to-target">{repairChanges.length > 0 ? `可更新 ${repairChanges.length} 处链接` : '没有可自动修复的链接'}</span>
              <div className="move-to-actions">
                <button className="move-to-btn" onClick={() => repairChanges.length > 0 ? void skipRepair() : onClose()}>
                  {repairChanges.length > 0 ? '关闭并跳过链接修复' : '完成'}
                </button>
                {repairChanges.length > 0 && (
                  <button className="move-to-btn primary" onClick={showRepairDiff}>查看可更新的链接</button>
                )}
              </div>
            </div>
          </>
        )}

        {stage === 'repair-diff' && (
          <>
            <div className="move-to-stage-list repair-list">
              {repairChanges.map(change => (
                <label key={change.changeId} className="move-to-repair-change">
                  <input
                    type="checkbox"
                    checked={selectedChangeIds.has(change.changeId)}
                    onChange={() => toggleRepairChange(change.changeId)}
                  />
                  <span className="move-to-repair-path">{change.sourceRelativePath}:{change.lineStart}</span>
                  <span className="move-to-repair-before">− {change.before}</span>
                  <span className="move-to-repair-after">+ {change.after}</span>
                </label>
              ))}
              {repairPlans.flatMap(plan => plan.warnings).map((warning, index) => (
                <div key={`${warning}-${index}`} className="move-to-repair-warning">⚠ {warning}</div>
              ))}
            </div>
            <div className="move-to-footer">
              <span className="move-to-target">已选择 {repairFileCount} 个文件中的 {selectedChangeIds.size} 处链接</span>
              <div className="move-to-actions">
                <button className="move-to-btn" onClick={() => void skipRepair()}>跳过链接修复</button>
                <button className="move-to-btn primary" disabled={selectedChangeIds.size === 0} onClick={() => void applyRepair()}>
                  更新 {repairFileCount} 个文件中的 {selectedChangeIds.size} 处链接
                </button>
              </div>
            </div>
          </>
        )}

        {stage === 'repair-result' && (
          <>
            <div className="move-to-stage-list">
              {repairResult?.files.map(file => (
                <div key={file.sourceRelativePath} className={`move-to-result-row ${file.status}`}>
                  <span>{file.status === 'updated' ? '✓' : file.status === 'conflict' ? '⚠' : '✕'}</span>
                  <strong>{file.sourceRelativePath}</strong>
                  <span>{file.status === 'updated' ? `已更新 ${file.updatedChanges} 处` : file.message ?? file.status}</span>
                </div>
              ))}
              {repairResult?.skippedChanges ? <div className="move-to-repair-warning">已跳过 {repairResult.skippedChanges} 处链接</div> : null}
            </div>
            <div className="move-to-summary">
              文件移动：{successfulMoves} 成功 / {failedMoves} 失败 · 链接修复：{updatedFiles} 成功 / {conflictFiles} 冲突 / {failedRepairFiles} 失败
            </div>
            <div className="move-to-footer">
              <span className="move-to-target">结果按文件 best-effort 应用；冲突文件未覆盖。</span>
              <div className="move-to-actions">
                {conflictFiles > 0 && <button className="move-to-btn" onClick={() => void regenerateConflictPlans()}>重新生成冲突文件预览</button>}
                <button className="move-to-btn primary" onClick={onClose}>完成</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
