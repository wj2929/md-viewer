import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef } from 'react'
import type { TtsEngine, TtsEngineError } from '../../src/tts/types'

// 收集两类引擎的实例,供断言"是否退回系统声"
const systemEngines: FakeEngine[] = []
const systemVoiceIds: Array<string | undefined> = []
const audioEngines: FakeEngine[] = []

class FakeEngine implements TtsEngine {
  onSeg: (i: number) => void = () => {}
  onEndCb: () => void = () => {}
  onErr: (e: TtsEngineError) => void = () => {}
  played = false
  startIndex = -1
  play(_segments: unknown[], startIndex: number): void {
    this.played = true
    this.startIndex = startIndex
  }
  pause(): void {}
  resume(): void {}
  stop(): void {}
  setRate(): void {}
  onSegmentStart(cb: (i: number) => void): void {
    this.onSeg = cb
  }
  onEnd(cb: () => void): void {
    this.onEndCb = cb
  }
  onError(cb: (e: TtsEngineError) => void): void {
    this.onErr = cb
  }
  dispose(): void {}
  /** 测试触发引擎报错 */
  emitError(e: TtsEngineError): void {
    this.onErr(e)
  }
}

vi.mock('../../src/tts/engines/SystemSpeechEngine', () => ({
  SystemSpeechEngine: class {
    constructor(voiceId?: string) {
      systemVoiceIds.push(voiceId)
      const e = new FakeEngine()
      systemEngines.push(e)
      return e as unknown as object
    }
  },
}))
vi.mock('../../src/tts/engines/AudioStreamEngine', () => ({
  AudioStreamEngine: class {
    constructor() {
      const e = new FakeEngine()
      audioEngines.push(e)
      return e as unknown as object
    }
  },
}))

// 分段器返回固定三段(带 sourceLine,供 playFromSourceLine 映射测试)
vi.mock('../../src/tts/segmenter', () => ({
  collectSpeechSegments: () => [
    { text: '一', element: document.createElement('p'), sourceLine: 3 },
    { text: '二', element: document.createElement('p'), sourceLine: 7 },
    { text: '三', element: document.createElement('p'), sourceLine: 12 },
  ],
  findViewportStartIndex: () => 0,
}))

import { useSpeech } from '../../src/hooks/useSpeech'

function makeContainerRef(): React.RefObject<HTMLDivElement> {
  const ref = createRef<HTMLDivElement>()
  ;(ref as { current: HTMLDivElement }).current = document.createElement('div')
  return ref as React.RefObject<HTMLDivElement>
}

beforeEach(() => {
  systemEngines.length = 0
  systemVoiceIds.length = 0
  audioEngines.length = 0
})

