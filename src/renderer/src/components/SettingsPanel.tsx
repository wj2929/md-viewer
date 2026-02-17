/**
 * 设置面板组件 - Tab 化布局
 * v1.5.2: 通用设置 + 关于/版本更新
 */

import { useState, useEffect, useCallback } from 'react'
import { useTheme, Theme } from '../hooks/useTheme'
import { useUIStore, FONT_SIZE } from '../stores/uiStore'

// ============================================================================
// 类型定义
// ============================================================================

type SettingsTab = 'general' | 'about'

type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; currentVersion: string }
  | { state: 'update-available'; currentVersion: string; latestVersion: string; releaseUrl: string; publishedAt?: string }
  | { state: 'error'; message: string }

interface ContextMenuStatus {
  installed: boolean
  platform: string
  installedAt?: number
  userConfirmedEnabled?: boolean
}

interface AppVersionInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
}

// ============================================================================
// 主组件
// ============================================================================

export const SettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  return (
    <>
      <div className="settings-overlay" onClick={onClose}>
        <div className="settings-panel" onClick={e => e.stopPropagation()}>
          <div className="settings-header">
            <h2>设置</h2>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>

          {/* Tab 栏 */}
          <div className="settings-tabs">
            <button
              className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              通用
            </button>
            <button
              className={`settings-tab ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => setActiveTab('about')}
            >
              关于
            </button>
          </div>

          {/* Tab 内容 */}
          <div className="settings-content">
            {activeTab === 'general' ? <GeneralTab /> : <AboutTab />}
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================================
// 通用 Tab
// ============================================================================

function GeneralTab() {
  const { theme, setTheme } = useTheme()
  const { fontSize, setFontSize } = useUIStore()
  const [settings, setSettings] = useState<{ maxRecentFiles: number; maxFolderHistory: number; showExportBranding: boolean }>({
    maxRecentFiles: 20,
    maxFolderHistory: 10,
    showExportBranding: true
  })

  // 右键菜单状态
  const [ctxStatus, setCtxStatus] = useState<ContextMenuStatus | null>(null)
  const [ctxLoading, setCtxLoading] = useState(false)
  const [showEnableGuide, setShowEnableGuide] = useState(false)

  // PlantUML 服务器配置
  const [plantumlServer, setPlantumlServer] = useState('')
  const [plantumlTestStatus, setPlantumlTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [showPlantumlGuide, setShowPlantumlGuide] = useState(false)

  useEffect(() => {
    loadSettings()
    loadCtxStatus()
    // 加载 PlantUML 服务器配置
    try {
      setPlantumlServer(localStorage.getItem('plantuml-server-url') || '')
    } catch { /* ignore */ }
  }, [])

  const loadSettings = async () => {
    try {
      const appSettings = await window.api.getAppSettings()
      setSettings(prev => ({
        maxRecentFiles: appSettings.maxRecentFiles ?? prev.maxRecentFiles,
        maxFolderHistory: appSettings.maxFolderHistory ?? prev.maxFolderHistory,
        showExportBranding: appSettings.showExportBranding !== false
      }))
    } catch { /* 使用默认值 */ }
  }

  const loadCtxStatus = async () => {
    const result = await window.api.checkContextMenuStatus()
    setCtxStatus(result)
  }

  const updateSetting = useCallback(async (key: string, value: number | boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    await window.api.updateAppSettings({ [key]: value })
  }, [])

  // ---- 右键菜单操作 ----

  const handleInstall = async () => {
    setCtxLoading(true)
    try {
      const result = await window.api.installContextMenu()
      if (result.success) {
        await loadCtxStatus()
        const newStatus = await window.api.checkContextMenuStatus()
        if (newStatus.platform === 'darwin') {
          setShowEnableGuide(true)
        }
      } else {
        alert(`安装失败: ${result.error}`)
      }
    } finally {
      setCtxLoading(false)
    }
  }

  const handleUninstall = async () => {
    const platform = ctxStatus?.platform
    const needsSystemSettings = platform === 'darwin'
    const message = needsSystemSettings
      ? '确定要卸载右键菜单吗？\n\n⚠️ 卸载后,请在系统设置中禁用 Finder 扩展,否则右键菜单会显示为灰色不可用状态。'
      : '确定要卸载右键菜单吗？'
    if (!confirm(message)) return

    setCtxLoading(true)
    try {
      const result = await window.api.uninstallContextMenu()
      if (result.success) {
        await loadCtxStatus()
        if (needsSystemSettings) {
          await window.api.openSystemSettings('finder-extensions')
        }
      } else {
        alert(`卸载失败: ${result.error}`)
      }
    } finally {
      setCtxLoading(false)
    }
  }

  const handleOpenSystemSettings = async () => {
    const result = await window.api.openSystemSettings('finder-extensions')
    if (!result.success) {
      const path = '系统设置 → 隐私与安全性 → 扩展 → Finder 扩展'
      alert(`无法自动打开系统设置。\n\n请手动前往：\n${path}\n\n提示：路径已复制到剪贴板`)
      try { await navigator.clipboard.writeText(path) } catch {}
    }
  }

  const handleConfirmEnabled = async () => {
    const result = await window.api.confirmContextMenuEnabled()
    if (result.success) {
      await loadCtxStatus()
      setShowEnableGuide(false)
    }
  }

  const getDisplayStatus = () => {
    if (!ctxStatus?.installed) return { icon: '⚪', text: '未安装', color: 'gray' }
    if (ctxStatus.platform === 'darwin' && !ctxStatus.userConfirmedEnabled) return { icon: '🟡', text: '已安装，待启用', color: 'yellow' }
    return { icon: '🟢', text: '已启用', color: 'green' }
  }

  const displayStatus = getDisplayStatus()
  const isMacOS = ctxStatus?.platform === 'darwin'
  const needsManualEnable = isMacOS && ctxStatus?.installed && !ctxStatus?.userConfirmedEnabled
  const fileManagerName = ctxStatus?.platform === 'darwin' ? 'Finder' : ctxStatus?.platform === 'win32' ? '资源管理器' : '文件管理器'

  const themes: { value: Theme; label: string }[] = [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
    { value: 'auto', label: '跟随系统' }
  ]

  return (
    <>
      {/* 外观 */}
      <section className="settings-section">
        <h3>外观</h3>
        <div className="setting-item setting-row">
          <label>主题</label>
          <div className="setting-radios" role="radiogroup" aria-label="主题选择">
            {themes.map(t => (
              <label key={t.value} className={`radio-label ${theme === t.value ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="theme"
                  value={t.value}
                  checked={theme === t.value}
                  onChange={() => setTheme(t.value)}
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>
        <div className="setting-item setting-row">
          <label>字体大小</label>
          <div className="setting-slider-group">
            <span className="slider-label-min">A-</span>
            <input
              type="range"
              min={FONT_SIZE.MIN}
              max={FONT_SIZE.MAX}
              step={FONT_SIZE.STEP}
              value={fontSize}
              onChange={e => setFontSize(Number(e.target.value))}
              className="settings-slider"
            />
            <span className="slider-label-max">A+</span>
            <span className="slider-value">{fontSize}px</span>
          </div>
        </div>
      </section>

      {/* 数据 */}
      <section className="settings-section">
        <h3>数据</h3>
        <div className="setting-item setting-row">
          <label>最近文件上限</label>
          <div className="setting-slider-group">
            <span className="slider-label-min">5</span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={settings.maxRecentFiles}
              onChange={e => updateSetting('maxRecentFiles', Number(e.target.value))}
              className="settings-slider"
            />
            <span className="slider-label-max">100</span>
            <span className="slider-value">{settings.maxRecentFiles}</span>
          </div>
        </div>
        <div className="setting-item setting-row">
          <label>文件夹历史上限</label>
          <div className="setting-slider-group">
            <span className="slider-label-min">5</span>
            <input
              type="range"
              min={5}
              max={50}
              step={5}
              value={settings.maxFolderHistory}
              onChange={e => updateSetting('maxFolderHistory', Number(e.target.value))}
              className="settings-slider"
            />
            <span className="slider-label-max">50</span>
            <span className="slider-value">{settings.maxFolderHistory}</span>
          </div>
        </div>
      </section>

      {/* 导出 */}
      <section className="settings-section">
        <h3>导出</h3>
        <div className="setting-item setting-row">
          <label>导出文件显示署名</label>
          <label className="setting-switch">
            <input
              type="checkbox"
              checked={settings.showExportBranding}
              onChange={e => updateSetting('showExportBranding', e.target.checked)}
            />
            <span className="switch-slider"></span>
          </label>
        </div>
        <p className="setting-section-hint">在导出的 HTML / PDF 末尾显示「由 MD Viewer 生成」</p>
      </section>

      {/* 图表 */}
      <section className="settings-section">
        <h3>图表</h3>
        <div className="setting-item setting-row">
          <label>PlantUML 服务器</label>
          <button
            className="btn-secondary btn-sm"
            disabled={plantumlTestStatus === 'testing'}
            onClick={async () => {
              setPlantumlTestStatus('testing')
              try {
                const server = plantumlServer.trim().replace(/\/+$/, '') || 'https://www.plantuml.com/plantuml'
                const res = await fetch(`${server}/svg/SoWkIImgAStDuNBAJrBGjLDmpCbCJbMmKiX8pSd9vt98pKi1IW80`, { signal: AbortSignal.timeout(5000) })
                setPlantumlTestStatus(res.ok ? 'success' : 'error')
              } catch {
                setPlantumlTestStatus('error')
              }
            }}
          >
            {plantumlTestStatus === 'testing' ? '测试中...' : plantumlTestStatus === 'success' ? '已连接' : plantumlTestStatus === 'error' ? '连接失败' : '测试连接'}
          </button>
        </div>
        <div className="setting-item setting-row" style={{ marginTop: '4px' }}>
          <input
            type="text"
            className="settings-input"
            style={{ width: '100%' }}
            placeholder="默认：https://www.plantuml.com/plantuml"
            value={plantumlServer}
            onChange={e => {
              setPlantumlServer(e.target.value)
              setPlantumlTestStatus('idle')
            }}
            onBlur={() => {
              try {
                const val = plantumlServer.trim()
                if (val) {
                  localStorage.setItem('plantuml-server-url', val)
                } else {
                  localStorage.removeItem('plantuml-server-url')
                }
              } catch { /* ignore */ }
            }}
          />
        </div>
        <p className="setting-section-hint">留空使用官方服务器。<a href="#" className="setting-help-link" onClick={e => { e.preventDefault(); setShowPlantumlGuide(true) }}>如何配置本地服务器？</a></p>
      </section>

      {/* 系统集成 */}
      <section className="settings-section">
        <h3>系统集成</h3>
        <div className="setting-item">
          <div className="setting-info">
            <h4>右键菜单集成</h4>
            <p className="setting-description">
              在 {fileManagerName} 中右键文件或文件夹，快速用 MD Viewer 打开。
            </p>
            <div className={`status-indicator ${displayStatus.color}`}>
              <span>{displayStatus.icon}</span>
              <span>状态：{displayStatus.text}</span>
            </div>
            {needsManualEnable && (
              <div className="warning-message">
                ⚠️ 请在系统设置中启用 Finder 扩展
              </div>
            )}
          </div>
          <div className="setting-actions">
            {!ctxStatus?.installed ? (
              <button onClick={handleInstall} disabled={ctxLoading} className="btn-primary">
                {ctxLoading ? '安装中...' : '安装右键菜单'}
              </button>
            ) : needsManualEnable ? (
              <>
                <button onClick={handleOpenSystemSettings} className="btn-primary">
                  打开系统设置
                </button>
                <button onClick={handleConfirmEnabled} className="btn-secondary">
                  我已启用
                </button>
                <button onClick={handleUninstall} disabled={ctxLoading} className="btn-danger-outline">
                  卸载
                </button>
              </>
            ) : (
              <button onClick={handleUninstall} disabled={ctxLoading} className="btn-danger-outline">
                {ctxLoading ? '卸载中...' : '卸载'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 引导模态框 */}
      {showEnableGuide && (
        <div className="enable-guide-modal" onClick={() => setShowEnableGuide(false)}>
          <div className="enable-guide-content" onClick={e => e.stopPropagation()}>
            <h2>✅ 右键菜单安装成功！</h2>
            <div className="guide-warning">
              <p><strong>⚠️ 重要：需要在系统设置中启用</strong></p>
              <p>macOS 要求用户手动授权 Finder 扩展，请按以下步骤操作：</p>
            </div>
            <div className="enable-guide-steps">
              <ol>
                <li>点击下方按钮打开系统设置</li>
                <li>找到「用 MD Viewer 打开」</li>
                <li>勾选启用</li>
              </ol>
            </div>
            <div className="enable-guide-actions">
              <button onClick={handleOpenSystemSettings} className="btn-primary">
                打开系统设置
              </button>
              <button onClick={handleConfirmEnabled} className="btn-secondary">
                我已完成启用
              </button>
            </div>
            <button onClick={() => setShowEnableGuide(false)} className="btn-link">
              稍后设置
            </button>
          </div>
        </div>
      )}

      {/* PlantUML 本地服务器配置帮助 */}
      {showPlantumlGuide && (
        <div className="enable-guide-modal" onClick={() => setShowPlantumlGuide(false)}>
          <div className="plantuml-guide-content" onClick={e => e.stopPropagation()}>
            <h2>配置本地 PlantUML 服务器</h2>
            <p className="guide-subtitle">本地服务器可实现离线渲染，保护代码隐私</p>

            <div className="guide-section">
              <h4>方式一：Docker（推荐）</h4>
              <div className="guide-code-block">
                <code>docker run -d -p 8080:8080 plantuml/plantuml-server:jetty</code>
                <button className="guide-copy-btn" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText('docker run -d -p 8080:8080 plantuml/plantuml-server:jetty')
                  } catch { /* ignore */ }
                }}>复制</button>
              </div>
              <p className="guide-note">服务器地址填写：<code>http://localhost:8080</code></p>
            </div>

            <div className="guide-section">
              <h4>方式二：Java 直接运行</h4>
              <div className="guide-code-block">
                <code>java -jar plantuml.war</code>
              </div>
              <p className="guide-note">需要安装 Java 运行时和 Graphviz。从 <a href="#" onClick={e => { e.preventDefault(); window.api?.openExternal?.('https://plantuml.com/download') }}>plantuml.com/download</a> 下载 WAR 文件</p>
            </div>

            <div className="guide-section">
              <h4>验证</h4>
              <p className="guide-note">启动后在浏览器访问 <code>http://localhost:8080</code>，看到 PlantUML 页面即表示成功。然后在上方输入框填入地址并点击「测试连接」。</p>
            </div>

            <button onClick={() => setShowPlantumlGuide(false)} className="btn-primary" style={{ marginTop: '16px' }}>
              知道了
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================================
// 关于 Tab
// ============================================================================

function AboutTab() {
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    loadVersionInfo()
  }, [])

  const loadVersionInfo = async () => {
    try {
      const info = await window.api.getAppVersion()
      setVersionInfo(info)
    } catch { /* ignore */ }
  }

  const handleCheckUpdate = useCallback(async () => {
    setUpdateStatus({ state: 'checking' })
    try {
      const result = await window.api.checkForUpdates()
      if (result.error) {
        setUpdateStatus({ state: 'error', message: result.error })
      } else if (result.hasUpdate) {
        setUpdateStatus({
          state: 'update-available',
          currentVersion: result.currentVersion!,
          latestVersion: result.latestVersion!,
          releaseUrl: result.releaseUrl!,
          publishedAt: result.publishedAt
        })
      } else {
        setUpdateStatus({ state: 'up-to-date', currentVersion: result.currentVersion! })
      }
    } catch {
      setUpdateStatus({ state: 'error', message: '检查更新时发生错误' })
    }
  }, [])

  const handleOpenUrl = useCallback((url: string) => {
    window.api.openExternal(url)
  }, [])

  const getPlatformLabel = (platform: string, arch: string) => {
    const os = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform
    return `${os} ${arch}`
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch { return dateStr }
  }

  return (
    <>
      {/* 应用信息 */}
      <div className="about-app-info">
        <div className="about-app-icon">📖</div>
        <div className="about-app-name">MD Viewer</div>
        <div className="about-app-version">版本 {versionInfo?.version ?? '...'}</div>
      </div>

      {/* 版本更新 */}
      <section className="settings-section">
        <h3>版本更新</h3>
        <div className="setting-item about-update-section">
          <div className="about-current-version">
            当前版本：{versionInfo?.version ?? '...'}
          </div>
          <button
            className="btn-primary about-check-btn"
            onClick={handleCheckUpdate}
            disabled={updateStatus.state === 'checking'}
          >
            {updateStatus.state === 'checking' ? '检查中...' : '检查更新'}
          </button>

          {/* 更新状态显示 */}
          {updateStatus.state === 'checking' && (
            <div className="about-update-status checking">
              <span className="update-spinner" /> 正在检查更新...
            </div>
          )}
          {updateStatus.state === 'up-to-date' && (
            <div className="about-update-status success">
              ✅ 已是最新版本
            </div>
          )}
          {updateStatus.state === 'update-available' && (
            <div className="about-update-status available">
              <div className="update-new-version">
                🆕 发现新版本 v{updateStatus.latestVersion}
              </div>
              {updateStatus.publishedAt && (
                <div className="update-date">发布于 {formatDate(updateStatus.publishedAt)}</div>
              )}
              <button
                className="btn-primary"
                onClick={() => handleOpenUrl(updateStatus.releaseUrl)}
              >
                前往下载
              </button>
            </div>
          )}
          {updateStatus.state === 'error' && (
            <div className="about-update-status error">
              <div>⚠️ {updateStatus.message}</div>
              <button className="btn-secondary" onClick={handleCheckUpdate}>
                重试
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 链接 */}
      <section className="settings-section">
        <h3>链接</h3>
        <div className="about-links">
          <button className="about-link-item" onClick={() => handleOpenUrl('https://github.com/wj2929/md-viewer')}>
            <span className="about-link-icon">🔗</span> GitHub 仓库
          </button>
          <button className="about-link-item" onClick={() => handleOpenUrl('https://github.com/wj2929/md-viewer/blob/main/LICENSE')}>
            <span className="about-link-icon">📄</span> MIT 开源协议
          </button>
          <button className="about-link-item" onClick={() => handleOpenUrl('https://github.com/wj2929/md-viewer/issues')}>
            <span className="about-link-icon">🐛</span> 反馈问题
          </button>
        </div>
      </section>

      {/* 系统信息 */}
      <section className="settings-section">
        <h3>系统信息</h3>
        <div className="about-system-info">
          <div className="system-info-row">
            <span className="system-info-label">Electron</span>
            <span className="system-info-value">{versionInfo?.electron ?? '...'}</span>
          </div>
          <div className="system-info-row">
            <span className="system-info-label">Chromium</span>
            <span className="system-info-value">{versionInfo?.chrome ?? '...'}</span>
          </div>
          <div className="system-info-row">
            <span className="system-info-label">Node.js</span>
            <span className="system-info-value">{versionInfo?.node ?? '...'}</span>
          </div>
          <div className="system-info-row">
            <span className="system-info-label">平台</span>
            <span className="system-info-value">
              {versionInfo ? getPlatformLabel(versionInfo.platform, versionInfo.arch) : '...'}
            </span>
          </div>
        </div>
      </section>
    </>
  )
}
