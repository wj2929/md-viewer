import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { extname } from 'path'
import { validateSecurePath } from '../security/pathValidator'
import { analyzeMarkdownFile, type MarkdownAnalysis } from './markdownAnalysis'
import { createFailureResult, createSuccessResult } from './result'
import type { CliResult } from './types'

interface SemanticEntry {
  key?: string
  value: Record<string, unknown>
}

interface DiffChange {
  type: 'added' | 'removed' | 'changed'
  category: 'front-matter' | 'heading' | 'paragraph' | 'link' | 'image' | 'code' | 'chart'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export async function buildDiffResult(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<CliResult> {
  if (positional.length !== 2) {
    return createFailureResult('diff', {
      code: 'INVALID_ARGUMENT',
      message: 'diff 需要两个 Markdown 文件路径',
      exitCode: 2,
      actions: [{
        label: '查看 diff 命令帮助',
        command: 'md-viewer help diff --json',
        target: 'diff',
        risk: 'safe',
      }],
    })
  }

  const validated: string[] = []
  for (const input of positional) {
    if (extname(input).toLowerCase() === '.excalidraw') {
      return createFailureResult('diff', {
        code: 'INPUT_NOT_ALLOWED',
        message: 'diff 仅支持 Markdown 文件，不支持 Excalidraw 文件',
        target: input,
        exitCode: 2,
      })
    }
    const result = await validateSecurePath(input)
    if (!result.valid || result.type !== 'md-file') {
      return createFailureResult('diff', {
        code: result.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
        message: result.error ?? '输入文件不可用',
        target: input,
        exitCode: result.error === '路径不存在' ? 3 : 2,
      })
    }
    if (extname(result.normalizedPath).toLowerCase() === '.excalidraw') {
      return createFailureResult('diff', {
        code: 'INPUT_NOT_ALLOWED',
        message: 'diff 仅支持 Markdown 文件，不支持 Excalidraw 文件',
        target: input,
        exitCode: 2,
      })
    }
    validated.push(result.normalizedPath)
  }

  const [beforePath, afterPath] = validated
  const [beforeMarkdown, afterMarkdown, beforeAnalysis, afterAnalysis] = await Promise.all([
    readFile(beforePath, 'utf8'),
    readFile(afterPath, 'utf8'),
    analyzeMarkdownFile(beforePath),
    analyzeMarkdownFile(afterPath),
  ])
  const before = buildSemanticEntries(beforeMarkdown, beforeAnalysis)
  const after = buildSemanticEntries(afterMarkdown, afterAnalysis)
  const changes = compareEntries(before, after)
  const summary = summarize(changes)
  const hasChanges = changes.length > 0
  const result = createSuccessResult('diff', {
    summary: {
      before: beforePath,
      after: afterPath,
      hasChanges,
      totalChanges: changes.length,
      ...summary,
    },
    results: { hasChanges, changes },
  })

  if (hasChanges && flags['fail-on-change'] === true) {
    return createFailureResult('diff', {
      code: 'DIFF_FOUND',
      message: '检测到 Markdown 语义差异',
      target: `${beforePath} → ${afterPath}`,
      exitCode: 4,
      summary: result.summary,
      results: result.results,
    })
  }
  return result
}

function buildSemanticEntries(markdown: string, analysis: MarkdownAnalysis): SemanticEntry[] {
  const entries: SemanticEntry[] = []
  const frontMatter = extractFrontMatter(markdown)
  if (frontMatter) {
    entries.push({ key: 'front-matter:0', value: { category: 'front-matter', hash: hash(frontMatter) } })
  }

  analysis.headings.forEach((heading, index) => {
    entries.push({
      key: `heading:${index}`,
      value: { category: 'heading', level: heading.level, text: heading.text, id: heading.id },
    })
  })
  analysis.links.forEach((link, index) => {
    entries.push({
      key: `link:${index}`,
      value: { category: 'link', text: link.text, target: link.target, kind: link.kind },
    })
  })
  analysis.images.forEach((image, index) => {
    entries.push({
      key: `image:${index}`,
      value: { category: 'image', alt: image.alt, target: image.target, kind: image.kind },
    })
  })

  const normalized = normalizeMarkdown(markdown)
  const lines = normalized.split('\n')
  const fences = extractFences(lines)
  fences.forEach((fence, index) => {
    const type = analysis.chartBlocks.find(block => block.lineStart === fence.lineStart)?.type
    entries.push({
      key: `${type ? 'chart' : 'code'}:${index}`,
      value: {
        category: type ? 'chart' : 'code',
        language: fence.language,
        ...(type ? { type } : {}),
        contentHash: hash(fence.content),
      },
    })
  })

  extractParagraphs(lines, fences).forEach((paragraph, index) => {
    entries.push({
      key: `paragraph:${index}`,
      value: { category: 'paragraph', contentHash: hash(paragraph), text: paragraph },
    })
  })
  return entries
}

function compareEntries(before: SemanticEntry[], after: SemanticEntry[]): DiffChange[] {
  const categories: DiffChange['category'][] = [
    'front-matter',
    'heading',
    'paragraph',
    'link',
    'image',
    'code',
    'chart',
  ]
  return categories.flatMap(category => compareCategoryEntries(
    before.filter(entry => entry.value.category === category).map(entry => entry.value),
    after.filter(entry => entry.value.category === category).map(entry => entry.value),
    category,
  ))
}

function compareCategoryEntries(
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
  category: DiffChange['category'],
): DiffChange[] {
  const beforeTokens = before.map(value => JSON.stringify(value))
  const afterTokens = after.map(value => JSON.stringify(value))
  const anchors = findUniqueAnchors(beforeTokens, afterTokens)
  const changes: DiffChange[] = []
  let beforeStart = 0
  let afterStart = 0

  for (const [beforeEnd, afterEnd] of [...anchors, [before.length, after.length] as const]) {
    appendUnmatchedChanges(
      before.slice(beforeStart, beforeEnd),
      after.slice(afterStart, afterEnd),
      category,
      changes,
    )
    beforeStart = beforeEnd + 1
    afterStart = afterEnd + 1
  }
  return changes
}

function appendUnmatchedChanges(
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
  category: DiffChange['category'],
  changes: DiffChange[],
): void {
  const paired = Math.min(before.length, after.length)
  for (let index = 0; index < paired; index += 1) {
    if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) {
      changes.push({ type: 'changed', category, before: before[index], after: after[index] })
    }
  }
  for (let index = paired; index < before.length; index += 1) {
    changes.push({ type: 'removed', category, before: before[index] })
  }
  for (let index = paired; index < after.length; index += 1) {
    changes.push({ type: 'added', category, after: after[index] })
  }
}

function findUniqueAnchors(before: string[], after: string[]): Array<readonly [number, number]> {
  const beforeOccurrences = collectOccurrences(before)
  const afterOccurrences = collectOccurrences(after)
  const candidates: Array<readonly [number, number]> = []
  for (const [token, positions] of beforeOccurrences) {
    const afterPositions = afterOccurrences.get(token)
    if (positions.length === 1 && afterPositions?.length === 1) {
      candidates.push([positions[0], afterPositions[0]])
    }
  }
  candidates.sort((left, right) => left[0] - right[0])
  return longestIncreasingByAfterIndex(candidates)
}

function collectOccurrences(values: string[]): Map<string, number[]> {
  const occurrences = new Map<string, number[]>()
  values.forEach((value, index) => {
    const positions = occurrences.get(value) ?? []
    positions.push(index)
    occurrences.set(value, positions)
  })
  return occurrences
}

function longestIncreasingByAfterIndex(
  candidates: Array<readonly [number, number]>,
): Array<readonly [number, number]> {
  if (candidates.length === 0) return []
  const tails: number[] = []
  const predecessors = new Array<number>(candidates.length).fill(-1)
  for (let index = 0; index < candidates.length; index += 1) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (candidates[tails[middle]][1] < candidates[index][1]) low = middle + 1
      else high = middle
    }
    if (low > 0) predecessors[index] = tails[low - 1]
    tails[low] = index
  }
  const result: Array<readonly [number, number]> = []
  let cursor = tails[tails.length - 1]
  while (cursor >= 0) {
    result.push(candidates[cursor])
    cursor = predecessors[cursor]
  }
  return result.reverse()
}

