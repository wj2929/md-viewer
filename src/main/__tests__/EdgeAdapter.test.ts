import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const control: { nextStreamError?: Error; metadataPromise?: Promise<void> } = {}

  class FakeStream {
    handlers = new Map<string, Array<(...args: any[]) => void>>()
    destroy = vi.fn(() => {
      this.emit('close')
      return this
    })
    on(event: string, handler: (...args: any[]) => void): this {
      const handlers = this.handlers.get(event) ?? []
      handlers.push(handler)
      this.handlers.set(event, handlers)
      return this
    }
    emit(event: string, ...args: any[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }
  }

  class FakeEdgeTts {
    setMetadata = vi.fn(() => control.metadataPromise ?? Promise.resolve())
    close = vi.fn()
    audioStream = new FakeStream()
    metadataStream = new FakeStream()
    input = ''

    constructor() {
      instances.push(this)
    }

    toStream(input: string) {
      this.input = input
      if (control.nextStreamError) {
        const error = control.nextStreamError
        control.nextStreamError = undefined
        throw error
      }
      return { audioStream: this.audioStream, metadataStream: this.metadataStream }
    }
  }

  const instances: FakeEdgeTts[] = []
  return { FakeEdgeTts, instances, control }
})

vi.mock('msedge-tts', () => ({
  MsEdgeTTS: mocks.FakeEdgeTts,
  OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3' },
}))

import { synthesizeEdge } from '../tts/EdgeAdapter'

beforeEach(() => {
  mocks.instances.length = 0
  mocks.control.nextStreamError = undefined
  mocks.control.metadataPromise = undefined
})

describe('EdgeAdapter', () => {
  it('转义 XML 保留字符并在完成后关闭 WebSocket', async () => {
    const synthesis = synthesizeEdge(`A & B < C > D "E" 'F'`)
    await Promise.resolve()
    await Promise.resolve()
    const instance = mocks.instances[0]

    expect(instance.input).toBe('A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos;')
    instance.audioStream.emit('data', Buffer.from('mp3'))
    instance.audioStream.emit('close')

    await expect(synthesis).resolves.toMatchObject({ format: 'mp3' })
    expect(instance.metadataStream.destroy).toHaveBeenCalled()
    expect(instance.close).toHaveBeenCalledTimes(1)
  })

  it('toStream 同步失败时关闭 WebSocket', async () => {
    mocks.control.nextStreamError = new Error('stream failed')

    const synthesis = synthesizeEdge('失败正文')
    await expect(synthesis).rejects.toThrow('stream failed')

    expect(mocks.instances[0].close).toHaveBeenCalledTimes(1)
  })

  it('建连阶段取消时关闭 WebSocket 并立即返回', async () => {
    mocks.control.metadataPromise = new Promise(() => {})
    const controller = new AbortController()
    const synthesis = synthesizeEdge('正文', undefined, 1, controller.signal)
    await Promise.resolve()
    const instance = mocks.instances[0]

    controller.abort()

    await expect(synthesis).rejects.toThrow('aborted')
    expect(instance.close).toHaveBeenCalledTimes(1)
    expect(instance.audioStream.destroy).not.toHaveBeenCalled()
  })

  it('取消时销毁音频和元数据流并关闭 WebSocket', async () => {
    const controller = new AbortController()
    const synthesis = synthesizeEdge('正文', undefined, 1, controller.signal)
    await Promise.resolve()
    const instance = mocks.instances[0]

    controller.abort()

    await expect(synthesis).rejects.toThrow('aborted')
    expect(instance.audioStream.destroy).toHaveBeenCalled()
    expect(instance.metadataStream.destroy).toHaveBeenCalled()
    expect(instance.close).toHaveBeenCalledTimes(1)
  })
})
