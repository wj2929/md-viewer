import { usePreflightStore } from '../stores/preflightStore'
import './PreflightPanel.css'

/**
 * 导出前预检面板。仅当预检发现风险(status !== 'ok')时由导出流程显示；
 * 无风险时导出流程根本不调用它，用户零打扰。
 */
export function PreflightPanel(): JSX.Element | null {
  const visible = usePreflightStore(s => s.visible)
  const result = usePreflightStore(s => s.result)
  const respond = usePreflightStore(s => s.respond)
  if (!visible || !result) return null

  const blockedDocx = result.blockedFormats.includes('docx')
  const title =
    result.status === 'action-required'
      ? `导出前检查 · ${result.warnings.length} 项需要处理`
      : `导出前检查 · ${result.warnings.length} 项提示`

  return (
    <div className="preflight-overlay" role="dialog" aria-modal="true">
      <div className="preflight-panel">
        <div className="export-task-header">
          <span className="export-task-header-title">🔍 {title}</span>
        </div>
        <div className="export-task-body">
          <div className="export-task-warnings">
            {result.warnings.map((w, i) => (
              <div key={i} className={`export-task-warning-item preflight-sev-${w.severity}`}>
                <div className="preflight-warning-message">· {w.message}</div>
                <div className="export-task-warning-detail"><strong>影响是什么</strong>：{w.impact}</div>
                <div className="export-task-warning-detail"><strong>下一步怎么做</strong>：{w.userAction}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="preflight-actions">
          <button className="export-task-btn export-task-btn-secondary" onClick={() => respond(false)}>
            取消导出
          </button>
          <button className="export-task-btn export-task-btn-primary" onClick={() => respond(true)}>
            {blockedDocx ? '仍要导出（DOCX 可能失败）' : '继续导出'}
          </button>
        </div>
      </div>
    </div>
  )
}
