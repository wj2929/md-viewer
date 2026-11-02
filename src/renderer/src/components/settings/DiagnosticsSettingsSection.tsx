import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DIAGNOSTIC_LOG_RETENTION_OPTIONS,
  DIAGNOSTIC_LOG_SIZE_OPTIONS,
  type DiagnosticLogMaxTotalMiB,
  type DiagnosticLogRetentionDays,
  type DiagnosticLogStatus,
} from '../../../../shared/diagnostics'

type BusyAction =
  | 'toggle'
  | 'choose'
  | 'retry'
  | 'reset'
  | 'open'
  | 'apply'
  | 'export'
  | 'clear'
  | null

interface OperationMessage {
  kind: 'success' | 'warning' | 'error'
  text: string
}

export function DiagnosticsSettingsSection() {
  const [status, setStatus] = useState<DiagnosticLogStatus | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [message, setMessage] = useState<OperationMessage | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [draftSize, setDraftSize] = useState<DiagnosticLogMaxTotalMiB>(10)
  const [draftDays, setDraftDays] = useState<DiagnosticLogRetentionDays>(7)

  const loadStatus = useCallback(async () => {
    setLoadError(false)
    try {
      const next = await window.api.getDiagnosticLogStatus()
      setStatus(next)
      setDraftSize(next.maxTotalMiB)
      setDraftDays(next.retentionDays)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const rulesDirty = Boolean(
    status
    && (draftSize !== status.maxTotalMiB || draftDays !== status.retentionDays),
  )
  const operationDisabled = busy !== null || !status

  const statusText = useMemo(() => {
    if (!status) return ''
    if (!status.enabled) return '已停止记录。已有日志仍可打开、导出或清除。'
    if (status.state === 'fallback') return '自定义位置当前不可用，新日志已临时写入默认位置。'
    if (status.state === 'error') return '当前无法写入诊断日志。文档浏览不受影响，请更改位置。'
    if (status.state === 'degraded') return '诊断日志写入性能下降，文档浏览不受影响。'
    if (status.state === 'initializing') return '正在准备诊断日志…'
    return status.usingCustomDirectory
      ? '正在记录诊断事件 · 使用自定义位置'
      : '正在记录诊断事件 · 使用默认位置'
  }, [status])

  const runStatusAction = async (
    action: Exclude<BusyAction, 'export' | 'open' | null>,
    task: () => Promise<DiagnosticLogStatus>,
  ) => {
    setBusy(action)
    setMessage(null)
    try {
      const next = await task()
      setStatus(next)
      setDraftSize(next.maxTotalMiB)
      setDraftDays(next.retentionDays)
    } catch {
      setMessage({ kind: 'error', text: '操作失败，请重试。' })
    } finally {
      setBusy(null)
    }
  }

  const handleToggle = (enabled: boolean) => {
    void runStatusAction('toggle', () => window.api.setDiagnosticLoggingEnabled(enabled))
  }

  const handleChooseDirectory = async () => {
    setBusy('choose')
    setMessage(null)
    try {
      const result = await window.api.chooseDiagnosticLogDirectory()
      setStatus(result.status)
      if (result.message) setMessage({ kind: 'error', text: result.message })
    } catch {
      setMessage({ kind: 'error', text: '无法更改日志位置，请重试。' })
    } finally {
      setBusy(null)
    }
  }

  const handleRetryDirectory = async () => {
    setBusy('retry')
    setMessage(null)
    try {
      const result = await window.api.retryDiagnosticLogDirectory()
      setStatus(result.status)
      setMessage(result.message
        ? { kind: 'warning', text: result.message }
        : { kind: 'success', text: '自定义日志位置已恢复。' })
    } catch {
      setMessage({ kind: 'error', text: '重试失败，新日志继续写入默认位置。' })
    } finally {
      setBusy(null)
    }
  }

  const handleResetDirectory = async () => {
    setBusy('reset')
    setMessage(null)
    try {
      const result = await window.api.resetDiagnosticLogDirectory()
      setStatus(result.status)
      setMessage({ kind: 'success', text: '已恢复默认日志位置。' })
    } catch {
      setMessage({ kind: 'error', text: '无法恢复默认位置，请重试。' })
    } finally {
      setBusy(null)
    }
  }

  const handleOpenDirectory = async () => {
    setBusy('open')
    setMessage(null)
    try {
      const result = await window.api.openDiagnosticLogDirectory()
      if (!result.success) {
        setMessage({ kind: 'error', text: '无法打开当前日志文件夹。' })
      }
    } catch {
      setMessage({ kind: 'error', text: '无法打开当前日志文件夹。' })
    } finally {
      setBusy(null)
    }
  }

  const copyPath = async (value: string | null) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setMessage({ kind: 'success', text: '日志路径已复制。' })
    } catch {
      setMessage({ kind: 'error', text: '无法复制路径。' })
    }
  }

  const handleApplyRetention = async () => {
    if (!status || !rulesDirty) return
    setBusy('apply')
    setMessage(null)
    try {
      const result = await window.api.applyDiagnosticRetentionPolicy({
        maxTotalMiB: draftSize,
        retentionDays: draftDays,
      })
      setStatus(result.status)
      setDraftSize(result.status.maxTotalMiB)
      setDraftDays(result.status.retentionDays)
      if (!result.canceled) {
        setMessage(result.partial
          ? { kind: 'warning', text: '规则已更新；部分正在使用的旧日志将在以后重试清理。' }
          : { kind: 'success', text: '自动清理规则已更新。' })
      }
    } catch {
      setMessage({ kind: 'error', text: '无法应用自动清理规则。' })
    } finally {
      setBusy(null)
    }
  }

  const handleExport = async () => {
    setBusy('export')
    setMessage(null)
    setExportedPath(null)
    try {
      const result = await window.api.exportDiagnosticsBundle()
      if (result.error) {
        setMessage({ kind: 'error', text: result.error.message })
      } else if (!result.canceled && result.outputPath) {
        setExportedPath(result.outputPath)
        setMessage({ kind: 'success', text: '诊断包已导出。' })
      }
    } catch {
      setMessage({ kind: 'error', text: '诊断包导出失败，请重试。' })
    } finally {
      setBusy(null)
    }
  }

  const handleClear = async () => {
    setBusy('clear')
    setMessage(null)
    try {
      const result = await window.api.clearDiagnosticLogs()
      setStatus(result.status)
      if (!result.canceled) {
        const detail = `已清除 ${result.deletedFiles} 个文件，共 ${formatBytes(result.deletedBytes)}`
        const skipped = result.skippedActiveFiles > 0
          ? `；${result.skippedActiveFiles} 个正在使用的文件已保留`
          : ''
        setMessage({
          kind: result.partial ? 'warning' : 'success',
          text: `${detail}${skipped}。`,
        })
      }
    } catch {
      setMessage({ kind: 'error', text: '无法清除诊断日志。' })
    } finally {
      setBusy(null)
    }
  }

  if (!status) {
    return (
      <section className="settings-section diagnostics-settings" aria-busy={!loadError}>
        <h3>诊断与日志</h3>
        <div className="diagnostics-card">
          {loadError ? (
            <>
              <p className="diagnostics-state error" role="alert">无法读取诊断日志状态。文档浏览不受影响。</p>
              <button className="btn-secondary btn-sm" onClick={() => void loadStatus()}>重新加载</button>
            </>
          ) : (
            <p className="diagnostics-loading" role="status">正在读取诊断日志状态…</p>
          )}
        </div>
      </section>
    )
  }

  const showConfiguredSeparately = status.usingFallback && status.configuredDirectory
  const currentPath = status.effectiveDirectory

  return (
    <section className="settings-section diagnostics-settings" aria-busy={busy !== null}>
      <h3>诊断与日志</h3>
      <div className="diagnostics-card">
        <div className="diagnostics-heading-row">
          <div>
            <h4>本地诊断日志</h4>
            <p>记录文件夹扫描、文件读取、索引和预览渲染的阶段耗时。</p>
          </div>
          <label className="setting-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="启用本地诊断日志"
              checked={status.enabled}
              disabled={busy !== null}
              onChange={event => handleToggle(event.target.checked)}
            />
            <span className="switch-slider" />
          </label>
        </div>

        <p className={`diagnostics-state ${status.state}`} role="status">{statusText}</p>

        <div className="diagnostics-block">
          <div className="diagnostics-block-title">
            <h4>日志保存位置</h4>
            <span className="diagnostics-badge">
              {status.usingCustomDirectory ? '自定义位置' : status.usingFallback ? '临时默认位置' : '默认位置'}
            </span>
          </div>

          {showConfiguredSeparately && (
            <PathDisplay
              label="配置位置"
              value={status.configuredDirectory}
              onCopy={copyPath}
            />
          )}
          <PathDisplay
            label={showConfiguredSeparately ? '当前写入位置' : '当前日志位置'}
            value={currentPath}
            onCopy={copyPath}
          />

          <div className="diagnostics-actions">
            {status.usingFallback && status.capabilities.canRetryDirectory && (
              <button className="btn-secondary btn-sm" disabled={operationDisabled} onClick={() => void handleRetryDirectory()}>
                {busy === 'retry' ? '正在重试…' : '重试自定义位置'}
              </button>
            )}
            <button className="btn-secondary btn-sm" disabled={operationDisabled || !status.capabilities.canChooseDirectory} onClick={() => void handleChooseDirectory()}>
              {busy === 'choose' ? '正在选择…' : '更改位置…'}
            </button>
            {status.capabilities.canResetDirectory && (
              <button className="btn-secondary btn-sm" disabled={operationDisabled} onClick={() => void handleResetDirectory()}>
                {busy === 'reset' ? '正在恢复…' : '恢复默认位置'}
              </button>
            )}
            <button className="btn-secondary btn-sm" disabled={operationDisabled || !status.capabilities.canOpenDirectory} onClick={() => void handleOpenDirectory()}>
              {busy === 'open' ? '正在打开…' : '打开日志文件夹'}
            </button>
          </div>
        </div>

        <div className="diagnostics-block">
          <h4>自动清理规则</h4>
          <div className="diagnostics-retention-grid">
            <label>
              <span>日志总大小上限</span>
              <select
                className="settings-select"
                value={draftSize}
                disabled={busy !== null || !status.capabilities.canApplyRetention}
                onChange={event => setDraftSize(Number(event.target.value) as DiagnosticLogMaxTotalMiB)}
              >
                {DIAGNOSTIC_LOG_SIZE_OPTIONS.map(value => <option key={value} value={value}>{value} MiB</option>)}
              </select>
            </label>
            <label>
              <span>保留时间</span>
              <select
                className="settings-select"
                value={draftDays}
                disabled={busy !== null || !status.capabilities.canApplyRetention}
                onChange={event => setDraftDays(Number(event.target.value) as DiagnosticLogRetentionDays)}
              >
                {DIAGNOSTIC_LOG_RETENTION_OPTIONS.map(value => <option key={value} value={value}>{value} 天</option>)}
              </select>
            </label>
          </div>
          <p className="diagnostics-rule-summary">
            仅保留最近 {draftDays} 天且总大小不超过 {draftSize} MiB；超限时从最旧开始清理。
          </p>
          <p className="diagnostics-usage">{formatUsage(status)}</p>
          {rulesDirty && (
            <div className="diagnostics-draft-actions">
              <span>新规则尚未应用</span>
              <button className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => {
                setDraftSize(status.maxTotalMiB)
                setDraftDays(status.retentionDays)
              }}>取消更改</button>
              <button className="btn-primary btn-sm" disabled={busy !== null} onClick={() => void handleApplyRetention()}>
                {busy === 'apply' ? '正在应用…' : '应用规则'}
              </button>
            </div>
          )}
        </div>

        <div className="diagnostics-block">
          <h4>获取支持</h4>
          <p>诊断包包含系统快照和最近最多 10 MiB 的有效事件；MD Viewer 不会自动上传。</p>
          <div className="diagnostics-actions diagnostics-support-actions">
            <button className="btn-primary btn-sm" disabled={operationDisabled || !status.capabilities.canExportBundle} onClick={() => void handleExport()}>
              {busy === 'export' ? '正在导出…' : '导出诊断包'}
            </button>
            <button className="btn-danger-outline btn-sm" disabled={operationDisabled || !status.capabilities.canClearLogs} onClick={() => void handleClear()}>
              {busy === 'clear' ? '正在清除…' : '清除日志…'}
            </button>
          </div>
        </div>

        {message && (
          <div className={`diagnostics-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            <span>{message.text}</span>
            {exportedPath && (
              <button className="btn-link" onClick={() => void window.api.showItemInFolder(exportedPath)}>
                显示导出的文件
              </button>
            )}
          </div>
        )}

        <p className="diagnostics-privacy">
          不记录 Markdown 正文、原始文件名、绝对路径、搜索词、语音文本或 API Key。若选择由第三方同步的目录，日志可能随该服务同步，并可能影响性能。
        </p>
      </div>
    </section>
  )
}

function PathDisplay({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string | null
  onCopy: (value: string | null) => Promise<void>
}) {
  return (
    <div className="diagnostics-path-group">
      <span className="diagnostics-path-label">{label}</span>
      <div className="diagnostics-path-row">
        <code dir="ltr">{value ?? '当前没有可用的日志位置'}</code>
        <button className="btn-secondary btn-sm" disabled={!value} onClick={() => void onCopy(value)}>复制路径</button>
      </div>
    </div>
  )
}

function formatUsage(status: DiagnosticLogStatus): string {
  if (status.fileCount === 0) return '当前没有事件日志；诊断包仍会包含系统诊断快照。'
  const oldest = status.oldestEventUnixMs
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(status.oldestEventUnixMs)
    : '未知'
  return `当前日志：${status.fileCount} 个文件 · ${formatBytes(status.totalBytes)} · 最早记录于 ${oldest}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
