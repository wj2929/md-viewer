import { describe, it, expect } from 'vitest'
import { speechReducer, initialSpeechState, type SpeechState } from '../../src/tts/speechReducer'

describe('speechReducer', () => {
  it('PLAY 进入 loading 并记录起点/总数,清除脱离跟随', () => {
    const s = speechReducer(
      { ...initialSpeechState, detachedFromFollow: true },
      { type: 'PLAY', startIndex: 3, total: 10 }
    )
    expect(s.status).toBe('loading')
    expect(s.currentIndex).toBe(3)
    expect(s.total).toBe(10)
    expect(s.detachedFromFollow).toBe(false)
    expect(s.error).toBeNull()
  })

  it('SEGMENT_START 从 loading 切到 playing 并更新索引', () => {
    const loading: SpeechState = { ...initialSpeechState, status: 'loading', total: 5 }
    const s = speechReducer(loading, { type: 'SEGMENT_START', index: 2 })
    expect(s.status).toBe('playing')
    expect(s.currentIndex).toBe(2)
  })

  it('迟到的 SEGMENT_START 在 idle(已 stop)时被忽略——竞态保护', () => {
    const s = speechReducer(initialSpeechState, { type: 'SEGMENT_START', index: 4 })
    expect(s.status).toBe('idle')
    expect(s.currentIndex).toBe(0)
  })

  it('迟到的 LOADING 在 error 态不覆盖', () => {
    const errored: SpeechState = {
      ...initialSpeechState,
      status: 'error',
      error: { kind: 'network', message: 'x' },
    }
    const s = speechReducer(errored, { type: 'LOADING' })
    expect(s.status).toBe('error')
  })

  it('PAUSE 仅在 playing 生效', () => {
    const playing: SpeechState = { ...initialSpeechState, status: 'playing' }
    expect(speechReducer(playing, { type: 'PAUSE' }).status).toBe('paused')
    // 非 playing 不变
    expect(speechReducer(initialSpeechState, { type: 'PAUSE' }).status).toBe('idle')
  })

  it('RESUME 仅在 paused 生效', () => {
    const paused: SpeechState = { ...initialSpeechState, status: 'paused' }
    expect(speechReducer(paused, { type: 'RESUME' }).status).toBe('playing')
    expect(speechReducer(initialSpeechState, { type: 'RESUME' }).status).toBe('idle')
  })

  it('STOP 与 END 都回到初始态', () => {
    const playing: SpeechState = { status: 'playing', currentIndex: 5, total: 9, error: null, detachedFromFollow: true }
    expect(speechReducer(playing, { type: 'STOP' })).toEqual(initialSpeechState)
    expect(speechReducer(playing, { type: 'END' })).toEqual(initialSpeechState)
  })

  it('ERROR 记录错误并进入 error 态', () => {
    const playing: SpeechState = { ...initialSpeechState, status: 'playing' }
    const s = speechReducer(playing, { type: 'ERROR', error: { kind: 'config', message: 'key 错' } })
    expect(s.status).toBe('error')
    expect(s.error).toEqual({ kind: 'config', message: 'key 错' })
  })

  it('DETACH_FOLLOW / REATTACH_FOLLOW 切换跟随标记', () => {
    const playing: SpeechState = { ...initialSpeechState, status: 'playing' }
    const detached = speechReducer(playing, { type: 'DETACH_FOLLOW' })
    expect(detached.detachedFromFollow).toBe(true)
    const reattached = speechReducer(detached, { type: 'REATTACH_FOLLOW' })
    expect(reattached.detachedFromFollow).toBe(false)
  })
})
