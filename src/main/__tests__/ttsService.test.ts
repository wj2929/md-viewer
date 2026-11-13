import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProviderKey: vi.fn<() => Promise<string | undefined>>(),
}))

vi.mock('../tts/keyStore', () => ({
  getProviderKey: mocks.getProviderKey,
}))

vi.mock('../tts/EdgeAdapter', () => ({
  synthesizeEdge: vi.fn(),
}))

import { synthesize } from '../tts/ttsService'

const request = {
  providerId: 'custom-tts-test',
  type: 'openai' as const,
  text: '测试',
  baseUrl: 'https://example.test/v1',
  model: 'custom-model',
  voice: 'custom-voice',
  rate: 1,
}

function mp3(bytes = 16): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(bytes - 2, 1)])
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.clearAllMocks()
  mocks.getProviderKey.mockReset().mockResolvedValue('secret')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAI-compatible TTS response', () => {
  it('解析标准原始 MP3', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array(mp3()), {
      headers: { 'Content-Type': 'audio/mpeg' },
    }))

    const result = await synthesize(request)

    expect(result).toEqual({ audioBase64: mp3().toString('base64'), format: 'mp3' })
    expect(fetch).toHaveBeenCalledWith('https://example.test/v1/audio/speech', expect.objectContaining({
      redirect: 'error',
      body: JSON.stringify({
        model: 'custom-model',
        input: '测试',
        voice: 'custom-voice',
        speed: 1,
        response_format: 'mp3',
      }),
    }))
  })

  it('解析 JSON content Base64', async () => {
    const audio = mp3(24)
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      content: audio.toString('base64'),
      url: 'https://ignored.example/audio.mp3',
    }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }))

    await expect(synthesize(request)).resolves.toEqual({
      audioBase64: audio.toString('base64'),
      format: 'mp3',
    })
  })

  it('解析并拼接 SSE Base64 分片', async () => {
    const first = mp3(8)
    const second = Buffer.alloc(8, 2)
    const body = [
      ': keep-alive',
      '',
      `data: ${JSON.stringify({ code: 0, content: first.toString('base64'), status: 1, seq: 1 })}`,
      '',
      `data: ${JSON.stringify({ code: 0, content: second.toString('base64'), status: 2, seq: 2 })}`,
      '',
    ].join('\r\n')
    vi.mocked(fetch).mockResolvedValue(new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    await expect(synthesize(request)).resolves.toEqual({
      audioBase64: Buffer.concat([first, second]).toString('base64'),
      format: 'mp3',
    })
  })

  it('拒绝非法 Base64 和未知响应格式', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ content: 'not-base64' }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    await expect(synthesize(request)).rejects.toMatchObject({ kind: 'unsupported' })

    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>gateway</html>', {
      headers: { 'Content-Type': 'text/html' },
    }))
    await expect(synthesize(request)).rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('按配置错误和网络错误区分 HTTP 状态', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 422 }))
    await expect(synthesize(request)).rejects.toMatchObject({ kind: 'config' })

    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(synthesize(request)).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('异步密钥等待', () => {
  it.each(['openai', 'azure'] as const)('%s 等待系统解密时可以立即取消，迟到结果不发请求', async type => {
    let finish!: (value: string | undefined) => void
    mocks.getProviderKey.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const validate = vi.fn()
    const pending = synthesize({ ...request, type, region: 'eastasia' }, controller.signal, validate)
    const rejected = expect(pending).rejects.toThrow('aborted')
    controller.abort()
    await rejected
    expect(fetch).not.toHaveBeenCalled()
    finish('late-secret')
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(validate).not.toHaveBeenCalled()
  })

  it('已取消请求不读取密钥，取消优先于缺 key 错误', async () => {
    const controller = new AbortController()
    controller.abort()
    mocks.getProviderKey.mockResolvedValueOnce(undefined)
    await expect(synthesize(request, controller.signal)).rejects.toThrow('aborted')
    expect(mocks.getProviderKey).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['openai', 'azure'] as const)('%s 解密完成后、fetch 前复核配置', async type => {
    let finish!: (value: string) => void
    mocks.getProviderKey.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const validate = vi.fn(() => { throw new Error('provider changed') })
    const pending = synthesize({ ...request, type, region: 'eastasia' }, undefined, validate)
    const rejected = expect(pending).rejects.toThrow('provider changed')
    expect(validate).not.toHaveBeenCalled()
    finish('temporary-key')
    await rejected
    expect(validate).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('解密拒绝不会触发 fetch 或未处理的 Promise', async () => {
    mocks.getProviderKey.mockRejectedValueOnce(new Error('decrypt failed'))
    await expect(synthesize(request)).rejects.toThrow('decrypt failed')
    expect(fetch).not.toHaveBeenCalled()
  })
})
