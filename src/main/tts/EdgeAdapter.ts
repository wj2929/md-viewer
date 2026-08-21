/**
 * edge-tts 适配器(隔离逆向第三方包 msedge-tts)
 * @module main/tts/EdgeAdapter
 * @description 把 msedge-tts 的用法封在此处。edge 接口若被微软改动/封禁,只需替换本文件。
 * 已实测:msedge-tts@2.0.7 在 Node v24 可用,返回 mp3 + WordBoundary 时间戳。
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { DEFAULT_EDGE_VOICE, EDGE_ZH_VOICES } from '../../shared/ttsProviders'

export { EDGE_ZH_VOICES }

export interface EdgeSynthesisResult {
  /** mp3 音频字节 */
  audio: Buffer
  format: 'mp3'
  /** 词边界时间戳(供后续字级高亮;第一期不消费) */
  boundaries: Array<{ text: string; offsetMs: number; durationMs: number }>
}

const DEFAULT_VOICE = DEFAULT_EDGE_VOICE
/** 100 纳秒 → 毫秒 */
const HNS_TO_MS = 10000

/**
 * 合成一段文本 → mp3 + 词边界。
 * @param text 要合成的文本
 * @param voice 音色 id
 * @param rate 语速(0.5-2),转成 edge 的 ±% prosody
 * @param signal 取消信号
 */
export async function synthesizeEdge(
  text: string,
  voice: string = DEFAULT_VOICE,
  rate = 1,
  signal?: AbortSignal
): Promise<EdgeSynthesisResult> {
  if (signal?.aborted) throw new Error('aborted')
  const tts = new MsEdgeTTS()
  let closed = false
  const closeTts = (): void => {
    if (closed) return
    closed = true
    tts.close()
  }
  try {
    await waitForMetadata(
      tts.setMetadata(voice || DEFAULT_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
        wordBoundaryEnabled: true,
      }),
      signal,
      closeTts
    )
  } catch (error) {
    closeTts()
    throw error
  }

  // 语速转 edge prosody 百分比:1→+0%, 1.5→+50%, 0.5→-50%
  const ratePct = Math.round((rate - 1) * 100)
  const prosody = ratePct === 0 ? undefined : { rate: `${ratePct > 0 ? '+' : ''}${ratePct}%` }

  const safeText = escapeXml(text)
  let streams: ReturnType<MsEdgeTTS['toStream']>
  try {
    streams = prosody
      ? tts.toStream(safeText, prosody)
      : tts.toStream(safeText)
  } catch (error) {
    closeTts()
    throw error
  }
  const { audioStream, metadataStream } = streams

  const chunks: Buffer[] = []
  const boundaries: EdgeSynthesisResult['boundaries'] = []

  if (metadataStream) {
    metadataStream.on('data', (c: Buffer) => {
      try {
        const parsed = JSON.parse(c.toString())
        for (const m of parsed?.Metadata ?? []) {
          if (m?.Type === 'WordBoundary' && m?.Data) {
            boundaries.push({
              text: m.Data.text?.Text ?? '',
              offsetMs: Math.round((m.Data.Offset ?? 0) / HNS_TO_MS),
              durationMs: Math.round((m.Data.Duration ?? 0) / HNS_TO_MS),
            })
          }
        }
      } catch {
        // 忽略无法解析的元数据帧
      }
    })
  }

  return new Promise<EdgeSynthesisResult>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
      metadataStream?.destroy()
      closeTts()
    }
    const finish = (result?: EdgeSynthesisResult, error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result as EdgeSynthesisResult)
    }
    const onAbort = (): void => {
      finish(undefined, new Error('aborted'))
      audioStream.destroy()
    }
    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    audioStream.on('data', (c: Buffer) => chunks.push(c))
    audioStream.on('close', () => {
      if (chunks.length === 0) {
        finish(undefined, new Error('edge-tts 未返回音频'))
        return
      }
      finish({ audio: Buffer.concat(chunks), format: 'mp3', boundaries })
    })
    audioStream.on('error', (err: Error) => finish(undefined, err))
  })
}

function waitForMetadata(
  metadata: Promise<unknown>,
  signal: AbortSignal | undefined,
  closeTts: () => void
): Promise<void> {
  if (!signal) return metadata.then(() => undefined)
  if (signal.aborted) {
    closeTts()
    return Promise.reject(new Error('aborted'))
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = (): void => {
      closeTts()
      finish(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    metadata.then(() => finish(), (error) => finish(error))
  })
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
