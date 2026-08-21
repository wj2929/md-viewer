/**
 * TTS 合成服务(主进程,工厂模式分派)
 * @module main/tts/ttsService
 * @description 统一入口 synthesize(),按 provider 类型分派到各引擎,统一返回 { audioBase64, format, boundaries }。
 *
 * 加一个 provider 的 5 步:
 *  1. shared/ttsProviders.ts 加 type + 元数据
 *  2. 本文件 SynthesizeRequest 补必要字段(baseUrl/region/model 等)
 *  3. 写 synthesizeXxx(req, apiKey, signal)
 *  4. synthesize() 的 switch 加 case
 *  5. 渲染进程 engine 侧无需改(edge/付费同走 AudioStreamEngine)
 *
 * 安全:渲染进程只传 opaque providerId + 非敏感配置;apiKey 由主进程从 keyStore(safeStorage)自取,不经渲染进程。
 */

import type { TtsProviderType } from '../../shared/ttsProviders'
import { synthesizeEdge } from './EdgeAdapter'
import { decodeOpenAiCompatibleResponse, OpenAiCompatibleResponseError } from './openAiCompatibleResponse'
import { getProviderKey } from './keyStore'
import { providerTarget } from './ttsSettings'

export interface SynthesizeRequest {
  providerId: string
  type: TtsProviderType
  text: string
  voice?: string
  rate?: number
  /** 付费端点 */
  baseUrl?: string
  region?: string
  model?: string
}

export interface SynthesizeResult {
  audioBase64: string
  format: string
  boundaries?: Array<{ text: string; offsetMs: number; durationMs: number }>
}

/** 合成错误,携带分类供渲染层决定是否 fallback */
export class TtsSynthesisError extends Error {
  kind: 'network' | 'config' | 'unsupported' | 'unknown' | 'empty'
  constructor(kind: TtsSynthesisError['kind'], message: string) {
    super(message)
    this.kind = kind
    this.name = 'TtsSynthesisError'
  }
}

export async function synthesize(
  req: SynthesizeRequest,
  signal?: AbortSignal
): Promise<SynthesizeResult> {
  switch (req.type) {
    case 'edge':
      return synthesizeViaEdge(req, signal)
    case 'openai':
      return synthesizeViaOpenAI(req, signal)
    case 'azure':
      return synthesizeViaAzure(req, signal)
    case 'system':
      // 系统声由渲染进程 speechSynthesis 直接处理,不该走到主进程
      throw new TtsSynthesisError('unsupported', '系统声在渲染进程处理,不经主进程合成')
    default:
      throw new TtsSynthesisError('unsupported', `未知 TTS 类型: ${req.type}`)
  }
}

/** 无可朗读字符(纯标点/引号/空白)→ 视为可跳过,不发合成请求 */
const HAS_READABLE = /[\p{L}\p{N}]/u

async function synthesizeViaEdge(
  req: SynthesizeRequest,
  signal?: AbortSignal
): Promise<SynthesizeResult> {
  // 治本已在分段器过滤,此处兜底:纯标点句直接判 empty,不打 edge
  if (!HAS_READABLE.test(req.text)) {
    throw new TtsSynthesisError('empty', '无可朗读内容')
  }
  try {
    const result = await synthesizeEdge(req.text, req.voice, req.rate ?? 1, signal)
    return {
      audioBase64: result.audio.toString('base64'),
      format: result.format,
      boundaries: result.boundaries,
    }
  } catch (err) {
    if ((err as Error).message === 'aborted') throw err
    // edge 未返回音频通常是纯标点句 → 归 empty(跳过),不误退系统声
    if ((err as Error).message.includes('未返回音频')) {
      throw new TtsSynthesisError('empty', '无可朗读内容')
    }
    // edge 逆向接口失败通常是网络/被限流 → 归 network 以便 fallback 到系统声
    throw new TtsSynthesisError('network', `edge-tts 合成失败: ${(err as Error).message}`)
  }
}

/** OpenAI TTS(/v1/audio/speech,带 key POST,收 mp3)。第 4 步接线 UI 后可用。 */
async function synthesizeViaOpenAI(
  req: SynthesizeRequest,
  signal?: AbortSignal
): Promise<SynthesizeResult> {
  const apiKey = getProviderKey(req.providerId, providerTarget(req))
  if (!apiKey) throw new TtsSynthesisError('config', '未配置 OpenAI API Key')
  const base = (req.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model || 'tts-1',
        input: req.text,
        voice: req.voice || 'alloy',
        speed: req.rate ?? 1,
        response_format: 'mp3',
      }),
      redirect: 'error',
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('aborted')
    throw new TtsSynthesisError('network', `OpenAI 请求失败: ${(err as Error).message}`)
  }
  if (!res.ok) {
    const kind = classifyHttpError(res.status)
    throw new TtsSynthesisError(kind, `OpenAI 返回 ${res.status}`)
  }
  try {
    const result = await decodeOpenAiCompatibleResponse(res, signal)
    return { audioBase64: result.audio.toString('base64'), format: result.format }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('aborted')
    if (err instanceof OpenAiCompatibleResponseError) {
      throw new TtsSynthesisError('unsupported', err.message)
    }
    throw err
  }
}

/** Azure TTS(cognitiveservices,带 region + key)。第 4 步接线 UI 后可用。 */
async function synthesizeViaAzure(
  req: SynthesizeRequest,
  signal?: AbortSignal
): Promise<SynthesizeResult> {
  const apiKey = getProviderKey(req.providerId, providerTarget(req))
  if (!apiKey) throw new TtsSynthesisError('config', '未配置 Azure API Key')
  if (!req.region) throw new TtsSynthesisError('config', '未配置 Azure region')
  const voice = req.voice || 'zh-CN-XiaoxiaoNeural'
  const endpoint = `https://${req.region}.tts.speech.microsoft.com/cognitiveservices/v1`
  const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice name='${voice}'>${escapeXml(
    req.text
  )}</voice></speak>`
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: ssml,
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('aborted')
    throw new TtsSynthesisError('network', `Azure 请求失败: ${(err as Error).message}`)
  }
  if (!res.ok) {
    const kind = res.status === 401 || res.status === 403 ? 'config' : 'network'
    throw new TtsSynthesisError(kind, `Azure 返回 ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return { audioBase64: buf.toString('base64'), format: 'mp3' }
}

function classifyHttpError(status: number): 'network' | 'config' {
  if ([400, 401, 403, 404, 405, 422].includes(status)) return 'config'
  return 'network'
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
