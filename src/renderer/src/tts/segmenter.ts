/**
 * 朗读分段器
 * @module tts/segmenter
 * @description 从已渲染的 .markdown-body DOM 收集朗读段落,并按中文标点切成句子级单元。
 * 不重新解析 markdown——直接复用预览已渲染的块级元素(它们已带 dataset.sourceLine)。
 * 句子单元携带所属元素 + 元素内字符偏移,供 CSS Highlight API 用 Range 精确高亮当前句。
 */

import type { SpeechSegment } from './types'

/** 要朗读的块级标签(排除 pre/table) */
const READABLE_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,blockquote,li'

/** 句末标点(中文 + 英文),用于把块文本切句 */
const SENTENCE_BOUNDARY = /([。！？；!?;…]+|\.(?:\s|$)|\n)/

/** 是否含可朗读字符(汉字/字母/数字);纯标点空白引号视为不可读 */
const HAS_READABLE = /[\p{L}\p{N}]/u

/** 后置闭合标点:句末标点在其前时会被切走,应把它们黏回前一句句尾 */
const TRAILING_PUNCT = /^["'”’」』）)】》]+/

/**
 * 判断元素是否应跳过朗读:
 * - 图表源码块 / 代码块(pre)
 * - 嵌套在 li 里的 p(避免重复朗读)
 */
function shouldSkip(el: HTMLElement): boolean {
  if (el.closest('pre')) return true
  if (el.tagName === 'P' && el.closest('li')) return true
  return false
}

/**
 * 把一段纯文本按句末标点切成句子,返回每句的 {text, start, end} 字符区间
 * (start/end 是相对该段规整后文本的偏移)。标点归入前一句。
 */
export function splitSentences(text: string): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = []
  const parts = text.split(SENTENCE_BOUNDARY)
  let cursor = 0
  let buffer = ''
  let bufStart = 0
  const flush = (endPos: number): void => {
    const trimmed = buffer.trim()
    if (trimmed) {
      // start/end 对应原始文本(高亮 Range 用);text 压缩内部空白供朗读(念得干净)
      const leading = buffer.length - buffer.trimStart().length
      const start = bufStart + leading
      const end = start + trimmed.length
      let compact = trimmed.replace(/\s+/g, ' ')
      let segStart = start
      // 后置闭合标点(如 。切句后甩到本句开头的闭引号 ”)→ 黏回前一句句尾。
      // 例:"…出手。”场面话…" 应切成 [ …出手。” ][ 场面话… ],而非把 ” 留给后句。
      const lead = compact.match(TRAILING_PUNCT)
      if (lead && result.length > 0) {
        const prev = result[result.length - 1]
        prev.text += lead[0]
        prev.end = segStart + lead[0].length
        compact = compact.slice(lead[0].length)
        segStart += lead[0].length
      }
      // 无可读字符(纯标点/引号,如切句后落单的闭引号)→ 并入前一句,不单独成句。
      // 否则会产生 TTS 合成失败的"垃圾句",误触发 fallback。
      if (!HAS_READABLE.test(compact) && result.length > 0) {
        const prev = result[result.length - 1]
        prev.text += compact
        prev.end = end
      } else if (HAS_READABLE.test(compact)) {
        result.push({ text: compact, start: segStart, end })
      }
      // 无可读字符且无前句(段首落单标点)→ 直接丢弃
    }
    buffer = ''
    bufStart = endPos
  }
  for (const part of parts) {
    if (part === undefined) continue
    if (buffer === '') bufStart = cursor
    buffer += part
    cursor += part.length
    if (SENTENCE_BOUNDARY.test(part) && part.length > 0 && buffer.trim()) {
      // part 是分隔符本身(split 的捕获组),连同前文一起成句
      flush(cursor)
    }
  }
  if (buffer.trim()) flush(cursor)
  return result
}

export interface SpeechSegmentOptions {
  /** 单次联网合成的 UTF-8 字节上限；只对仍然过长的句子做二级切分 */
  maxUtf8Bytes?: number
}

const UTF8_ENCODER = new TextEncoder()
const SOFT_CHUNK_BOUNDARY = /[，,、；;：:\s]/u

