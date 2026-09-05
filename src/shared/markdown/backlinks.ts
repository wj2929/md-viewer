import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type { AnalyzedMarkdownLink } from './analyze'

export type BacklinkPlacement = 'prose' | 'standalone-link' | 'table'

export interface BacklinkPresentation {
  placement: BacklinkPlacement
  context: string
}

const markdownParser = new MarkdownIt({ html: true, linkify: false })
const MAX_CONTEXT_LENGTH = 240

function collectText(tokens: readonly Token[] | null | undefined): string {
  return (tokens ?? []).map(token => {
    if (token.type === 'text' || token.type === 'code_inline') return token.content
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' '
    if (token.type === 'image') return token.content
    if (token.type === 'html_inline') return token.content.replace(/<[^>]*>/g, '')
    return collectText(token.children)
  }).join('')
}

function buildPlainContext(line: string, table: boolean): string {
  const inline = markdownParser.parseInline(line, {})
  let context = collectText(inline)
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*)/, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '')

  if (table) {
    context = context
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map(cell => cell.trim())
      .filter(Boolean)
      .join(' · ')
  }

  return context
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .trim()
    .slice(0, MAX_CONTEXT_LENGTH)
}

function tableLineRanges(source: string): Array<[number, number]> {
  return markdownParser.parse(source, {})
    .filter(token => token.type === 'table_open' && token.map)
    .map(token => token.map as [number, number])
}

function overlapsLine(link: AnalyzedMarkdownLink, line: number): boolean {
  return link.sourceRange.startLine <= line && link.sourceRange.endLine >= line
}

function removeLinksFromLine(
  line: string,
  lineNumber: number,
  links: readonly AnalyzedMarkdownLink[],
): string {
  const ranges = links
    .filter(link => overlapsLine(link, lineNumber))
    .map(link => {
      const start = link.sourceRange.startLine < lineNumber
        ? 0
        : Math.max(0, link.sourceRange.startColumn - 1)
      const end = link.sourceRange.endLine > lineNumber
        ? line.length
        : Math.max(start, link.sourceRange.endColumn - 1)
      return { start, end }
    })
    .sort((left, right) => right.start - left.start)

  let remaining = line
  for (const range of ranges) {
    remaining = `${remaining.slice(0, range.start)} ${remaining.slice(range.end)}`
  }
  return remaining
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*)/, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildBacklinkPresentations(
  source: string,
  links: readonly AnalyzedMarkdownLink[],
): Map<number, BacklinkPresentation> {
  const lines = source.split(/\r\n|\r|\n/)
  const tables = tableLineRanges(source)
  const presentations = new Map<number, BacklinkPresentation>()

  for (const link of links) {
    const lineNumber = link.lineStart
    const line = lines[lineNumber - 1] ?? ''
    const inTable = tables.some(([start, end]) => lineNumber > start && lineNumber <= end)
    const placement: BacklinkPlacement = link.syntax === 'reference-definition'
      ? 'standalone-link'
      : inTable
        ? 'table'
        : /[\p{L}\p{N}]/u.test(removeLinksFromLine(line, lineNumber, links))
          ? 'prose'
          : 'standalone-link'

    presentations.set(link.sourceRange.startOffset, {
      placement,
      context: buildPlainContext(line, inTable),
    })
  }

  return presentations
}