function summarize(changes: DiffChange[]): Record<string, number> {
  return {
    frontMatter: changes.filter(change => change.category === 'front-matter').length,
    heading: changes.filter(change => change.category === 'heading').length,
    paragraph: changes.filter(change => change.category === 'paragraph').length,
    link: changes.filter(change => change.category === 'link').length,
    image: changes.filter(change => change.category === 'image').length,
    code: changes.filter(change => change.category === 'code').length,
    chart: changes.filter(change => change.category === 'chart').length,
  }
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
}

function extractFrontMatter(markdown: string): string | null {
  const normalized = normalizeMarkdown(markdown)
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  return match ? match[1].trim() : null
}

interface Fence {
  lineStart: number
  lineEnd: number
  language: string
  content: string
}

function extractFences(lines: string[]): Fence[] {
  const fences: Fence[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/)
    if (!match) continue
    const marker = match[1][0]
    const minimumLength = match[1].length
    const content: string[] = []
    let end = index + 1
    while (end < lines.length && !new RegExp(`^\\s*${marker}{${minimumLength},}\\s*$`).test(lines[end])) {
      content.push(lines[end])
      end += 1
    }
    fences.push({
      lineStart: index + 1,
      lineEnd: Math.min(end + 1, lines.length),
      language: match[2].toLowerCase(),
      content: content.join('\n'),
    })
    index = end
  }
  return fences
}

function extractParagraphs(lines: string[], fences: Fence[]): string[] {
  const excludedLines = new Set<number>()
  for (const fence of fences) {
    for (let line = fence.lineStart; line <= fence.lineEnd; line += 1) excludedLines.add(line)
  }
  const paragraphs: string[] = []
  let current: string[] = []
  const flush = (): void => {
    const paragraph = current.join(' ').replace(/\s+/g, ' ').trim()
    if (paragraph) paragraphs.push(paragraph)
    current = []
  }
  lines.forEach((line, index) => {
    const lineNumber = index + 1
    if (excludedLines.has(lineNumber) || /^\s*$/.test(line) || /^\s{0,3}#{1,6}\s+/.test(line) || /^---\s*$/.test(line)) {
      flush()
      return
    }
    current.push(line.trim())
  })
  flush()
  return paragraphs
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
