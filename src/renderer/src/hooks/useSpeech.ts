/**
 * 朗读 hook
 * @module hooks/useSpeech
 * @description 串联状态机 reducer + TtsEngine + 分段器 + 段落高亮/滚动。
 * 第一期只用 SystemSpeechEngine(离线系统声);edge/付费引擎在后续步骤接入。
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { speechReducer, initialSpeechState } from '../tts/speechReducer'
import { collectSpeechSegments, findViewportStartIndex } from '../tts/segmenter'
import { SystemSpeechEngine } from '../tts/engines/SystemSpeechEngine'
import { AudioStreamEngine, type AudioEngineProvider } from '../tts/engines/AudioStreamEngine'
import type { TtsEngine, SpeechSegment, TtsEngineError } from '../tts/types'

const HIGHLIGHT_CLASS = 'reading-highlight'
const HIGHLIGHT_NAME = 'reading-aloud'

// CSS Custom Highlight API:用 Range 高亮文字字符,贴合文字、不涂块空白、不注入 DOM。
// 不支持时(如测试环境/旧 Chromium)回退到 class。
const supportsHighlightAPI =
  typeof CSS !== 'undefined' &&
  'highlights' in CSS &&
  typeof Highlight !== 'undefined' &&
  typeof Range !== 'undefined'

/**
 * 把"元素内字符偏移区间"映射成 Range(遍历文本节点累加偏移定位)。
 * charStart/charEnd 相对 element.textContent。缺省则整个元素内容。
 * 导出供单测验证偏移映射正确性。
 */
