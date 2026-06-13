import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { readFile, stat } from 'fs/promises'
import path from 'path'

const chartLanguageAliases: Record<string, string> = {
  dot: 'graphviz',
  graphviz: 'graphviz',
  gv: 'graphviz',
  puml: 'plantuml',
  plantuml: 'plantuml',
  c4: 'c4plantuml',
  c4plantuml: 'c4plantuml',
  c4container: 'c4plantuml',
  c4component: 'c4plantuml',
  c4context: 'c4plantuml',
  g6: 'antv-g6',
  antv: 'antv-g6',
  antvg6: 'antv-g6',
  'antv-g6': 'antv-g6',
  excalidraw: 'excalidraw',
  mermaid: 'mermaid',
  echarts: 'echarts',
  markmap: 'markmap',
  drawio: 'drawio',
  dio: 'drawio',
  infographic: 'infographic',
  katex: 'katex',
  tex: 'katex',
  latex: 'katex',
  'vega-lite': 'vega-lite',
  vegalite: 'vega-lite',
  vega: 'vega-lite',
  d2: 'd2',
  bpmn: 'bpmn',
  wavedrom: 'wavedrom',
  structurizr: 'structurizr',
  plotly: 'plotly',
  dbml: 'dbml',
  kroki: 'kroki',
  nomnoml: 'kroki',
  pikchr: 'kroki',
  svgbob: 'kroki',
  bytefield: 'kroki',
  tikz: 'kroki',
}

export interface MarkdownHeadingInfo {
  level: number
  text: string
  id: string
  lineStart: number
}

export interface MarkdownCodeBlockInfo {
  language: string
  lineStart: number
  lineEnd: number
}

export interface MarkdownChartBlockInfo extends MarkdownCodeBlockInfo {
  type: string
}

export interface MarkdownImageInfo {
  alt: string
  target: string
  kind: 'local' | 'external' | 'data' | 'unsupported'
  exists?: boolean
  resolvedPath?: string
  lineStart: number
}

export interface MarkdownLinkInfo {
  text: string
  target: string
  kind: 'markdown' | 'anchor' | 'external' | 'local-resource' | 'unsupported'
  exists?: boolean
  anchor?: string
  anchorExists?: boolean
  resolvedPath?: string
  lineStart: number
}

export interface MarkdownAnalysisSummary {
  lines: number
  words: number
  headings: number
  images: number
  links: number
  codeBlocks: number
  chartBlocks: number
  missingAssets: number
  missingMarkdownLinks: number
  missingAnchors: number
  externalLinks: number
}

export interface MarkdownAnalysis {
  input: string
  summary: MarkdownAnalysisSummary
  headings: MarkdownHeadingInfo[]
  images: MarkdownImageInfo[]
  links: MarkdownLinkInfo[]
  codeBlocks: MarkdownCodeBlockInfo[]
  chartBlocks: MarkdownChartBlockInfo[]
}

const md = new MarkdownIt({ html: true, linkify: false })

export async function analyzeMarkdownFile(filePath: string): Promise<MarkdownAnalysis> {
  const markdown = await readFile(filePath, 'utf8')
  return analyzeMarkdown(markdown, filePath)
}

export async function analyzeMarkdown(markdown: string, filePath: string): Promise<MarkdownAnalysis> {
  const tokens = md.parse(markdown, {})
  const headings = extractHeadings(tokens)
  const codeBlocks = extractCodeBlocks(tokens)
  const chartBlocks = codeBlocks
    .map(block => {
      const type = normalizeChartType(block.language)
      return type ? { ...block, type } : null
    })
    .filter((block): block is MarkdownChartBlockInfo => Boolean(block))
  const baseDir = path.dirname(filePath)
  const images = await extractImages(tokens, baseDir)
  const links = await extractLinks(tokens, filePath, headings)

  const summary: MarkdownAnalysisSummary = {
    lines: markdown.length === 0 ? 0 : markdown.split(/\r?\n/).length,
    words: countWords(markdown),
    headings: headings.length,
    images: images.length,
    links: links.length,
    codeBlocks: codeBlocks.length,
    chartBlocks: chartBlocks.length,
    missingAssets: images.filter(image => image.kind === 'local' && image.exists === false).length,
    missingMarkdownLinks: links.filter(link => link.kind === 'markdown' && link.exists === false).length,
    missingAnchors: links.filter(link => link.anchor && link.anchorExists === false).length,
    externalLinks: links.filter(link => link.kind === 'external').length,
  }

  return {
    input: filePath,
    summary,
    headings,
    images,
    links,
    codeBlocks,
    chartBlocks,
  }
}

