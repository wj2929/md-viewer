import { useState, useEffect, useCallback, useRef } from 'react'
import { useExportTaskStore, type DocxErrorDetail } from '../stores/exportTaskStore'
import './ExportTaskView.css'

const DONE_AUTO_DISMISS_MS = 15000

interface ExportTaskViewProps {
  onCancel?: () => void
  onShowInFolder?: (filePath: string) => void
  onOpenSettings?: () => void
  onTestConnection?: () => void
}

export function ExportTaskView({
  onCancel,
  onShowInFolder,
  onOpenSettings,
  onTestConnection,
}: ExportTaskViewProps): JSX.Element | null {
  const store = useExportTaskStore()
  const { status, minimized, fileName, currentChart, totalCharts, chartType,
    filePath, imagesFailed, errorMessage, errorDetail, warnings,
    toggleMinimize, close, cacheVersionInfo, versionInfo } = store

  const panelRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!versionInfo) {
      window.api.getAppVersion?.().then(info => {
        if (info) cacheVersionInfo({ version: info.version, platform: info.platform || '', arch: info.arch || '', electron: info.electron || '' })
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (status === 'done') {
      setHovered(false)
      requestAnimationFrame(() => {
        if (panelRef.current?.matches(':hover')) setHovered(true)
      })
    }
  }, [status])

  useEffect(() => {
    if (status !== 'done' || hovered) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      return
    }
    timerRef.current = setTimeout(() => close(), DONE_AUTO_DISMISS_MS)
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
  }, [status, hovered, close])

  if (status === 'idle') return null

  if (minimized) {
    return <MinimizedBar status={status} currentChart={currentChart} totalCharts={totalCharts} onExpand={toggleMinimize} onClose={close} />
  }

  const headerIcon = status === 'done' ? '✅' : status === 'error' ? '❌' : '📄'
  const headerTitle = status === 'done' ? 'Word 已导出' : status === 'error' ? '导出失败' : '正在导出 Word 文档'

  return (
    <div className="export-task-panel" ref={panelRef}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="export-task-header">
        <span className="export-task-header-title">{headerIcon} {headerTitle}</span>
        <span className="export-task-header-actions">
          {status !== 'done' && status !== 'error' && (
            <button className="export-task-header-btn" onClick={toggleMinimize} title="最小化">─</button>
          )}
          <button className="export-task-header-btn" onClick={close} title="关闭">✕</button>
        </span>
      </div>
      <div className="export-task-body">
        {status === 'rendering' && <RenderingView fileName={fileName} current={currentChart} total={totalCharts} chartType={chartType} onCancel={onCancel} />}
        {status === 'generating' && <GeneratingView fileName={fileName} onCancel={onCancel} />}
        {status === 'done' && <DoneView fileName={fileName} imagesFailed={imagesFailed} warnings={warnings} onShowInFolder={onShowInFolder ? () => onShowInFolder(filePath) : undefined} />}
        {status === 'error' && <ErrorView errorMessage={errorMessage} errorDetail={errorDetail} versionInfo={versionInfo} onTestConnection={onTestConnection} onOpenSettings={onOpenSettings} />}
      </div>
      {status === 'done' && <div className="export-task-countdown-bar" style={hovered ? { animationPlayState: 'paused' } : undefined} />}
    </div>
  )
}

function MinimizedBar({ status, currentChart, totalCharts, onExpand, onClose }: {
  status: string; currentChart: number; totalCharts: number; onExpand: () => void; onClose: () => void
}): JSX.Element {
  const icon = status === 'done' ? '✅' : status === 'error' ? '❌' : '📄'
  const text = status === 'done' ? '导出完成' : status === 'error' ? '导出失败' : `导出中... ${currentChart}/${totalCharts}`
  const percent = totalCharts > 0 ? Math.round((currentChart / totalCharts) * 100) : 0
  return (
    <div className="export-task-minimized">
      <div className="export-task-minimized-row">
        <span className="export-task-minimized-text">{icon} {text}</span>
        <span className="export-task-minimized-actions">
          <button className="export-task-header-btn" onClick={onExpand} title="展开">□</button>
          <button className="export-task-header-btn" onClick={onClose} title="关闭">✕</button>
        </span>
      </div>
      {(status === 'rendering' || status === 'generating') && (
        <div className="export-task-progress-track">
          <div className={`export-task-progress-fill${status === 'generating' ? ' indeterminate' : ''}`}
            style={status === 'rendering' ? { width: `${percent}%` } : undefined} />
        </div>
      )}
    </div>
  )
}

function RenderingView({ fileName, current, total, chartType, onCancel }: {
  fileName: string; current: number; total: number; chartType: string; onCancel?: () => void
}): JSX.Element {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <>
      <div className="export-task-filename">{fileName}</div>
      <div className="export-task-step">Step 1/2：渲染图表</div>
      <div className="export-task-progress-track">
        <div className="export-task-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="export-task-label">{current > 0 ? `渲染图表 ${current}/${total}（${chartType}）` : '准备渲染图表...'}</div>
      {onCancel && (
        <div className="export-task-actions">
          <button className="export-task-btn export-task-btn-secondary" onClick={onCancel}>取消</button>
        </div>
      )}
    </>
  )
}

