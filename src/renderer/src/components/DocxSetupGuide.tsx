import { useState, useEffect, useRef } from 'react'

interface ConnectionResult {
  ok: boolean
  version?: string
  mode?: string
  styles?: string[]
  fontsAvailable?: string[]
  error?: string
}

interface DocxSetupGuideProps {
  onClose: () => void
  onComplete: (serverUrl: string) => void
  initialUrl?: string
}

const DOCKER_CMD = 'docker run -d --name md-docx -p 127.0.0.1:3179:3000 mdviewer/docx-service:latest'
const DEFAULT_URL = 'http://localhost:3179'

export function DocxSetupGuide({ onClose, onComplete, initialUrl }: DocxSetupGuideProps) {
  const [serverUrl, setServerUrl] = useState(initialUrl || DEFAULT_URL)
  const [connResult, setConnResult] = useState<ConnectionResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [polling, setPolling] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  const testConnection = async (url?: string) => {
    const target = (url || serverUrl).trim().replace(/\/+$/, '')
    if (!target) return
    setTesting(true)
    setConnResult(null)
    try {
      const result = await window.api.testDocxConnection(target)
      setConnResult(result)
    } catch {
      setConnResult({ ok: false, error: '连接失败' })
    } finally {
      setTesting(false)
    }
  }

  const startPolling = () => {
    setPolling(true)
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(async () => {
      try {
        const result = await window.api.testDocxConnection(serverUrl.trim().replace(/\/+$/, '') || DEFAULT_URL)
        if (result.ok) {
          if (pollingRef.current) clearInterval(pollingRef.current)
          pollingRef.current = null
          setPolling(false)
          setConnResult(result)
        }
      } catch { /* keep polling */ }
    }, 3000)
  }

  const stopPolling = () => {
    setPolling(false)
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
  }

  const handleComplete = () => {
    stopPolling()
    onComplete(serverUrl.trim().replace(/\/+$/, '') || DEFAULT_URL)
  }

  const handleClose = () => {
    stopPolling()
    onClose()
  }

  return (
    <div className="enable-guide-modal" onClick={handleClose}>
      <div className="docx-setup-content" onClick={e => e.stopPropagation()}>
        <div className="docx-setup-header">
          <h2>启用 DOCX 导出服务</h2>
          <button className="close-btn" onClick={handleClose}>×</button>
        </div>

        <div className="docx-step-body">
          <div className="guide-info-box">
            <p>DOCX 导出需要连接到 md-viewer-docx-service 来保证中文排版和图表渲染质量。</p>
            <p className="guide-note-muted">填写已运行的服务地址，点击测试验证连接。</p>
          </div>

          {/* 服务器地址 + 测试 */}
          <div className="guide-section">
            <h4>服务器地址</h4>
            <div className="docx-url-row">
              <input
                type="text"
                className="settings-input"
                value={serverUrl}
                onChange={e => { setServerUrl(e.target.value); setConnResult(null); stopPolling() }}
                placeholder={DEFAULT_URL}
              />
              <button
                className="btn-secondary btn-sm"
                disabled={testing}
                onClick={() => testConnection()}
              >
                {testing ? '测试中...' : '测试'}
              </button>
            </div>
          </div>

          {/* 连接结果 */}
          {connResult && (
            <div className={`docx-conn-result ${connResult.ok ? 'success' : 'error'}`}>
              {connResult.ok ? (
                <>
                  <div className="conn-result-row">✓ 已连接 — 服务版本 v{connResult.version}</div>
                  {connResult.fontsAvailable && connResult.fontsAvailable.length > 0 && (
                    <div className="conn-result-row">✓ 字体：{connResult.fontsAvailable.join(', ')}</div>
                  )}
                  {connResult.styles && connResult.styles.length > 0 && (
                    <div className="conn-result-row">✓ 支持样式：{connResult.styles.join(' · ')}</div>
                  )}
                </>
              ) : (
                <>
                  <div className="conn-result-row">✕ {connResult.error || '无法连接服务器'}</div>
                  {!showHelp && (
                    <div className="conn-result-row" style={{ marginTop: 4 }}>
                      <a href="#" className="setting-help-link" onClick={e => { e.preventDefault(); setShowHelp(true) }}>
                        还没有部署？查看部署方式
                      </a>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 部署帮助（折叠，连接失败时引导展开） */}
          {showHelp && (
            <div className="docx-deploy-help">
              <div className="docx-deploy-help-header" onClick={() => setShowHelp(false)}>
                <span>部署方式</span>
                <span className="deploy-help-close">收起</span>
              </div>
              <div className="guide-section">
                <h4>Docker（推荐）</h4>
                <div className="guide-code-block">
                  <code>{DOCKER_CMD}</code>
                  <button className="guide-copy-btn" onClick={() => handleCopy(DOCKER_CMD)}>复制</button>
                </div>
                <p className="guide-note-muted" style={{ marginTop: 6 }}>首次运行会下载镜像（约 700 MB）。内置完整 CJK 字体。</p>
              </div>
              <div className="guide-section">
                <h4>更多方式</h4>
                <p className="guide-note-muted">
                  Python 直接运行、远程服务器部署等，请参阅
                  <a href="#" className="setting-help-link" onClick={e => {
                    e.preventDefault()
                    window.api?.openExternal?.('https://github.com/wj2929/md-viewer-docx-service')
                  }}> 部署文档</a>。
                </p>
              </div>

              {polling ? (
                <div className="docx-polling-status">
                  <span className="update-spinner" /> 正在等待服务启动...
                  <button className="btn-secondary btn-sm" onClick={stopPolling} style={{ marginLeft: 8 }}>停止</button>
                </div>
              ) : (
                <button className="btn-secondary btn-sm" onClick={startPolling}>
                  等待服务启动（自动检测）
                </button>
              )}
            </div>
          )}

          {/* 没有连接结果时，也显示一个折叠入口 */}
          {!connResult && !showHelp && (
            <p className="guide-note-muted" style={{ padding: '0 2px' }}>
              <a href="#" className="setting-help-link" onClick={e => { e.preventDefault(); setShowHelp(true) }}>
                还没有部署服务？
              </a>
            </p>
          )}

          {/* 底部操作 */}
          <div className="docx-step-actions">
            <button className="btn-secondary" onClick={handleClose}>
              取消
            </button>
            <button
              className="btn-primary"
              disabled={!connResult?.ok}
              onClick={handleComplete}
            >
              启用并完成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
