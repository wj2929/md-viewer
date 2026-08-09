/**
 * edge-tts 适配器(隔离逆向第三方包 msedge-tts)
 * @module main/tts/EdgeAdapter
 * @description 把 msedge-tts 的用法封在此处。edge 接口若被微软改动/封禁,只需替换本文件。
 * 已实测:msedge-tts@2.0.7 在 Node v24 可用,返回 mp3 + WordBoundary 时间戳。
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

export interface EdgeSynthesisResult {
  /** mp3 音频字节 */
  audio: Buffer
  format: 'mp3'
  /** 词边界时间戳(供后续字级高亮;第一期不消费) */
  boundaries: Array<{ text: string; offsetMs: number; durationMs: number }>
}

/** edge 中文语音(内建可选) */
export const EDGE_ZH_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（女）', lang: 'zh-CN' },
  { id: 'zh-CN-YunxiNeural', name: '云希（男）', lang: 'zh-CN' },
  { id: 'zh-CN-YunjianNeural', name: '云健（男）', lang: 'zh-CN' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊（女）', lang: 'zh-CN' },
  { id: 'zh-CN-YunyangNeural', name: '云扬（男）', lang: 'zh-CN' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏（男童）', lang: 'zh-CN' },
]

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'
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
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice || DEFAULT_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  })

  // 语速转 edge prosody 百分比:1→+0%, 1.5→+50%, 0.5→-50%
  const ratePct = Math.round((rate - 1) * 100)
  const prosody = ratePct === 0 ? undefined : { rate: `${ratePct > 0 ? '+' : ''}${ratePct}%` }

  const { audioStream, metadataStream } = prosody
    ? tts.toStream(text, prosody)
    : tts.toStream(text)

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
    const onAbort = (): void => {
      audioStream.destroy()
      reject(new Error('aborted'))
    }
    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }
    audioStream.on('data', (c: Buffer) => chunks.push(c))
    audioStream.on('close', () => {
      signal?.removeEventListener('abort', onAbort)
      if (chunks.length === 0) {
        reject(new Error('edge-tts 未返回音频'))
        return
      }
      resolve({ audio: Buffer.concat(chunks), format: 'mp3', boundaries })
    })
    audioStream.on('error', (err: Error) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
  })
}