function GeneratingView({ fileName, onCancel }: { fileName: string; onCancel?: () => void }): JSX.Element {
  return (
    <>
      <div className="export-task-filename">{fileName}</div>
      <div className="export-task-step">Step 2/2：生成 Word 文档</div>
      <div className="export-task-progress-track"><div className="export-task-progress-fill indeterminate" /></div>
      <div className="export-task-label">正在上传到服务器并生成...</div>
      {onCancel && (
        <div className="export-task-actions">
          <button className="export-task-btn export-task-btn-secondary" onClick={onCancel}>取消</button>
        </div>
      )}
    </>
  )
}

function DoneView({ fileName, imagesFailed, warnings, onShowInFolder }: {
  fileName: string; imagesFailed: number; warnings: string[]; onShowInFolder?: () => void
}): JSX.Element {
  return (
    <>
      <div className="export-task-filename">{fileName}</div>
      {imagesFailed > 0 && (
        <div className="export-task-result">导出完成，{imagesFailed} 个图表以代码形式保留</div>
      )}
      {warnings.length > 0 && (
        <div className="export-task-warnings">
          {warnings.map((w, i) => <div key={i} className="export-task-warning-item">· {w}</div>)}
        </div>
      )}
      <div className="export-task-actions">
        {onShowInFolder && (
          <button className="export-task-btn export-task-btn-primary" onClick={onShowInFolder}>打开所在位置</button>
        )}
      </div>
    </>
  )
}

function getHintsForErrorType(errorType: string): { user: string[]; advanced?: string[] } {
  switch (errorType) {
    case 'network':
      return {
        user: ['应用服务是否已启动', '设置中的服务地址是否正确'],
        advanced: ['Docker Desktop 是否运行', '终端运行 docker ps 查看容器状态'],
      }
    case 'timeout':
      return { user: ['在设置中增加超时时间', '稍后重试'] }
    case 'client_error':
      return { user: ['API Key 是否正确（设置 > 高级选项）', '客户端版本与服务端是否兼容'] }
    case 'server_error':
      return {
        user: ['服务是否运行正常', '服务端版本是否最新'],
        advanced: ['docker logs md-docx 查看日志', 'docker restart md-docx 重启服务'],
      }
    case 'write_error':
      return { user: ['磁盘空间是否充足', '目标文件夹是否有写入权限'] }
    default:
      return { user: ['应用服务是否已启动', '设置中的服务地址是否正确'] }
  }
}

function ErrorView({ errorMessage, errorDetail, versionInfo, onTestConnection, onOpenSettings }: {
  errorMessage: string; errorDetail: DocxErrorDetail | null
  versionInfo: { version: string; platform: string; arch: string; electron: string } | null
  onTestConnection?: () => void; onOpenSettings?: () => void
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const hints = getHintsForErrorType(errorDetail?.errorType || '')

  const handleCopyReport = useCallback(async () => {
    const lines = [
      `导出失败：${errorMessage}`,
      `时间：${errorDetail?.timestamp ? new Date(errorDetail.timestamp).toLocaleString() : new Date().toLocaleString()}`,
      errorDetail?.serverUrl ? `服务地址：${errorDetail.serverUrl}` : '',
      versionInfo ? `客户端版本：v${versionInfo.version}` : '',
      errorDetail?.serviceVersion ? `服务端版本：v${errorDetail.serviceVersion}` : '',
      versionInfo ? `系统：${versionInfo.platform} ${versionInfo.arch} · Electron ${versionInfo.electron}` : '',
    ].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(lines)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }, [errorMessage, errorDetail, versionInfo])

  const handleCopyJson = useCallback(async () => {
    const json = {
      errorType: errorDetail?.errorType,
      message: errorMessage,
      statusCode: errorDetail?.statusCode,
      serverUrl: errorDetail?.serverUrl,
      clientVersion: versionInfo?.version,
      serviceVersion: errorDetail?.serviceVersion,
      timestamp: errorDetail?.timestamp,
      os: versionInfo ? `${versionInfo.platform} ${versionInfo.arch}` : undefined,
      electron: versionInfo?.electron,
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(json, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }, [errorMessage, errorDetail, versionInfo])

  return (
    <>
      <div className="export-task-error-msg">{errorMessage}</div>
      <div className="export-task-error-hints">
        {errorDetail?.errorType === 'timeout' ? '建议：' : '请检查：'}
        <ul>{hints.user.map((h, i) => <li key={i}>{h}</li>)}</ul>
      </div>
      {hints.advanced && (
        <div className="export-task-advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
          {advancedOpen ? '▾' : '▸'} 高级诊断
        </div>
      )}
      {hints.advanced && advancedOpen && (
        <div className="export-task-advanced-panel">
          <ul>{hints.advanced.map((h, i) => <li key={i}>{h}</li>)}</ul>
          {errorDetail?.statusCode && <div className="export-task-advanced-detail">HTTP 状态码：{errorDetail.statusCode}</div>}
          {errorDetail?.raw && <div className="export-task-advanced-detail">错误代码：{errorDetail.raw}</div>}
          <button className="export-task-btn export-task-btn-tertiary" onClick={handleCopyJson}>
            📋 复制原始 JSON
          </button>
        </div>
      )}
      <div className="export-task-actions">
        <button className="export-task-btn export-task-btn-secondary" onClick={handleCopyReport}>
          {copied ? '✓ 已复制' : '📋 复制错误报告'}
        </button>
        {onTestConnection && errorDetail?.errorType === 'network' && (
          <button className="export-task-btn export-task-btn-secondary" onClick={onTestConnection}>测试连接</button>
        )}
        {onOpenSettings && (
          <button className="export-task-btn export-task-btn-primary" onClick={onOpenSettings}>打开设置</button>
        )}
      </div>
    </>
  )
}