describe('useSpeech 断网 fallback 决策', () => {
  it('直接系统朗读使用所选系统音色', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() =>
      useSpeech({
        containerRef,
        provider: { id: 'system', type: 'system' },
        voiceId: 'voice-selected',
      })
    )

    act(() => result.current.play(0))

    expect(systemVoiceIds).toEqual(['voice-selected'])
    expect(systemEngines[0].played).toBe(true)
  })

  it('edge network 失败后的系统 fallback 使用同一系统音色', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() =>
      useSpeech({
        containerRef,
        provider: { id: 'edge', type: 'edge' },
        voiceId: 'voice-selected',
        fallbackToSystem: true,
      })
    )

    act(() => result.current.play(0))
    act(() => audioEngines[0].emitError({ kind: 'network', message: '断网' }))

    expect(systemVoiceIds).toEqual(['voice-selected'])
  })

  it('edge network 失败 + fallback 开 → 退回系统声,标记 fellBackToSystem', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() =>
      useSpeech({
        containerRef,
        provider: { id: 'edge', type: 'edge' },
        fallbackToSystem: true,
      })
    )
    act(() => result.current.play(0))
    expect(audioEngines).toHaveLength(1)
    expect(systemEngines).toHaveLength(0)

    // 模拟 edge 断网报错
    act(() => audioEngines[0].emitError({ kind: 'network', message: '断网' }))
    // 应新建系统声引擎接管
    expect(systemEngines).toHaveLength(1)
    expect(systemEngines[0].played).toBe(true)
    expect(result.current.fellBackToSystem).toBe(true)
  })

  it('合成失败带段索引时,系统声从失败段精确接管', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() =>
      useSpeech({ containerRef, provider: { id: 'edge', type: 'edge' }, fallbackToSystem: true })
    )
    act(() => result.current.play(0))
    act(() => audioEngines[0].emitError({
      kind: 'network',
      message: '第二段失败',
      segmentIndex: 1,
    }))
    expect(systemEngines[0].startIndex).toBe(1)
  })

  it('edge network 失败 + fallback 关 → 不退,进 error 状态', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() =>
      useSpeech({
        containerRef,
        provider: { id: 'edge', type: 'edge' },
        fallbackToSystem: false,
      })
    )
    act(() => result.current.play(0))
    act(() => audioEngines[0].emitError({ kind: 'network', message: '断网' }))
    expect(systemEngines).toHaveLength(0) // 没退回
    expect(result.current.status).toBe('error')
    expect(result.current.fellBackToSystem).toBe(false)
  })

  it('config 错误(key 错):即使 fallback 开也不退,进 error(应提示改配置)', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() =>
      useSpeech({
        containerRef,
        provider: { id: 'custom-tts-x', type: 'openai' },
        fallbackToSystem: true,
      })
    )
    act(() => result.current.play(0))
    act(() => audioEngines[0].emitError({ kind: 'config', message: 'key 错' }))
    expect(systemEngines).toHaveLength(0)
    expect(result.current.status).toBe('error')
    expect(result.current.error?.kind).toBe('config')
  })

  it('stop 清除 fellBackToSystem 标记', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() =>
      useSpeech({ containerRef, provider: { id: 'edge', type: 'edge' }, fallbackToSystem: true })
    )
    act(() => result.current.play(0))
    act(() => audioEngines[0].emitError({ kind: 'network', message: '断网' }))
    expect(result.current.fellBackToSystem).toBe(true)
    act(() => result.current.stop())
    expect(result.current.fellBackToSystem).toBe(false)
  })

  describe('playFromSourceLine 行号→句索引映射', () => {
    // segments: [line3, line7, line12]
    it('精确命中源码行 → 从对应句起播', () => {
      const containerRef = makeContainerRef()
      const { result } = renderHook(() =>
        useSpeech({ containerRef, provider: { id: 'edge', type: 'edge' }, fallbackToSystem: true })
      )
      act(() => result.current.playFromSourceLine(7))
      expect(audioEngines[0].startIndex).toBe(1) // line7 是第 2 句
    })

    it('行号落在两句之间 → 取第一个 >= 该行的句', () => {
      const containerRef = makeContainerRef()
      const { result } = renderHook(() =>
        useSpeech({ containerRef, provider: { id: 'edge', type: 'edge' }, fallbackToSystem: true })
      )
      act(() => result.current.playFromSourceLine(5)) // 3<5<7 → 命中 line7(idx1)
      expect(audioEngines[0].startIndex).toBe(1)
    })

    it('行号超过末句 → 从最后一句起播', () => {
      const containerRef = makeContainerRef()
      const { result } = renderHook(() =>
        useSpeech({ containerRef, provider: { id: 'edge', type: 'edge' }, fallbackToSystem: true })
      )
      act(() => result.current.playFromSourceLine(999))
      expect(audioEngines[0].startIndex).toBe(2) // 最后一句
    })

    it('sourceLine 为 null → 退化为默认起点(视口首段 idx0)', () => {
      const containerRef = makeContainerRef()
      const { result } = renderHook(() =>
        useSpeech({ containerRef, provider: { id: 'edge', type: 'edge' }, fallbackToSystem: true })
      )
      act(() => result.current.playFromSourceLine(null))
      expect(audioEngines[0].startIndex).toBe(0)
    })
  })
})