function extractHeadings(tokens: Token[]): MarkdownHeadingInfo[] {
  const usedSlugs = new Map<string, number>()
  const headings: MarkdownHeadingInfo[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open') continue
    const inlineToken = tokens[index + 1]
    if (!inlineToken || inlineToken.type !== 'inline') continue
    const text = inlinePlainText(inlineToken)
    if (!text) continue
    headings.push({
      level: Number(token.tag.slice(1)) || 1,
      text,
      id: uniqueSlugify(text, usedSlugs),
      lineStart: token.map ? token.map[0] + 1 : 0,
    })
  }

  return headings
}

function extractCodeBlocks(tokens: Token[]): MarkdownCodeBlockInfo[] {
  return tokens
    .filter(token => token.type === 'fence')
    .map(token => ({
      language: normalizeFenceLanguage(token.info),
      lineStart: token.map ? token.map[0] + 1 : 0,
      lineEnd: token.map ? token.map[1] : 0,
    }))
}

async function extractImages(tokens: Token[], baseDir: string): Promise<MarkdownImageInfo[]> {
  const images: MarkdownImageInfo[] = []
  for (const inlineToken of tokens.filter(token => token.type === 'inline')) {
    for (const child of inlineToken.children ?? []) {
      if (child.type !== 'image') continue
      const target = child.attrGet('src') ?? ''
      const resolved = await resolveLocalTarget(baseDir, target)
      images.push({
        alt: child.content,
        target,
        kind: classifyTarget(target, { image: true }),
        ...(resolved ? { exists: resolved.exists, resolvedPath: resolved.path } : {}),
        lineStart: inlineToken.map ? inlineToken.map[0] + 1 : 0,
      })
    }
  }
  return images
}

async function extractLinks(
  tokens: Token[],
  filePath: string,
  currentHeadings: MarkdownHeadingInfo[],
): Promise<MarkdownLinkInfo[]> {
  const links: MarkdownLinkInfo[] = []
  const baseDir = path.dirname(filePath)
  const currentAnchors = new Set(currentHeadings.map(heading => heading.id))

  for (const inlineToken of tokens.filter(token => token.type === 'inline')) {
    const children = inlineToken.children ?? []
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (child.type !== 'link_open') continue
      const target = child.attrGet('href') ?? ''
      const text = collectLinkText(children, index + 1)
      links.push(await inspectLinkTarget({
        target,
        text,
        baseDir,
        currentAnchors,
        lineStart: inlineToken.map ? inlineToken.map[0] + 1 : 0,
      }))
    }
  }

  return links
}

