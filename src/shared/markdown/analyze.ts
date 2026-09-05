import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import {
  classifyMarkdownTarget,
  createHeadingIdAllocator,
  extractPlainHeadingText,
  splitMarkdownTarget,
  type MarkdownTargetKind,
} from './semantics'
import { scanMarkdownLinkDestinations, type SourceRange } from './sourceLinks'

export interface AnalyzedMarkdownHeading {
  level: number
  text: string
  id: string
  lineStart: number
}

export interface AnalyzedMarkdownLink {
  syntax: 'inline' | 'reference-definition' | 'autolink' | 'html'
  isImage: boolean
  rawTarget: string
  decodedTarget: string
  kind: MarkdownTargetKind
  lineStart: number
  sourceRange: SourceRange
  destinationRange?: SourceRange
  anchor?: string
}

export interface AnalyzedMarkdownDocument {
  headings: AnalyzedMarkdownHeading[]
  links: AnalyzedMarkdownLink[]
  terms: Record<string, number>
  lineCount: number
}

const markdownParser = new MarkdownIt({ html: true, linkify: false })

export function analyzeMarkdownSource(source: string): AnalyzedMarkdownDocument {
  const tokens = markdownParser.parse(source, {})
  return {
    headings: extractHeadings(tokens),
    links: scanMarkdownLinkDestinations(source).map(link => {
      const target = splitMarkdownTarget(link.rawTarget)
      return {
        syntax: link.syntax,
        isImage: link.isImage,
        rawTarget: link.rawTarget,
        decodedTarget: [
          target.decodedPath,
          target.rawQuery === undefined ? '' : `?${target.query ?? ''}`,
          target.rawAnchor === undefined ? '' : `#${target.anchor ?? ''}`,
        ].join(''),
        kind: classifyMarkdownTarget(link.rawTarget),
        lineStart: link.sourceRange.startLine,
        sourceRange: link.sourceRange,
        ...(link.destinationRange ? { destinationRange: link.destinationRange } : {}),
        ...(target.anchor ? { anchor: target.anchor } : {}),
      }
    }),
    terms: collectTerms(tokens),
    lineCount: source.length === 0 ? 0 : source.split(/\r\n|\r|\n/).length,
  }
}

function extractHeadings(tokens: Token[]): AnalyzedMarkdownHeading[] {
  const headings: AnalyzedMarkdownHeading[] = []
  const allocateHeadingId = createHeadingIdAllocator()
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open') continue
    const inline = tokens[index + 1]
    if (!inline || inline.type !== 'inline') continue
    const text = extractPlainHeadingText(inline.children)
    headings.push({
      level: Number(token.tag.slice(1)) || 1,
      text,
      id: allocateHeadingId(text),
      lineStart: token.map ? token.map[0] + 1 : 0,
    })
  }
  return headings
}

function collectTerms(tokens: Token[]): Record<string, number> {
  const counts: Record<string, number> = Object.create(null)
  const text = tokens
    .filter(token => token.type === 'inline')
    .flatMap(token => token.children ?? [])
    .filter(token => token.type === 'text' || token.type === 'code_inline')
    .map(token => token.content)
    .join(' ')

  for (const term of tokenizeSearchText(text)) {
    counts[term] = (counts[term] ?? 0) + 1
  }
  return counts
}

export function tokenizeSearchText(text: string): string[] {
  const normalized = text.toLocaleLowerCase().normalize('NFKC')
  const words = normalized.match(/[\p{L}\p{N}_]+/gu) ?? []
  const terms: string[] = []
  for (const word of words) {
    terms.push(word)
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(word)) {
      for (const character of word) terms.push(character)
      for (let index = 0; index + 1 < word.length; index += 1) terms.push(word.slice(index, index + 2))
    }
  }
  return terms
}
