import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AudioStreamEngine } from '../../src/tts/engines/AudioStreamEngine'
import type { SpeechSegment } from '../../src/tts/types'

// mock HTMLAudioElement:play 立即 resolve,手动触发 onended 推进
const audioInstances: FakeAudio[] = []
class FakeAudio {
  static rejectPlay = false
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playbackRate = 1
  src: string
  autoEnd = true // 用例可在 play 前改 prototype.autoEnd 影响后续实例
  constructor(src: string) {
    this.src = src
    this.autoEnd = FakeAudio.prototype.autoEnd
    audioInstances.push(this)
  }
  play(): Promise<void> {
    if (FakeAudio.rejectPlay) return Promise.reject(new Error('play failed'))
    // 默认微任务后自动"播完",驱动下一段;autoEnd=false 时停住(供 setRate 测当前音频)
    if (this.autoEnd) Promise.resolve().then(() => this.onended?.())
    return Promise.resolve()
  }
  pause(): void {}
}

const ttsSynthesize = vi.fn()
const ttsCancel = vi.fn().mockResolvedValue({ ok: true })

function seg(text: string): SpeechSegment {
  return { text, element: document.createElement('p') }
}

beforeEach(() => {
  ttsSynthesize.mockReset()
  ttsCancel.mockClear()
  audioInstances.length = 0
  FakeAudio.prototype.autoEnd = true
  FakeAudio.rejectPlay = false
  global.window = global.window || ({} as Window & typeof globalThis)
  ;(global.window as unknown as { api: unknown }).api = { ttsSynthesize, ttsCancel }
  ;(global as unknown as { Audio: unknown }).Audio = FakeAudio
  ;(global as unknown as { URL: unknown }).URL = {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => {},
  }
  ;(global as unknown as { atob: unknown }).atob = (s: string) => s
})

const provider = { providerId: 'edge', type: 'edge' as const, voice: 'v' }

