/**
 * 朗读播放控制条
 * @module components/ReadAloudBar
 * @description 预览区浮动朗读控制。第一期:系统声,播放/暂停/停止/语速/进度/回到朗读位。
 * 仿 FloatingNav 挂在预览区。服务选择下拉在多 provider 步骤加入。
 */

import React, { useState, useCallback } from 'react'
import { useSpeech, type ActiveProvider } from '../hooks/useSpeech'
import { useReadAloudStore } from '../stores/readAloudStore'
import { DEFAULT_EDGE_VOICE, EDGE_ZH_VOICES } from '../../../shared/ttsProviders'
import {
  loadSystemVoices,
  toSystemVoiceOptions,
  type SystemVoiceOption,
} from '../tts/engines/SystemSpeechEngine'

interface ReadAloudBarProps {
  /** 预览滚动容器 ref */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 文档路径(切文档时用于重置) */
  filePath: string
  /** 当前预览内容；同文件内容替换时停止旧 DOM 上的朗读 */
  contentKey?: string
}

const ReadAloudBar: React.FC<ReadAloudBarProps> = ({ containerRef, filePath, contentKey }) => {
  const [expanded, setExpanded] = useState(false)
  const [sleepDeadline, setSleepDeadline] = useState<number | null>(null)
  const [sleepDuration, setSleepDuration] = useState(0)
  const [sleepRemaining, setSleepRemaining] = useState(0)
  const sleepTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const sleepIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const stopRef = React.useRef<() => void>(() => {})
  const playbackConfigRef = React.useRef<string | null>(null)

  // 从 store 读多 provider 配置(单一状态源,与设置"朗读"Tab 同步)
  const settings = useReadAloudStore((s) => s.settings)
  const settingsLoaded = useReadAloudStore((s) => s.loaded)
  const setActiveProvider = useReadAloudStore((s) => s.setActiveProvider)
  const setDefaultRate = useReadAloudStore((s) => s.setDefaultRate)
  const setSystemVoice = useReadAloudStore((s) => s.setSystemVoice)
  const setEdgeVoice = useReadAloudStore((s) => s.setEdgeVoice)
  const setActiveVoiceProfile = useReadAloudStore((s) => s.setActiveVoiceProfile)
  const [systemVoices, setSystemVoices] = useState<SystemVoiceOption[]>([])
  const [edgeVoices, setEdgeVoices] = useState<Array<{ id: string; name: string; lang?: string }>>(
    [...EDGE_ZH_VOICES]
  )

  const rate = settings.defaultRate
  const providerId = settings.activeProviderId
  const enabledProviders = settings.providers.filter((p) => p.enabled)
  const systemProvider = settings.providers.find((p) => p.id === 'system')
  const providerCfg =
    settings.providers.find((p) => p.id === providerId) ?? settings.providers[0]
  const activeVoiceProfile = providerCfg.type === 'openai'
    ? providerCfg.profiles?.find((profile) => profile.id === providerCfg.activeProfileId)
    : undefined

  // 运行时 provider(不含 key,key 主进程自取)
  const provider: ActiveProvider = {
    id: providerCfg.id,
    type: providerCfg.type,
    voice: activeVoiceProfile?.voice ?? providerCfg.voice,
    baseUrl: providerCfg.baseUrl,
    region: providerCfg.region,
    model: activeVoiceProfile?.model ?? providerCfg.model,
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
  } = useSpeech({
    containerRef,
    rate,
    provider,
    voiceId: systemProvider?.voice,
    fallbackToSystem: settings.fallbackToSystem,
  })

  React.useEffect(() => {
    let active = true
    loadSystemVoices().then((voices) => {
      if (active) setSystemVoices(toSystemVoiceOptions(voices))
    })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    const listVoices = window.api.ttsListVoices
    if (typeof listVoices !== 'function') return
    let active = true
    listVoices('edge')
      .then((voices) => {
        if (active && voices.length > 0) setEdgeVoices(voices)
      })
      .catch(() => { /* 使用内建声线表 */ })
    return () => { active = false }
  }, [])

  // v2.7.0:预览区右键"从当前行播放" → 展开播放条并从该行起读
  React.useEffect(() => {
    const off = window.api.onReadAloudFromLine(({ sourceLine }) => {
      setExpanded(true)
      playFromSourceLine(sourceLine)
    })
    return off
  }, [playFromSourceLine])

  // 切文档或同文件内容替换时停止朗读和睡眠定时
  React.useEffect(() => {
    stopRef.current()
  }, [filePath, contentKey])

  const isActive = status === 'playing' || status === 'paused' || status === 'loading'

  const cancelSleepTimer = useCallback(() => {
    if (sleepTimeoutRef.current) clearTimeout(sleepTimeoutRef.current)
    if (sleepIntervalRef.current) clearInterval(sleepIntervalRef.current)
    sleepTimeoutRef.current = null
    sleepIntervalRef.current = null
    setSleepDeadline(null)
    setSleepDuration(0)
    setSleepRemaining(0)
  }, [])

  const handleStop = useCallback(() => {
    cancelSleepTimer()
    stop()
  }, [cancelSleepTimer, stop])

  stopRef.current = handleStop

  const startSleepTimer = useCallback((minutes: number) => {
    cancelSleepTimer()
    const deadline = Date.now() + minutes * 60_000
    const updateRemaining = (): void => {
      setSleepRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }
    setSleepDeadline(deadline)
    setSleepDuration(minutes)
    updateRemaining()
    sleepIntervalRef.current = setInterval(updateRemaining, 1_000)
    sleepTimeoutRef.current = setTimeout(() => {
      stopRef.current()
    }, minutes * 60_000)
  }, [cancelSleepTimer])

  const sleepLabel = sleepRemaining > 0
    ? `剩余 ${Math.floor(sleepRemaining / 60).toString().padStart(2, '0')}:${(sleepRemaining % 60).toString().padStart(2, '0')}`
    : '定时停止'
  const sleepStatus = sleepRemaining > 0
    ? `定时停止剩余 ${Math.ceil(sleepRemaining / 60)} 分钟`
    : ''

  React.useEffect(() => {
    return () => cancelSleepTimer()
  }, [cancelSleepTimer])

  React.useEffect(() => {
    if (!isActive && sleepDeadline) cancelSleepTimer()
  }, [isActive, sleepDeadline, cancelSleepTimer])

  React.useEffect(() => {
    const nextConfig = `${providerCfg.id}:${providerCfg.activeProfileId || ''}:${providerCfg.voice || ''}:${systemProvider?.voice || ''}`
    if (playbackConfigRef.current && playbackConfigRef.current !== nextConfig) handleStop()
    playbackConfigRef.current = nextConfig
  }, [providerCfg.id, providerCfg.activeProfileId, providerCfg.voice, systemProvider?.voice, handleStop])

  const handleToggleExpand = useCallback(() => {
    setExpanded((v) => !v)
  }, [])

  const handlePlayPause = useCallback(() => {
    if (status === 'playing') {
      pause()
    } else if (status === 'paused') {
      resume()
    } else if (status === 'loading') {
      handleStop()
    } else if (settingsLoaded) {
      play()
    }
  }, [status, settingsLoaded, play, pause, resume, handleStop])

  // v2.7.0:应用窗口聚焦时用 Cmd/Ctrl+Shift+Space 播放/暂停;首次触发自动展开播放条
  React.useEffect(() => {
    const off = window.api.onShortcutToggleReadAloud(() => {
      setExpanded(true)
      handlePlayPause()
    })
    return off
  }, [handlePlayPause])

  // 切换服务:先停(下次播放用新 provider),符合"先 stop 下次生效"语义
  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    handleStop()
    setActiveProvider(e.target.value)
  }, [handleStop, setActiveProvider])

  const handleSystemVoiceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    handleStop()
    setSystemVoice(e.target.value || undefined)
  }, [handleStop, setSystemVoice])

  const handleVoiceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    handleStop()
    setEdgeVoice(e.target.value)
  }, [handleStop, setEdgeVoice])

  const handleVoiceProfileChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    handleStop()
    void setActiveVoiceProfile(providerCfg.id, e.target.value)
  }, [handleStop, providerCfg.id, setActiveVoiceProfile])

  const playIcon = status === 'playing' ? '⏸' : status === 'loading' ? '×' : '▶'
  const playLabel = status === 'playing'
    ? '暂停朗读'
    : status === 'paused'
      ? '继续朗读'
      : status === 'loading'
        ? '取消合成'
        : '开始朗读'

  return (
    <div className="read-aloud">
      {/* 🔊 触发按钮 */}
      <button
        className={`read-aloud-toggle ${isActive ? 'active' : ''}`}
        onClick={handleToggleExpand}
        aria-label="朗读"
        aria-expanded={expanded}
      >
        🔊
      </button>

      {/* 展开的播放条 */}
      {expanded && (
        <div className="read-aloud-bar" role="group" aria-label="朗读控制">
          <button
            className="read-aloud-btn"
            onClick={handlePlayPause}
            disabled={!settingsLoaded && status !== 'loading'}
            aria-label={playLabel}
          >
            {playIcon}
          </button>
          <button
            className="read-aloud-btn"
            onClick={handleStop}
            disabled={!isActive}
            aria-label="停止朗读"
          >
            ⏹
          </button>

          <label className="read-aloud-rate">
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
          >
            {enabledProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {providerCfg.type === 'system' && (
            <select
              className="read-aloud-provider"
              value={systemProvider?.voice || ''}
              onChange={handleSystemVoiceChange}
              aria-label="系统音色"
            >
              <option value="">系统默认音色</option>
              {systemProvider?.voice && !systemVoices.some((voice) => voice.id === systemProvider.voice) && (
                <option value={systemProvider.voice}>已不可用（将使用系统默认）</option>
              )}
              {systemVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name}（{voice.lang}）</option>
              ))}
            </select>
          )}

          {providerCfg.type === 'edge' && (
            <select
              className="read-aloud-provider"
              value={providerCfg.voice || DEFAULT_EDGE_VOICE}
              onChange={handleVoiceChange}
              aria-label="Edge 音色"
            >
              {edgeVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name}</option>
              ))}
            </select>
          )}

          {providerCfg.type === 'openai' && providerCfg.profiles && (
            <select
              className="read-aloud-provider"
              value={providerCfg.activeProfileId}
              onChange={handleVoiceProfileChange}
              aria-label="声音方案"
            >
              {providerCfg.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          )}

          <select
            className="read-aloud-provider read-aloud-sleep"
            value={sleepDuration}
            onChange={(e) => {
              const minutes = Number(e.target.value)
              if (minutes > 0) startSleepTimer(minutes)
              else cancelSleepTimer()
            }}
            disabled={!isActive}
            aria-label="睡眠定时停止"
          >
            <option value={0}>定时停止</option>
            <option value={5}>5 分钟</option>
            <option value={10}>10 分钟</option>
            <option value={15}>15 分钟</option>
            <option value={30}>30 分钟</option>
          </select>
          {sleepDeadline && (
            <button
              className="read-aloud-btn read-aloud-sleep-cancel"
              onClick={cancelSleepTimer}
              aria-label="取消定时停止"
            >
              ×
            </button>
          )}
          {sleepDeadline && (
            <>
              <span className="read-aloud-sleep-remaining" aria-hidden="true">
                {sleepLabel}
              </span>
              <span className="read-aloud-sr-status" aria-live="polite">
                {sleepStatus}
              </span>
            </>
          )}

          {total > 0 && (
            <span className="read-aloud-progress" aria-live="polite">
              {Math.min(currentIndex + 1, total)}/{total} 段
            </span>
          )}

          {error && error.kind === 'config' && (
            <span className="read-aloud-error" role="alert">
              ⚠ {error.message}
            </span>
          )}

          {fellBackToSystem && isActive && (
            <span
              className="read-aloud-fallback"
              role="status"
              aria-live="polite"
            >
              当前:系统声（{providerCfg.name}不可用）
            </span>
          )}

          {detachedFromFollow && isActive && (
            <button
              className="read-aloud-btn read-aloud-reattach"
              onClick={reattachFollow}
              aria-label="回到朗读位置"
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