async function inspectLinkTarget(options: {
  target: string
  text: string
  baseDir: string
  currentAnchors: Set<string>
  lineStart: number
}): Promise<MarkdownLinkInfo> {
  const { cleanTarget, anchor } = splitTarget(options.target)
  if (!cleanTarget && anchor) {
    return {
      text: options.text,
      target: safeDecode(options.target),
      kind: 'anchor',
      anchor,
      anchorExists: options.currentAnchors.has(normalizeAnchor(anchor)),
      lineStart: options.lineStart,
    }
  }

  if (isExternalTarget(cleanTarget)) {
    return {
      text: options.text,
      target: safeDecode(options.target),
      kind: 'external',
      lineStart: options.lineStart,
    }
  }

  if (isUnsupportedTarget(cleanTarget)) {
    return {
      text: options.text,
      target: safeDecode(options.target),
      kind: 'unsupported',
      lineStart: options.lineStart,
    }
  }

  const resolvedPath = path.resolve(options.baseDir, safeDecode(cleanTarget))
  const exists = await pathExists(resolvedPath)
  const kind = /\.m(?:d|arkdown|down|kd|dx)$/i.test(resolvedPath) ? 'markdown' : 'local-resource'
  const link: MarkdownLinkInfo = {
    text: options.text,
    target: safeDecode(options.target),
    kind,
    exists,
    resolvedPath,
    ...(anchor ? { anchor } : {}),
    lineStart: options.lineStart,
  }

  if (exists && anchor && kind === 'markdown') {
    link.anchorExists = await targetFileHasAnchor(resolvedPath, anchor)
  }

  return link
}

async function targetFileHasAnchor(filePath: string, anchor: string): Promise<boolean> {
  try {
    const markdown = await readFile(filePath, 'utf8')
    const headings = extractHeadings(md.parse(markdown, {}))
    return headings.some(heading => heading.id === normalizeAnchor(anchor))
  } catch {
    return false
  }
}

function inlinePlainText(token: Token): string {
  return (token.children ?? [])
    .filter(child => child.type === 'text' || child.type === 'code_inline')
    .map(child => child.content)
    .join('')
    .trim()
}

function collectLinkText(children: Token[], startIndex: number): string {
  const parts: string[] = []
  for (let index = startIndex; index < children.length; index += 1) {
    const child = children[index]
    if (child.type === 'link_close') break
    if (child.type === 'text' || child.type === 'code_inline') {
      parts.push(child.content)
    }
  }
  return parts.join('').trim()
}

function normalizeFenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

function normalizeChartType(language: string): string | undefined {
  return chartLanguageAliases[language]
}

function classifyTarget(target: string, options: { image?: boolean } = {}): MarkdownImageInfo['kind'] {
  if (/^data:/i.test(target)) return 'data'
  if (isExternalTarget(target)) return 'external'
  if (isUnsupportedTarget(target)) return 'unsupported'
  return options.image ? 'local' : 'unsupported'
}

async function resolveLocalTarget(baseDir: string, target: string): Promise<{ path: string; exists: boolean } | null> {
  if (!target || isExternalTarget(target) || isUnsupportedTarget(target) || /^data:/i.test(target)) {
    return null
  }
  const cleanTarget = splitTarget(target).cleanTarget.trim().replace(/^<|>$/g, '')
  const resolvedPath = path.resolve(baseDir, safeDecode(cleanTarget))
  return {
    path: resolvedPath,
    exists: await pathExists(resolvedPath),
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function splitTarget(target: string): { cleanTarget: string; anchor?: string } {
  const hashIndex = target.indexOf('#')
  if (hashIndex < 0) return { cleanTarget: target.replace(/^<|>$/g, '') }
  const cleanTarget = target.slice(0, hashIndex).replace(/^<|>$/g, '')
  const anchor = safeDecode(target.slice(hashIndex + 1)).trim()
  return {
    cleanTarget,
    ...(anchor ? { anchor } : {}),
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeAnchor(anchor: string): string {
  return safeDecode(anchor).trim()
}

function isExternalTarget(target: string): boolean {
  return /^(?:https?:|mailto:)/i.test(target)
}

function isUnsupportedTarget(target: string): boolean {
  return /^(?:data:|file:|javascript:|local-image:)/i.test(target)
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'heading'
}

function uniqueSlugify(text: string, usedSlugs: Map<string, number>): string {
  const baseSlug = slugify(text)
  const count = usedSlugs.get(baseSlug) ?? 0
  usedSlugs.set(baseSlug, count + 1)
  return count > 0 ? `${baseSlug}-${count}` : baseSlug
}

function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  const latinWords = text.match(/[A-Za-z0-9_]+/g) ?? []
  const cjkChars = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []
  return latinWords.length + cjkChars.length
}
