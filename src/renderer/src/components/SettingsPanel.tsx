/**
 * 设置面板组件 - 右键菜单安装/卸载
 * v1.3.4 优化版：增加引导模态框和系统设置跳转
 */

import { useState, useEffect } from 'react'

interface ContextMenuStatus {
  installed: boolean
  platform: string
  installedAt?: number
  userConfirmedEnabled?: boolean
}

export const SettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [status, setStatus] = useState<ContextMenuStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [showEnableGuide, setShowEnableGuide] = useState(false)

  useEffect(() => {
    loadStatus()
  }, [])

  const loadStatus = async () => {
    const result = await window.api.checkContextMenuStatus()
    setStatus(result)
  }

  const handleInstall = async () => {
    setLoading(true)
    try {
      const result = await window.api.installContextMenu()
      if (result.success) {
        await loadStatus()
        // macOS 需要手动启用,显示引导模态框
        const newStatus = await window.api.checkContextMenuStatus()
        if (newStatus.platform === 'darwin') {
          setShowEnableGuide(true)
        }
      } else {
        alert(`安装失败: ${result.error}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleUninstall = async () => {
    const platform = status?.platform
    const needsSystemSettings = platform === 'darwin'

    const message = needsSystemSettings
      ? '确定要卸载右键菜单吗？\n\n⚠️ 卸载后,请在系统设置中禁用 Finder 扩展,否则右键菜单会显示为灰色不可用状态。'
      : '确定要卸载右键菜单吗？'

    if (!confirm(message)) return

    setLoading(true)
    try {
      const result = await window.api.uninstallContextMenu()
      if (result.success) {
        await loadStatus()
        // macOS 卸载后打开系统设置
        if (needsSystemSettings) {
          await window.api.openSystemSettings('finder-extensions')
        }
      } else {
        alert(`卸载失败: ${result.error}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleOpenSystemSettings = async () => {
    const result = await window.api.openSystemSettings('finder-extensions')
    if (!result.success) {
      // 降级方案：复制路径提示
      const path = '系统设置 → 隐私与安全性 → 扩展 → Finder 扩展'
      alert(`无法自动打开系统设置。\n\n请手动前往：\n${path}\n\n提示：路径已复制到剪贴板`)
      // 尝试复制到剪贴板
      try {
        await navigator.clipboard.writeText(path)
      } catch {}
    }
  }

  const handleConfirmEnabled = async () => {
    const result = await window.api.confirmContextMenuEnabled()
    if (result.success) {
      await loadStatus()
      setShowEnableGuide(false)
    }
  }

  const handleSkipForNow = () => {
    setShowEnableGuide(false)
  }

  const getPlatformName = () => {
    switch (status?.platform) {
      case 'darwin': return 'macOS'
      case 'win32': return 'Windows'
      case 'linux': return 'Linux'
      default: return '未知'
    }
  }

  const getDisplayStatus = () => {
    if (!status?.installed) {
      return { icon: '⚪', text: '未安装', color: 'gray' }
    }
    if (status.platform === 'darwin' && !status.userConfirmedEnabled) {
      return { icon: '🟡', text: '已安装，待启用', color: 'yellow' }
    }
    return { icon: '🟢', text: '已启用', color: 'green' }
  }

  const displayStatus = getDisplayStatus()
  const isMacOS = status?.platform === 'darwin'
  const needsManualEnable = isMacOS && status?.installed && !status?.userConfirmedEnabled

  return (
    <>
      <div className="settings-overlay" onClick={onClose}>
        <div className="settings-panel" onClick={e => e.stopPropagation()}>
          <div className="settings-header">
            <h2>设置</h2>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="settings-content">
            <section className="settings-section">
              <h3>系统集成</h3>
              <div className="setting-item">
                <div className="setting-info">
                  <h4>🔗 右键菜单</h4>
                  <p className="setting-description">
                    在 Finder 中右键文件或文件夹，快速用 MD Viewer 打开。
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
                  {!status?.installed ? (
                    <button onClick={handleInstall} disabled={loading} className="btn-primary">
                      {loading ? '安装中...' : '安装右键菜单'}
                    </button>
                  ) : needsManualEnable ? (
                    <>
                      <button onClick={handleOpenSystemSettings} className="btn-primary">
                        打开系统设置
                      </button>
                      <button onClick={handleConfirmEnabled} className="btn-secondary">
                        我已启用
                      </button>
                      <button onClick={handleUninstall} disabled={loading} className="btn-danger-outline">
                        卸载
                      </button>
                    </>
                  ) : (
                    <button onClick={handleUninstall} disabled={loading} className="btn-danger-outline">
                      {loading ? '卸载中...' : '卸载'}
                    </button>
                  )}
                </div>
              </div>
            </section>

            {!status?.installed && (
              <section className="usage-instructions">
                <h4>📖 使用说明</h4>
                <ol>
                  <li>安装后，在 Finder 中右键点击 .md 文件或文件夹</li>
                  <li>选择「快速操作」→「用 MD Viewer 打开」</li>
                  {isMacOS && <li className="highlight">⚠️ macOS 需在系统设置中手动启用 Finder 扩展</li>}
                </ol>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* 引导模态框 */}
      {showEnableGuide && (
        <div className="enable-guide-modal" onClick={handleSkipForNow}>
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
            <button onClick={handleSkipForNow} className="btn-link">
              稍后设置
            </button>
          </div>
        </div>
      )}
    </>
  )
}
