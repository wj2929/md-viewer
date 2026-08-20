const MAX_AUDIO_BYTES = 16 * 1024 * 1024
const MAX_ENVELOPE_BYTES = 24 * 1024 * 1024

const AUDIO_MIME_FORMATS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
}

export class OpenAiCompatibleResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAiCompatibleResponseError'
  }
}

export interface DecodedAudioResponse {
  audio: Buffer
  format: string
}

export async function decodeOpenAiCompatibleResponse(
  response: Response,
  signal?: AbortSignal
): Promise<DecodedAudioResponse> {
  const mediaType = getMediaType(response.headers.get('content-type'))
  const audioFormat = AUDIO_MIME_FORMATS[mediaType]
  const maxWireBytes = audioFormat || mediaType === 'application/octet-stream'
    ? MAX_AUDIO_BYTES
    : MAX_ENVELOPE_BYTES
  const body = await readBodyWithLimit(response, maxWireBytes, signal)

  if (audioFormat) return validateAudio(body, audioFormat)
  if (mediaType === 'application/json' || mediaType.endsWith('+json')) {
    return decodeJsonAudio(body)
  }
  if (mediaType === 'text/event-stream') return decodeSseAudio(body)
  if (mediaType === 'application/octet-stream') return detectAudio(body)

  if (!mediaType) {
    try {
      return detectAudio(body)
    } catch {
      const text = body.toString('utf8').trimStart()
      if (text.startsWith('{')) return decodeJsonAudio(body)
      if (text.startsWith('data:') || text.startsWith(':')) return decodeSseAudio(body)
    }
  }

  throw new OpenAiCompatibleResponseError(
    `服务返回了不支持的音频类型${mediaType ? `：${mediaType}` : ''}`
  )
}

function getMediaType(contentType: string | null): string {
  return (contentType ?? '').split(';', 1)[0].trim().toLowerCase()
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Buffer> {
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new OpenAiCompatibleResponseError('语音服务返回的音频过大')
    }
  }
  if (!response.body) throw new OpenAiCompatibleResponseError('语音服务返回了空响应')

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  const abort = (): void => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new OpenAiCompatibleResponseError('语音服务返回的音频过大')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    signal?.removeEventListener('abort', abort)
  }

  if (total === 0) throw new OpenAiCompatibleResponseError('语音服务返回了空响应')
  return Buffer.concat(chunks, total)
}

function decodeJsonAudio(body: Buffer): DecodedAudioResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new OpenAiCompatibleResponseError('语音服务返回的 JSON 无法解析')
  }
  if (!isRecord(parsed)) {
    throw new OpenAiCompatibleResponseError('语音服务返回的 JSON 格式不受支持')
  }
  if (typeof parsed.code === 'number' && parsed.code !== 0) {
    throw new OpenAiCompatibleResponseError(readServiceMessage(parsed))
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'content') || typeof parsed.content !== 'string') {
    throw new OpenAiCompatibleResponseError(readServiceMessage(parsed))
  }
  const format = readFormat(parsed) ?? 'mp3'
  return validateAudio(decodeStrictBase64(parsed.content), format)
}

function decodeSseAudio(body: Buffer): DecodedAudioResponse {
  const normalized = body.toString('utf8').replace(/\r\n?/g, '\n')
  const events = normalized.split('\n\n')
  const chunks: Array<{ seq?: number; audio: Buffer }> = []
  let lastSeq: number | undefined
  let format = 'mp3'

  for (const event of events) {
    const dataLines = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
    if (dataLines.length === 0) continue
    const data = dataLines.join('\n').trim()
    if (!data || data === '[DONE]') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      throw new OpenAiCompatibleResponseError('语音服务返回的 SSE 数据无法解析')
    }
    if (!isRecord(parsed)) {
      throw new OpenAiCompatibleResponseError('语音服务返回的 SSE 格式不受支持')
    }
    if (typeof parsed.code === 'number' && parsed.code !== 0) {
      throw new OpenAiCompatibleResponseError(readServiceMessage(parsed))
    }
    if (parsed.seq !== undefined) {
      const seq = parsed.seq
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || (lastSeq !== undefined && seq <= lastSeq)) {
        throw new OpenAiCompatibleResponseError('语音服务返回的 SSE 分片顺序无效')
      }
      lastSeq = seq
    }
    if (typeof parsed.content !== 'string' || !parsed.content) continue
    format = readFormat(parsed) ?? format
    chunks.push({ seq: parsed.seq as number | undefined, audio: decodeStrictBase64(parsed.content) })
  }

  if (chunks.length === 0) {
    throw new OpenAiCompatibleResponseError('语音服务没有返回音频数据')
  }
  const audio = Buffer.concat(chunks.map((chunk) => chunk.audio))
  return validateAudio(audio, format)
}

function decodeStrictBase64(value: string): Buffer {
  if (
    !value
    || value.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new OpenAiCompatibleResponseError('语音服务返回的音频编码无效')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 0 || decoded.length > MAX_AUDIO_BYTES || decoded.toString('base64') !== value) {
    throw new OpenAiCompatibleResponseError('语音服务返回的音频编码无效')
  }
  return decoded
}

function readFormat(value: Record<string, unknown>): string | undefined {
  const raw = typeof value.format === 'string'
    ? value.format
    : typeof value.mimeType === 'string'
      ? AUDIO_MIME_FORMATS[getMediaType(value.mimeType)]
      : undefined
  if (!raw) return undefined
  const normalized = raw.toLowerCase().replace(/^audio\//, '')
  if (normalized === 'mpeg') return 'mp3'
  return ['mp3', 'wav', 'ogg', 'flac', 'aac', 'webm'].includes(normalized)
    ? normalized
    : undefined
}

function detectAudio(audio: Buffer): DecodedAudioResponse {
  for (const format of ['mp3', 'wav', 'ogg', 'flac', 'aac', 'webm']) {
    if (matchesAudioMagic(audio, format)) return { audio, format }
  }
  throw new OpenAiCompatibleResponseError('语音服务返回的内容不是可识别的音频')
}

function validateAudio(audio: Buffer, format: string): DecodedAudioResponse {
  if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) {
    throw new OpenAiCompatibleResponseError('语音服务返回的音频大小无效')
  }
  if (!matchesAudioMagic(audio, format)) {
    throw new OpenAiCompatibleResponseError('语音服务返回的音频格式与内容不匹配')
  }
  return { audio, format }
}

function matchesAudioMagic(audio: Buffer, format: string): boolean {
  if (format === 'mp3') {
    return audio.subarray(0, 3).toString('ascii') === 'ID3'
      || (audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)
  }
  if (format === 'wav') {
    return audio.length >= 12
      && audio.subarray(0, 4).toString('ascii') === 'RIFF'
      && audio.subarray(8, 12).toString('ascii') === 'WAVE'
  }
  if (format === 'ogg') return audio.subarray(0, 4).toString('ascii') === 'OggS'
  if (format === 'flac') return audio.subarray(0, 4).toString('ascii') === 'fLaC'
  if (format === 'aac') return audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xf6) === 0xf0
  if (format === 'webm') return audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  return false
}

function readServiceMessage(value: Record<string, unknown>): string {
  const message = typeof value.message === 'string'
    ? value.message
    : typeof value.error === 'string'
      ? value.error
      : '语音服务没有返回可用音频'
  return message.slice(0, 300)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
