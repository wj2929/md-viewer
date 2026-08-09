/**
 * 朗读播放控制条
 * @module components/ReadAloudBar
 * @description 预览区浮动朗读控制。第一期:系统声,播放/暂停/停止/语速/进度/回到朗读位。
 * 仿 FloatingNav 挂在预览区。服务选择下拉在多 provider 步骤加入。
 */

import React, { useState, useCallback } from 'react'
import { useSpeech, type ActiveProvider } from '../hooks/useSpeech'
import { useReadAloudStore } from '../stores/readAloudStore'

interface ReadAloudBarProps {
  /** 预览滚动容器 ref */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 文档路径(切文档时用于重置) */
  filePath: string
}

const ReadAloudBar: React.FC<ReadAloudBarProps> = ({ containerRef, filePath }) => {
  const [expanded, setExpanded] = useState(false)

  // 从 store 读多 provider 配置(单一状态源,与设置"朗读"Tab 同步)
  const settings = useReadAloudStore((s) => s.settings)
  const setActiveProvider = useReadAloudStore((s) => s.setActiveProvider)
  const setDefaultRate = useReadAloudStore((s) => s.setDefaultRate)

  const rate = settings.defaultRate
  const providerId = settings.activeProviderId
  const enabledProviders = settings.providers.filter((p) => p.enabled)
  const providerCfg =
    settings.providers.find((p) => p.id === providerId) ?? settings.providers[0]

  // 运行时 provider(不含 key,key 主进程自取)
  const provider: ActiveProvider = {
    id: providerCfg.id,
    type: providerCfg.type,
    voice: providerCfg.voice,
    baseUrl: providerCfg.baseUrl,
    region: providerCfg.region,
    model: providerCfg.model,
  }

  const {
    status,
    currentIndex,
    total,
    error,
    detachedFromFollow,
    play,
    pause,
    resume,
    stop,
    reattachFollow,
    fellBackToSystem,
    playFromSourceLine,
  } = useSpeech({ containerRef, rate, provider, fallbackToSystem: settings.fallbackToSystem })

  // v2.7.0:预览区右键"从当前行播放" → 展开播放条并从该行起读
  React.useEffect(() => {
    const off = window.api.onReadAloudFromLine(({ sourceLine }) => {
      setExpanded(true)
      playFromSourceLine(sourceLine)
    })
    return off
  }, [playFromSourceLine])

  // 切文档时停止朗读
  React.useEffect(() => {
    stop()
  }, [filePath, stop])

  const isActive = status === 'playing' || status === 'paused' || status === 'loading'

  const handleToggleExpand = useCallback(() => {
    setExpanded((v) => !v)
  }, [])

  const handlePlayPause = useCallback(() => {
    if (status === 'playing') {
      pause()
    } else if (status === 'paused') {
      resume()
    } else {
      play()
    }
  }, [status, play, pause, resume])

  // v2.7.0:全局快捷键(Cmd/Ctrl+Shift+Space)播放/暂停;首次触发自动展开播放条
  React.useEffect(() => {
    const off = window.api.onShortcutToggleReadAloud(() => {
      setExpanded(true)
      handlePlayPause()
    })
    return off
  }, [handlePlayPause])

  // 切换服务:先停(下次播放用新 provider),符合"先 stop 下次生效"语义
  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    stop()
    setActiveProvider(e.target.value)
  }, [stop, setActiveProvider])

  const playIcon = status === 'playing' ? '⏸' : '▶'
  const playLabel = status === 'playing' ? '暂停朗读' : status === 'paused' ? '继续朗读' : '开始朗读'

  return (
    <div className="read-aloud">
      {/* 🔊 触发按钮 */}
      <button
        className={`read-aloud-toggle ${isActive ? 'active' : ''}`}
        onClick={handleToggleExpand}
        aria-label="朗读"
        aria-expanded={expanded}
        title="朗读"
      >
        🔊
      </button>

      {/* 展开的播放条 */}
      {expanded && (
        <div className="read-aloud-bar" role="group" aria-label="朗读控制">
          <button
            className="read-aloud-btn"
            onClick={handlePlayPause}
            aria-label={playLabel}
            title={playLabel}
          >
            {status === 'loading' ? '…' : playIcon}
          </button>
          <button
            className="read-aloud-btn"
            onClick={stop}
            disabled={!isActive}
            aria-label="停止朗读"
            title="停止朗读"
          >
            ⏹
          </button>

          <label className="read-aloud-rate" title="语速">
            <span aria-hidden="true">语速</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.25}
              value={rate}
              onChange={(e) => setDefaultRate(Number(e.target.value))}
              aria-label="语速"
            />
            <span className="read-aloud-rate-value">{rate.toFixed(2)}x</span>
          </label>

          <select
            className="read-aloud-provider"
            value={providerId}
            onChange={handleProviderChange}
            aria-label="朗读服务"
            title="朗读服务"
          >
            {enabledProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {total > 0 && (
            <span className="read-aloud-progress" aria-live="polite">
              {Math.min(currentIndex + 1, total)}/{total} 段
            </span>
          )}

          {error && error.kind === 'config' && (
            <span className="read-aloud-error" role="alert" title={error.message}>
              ⚠ 配置有误
            </span>
          )}

          {fellBackToSystem && isActive && (
            <span
              className="read-aloud-fallback"
              role="status"
              aria-live="polite"
              title={`${providerCfg.name}不可用,已改用系统声`}
            >
              当前:系统声（{providerCfg.name}不可用）
            </span>
          )}

          {detachedFromFollow && isActive && (
            <button
              className="read-aloud-btn read-aloud-reattach"
              onClick={reattachFollow}
              aria-label="回到朗读位置"
              title="回到朗读位置"
            >
              ↩
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default ReadAloudBar
