/**
 * 系统语音引擎(Web Speech API)
 * @module tts/engines/SystemSpeechEngine
 * @description 包装 window.speechSynthesis。离线免费,音质取决于系统语音。
 * 关键坑处理:逐段 speak(每段一个 utterance)天然规避 Chromium "连续朗读超 ~15 秒静默停止" 的 bug。
 */

import type { TtsEngine, TtsEngineError, SpeechSegment } from '../types'

export class SystemSpeechEngine implements TtsEngine {
  private segments: SpeechSegment[] = []
  private index = 0
  private rate = 1
  private voice: SpeechSynthesisVoice | null = null
  private disposed = false
  private current: SpeechSynthesisUtterance | null = null

  private segmentStartCb: (index: number) => void = () => {}
  private endCb: () => void = () => {}
  private errorCb: (e: TtsEngineError) => void = () => {}

  constructor(voiceId?: string, rate?: number) {
    if (rate) this.rate = rate
    if (voiceId) this.voice = this.findVoice(voiceId)
  }

  private findVoice(voiceId: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis?.getVoices?.() ?? []
    return voices.find(v => v.voiceURI === voiceId || v.name === voiceId) ?? null
  }

  play(segments: SpeechSegment[], startIndex: number): void {
    if (!window.speechSynthesis) {
      this.errorCb({ kind: 'unsupported', message: '当前环境不支持语音合成' })
      return
    }
    this.segments = segments
    this.index = Math.max(0, Math.min(startIndex, segments.length - 1))
    window.speechSynthesis.cancel()
    this.speakCurrent()
  }

  private speakCurrent(): void {
    if (this.disposed) return
    if (this.index >= this.segments.length) {
      this.endCb()
      return
    }
    const seg = this.segments[this.index]
    const utt = new SpeechSynthesisUtterance(seg.text)
    utt.rate = this.rate
    if (this.voice) {
      utt.voice = this.voice
      utt.lang = this.voice.lang
    }
    utt.onstart = () => {
      if (!this.disposed) this.segmentStartCb(this.index)
    }
    utt.onend = () => {
      if (this.disposed) return
      // 只有正常读完(非被 cancel 打断)才推进。cancel 会触发 onend,故用 current 标记区分。
      if (this.current !== utt) return
      this.index += 1
      this.speakCurrent()
    }
    utt.onerror = (ev) => {
      if (this.disposed) return
      if (this.current !== utt) return
      // 'canceled'/'interrupted' 是主动停止,不算错误
      if (ev.error === 'canceled' || ev.error === 'interrupted') return
      this.errorCb({ kind: 'unknown', message: `系统语音出错: ${ev.error}` })
    }
    this.current = utt
    window.speechSynthesis.speak(utt)
  }

  pause(): void {
    window.speechSynthesis?.pause()
  }

  resume(): void {
    window.speechSynthesis?.resume()
  }

  stop(): void {
    this.current = null
    window.speechSynthesis?.cancel()
  }

  setRate(rate: number): void {
    if (rate === this.rate) return
    this.rate = rate
    // speechSynthesis 无法对已 speak 的 utterance 改速,故取消当前句、用新语速从当前句句首重读,
    // 让语速调节立即生效(代价:当前句从头再读)。仅在朗读中重读。
    if (this.current && !this.disposed && window.speechSynthesis) {
      window.speechSynthesis.cancel()
      this.speakCurrent()
    }
  }

  onSegmentStart(cb: (index: number) => void): void {
    this.segmentStartCb = cb
  }

  onEnd(cb: () => void): void {
    this.endCb = cb
  }

  onError(cb: (e: TtsEngineError) => void): void {
    this.errorCb = cb
  }

  dispose(): void {
    this.disposed = true
    this.current = null
    window.speechSynthesis?.cancel()
  }
}

/**
 * 获取系统可用中文优先的音色列表。
 * 处理 getVoices() 首次返回空的坑:若为空,监听 voiceschanged 后再取。
 */
export function loadSystemVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve([])
      return
    }
    const immediate = window.speechSynthesis.getVoices()
    if (immediate.length > 0) {
      resolve(immediate)
      return
    }
    let settled = false
    const handler = (): void => {
      if (settled) return
      settled = true
      window.speechSynthesis.removeEventListener('voiceschanged', handler)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', handler)
    // 兜底:1.5s 后仍无事件则返回当前(可能仍空)
    setTimeout(handler, 1500)
  })
}
