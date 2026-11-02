const MAX_FORMAT_INPUT_BYTES = 1024 * 1024
const MAX_FORMAT_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_FORMAT_DEPTH = 64
const MAX_JSON_LINES_RECORDS = 10_000

export type AttachmentFormatResult = { content: string; reason?: 'invalid' | 'budget'; invalidLine?: number }

export function formatAttachmentJsonLines(source: string): AttachmentFormatResult {
  const encoder = new TextEncoder()
  if (source.length > MAX_FORMAT_INPUT_BYTES || encoder.encode(source).length > MAX_FORMAT_INPUT_BYTES) {
    return { content: source, reason: 'budget' }
  }
  const lines = source.replace(/^﻿/, '').split(/\r?\n/)
  const records: string[] = []
  let bytes = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^[ \t\r]*$/.test(line)) continue
    if (records.length >= MAX_JSON_LINES_RECORDS) return { content: source, reason: 'budget' }
    const result = line.startsWith('﻿') ? { content: line, reason: 'invalid' as const } : formatAttachmentJson(line)
    if (result.reason) return { content: source, reason: result.reason, ...(result.reason === 'invalid' ? { invalidLine: index + 1 } : {}) }
    bytes += encoder.encode(result.content).length + (records.length ? 2 : 0)
    if (bytes > MAX_FORMAT_OUTPUT_BYTES) return { content: source, reason: 'budget' }
    records.push(result.content)
  }
  return { content: records.length ? records.join('\n\n') : source }
}

// 只重排 JSON 词法空白；不通过 JS 对象重建数值、转义或重复键。
export function formatAttachmentJson(source: string): AttachmentFormatResult {
  const encoder = new TextEncoder()
  if (encoder.encode(source).length > MAX_FORMAT_INPUT_BYTES) return { content: source, reason: 'budget' }
  const input = source.replace(/^﻿/, '')
  try { JSON.parse(input) } catch { return { content: source, reason: 'invalid' } }
  const parts: string[] = []
  let bytes = 0
  let depth = 0
  let previous = ''
  const append = (part: string): boolean => {
    bytes += encoder.encode(part).length
    if (bytes > MAX_FORMAT_OUTPUT_BYTES) return false
    parts.push(part)
    return true
  }
  const nextNonSpace = (from: number): string => {
    while (from < input.length && /\s/.test(input[from])) from++
    return input[from] ?? ''
  }
  for (let i = 0; i < input.length;) {
    const char = input[i]
    if (/\s/.test(char)) { i++; continue }
    let token: string
    if (char === '"') {
      const start = i++
      while (i < input.length) {
        if (input[i] === '\\') { i += 2; continue }
        if (input[i++] === '"') break
      }
      token = input.slice(start, i)
    } else if (char === '{' || char === '[') {
      i++
      depth++
      if (depth > MAX_FORMAT_DEPTH) return { content: source, reason: 'budget' }
      token = char + (nextNonSpace(i) === (char === '{' ? '}' : ']') ? '' : `\n${'  '.repeat(depth)}`)
    } else if (char === '}' || char === ']') {
      i++
      depth--
      token = (previous === (char === '}' ? '{' : '[') ? '' : `\n${'  '.repeat(depth)}`) + char
    } else if (char === ',') {
      i++
      token = `,\n${'  '.repeat(depth)}`
    } else if (char === ':') {
      i++
      token = ': '
    } else {
      const start = i++
      while (i < input.length && !/[\s,\]}]/.test(input[i])) i++
      token = input.slice(start, i)
    }
    if (!append(token)) return { content: source, reason: 'budget' }
    previous = char
  }
  return { content: parts.join('') }
}

export const attachmentErrorMessages = {
  'invalid-reference': '附件链接必须使用安全相对路径，不支持协议、查询或片段。',
  'owner-missing': '来源文档不属于本窗口工作区，无法查看此附件。',
  unavailable: '附件不存在、不可访问或不在来源工作区内。',
  stale: '来源工作区或附件已变化，请重新打开。',
  busy: '正在等待系统打开确认。',
} as const

export const attachmentNoticeMessages = {
  'too-large': '附件超过 5 MiB，无法在应用内完整查看。',
  'not-utf8': '附件不是有效 UTF-8 文本，无法在应用内查看。',
  binary: '附件包含二进制内容，无法按文本查看。',
  unsupported: '此附件链接暂不支持应用内查看或直接执行。',
} as const
