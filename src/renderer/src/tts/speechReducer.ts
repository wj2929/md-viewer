/**
 * 朗读状态机 reducer(纯函数,可单测)
 * @module tts/speechReducer
 * @description 把状态转换与副作用(speechSynthesis/IPC)分离:reducer 只算状态,
 * hook 负责根据状态执行副作用。竞态确定性靠纯函数化保证。
 */

import type { SpeechStatus, TtsEngineError } from './types'

export interface SpeechState {
  status: SpeechStatus
  /** 当前朗读段落索引 */
  currentIndex: number
  /** 总段数 */
  total: number
  /** 错误信息(status==='error' 时) */
  error: TtsEngineError | null
  /** 是否已脱离自动滚动跟随(用户手动滚动触发) */
  detachedFromFollow: boolean
}

export type SpeechAction =
  | { type: 'PLAY'; startIndex: number; total: number }
  | { type: 'LOADING' }
  | { type: 'SEGMENT_START'; index: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'END' }
  | { type: 'ERROR'; error: TtsEngineError }
  | { type: 'DETACH_FOLLOW' }
  | { type: 'REATTACH_FOLLOW' }

export const initialSpeechState: SpeechState = {
  status: 'idle',
  currentIndex: 0,
  total: 0,
  error: null,
  detachedFromFollow: false,
}

export function speechReducer(state: SpeechState, action: SpeechAction): SpeechState {
  switch (action.type) {
    case 'PLAY':
      return {
        ...state,
        status: 'loading',
        currentIndex: action.startIndex,
        total: action.total,
        error: null,
        detachedFromFollow: false,
      }
    case 'LOADING':
      // 仅在播放相关态下允许进入 loading(避免 stop 后的迟到合成把状态拉回)
      if (state.status === 'idle' || state.status === 'error') return state
      return { ...state, status: 'loading' }
    case 'SEGMENT_START':
      // 迟到的段开始事件(已 stop)忽略
      if (state.status === 'idle' || state.status === 'error') return state
      return { ...state, status: 'playing', currentIndex: action.index }
    case 'PAUSE':
      if (state.status !== 'playing') return state
      return { ...state, status: 'paused' }
    case 'RESUME':
      if (state.status !== 'paused') return state
      return { ...state, status: 'playing' }
    case 'STOP':
      return { ...initialSpeechState }
    case 'END':
      return { ...initialSpeechState }
    case 'ERROR':
      return { ...state, status: 'error', error: action.error }
    case 'DETACH_FOLLOW':
      return { ...state, detachedFromFollow: true }
    case 'REATTACH_FOLLOW':
      return { ...state, detachedFromFollow: false }
    default:
      return state
  }
}
