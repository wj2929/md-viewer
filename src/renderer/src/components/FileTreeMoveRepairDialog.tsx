import { useMemo, useState } from 'react'
import type {
  LinkImpactSummary,
  LinkRewriteApplyFileResult,
  LinkRewritePlanView,
} from '../../../main/linking/types'
import type { WorkspaceOperationContext } from '../../../shared/workspace'
import './MoveToDialog.css'

interface FileTreeMoveRepairDialogProps {
  operation: WorkspaceOperationContext
  sources: string[]
  targetDir: string
  mappings: Array<{ oldRelativePath: string; newRelativePath: string }>
  impacts: LinkImpactSummary[]
  onMoveSuccess?: (message: string) => void
  onMoveError?: (message: string) => void
  onClose: () => void
}

interface MoveItem {
  sourcePath: string
  status: 'success' | 'failed'
  message?: string
}

type Stage = 'impact' | 'moving' | 'result' | 'diff' | 'repair-result'

const normPath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
const baseName = (value: string): string => normPath(value).split('/').pop() ?? value

export function FileTreeMoveRepairDialog({
  operation,
  sources,
  targetDir,
  mappings,
  impacts,
  onMoveSuccess,
  onMoveError,
  onClose,
}: FileTreeMoveRepairDialogProps): JSX.Element {
  const [stage, setStage] = useState<Stage>('impact')
  const [moveItems, setMoveItems] = useState<MoveItem[]>([])
  const [plans, setPlans] = useState<LinkRewritePlanView[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<LinkRewriteApplyFileResult[]>([])
  const [skippedChanges, setSkippedChanges] = useState(0)
  const [repairError, setRepairError] = useState<string | null>(null)

  const exactChanges = impacts.reduce((sum, impact) => sum + impact.exactChanges, 0)
  const candidates = impacts.reduce((sum, impact) => sum + impact.candidates, 0)
  const changes = plans.flatMap(plan => plan.changes)
  const successfulMoves = moveItems.filter(item => item.status === 'success').length
  const failedMoves = moveItems.filter(item => item.status === 'failed').length
  const selectedFileCount = useMemo(() => new Set(
    changes.filter(change => selectedIds.has(change.changeId)).map(change => change.sourceRelativePath),
  ).size, [changes, selectedIds])
  const updated = result.filter(file => file.status === 'updated').length
  const conflicts = result.filter(file => file.status === 'conflict').length
  const failed = result.filter(file => file.status === 'failed').length

  const executeMove = async (): Promise<void> => {
    setStage('moving')
    const items: MoveItem[] = []
    const repairPairs: Array<{ mapping: { oldRelativePath: string; newRelativePath: string }; receiptId: string }> = []
    for (const [index, sourcePath] of sources.entries()) {
      try {
        const execution = await window.api.executeLinkRewriteOperation(operation, {
          impactId: impacts[index].impactId,
          mapping: mappings[index],
          reason: 'move',
          confirm: true,
        })
        items.push({ sourcePath, status: 'success' })
        repairPairs.push({ mapping: mappings[index], receiptId: execution.receipt.operationReceiptId })
      } catch (cause) {
        items.push({
          sourcePath,
          status: 'failed',
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }
    setMoveItems(items)

    let nextPlans: LinkRewritePlanView[] = []
    if (exactChanges > 0) {
      try {
        nextPlans = await Promise.all(repairPairs.map(({ mapping, receiptId }) =>
          window.api.createLinkRepairPlan(operation, mapping, 'move', receiptId)
        ))
      } catch (cause) {
        setRepairError(`链接修复预览生成失败：${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    const nextChanges = nextPlans.flatMap(plan => plan.changes)
    setPlans(nextPlans)
    setSelectedIds(new Set(nextChanges.map(change => change.changeId)))
    setStage('result')

    const succeeded = items.filter(item => item.status === 'success').length
    const failures = items.length - succeeded
    if (failures === 0) onMoveSuccess?.(`已移动 ${succeeded} 项到“${baseName(targetDir)}”`)
    else if (succeeded === 0) onMoveError?.(`移动失败：${items.find(item => item.status === 'failed')?.message}`)
    else onMoveError?.(`已移动 ${succeeded} 项，${failures} 项失败`)
  }

  const skipRepair = async (): Promise<void> => {
    try {
      await Promise.all(plans.map(plan => window.api.discardLinkRepairPlan(operation, plan.planId)))
    } catch (cause) {
      setRepairError(`放弃链接修复失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
    setSkippedChanges(changes.length)
    setResult([])
    setStage('repair-result')
  }

  const applyRepair = async (): Promise<void> => {
    const applied = await window.api.applyLinkRepairPlans(operation, {
      plans: plans.map(plan => ({
        planId: plan.planId,
        operationReceiptId: plan.operationReceiptId,
        selectedChangeIds: plan.changes
          .filter(change => selectedIds.has(change.changeId))
          .map(change => change.changeId),
      })),
      confirm: true,
    })
    setSkippedChanges(changes.length - selectedIds.size)
    setResult(applied.files)
    setStage('repair-result')
  }

  const regenerateConflicts = async (): Promise<void> => {
    const regenerated = await Promise.all(plans.map(plan =>
      window.api.regenerateLinkRepairPlan(operation, plan.planId)
    ))
    setPlans(regenerated)
    setSelectedIds(new Set(regenerated.flatMap(plan => plan.changes.map(change => change.changeId))))
    setResult([])
    setSkippedChanges(0)
    setStage('diff')
  }

  const toggleChange = (changeId: string): void => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(changeId)) next.delete(changeId)
      else next.add(changeId)
      return next
    })
  }

  const title = stage === 'impact' ? '移动影响' : stage === 'moving' ? '正在移动' :
    stage === 'result' ? '移动结果' : stage === 'diff' ? '更新引用' : '链接修复结果'

  return <div className="move-to-overlay">
    <div className="move-to-dialog" role="dialog" aria-modal="true" aria-labelledby="file-tree-move-title">
      <div className="move-to-header">
        <h2 id="file-tree-move-title">📦 {title}</h2>
        <button className="move-to-close" aria-label="关闭" onClick={onClose}>×</button>
      </div>

      {stage === 'impact' && <>
        <div className="move-to-stage-list">
          <div className="move-to-summary">移动 {sources.length} 项到“{baseName(targetDir)}”</div>
          <div className="move-to-impact">
            {impacts.reduce((sum, impact) => sum + impact.affectedSourceFiles, 0)} 个来源文件可能受影响，
            {exactChanges} 处可精确更新，{candidates} 处仅提示。
          </div>
          {impacts.flatMap(impact => impact.items).slice(0, 100).map((item, index) =>
            <div className="move-to-result-row" key={`${item.sourceRelativePath}-${item.lineStart}-${index}`}>
              <span>{item.confidence === 'exact' ? '✓' : '⚠'}</span>
              <strong>{item.sourceRelativePath}:{item.lineStart}</strong>
              <span>{item.rawTarget}</span>
            </div>
          )}
        </div>
        <div className="move-to-footer">
          <span className="move-to-target">此确认只授权物理移动，不修改 Markdown 链接。</span>
          <div className="move-to-actions">
            <button className="move-to-btn" onClick={onClose}>取消</button>
            <button className="move-to-btn primary" onClick={() => void executeMove()}>移动 {sources.length} 项</button>
          </div>
        </div>
      </>}

      {stage === 'moving' && <div className="move-to-stage" aria-live="polite">
        <div className="move-to-progress">正在执行物理移动…</div>
        <p>此步骤不会修改 Markdown 链接。</p>
      </div>}

      {stage === 'result' && <>
        <div className="move-to-stage-list">
          {moveItems.map(item => <div key={item.sourcePath} className={`move-to-result-row ${item.status}`}>
            <span>{item.status === 'success' ? '✓' : '✕'}</span>
            <strong>{baseName(item.sourcePath)}</strong>
            <span>{item.status === 'success' ? '已移动' : item.message}</span>
          </div>)}
          {repairError && <div className="move-to-repair-warning">⚠ {repairError}</div>}
        </div>
        <div className="move-to-summary">{successfulMoves} 项成功 · {failedMoves} 项失败</div>
        <div className="move-to-footer">
          <span className="move-to-target">{changes.length > 0 ? `可更新 ${changes.length} 处链接` : '没有可自动修复的链接'}</span>
          <div className="move-to-actions">
            <button className="move-to-btn" onClick={() => changes.length ? void skipRepair() : onClose()}>
              {changes.length ? '关闭并跳过链接修复' : '完成'}
            </button>
            {changes.length > 0 && <button className="move-to-btn primary" onClick={() => setStage('diff')}>查看可更新的链接</button>}
          </div>
        </div>
      </>}

      {stage === 'diff' && <>
        <div className="move-to-stage-list repair-list">
          {changes.map(change => <label key={change.changeId} className="move-to-repair-change">
            <input type="checkbox" checked={selectedIds.has(change.changeId)} onChange={() => toggleChange(change.changeId)} />
            <span className="move-to-repair-path">{change.sourceRelativePath}:{change.lineStart}</span>
            <span className="move-to-repair-before">− {change.before}</span>
            <span className="move-to-repair-after">+ {change.after}</span>
          </label>)}
          {plans.flatMap(plan => plan.warnings).map((warning, index) =>
            <div key={`${warning}-${index}`} className="move-to-repair-warning">⚠ {warning}</div>
          )}
        </div>
        <div className="move-to-footer">
          <span className="move-to-target">已选择 {selectedFileCount} 个文件中的 {selectedIds.size} 处链接</span>
          <div className="move-to-actions">
            <button className="move-to-btn" onClick={() => void skipRepair()}>跳过链接修复</button>
            <button className="move-to-btn primary" disabled={selectedIds.size === 0} onClick={() => void applyRepair()}>
              更新 {selectedFileCount} 个文件中的 {selectedIds.size} 处链接
            </button>
          </div>
        </div>
      </>}

      {stage === 'repair-result' && <>
        <div className="move-to-stage-list">
          {result.map(file => <div key={file.sourceRelativePath} className={`move-to-result-row ${file.status}`}>
            <span>{file.status === 'updated' ? '✓' : file.status === 'conflict' ? '⚠' : '✕'}</span>
            <strong>{file.sourceRelativePath}</strong>
            <span>{file.status === 'updated' ? `已更新 ${file.updatedChanges} 处` : file.message ?? file.status}</span>
          </div>)}
          {skippedChanges > 0 && <div className="move-to-repair-warning">已跳过 {skippedChanges} 处链接。</div>}
        </div>
        <div className="move-to-summary">
          文件移动：{successfulMoves} 成功 / {failedMoves} 失败 · 链接修复：{updated} 成功 / {conflicts} 冲突 / {failed} 失败
        </div>
        <div className="move-to-footer">
          <span className="move-to-target">结果按文件 best-effort 应用；冲突文件未覆盖。</span>
          <div className="move-to-actions">
            {conflicts > 0 && <button className="move-to-btn" onClick={() => void regenerateConflicts()}>重新生成冲突文件预览</button>}
            <button className="move-to-btn primary" onClick={onClose}>完成</button>
          </div>
        </div>
      </>}
    </div>
  </div>
}
