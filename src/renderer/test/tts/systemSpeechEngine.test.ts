import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SystemSpeechEngine,
  toSystemVoiceOptions,
} from '../../src/tts/engines/SystemSpeechEngine'
import type { SpeechSegment } from '../../src/tts/types'

class FakeUtterance extends EventTarget {
  text: string
  rate = 1
  lang = ''
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null

  constructor(text: string) {
    super()
    this.text = text
  }
}

class FakeSpeechSynthesis extends EventTarget {
  voices: SpeechSynthesisVoice[] = []
  spoken: FakeUtterance[] = []
  cancel = vi.fn()
  pause = vi.fn()
  resume = vi.fn()

  getVoices = (): SpeechSynthesisVoice[] => this.voices
  speak = (utterance: SpeechSynthesisUtterance): void => {
    this.spoken.push(utterance as unknown as FakeUtterance)
  }
}

function voice(name: string, voiceURI: string, lang = 'zh-CN'): SpeechSynthesisVoice {
  return {
    default: false,
    lang,
    localService: true,
    name,
    voiceURI,
  }
}

function segments(): SpeechSegment[] {
  return [
    { text: '第一句', element: document.createElement('p') },
    { text: '第二句', element: document.createElement('p') },
  ]
}

let synthesis: FakeSpeechSynthesis

beforeEach(() => {
  synthesis = new FakeSpeechSynthesis()
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: synthesis,
  })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
})

describe('SystemSpeechEngine', () => {
  it('系统音色选项以 voiceURI 优先并去重', () => {
    expect(toSystemVoiceOptions([
      voice('Tingting', 'voice-1'),
      voice('重复', 'voice-1'),
      voice('Sinji', 'voice-2', 'zh-HK'),
    ])).toEqual([
      { id: 'voice-1', name: 'Tingting', lang: 'zh-CN' },
      { id: 'voice-2', name: 'Sinji', lang: 'zh-HK' },
    ])
  })

  it('优先按 voiceURI 选择系统音色，并兼容按名称选择', () => {
    const tingting = voice('Tingting', 'voice-1')
    synthesis.voices = [tingting]

    new SystemSpeechEngine('voice-1').play(segments(), 0)
    expect(synthesis.spoken[0].voice).toBe(tingting)

    synthesis.spoken = []
    new SystemSpeechEngine('Tingting').play(segments(), 0)
    expect(synthesis.spoken[0].voice).toBe(tingting)
  })

  it('持久化音色不存在时等待 voiceschanged 后再播放所选音色', async () => {
    const engine = new SystemSpeechEngine('voice-late')
    engine.play(segments(), 0)
    expect(synthesis.spoken).toHaveLength(0)

    const lateVoice = voice('Late Voice', 'voice-late')
    synthesis.voices = [lateVoice]
    synthesis.dispatchEvent(new Event('voiceschanged'))
    await Promise.resolve()

    expect(synthesis.spoken).toHaveLength(1)
    expect(synthesis.spoken[0].voice).toBe(lateVoice)
  })

  it('已有其它音色但目标音色稍后加载时仍等待目标音色', async () => {
    synthesis.voices = [voice('Other Voice', 'voice-other')]
    const engine = new SystemSpeechEngine('voice-late')
    engine.play(segments(), 0)
    expect(synthesis.spoken).toHaveLength(0)

    const lateVoice = voice('Late Voice', 'voice-late')
    synthesis.voices = [synthesis.voices[0], lateVoice]
    synthesis.dispatchEvent(new Event('voiceschanged'))
    await Promise.resolve()

    expect(synthesis.spoken).toHaveLength(1)
    expect(synthesis.spoken[0].voice).toBe(lateVoice)
  })

  it('等待音色期间停止后不会迟到播放', async () => {
    const engine = new SystemSpeechEngine('voice-late')
    engine.play(segments(), 0)
    engine.stop()

    synthesis.voices = [voice('Late Voice', 'voice-late')]
    synthesis.dispatchEvent(new Event('voiceschanged'))
    await Promise.resolve()

    expect(synthesis.spoken).toHaveLength(0)
  })

  it('变速时 cancel 触发旧 onend 不会跳过当前句', () => {
    const engine = new SystemSpeechEngine(undefined, 1)
    engine.play(segments(), 0)
    const first = synthesis.spoken[0]
    synthesis.cancel.mockImplementationOnce(() => first.onend?.())

    engine.setRate(1.5)

    expect(synthesis.spoken).toHaveLength(2)
    expect(synthesis.spoken[1].text).toBe('第一句')
    expect(synthesis.spoken[1].rate).toBe(1.5)
    synthesis.spoken[1].onend?.()
    expect(synthesis.spoken[2].text).toBe('第二句')
  })

  it('停止后旧 utterance 的 onend 不会推进下一句', () => {
    const onSegmentStart = vi.fn()
    const engine = new SystemSpeechEngine()
    engine.onSegmentStart(onSegmentStart)
    engine.play(segments(), 0)

    const first = synthesis.spoken[0]
    first.onstart?.()
    engine.stop()
    first.onend?.()

    expect(onSegmentStart).toHaveBeenCalledTimes(1)
    expect(synthesis.spoken).toHaveLength(1)
  })
})
