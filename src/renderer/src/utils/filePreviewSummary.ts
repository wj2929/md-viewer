const MAX_PREVIEW_CHARACTERS = 500

function stripFrontmatter(source: string): string {
  const lines = source.split('\n')
  if (lines[0]?.trim() !== '---') return source

  const end = lines.findIndex((line, index) => (
    index > 0 && (line.trim() === '---' || line.trim() === '...')
  ))
  return end >= 0 ? lines.slice(end + 1).join('\n') : source
}

function stripFencedCodeBlocks(source: string): string {
  const output: string[] = []
  let fenceChar = ''
  let fenceLength = 0

  for (const line of source.split('\n')) {
    const match = line.match(/^\s*(`{3,}|~{3,})/)
    if (!fenceChar && match) {
      fenceChar = match[1][0]
      fenceLength = match[1].length
      continue
    }
    if (fenceChar) {
      if (match && match[1][0] === fenceChar && match[1].length >= fenceLength) {
        fenceChar = ''
        fenceLength = 0
      }
      continue
    }
    output.push(line)
  }

  return output.join('\n')
}

function cleanMarkdownLine(line: string): string {
  const trimmed = line.trim()
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return ''
  if (/^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(trimmed)) return ''

  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '│ ')
    .replace(/^\s*[-*+]\s+/, '• ')
    .replace(/^\s*(\d+)[.)]\s+/, '$1. ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?:\*\*|__)(.*?)(?:\*\*|__)/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/[ \t]+$/g, '')
}

function truncateNaturally(text: string): string {
  if (Array.from(text).length <= MAX_PREVIEW_CHARACTERS) return text

  const candidate = Array.from(text)
    .slice(0, MAX_PREVIEW_CHARACTERS - 1)
    .join('')
    .trimEnd()
  const minimumBoundary = Math.floor(candidate.length * 0.6)
  const boundaryPattern = /[。！？；](?:["'”’）)\]]*)?|[.!?](?:["'”’）)\]]*)?(?=\s|$)|\n+|\s+/gu
  let boundary = 0
  for (const match of candidate.matchAll(boundaryPattern)) {
    const matchEnd = match.index + match[0].length
    if (matchEnd >= minimumBoundary) boundary = matchEnd
  }

  const result = (boundary > 0 ? candidate.slice(0, boundary) : candidate)
    .trimEnd()
    .replace(/…+$/u, '')
  return `${result}…`
}

export function extractFilePreview(raw: string): string {
  const normalized = raw
    .replace(/^﻿/u, '')
    .replace(/\r\n?/g, '\n')
  const withoutMetadata = stripFrontmatter(normalized)
  const withoutCode = stripFencedCodeBlocks(withoutMetadata)
  const cleaned = withoutCode
    .split('\n')
    .map(cleanMarkdownLine)
    .join('\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!cleaned) return '（未找到可预览的正文）'
  return truncateNaturally(cleaned)
}