/**
 * 在保留原 DOM UTF-16 偏移的前提下按 UTF-8 字节限制切分。
 * 优先停在逗号/分号/空白后；无自然边界时按 Unicode code point 切，避免拆坏 emoji。
 */
function splitRangeByUtf8Bytes(
  raw: string,
  start: number,
  end: number,
  maxBytes: number
): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = []
  let chunkStart = start
  let cursor = start
  let chunkBytes = 0
  let lastSoftEnd = -1

  const emit = (rangeEnd: number): void => {
    const source = raw.slice(chunkStart, rangeEnd)
    const leading = source.length - source.trimStart().length
    const trailing = source.length - source.trimEnd().length
    const segmentStart = chunkStart + leading
    const segmentEnd = rangeEnd - trailing
    if (segmentEnd > segmentStart) {
      result.push({
        text: raw.slice(segmentStart, segmentEnd).replace(/\s+/g, ' '),
        start: segmentStart,
        end: segmentEnd,
      })
    }
    chunkStart = rangeEnd
    cursor = rangeEnd
    chunkBytes = 0
    lastSoftEnd = -1
  }

  while (cursor < end) {
    const codePoint = raw.codePointAt(cursor)
    if (codePoint === undefined) break
    const char = String.fromCodePoint(codePoint)
    const next = cursor + char.length
    const charBytes = UTF8_ENCODER.encode(char).byteLength
    if (chunkBytes + charBytes > maxBytes && cursor > chunkStart) {
      const splitAt = lastSoftEnd > chunkStart ? lastSoftEnd : cursor
      emit(splitAt)
      continue
    }
    chunkBytes += charBytes
    cursor = next
    if (SOFT_CHUNK_BOUNDARY.test(char)) lastSoftEnd = cursor
  }
  if (chunkStart < end) emit(end)
  return result
}

/**
 * 收集句子级朗读单元。
 * 每个块级元素的 textContent 切句;句子的字符偏移相对该元素的完整 textContent,
 * 供高亮时用 Range 在元素内定位。
 */
export function collectSpeechSegments(
  container: HTMLElement | null,
  options: SpeechSegmentOptions = {}
): SpeechSegment[] {
  if (!container) return []
  const body = container.querySelector('.markdown-body') ?? container
  const elements = Array.from(body.querySelectorAll<HTMLElement>(READABLE_SELECTOR))
  const segments: SpeechSegment[] = []
  for (const element of elements) {
    if (shouldSkip(element)) continue
    const raw = element.textContent || ''
    if (!raw.trim()) continue
    const sourceLineRaw = element.dataset.sourceLine
    const sourceLine = sourceLineRaw ? Number(sourceLineRaw) : undefined
    const sentences = splitSentences(raw)
    // 无可切句子(纯标点等)时,整块作为一句
    const units = sentences.length > 0 ? sentences : [{ text: raw.trim(), start: 0, end: raw.length }]
    const boundedUnits = options.maxUtf8Bytes
      ? units.flatMap((unit) => UTF8_ENCODER.encode(unit.text).byteLength > options.maxUtf8Bytes!
        ? splitRangeByUtf8Bytes(raw, unit.start, unit.end, options.maxUtf8Bytes!)
        : [unit])
      : units
    for (const u of boundedUnits) {
      segments.push({
        text: u.text,
        element,
        sourceLine: Number.isFinite(sourceLine) ? sourceLine : undefined,
        charStart: u.start,
        charEnd: u.end,
      })
    }
  }
  return segments
}

/**
 * 找到"当前视口内第一个完整可见句子"的索引,作为默认朗读起点。
 * 找不到则返回 0。
 */
export function findViewportStartIndex(
  segments: SpeechSegment[],
  container: HTMLElement | null
): number {
  if (!container || segments.length === 0) return 0
  const containerTop = container.getBoundingClientRect().top
  const tolerance = 4
  for (let i = 0; i < segments.length; i++) {
    const rect = segments[i].element.getBoundingClientRect()
    if (rect.top >= containerTop - tolerance) {
      return i
    }
  }
  return Math.max(0, segments.length - 1)
}