export function buildSentenceRange(
  element: HTMLElement,
  charStart?: number,
  charEnd?: number
): Range | null {
  const range = new Range()
  if (charStart === undefined || charEnd === undefined) {
    range.selectNodeContents(element)
    return range
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let offset = 0
  let startSet = false
  let node = walker.nextNode()
  while (node) {
    const len = node.textContent?.length ?? 0
    if (!startSet && offset + len >= charStart) {
      range.setStart(node, Math.max(0, charStart - offset))
      startSet = true
    }
    if (startSet && offset + len >= charEnd) {
      range.setEnd(node, Math.max(0, charEnd - offset))
      return range
    }
    offset += len
    node = walker.nextNode()
  }
  // 未精确命中(偏移超界)则退化为整元素
  if (!startSet) range.selectNodeContents(element)
  return range
}

/** 当前朗读用的 provider(渲染侧运行时信息,不含 key) */
export interface ActiveProvider {
  id: string
  type: 'system' | 'edge' | 'openai' | 'azure'
  voice?: string
  baseUrl?: string
  region?: string
  model?: string
}

interface UseSpeechOptions {
  /** 预览滚动容器 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 语速 */
  rate?: number
  /** 当前 provider */
  provider?: ActiveProvider
  /** 系统音色 id(provider.type==='system' 时) */
  voiceId?: string
  /** 失败是否自动退回系统声 */
  fallbackToSystem?: boolean
}

const SYSTEM_PROVIDER: ActiveProvider = { id: 'system', type: 'system' }

export function useSpeech({
  containerRef,
  rate = 1,
  provider = SYSTEM_PROVIDER,
  voiceId,
  fallbackToSystem = true,
}: UseSpeechOptions) {
  const [state, dispatch] = useReducer(speechReducer, initialSpeechState)
  // 是否已从选中服务退回系统声(network 失败触发)——供播放条橙线提示
  const [fellBackToSystem, setFellBackToSystem] = useState(false)
  const engineRef = useRef<TtsEngine | null>(null)
  const engineCurrentIndexRef = useRef(0)
  const segmentsRef = useRef<SpeechSegment[]>([])
  const highlightedRef = useRef<HTMLElement | null>(null)
  // 用 ref 存 detached,供事件回调读到最新值(避免闭包旧值)
  const detachedRef = useRef(false)
  detachedRef.current = state.detachedFromFollow

  const clearHighlight = useCallback(() => {
    if (supportsHighlightAPI) {
      CSS.highlights.delete(HIGHLIGHT_NAME)
    }
    if (highlightedRef.current) {
      highlightedRef.current.classList.remove(HIGHLIGHT_CLASS)
      highlightedRef.current = null
    }
  }, [])

  const highlightSegment = useCallback((index: number) => {
    const seg = segmentsRef.current[index]
    if (!seg) return
    clearHighlight()
    if (supportsHighlightAPI) {
      const range = buildSentenceRange(seg.element, seg.charStart, seg.charEnd)
      if (range) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range))
    } else {
      seg.element.classList.add(HIGHLIGHT_CLASS)
    }
    highlightedRef.current = seg.element
    // 未脱离跟随时才自动滚动;block:'nearest' 减少突兀跳动
    if (!detachedRef.current) {
      seg.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [clearHighlight])

  const destroyEngine = useCallback(() => {
    engineRef.current?.dispose()
    engineRef.current = null
  }, [])

  // 用 ref 保存最新 provider/rate/fallback,供引擎回调与 fallback 读到最新值
  const providerRef = useRef(provider)
  providerRef.current = provider
  const rateRef = useRef(rate)
  rateRef.current = rate
  const fallbackRef = useRef(fallbackToSystem)
  fallbackRef.current = fallbackToSystem
  const voiceIdRef = useRef(voiceId)
  voiceIdRef.current = voiceId

  const wireEngine = useCallback((engine: TtsEngine, onFatal: (e: TtsEngineError) => void): TtsEngine => {
    engine.onSegmentStart((index) => {
      engineCurrentIndexRef.current = index
      dispatch({ type: 'SEGMENT_START', index })
      highlightSegment(index)
    })
    engine.onEnd(() => {
      clearHighlight()
      dispatch({ type: 'END' })
    })
    engine.onError(onFatal)
    return engine
  }, [highlightSegment, clearHighlight])

  const buildSystemEngine = useCallback((): TtsEngine => {
    return wireEngine(new SystemSpeechEngine(voiceIdRef.current, rateRef.current), (error) => {
      dispatch({ type: 'ERROR', error })
    })
  }, [wireEngine])

  /** 从指定段开始播放(startIndex 省略则用视口首段) */
  const play = useCallback((startIndex?: number) => {
    const segments = collectSpeechSegments(containerRef.current)
    if (segments.length === 0) return
    segmentsRef.current = segments
    const start = startIndex ?? findViewportStartIndex(segments, containerRef.current)
    destroyEngine()
    setFellBackToSystem(false) // 新播放清除上次的退回标记

    const p = providerRef.current
    if (p.type === 'system') {
      const engine = buildSystemEngine()
      engineRef.current = engine
      dispatch({ type: 'PLAY', startIndex: start, total: segments.length })
      engine.play(segments, start)
      return
    }

    // edge / 付费:走 AudioStreamEngine;失败按 error 分类决定 fallback
    const audioProvider: AudioEngineProvider = {
      providerId: p.id,
      type: p.type,
      voice: p.voice,
      baseUrl: p.baseUrl,
      region: p.region,
      model: p.model,
    }
    const engine = wireEngine(new AudioStreamEngine(audioProvider, rateRef.current), (error) => {
      // network 类错误 + 开了 fallback → 退回系统声重读(从当前段);config 类提示改配置
      if (error.kind === 'network' && fallbackRef.current) {
        const fromIndex = segmentsRef.current.length ? engineCurrentIndexRef.current : start
        destroyEngine()
        setFellBackToSystem(true) // 标记已退回系统声,播放条显示橙线提示
        const sys = buildSystemEngine()
        engineRef.current = sys
        dispatch({ type: 'PLAY', startIndex: fromIndex, total: segmentsRef.current.length })
        sys.play(segmentsRef.current, fromIndex)
      } else {
        dispatch({ type: 'ERROR', error })
      }
    })
    engineRef.current = engine
    dispatch({ type: 'PLAY', startIndex: start, total: segments.length })
    engine.play(segments, start)
  }, [containerRef, destroyEngine, buildSystemEngine, wireEngine])

  /** 从指定源码行对应的朗读句开始播放(右键"从当前行播放") */
  const playFromSourceLine = useCallback((line: number | null) => {
    if (line == null) {
      play()
      return
    }
    const segments = collectSpeechSegments(containerRef.current)
    if (segments.length === 0) return
    // 找第一个 sourceLine >= 目标行的句子;找不到(超末尾)则用最后一段
    let idx = segments.findIndex((s) => typeof s.sourceLine === 'number' && s.sourceLine >= line)
    if (idx < 0) idx = segments.length - 1
    play(idx)
  }, [containerRef, play])

  const pause = useCallback(() => {
    engineRef.current?.pause()
    dispatch({ type: 'PAUSE' })
  }, [])

  const resume = useCallback(() => {
    engineRef.current?.resume()
    dispatch({ type: 'RESUME' })
  }, [])

  const stop = useCallback(() => {
    engineRef.current?.stop()
    destroyEngine()
    clearHighlight()
    setFellBackToSystem(false)
    dispatch({ type: 'STOP' })
  }, [destroyEngine, clearHighlight])

  const detachFollow = useCallback(() => {
    if (!detachedRef.current) dispatch({ type: 'DETACH_FOLLOW' })
  }, [])

  const reattachFollow = useCallback(() => {
    dispatch({ type: 'REATTACH_FOLLOW' })
    // 回到当前朗读段
    const seg = segmentsRef.current[state.currentIndex]
    seg?.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [state.currentIndex])

  // 语速变化实时下发给引擎
  useEffect(() => {
    engineRef.current?.setRate(rate)
  }, [rate])

  // 用户主动滚动 → 脱离自动跟随(仅在朗读中)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (): void => {
      if (state.status === 'playing' || state.status === 'paused') {
        detachFollow()
      }
    }
    container.addEventListener('wheel', onWheel, { passive: true })
    return () => container.removeEventListener('wheel', onWheel)
  }, [containerRef, state.status, detachFollow])

  // 卸载时清理
  useEffect(() => {
    return () => {
      engineRef.current?.stop()
      engineRef.current?.dispose()
      if (supportsHighlightAPI) {
        CSS.highlights.delete(HIGHLIGHT_NAME)
      }
      if (highlightedRef.current) {
        highlightedRef.current.classList.remove(HIGHLIGHT_CLASS)
      }
    }
  }, [])

  return {
    status: state.status,
    currentIndex: state.currentIndex,
    total: state.total,
    error: state.error,
    detachedFromFollow: state.detachedFromFollow,
    fellBackToSystem,
    play,
    playFromSourceLine,
    pause,
    resume,
    stop,
    detachFollow,
    reattachFollow,
  }
}
