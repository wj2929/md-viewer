import { useMemo, useState } from 'react'
import type {
  LinkImpactSummary,
  LinkRewriteApplyFileResult,
  LinkRewritePlanView,
} from '../../../main/linking/types'
import type { WorkspaceOperationContext } from '../../../shared/workspace'
import './MoveToDialog.css'

interface RenameRepairDialogProps {
  operation: WorkspaceOperationContext
  oldPath: string
  newName: string
  mapping: { oldRelativePath: string; newRelativePath: string }
  impact: LinkImpactSummary
  onMoved: (newPath: string) => void | Promise<void>
  onClose: () => void
}

type Stage = 'impact' | 'moving' | 'result' | 'diff' | 'repair-result'

export function RenameRepairDialog({
  operation,
  oldPath,
  newName,
  mapping,
  impact,
  onMoved,
  onClose,
}: RenameRepairDialogProps): JSX.Element {
  const [stage, setStage] = useState<Stage>('impact')
  const [newPath, setNewPath] = useState<string | null>(null)
  const [plan, setPlan] = useState<LinkRewritePlanView | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<LinkRewriteApplyFileResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const changes = plan?.changes ?? []
  const selectedFileCount = useMemo(() => new Set(
    changes.filter(change => selectedIds.has(change.changeId)).map(change => change.sourceRelativePath)
  ).size, [changes, selectedIds])

  const executeRename = async (): Promise<void> => {
    setStage('moving')
    setError(null)
    try {
      const execution = await window.api.executeLinkRewriteOperation(operation, {
        impactId: impact.impactId,
        mapping,
        reason: 'rename',
        confirm: true,
      })
      setNewPath(execution.newPath)
      await onMoved(execution.newPath)
      if (impact.exactChanges > 0) {
        const nextPlan = await window.api.createLinkRepairPlan(
          operation,
          mapping,
          'rename',
          execution.receipt.operationReceiptId,
        )
        setPlan(nextPlan)
        setSelectedIds(new Set(nextPlan.changes.map(change => change.changeId)))
      }
      setStage('result')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重命名失败')
      setStage('impact')
    }
  }

  const skipRepair = async (): Promise<void> => {
    if (plan) await window.api.discardLinkRepairPlan(operation, plan.planId)
    setResult([])
    setStage('repair-result')
  }

  const applyRepair = async (): Promise<void> => {
    if (!plan) return
    const applied = await window.api.applyLinkRepairPlan(operation, {
      planId: plan.planId,
      operationReceiptId: plan.operationReceiptId,
      selectedChangeIds: plan.changes.filter(change => selectedIds.has(change.changeId)).map(change => change.changeId),
      confirm: true,
    })
    setResult(applied.files)
    setStage('repair-result')
  }

  const regenerateConflictPlan = async (): Promise<void> => {
    if (!plan) return
    const regenerated = await window.api.regenerateLinkRepairPlan(operation, plan.planId)
    setPlan(regenerated)
    setSelectedIds(new Set(regenerated.changes.map(change => change.changeId)))
    setResult([])
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

  const title = stage === 'impact' ? '重命名影响' : stage === 'moving' ? '正在重命名' :
    stage === 'result' ? '重命名结果' : stage === 'diff' ? '更新引用' : '链接修复结果'
  const updated = result.filter(file => file.status === 'updated').length
  const conflicts = result.filter(file => file.status === 'conflict').length
  const failed = result.filter(file => file.status === 'failed').length

  return (
    <div className="move-to-overlay">
      <div className="move-to-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-repair-title">
        <div className="move-to-header">
          <h2 id="rename-repair-title">✏️ {title}</h2>
          <button className="move-to-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        {stage === 'impact' && <>
          <div className="move-to-stage-list">
            <div className="move-to-summary">{oldPath.split(/[\\/]/).pop()} → {newName}</div>
            <div className="move-to-impact">
              {impact.affectedSourceFiles} 个来源文件可能受影响，{impact.exactChanges} 处可精确更新，{impact.candidates} 处仅提示。
            </div>
            {impact.items.slice(0, 100).map((item, index) => (
              <div className="move-to-result-row" key={`${item.sourceRelativePath}-${item.lineStart}-${index}`}>
                <span>{item.confidence === 'exact' ? '✓' : '⚠'}</span>
                <strong>{item.sourceRelativePath}:{item.lineStart}</strong>
                <span>{item.rawTarget}</span>
              </div>
            ))}
            {error && <div className="move-to-repair-warning">✕ {error}</div>}
          </div>
          <div className="move-to-footer">
            <span className="move-to-target">此确认只授权重命名，不修改 Markdown 链接。</span>
            <div className="move-to-actions">
              <button className="move-to-btn" onClick={onClose}>取消</button>
              <button className="move-to-btn primary" onClick={() => void executeRename()}>重命名文件</button>
            </div>
          </div>
        </>}

        {stage === 'moving' && <div className="move-to-stage" aria-live="polite">
          <div className="move-to-progress">正在执行物理重命名…</div>
          <p>此步骤不会修改 Markdown 链接。</p>
        </div>}

        {stage === 'result' && <>
          <div className="move-to-stage-list">
            <div className="move-to-result-row success"><span>✓</span><strong>{newName}</strong><span>已重命名</span></div>
            {newPath && <div className="move-to-summary">文件路径已更新</div>}
          </div>
          <div className="move-to-footer">
            <span className="move-to-target">{changes.length > 0 ? `可更新 ${changes.length} 处链接` : '没有可自动修复的链接'}</span>
            <div className="move-to-actions">
              <button className="move-to-btn" onClick={() => changes.length ? void skipRepair() : onClose()}>{changes.length ? '关闭并跳过链接修复' : '完成'}</button>
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
            {plan?.warnings.map((warning, index) => <div key={`${warning}-${index}`} className="move-to-repair-warning">⚠ {warning}</div>)}
          </div>
          <div className="move-to-footer">
            <span className="move-to-target">已选择 {selectedFileCount} 个文件中的 {selectedIds.size} 处链接</span>
            <div className="move-to-actions">
              <button className="move-to-btn" onClick={() => void skipRepair()}>跳过链接修复</button>
              <button className="move-to-btn primary" disabled={selectedIds.size === 0} onClick={() => void applyRepair()}>更新 {selectedFileCount} 个文件中的 {selectedIds.size} 处链接</button>
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
            {result.length === 0 && <div className="move-to-repair-warning">文件已重命名，链接修复已跳过。</div>}
          </div>
          <div className="move-to-summary">链接修复：{updated} 成功 / {conflicts} 冲突 / {failed} 失败</div>
          <div className="move-to-footer"><span className="move-to-target">冲突文件未覆盖。</span><div className="move-to-actions">
            {conflicts > 0 && <button className="move-to-btn" onClick={() => void regenerateConflictPlan()}>重新生成冲突文件预览</button>}
            <button className="move-to-btn primary" onClick={onClose}>完成</button>
          </div></div>
        </>}
      </div>
    </div>
  )
}