describe('AudioStreamEngine', () => {
  it('正常:逐段合成并回调 onSegmentStart / onEnd', async () => {
    ttsSynthesize.mockResolvedValue({ ok: true, audioBase64: 'AA', format: 'mp3' })
    const engine = new AudioStreamEngine(provider, 1)
    const starts: number[] = []
    let ended = false
    engine.onSegmentStart((i) => starts.push(i))
    engine.onEnd(() => (ended = true))
    engine.play([seg('一'), seg('二')], 0)
    await new Promise((r) => setTimeout(r, 20))
    expect(starts).toEqual([0, 1])
    expect(ended).toBe(true)
  })

  it('empty:纯标点句返回 empty → 跳过继续下一句,不报错不停', async () => {
    // 第0段 empty,第1段正常
    ttsSynthesize
      .mockResolvedValueOnce({ ok: false, kind: 'empty', message: '无可朗读内容' })
      .mockResolvedValue({ ok: true, audioBase64: 'AA', format: 'mp3' })
    const engine = new AudioStreamEngine(provider, 1)
    const starts: number[] = []
    const errors: string[] = []
    engine.onSegmentStart((i) => starts.push(i))
    engine.onError((e) => errors.push(e.kind))
    engine.play([seg('“'), seg('正文。')], 0)
    await new Promise((r) => setTimeout(r, 20))
    // 第0段被跳过(未 segmentStart),第1段正常播;全程无 error
    expect(starts).toContain(1)
    expect(errors).toHaveLength(0)
  })

  it('Edge 连续 network 错误:重试耗尽后才上报 fallback', async () => {
    vi.useFakeTimers()
    ttsSynthesize.mockResolvedValue({ ok: false, kind: 'network', message: '断网' })
    const engine = new AudioStreamEngine(provider, 1)
    const errors: string[] = []
    engine.onError((e) => errors.push(e.kind))
    engine.play([seg('一')], 0)
    await vi.advanceTimersByTimeAsync(600)
    expect(ttsSynthesize).toHaveBeenCalledTimes(3)
    expect(errors).toEqual(['network'])
    vi.useRealTimers()
  })

  it('Edge 瞬时 network 错误:当前段重试成功,不触发 fallback', async () => {
    vi.useFakeTimers()
    ttsSynthesize
      .mockResolvedValueOnce({ ok: false, kind: 'network', message: '连接重置' })
      .mockResolvedValue({ ok: true, audioBase64: 'AA', format: 'mp3' })
    const engine = new AudioStreamEngine(provider, 1)
    const errors: string[] = []
    const starts: number[] = []
    engine.onError((e) => errors.push(e.kind))
    engine.onSegmentStart((i) => starts.push(i))
    engine.play([seg('一')], 0)
    await vi.advanceTimersByTimeAsync(200)
    expect(ttsSynthesize).toHaveBeenCalledTimes(2)
    expect(starts).toEqual([0])
    expect(errors).toHaveLength(0)
    vi.useRealTimers()
  })

  it('预取失败:当前段播放期间不上报,轮到失败段时才上报', async () => {
    vi.useFakeTimers()
    FakeAudio.prototype.autoEnd = false
    ttsSynthesize
      .mockResolvedValueOnce({ ok: true, audioBase64: 'AA', format: 'mp3' })
      .mockResolvedValue({ ok: false, kind: 'network', message: '连接重置' })
    const engine = new AudioStreamEngine(provider, 1)
    const errors: Array<{ kind: string; segmentIndex?: number }> = []
    engine.onError((e) => errors.push(e))
    engine.play([seg('当前段'), seg('预取段')], 0)

    await vi.advanceTimersByTimeAsync(600)
    expect(audioInstances).toHaveLength(1)
    expect(errors).toHaveLength(0)

    audioInstances[0].onended?.()
    await vi.runAllTimersAsync()
    expect(errors).toEqual([
      expect.objectContaining({ kind: 'network', segmentIndex: 1 }),
    ])

    FakeAudio.prototype.autoEnd = true
    vi.useRealTimers()
  })

  it('付费 provider 的 network 错误不自动重试,避免重复计费', async () => {
    ttsSynthesize.mockResolvedValue({ ok: false, kind: 'network', message: '请求失败' })
    const paidProvider = { providerId: 'openai-1', type: 'openai' as const }
    const engine = new AudioStreamEngine(paidProvider, 1)
    const errors: string[] = []
    engine.onError((e) => errors.push(e.kind))
    engine.play([seg('一')], 0)
    await new Promise((r) => setTimeout(r, 20))
    expect(ttsSynthesize).toHaveBeenCalledTimes(1)
    expect(errors).toEqual(['network'])
  })

  it('config 错误:上报 config(上层应提示改配置,不 fallback)', async () => {
    ttsSynthesize.mockResolvedValue({ ok: false, kind: 'config', message: 'key 错' })
    const engine = new AudioStreamEngine(provider, 1)
    const errors: string[] = []
    engine.onError((e) => errors.push(e.kind))
    engine.play([seg('一')], 0)
    await new Promise((r) => setTimeout(r, 20))
    expect(errors).toContain('config')
  })

  it('aborted:不上报错误(主动取消)', async () => {
    ttsSynthesize.mockResolvedValue({ ok: false, kind: 'aborted', message: '已取消' })
    const engine = new AudioStreamEngine(provider, 1)
    const errors: string[] = []
    engine.onError((e) => errors.push(e.kind))
    engine.play([seg('一')], 0)
    await new Promise((r) => setTimeout(r, 20))
    expect(errors).toHaveLength(0)
  })

  it('合成固定用 rate=1(语速改由播放侧 playbackRate 控制,不烤进音频)', async () => {
    ttsSynthesize.mockResolvedValue({ ok: true, audioBase64: 'AA', format: 'mp3' })
    const engine = new AudioStreamEngine(provider, 1.5) // 初始 1.5x
    engine.play([seg('一')], 0)
    await new Promise((r) => setTimeout(r, 20))
    // 传给合成的 rate 恒为 1,不是 1.5
    expect(ttsSynthesize).toHaveBeenCalledWith(expect.objectContaining({ rate: 1 }))
    // 播放侧用 1.5x
    expect(audioInstances[0].playbackRate).toBe(1.5)
  })

  it('stop:取消当前与预取的在途合成请求', async () => {
    const pending = new Promise(() => {})
    ttsSynthesize.mockReturnValue(pending)
    const engine = new AudioStreamEngine(provider, 1)
    engine.play([seg('一')], 0)
    await Promise.resolve()

    const requestId = ttsSynthesize.mock.calls[0][0].requestId
    engine.stop()

    expect(ttsCancel).toHaveBeenCalledWith(requestId)
  })

  it('audio.play 拒绝时上报错误并释放资源', async () => {
    FakeAudio.prototype.autoEnd = false
    FakeAudio.rejectPlay = true
    const revokeObjectURL = vi.fn()
    ;(global as unknown as { URL: unknown }).URL = {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL,
    }
    ttsSynthesize.mockResolvedValue({ ok: true, audioBase64: 'AA', format: 'mp3' })
    const engine = new AudioStreamEngine(provider, 1)
    const errors: string[] = []
    engine.onError((error) => errors.push(error.kind))

    engine.play([seg('当前段'), seg('预取段')], 0)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(errors).toEqual(['unknown'])
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('音频播放错误:释放当前与预取 Blob', async () => {
    FakeAudio.prototype.autoEnd = false
    const revokeObjectURL = vi.fn()
    ;(global as unknown as { URL: unknown }).URL = {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL,
    }
    ttsSynthesize.mockResolvedValue({ ok: true, audioBase64: 'AA', format: 'mp3' })
    const engine = new AudioStreamEngine(provider, 1)
    const errors: string[] = []
    engine.onError((error) => errors.push(error.kind))
    engine.play([seg('当前段'), seg('预取段')], 0)
    await new Promise((resolve) => setTimeout(resolve, 10))

    audioInstances[0].onerror?.()
    await Promise.resolve()

    expect(errors).toEqual(['unknown'])
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('setRate:立即改当前正在播音频的 playbackRate(拖语速当前句即时生效)', async () => {
    // 单段且不自动结束,保持"正在播"状态
    FakeAudio.prototype.autoEnd = false
    ttsSynthesize.mockResolvedValue({ ok: true, audioBase64: 'AA', format: 'mp3' })
    const engine = new AudioStreamEngine(provider, 1)
    engine.play([seg('长句一')], 0)
    await new Promise((r) => setTimeout(r, 10))
    const playing = audioInstances[0]
    expect(playing.playbackRate).toBe(1) // 起始 1x
    engine.setRate(1.75)
    expect(playing.playbackRate).toBe(1.75) // 立即变速
    FakeAudio.prototype.autoEnd = true // 复位,不影响其它用例
  })
})
