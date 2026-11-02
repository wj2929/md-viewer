import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { readFile, stat } from 'fs/promises'
import path from 'path'
import { escape, glob } from 'glob'
import { inspectMarkdownBlock } from '../../shared/markdown/blocks'
import { isBareWikiDocumentName } from '../../shared/markdown/wikiDocumentNames'
import { scanMarkdownLinkDestinations } from '../../shared/markdown/sourceLinks'
import type { ParsedWikiReference } from '../../shared/markdown/obsidianSyntax'
import { isSafeLocalResourceReference, MARKDOWN_EXTENSIONS } from '../../shared/localMedia'
import {
  classifyMarkdownTarget,
  createHeadingIdAllocator,
  extractPlainHeadingText,
  markdownAnchorMatches,
  safeDecodeURIComponent,
  splitMarkdownTarget,
} from '../../shared/markdown/semantics'

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
  svg: 'svg',
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
  ambiguous?: boolean
  checkStatus?: 'alias-not-checked'
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
  const wikiReferences = scanMarkdownLinkDestinations(markdown)
    .filter(link => link.syntax === 'wiki' && link.wikiReference)
  const images = await extractImages(tokens, baseDir)
  const links = await extractLinks(tokens, filePath, headings)
  for (const link of wikiReferences) {
    const reference = link.wikiReference!
    if (reference.isEmbed && reference.resourceKind === 'image') {
      images.push(await inspectWikiImage(reference, baseDir, link.sourceRange.startLine))
    } else {
      links.push(await inspectWikiLink(reference, baseDir, headings, link.sourceRange.startLine))
    }
  }

  const blockSources = new Map<string, string>([[filePath, markdown]])
  for (const link of links) {
    if (!link.anchor?.startsWith('^')) continue
    const targetPath = link.kind === 'anchor' ? filePath : link.exists ? link.resolvedPath : undefined
    if (!targetPath) continue
    let source = blockSources.get(targetPath)
    if (source === undefined) {
      try { source = await readFile(targetPath, 'utf8'); blockSources.set(targetPath, source) }
      catch { continue }
    }
    const block = inspectMarkdownBlock(source, link.anchor.slice(1))
    link.anchorExists = block === 'found'
    if (block === 'ambiguous') link.ambiguous = true
  }

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
  const allocateHeadingId = createHeadingIdAllocator()
  const headings: MarkdownHeadingInfo[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open') continue
    const inlineToken = tokens[index + 1]
    if (!inlineToken || inlineToken.type !== 'inline') continue
    const text = extractPlainHeadingText(inlineToken.children)
    headings.push({
      level: Number(token.tag.slice(1)) || 1,
      text,
      id: allocateHeadingId(text),
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
  const splitTarget = splitMarkdownTarget(options.target)
  const cleanTarget = splitTarget.decodedPath
  const anchor = splitTarget.anchor
  if (!cleanTarget && anchor) {
    return {
      text: options.text,
      target: safeDecodeURIComponent(options.target),
      kind: 'anchor',
      anchor,
      anchorExists: Array.from(options.currentAnchors).some(candidate => markdownAnchorMatches(candidate, anchor)),
      lineStart: options.lineStart,
    }
  }

  const targetKind = classifyMarkdownTarget(options.target)
  if (targetKind === 'external') {
    return {
      text: options.text,
      target: safeDecodeURIComponent(options.target),
      kind: 'external',
      lineStart: options.lineStart,
    }
  }

  if (targetKind === 'unsupported' || targetKind === 'data') {
    return {
      text: options.text,
      target: safeDecodeURIComponent(options.target),
      kind: 'unsupported',
      lineStart: options.lineStart,
    }
  }

  const resolvedPath = path.resolve(options.baseDir, cleanTarget)
  const exists = await pathExists(resolvedPath)
  const kind = targetKind === 'markdown' ? 'markdown' : 'local-resource'
  const link: MarkdownLinkInfo = {
    text: options.text,
    target: safeDecodeURIComponent(options.target),
    kind,
    exists,
    resolvedPath,
    ...(anchor ? { anchor } : {}),
    lineStart: options.lineStart,
  }

  if (exists && anchor && !anchor.startsWith('^') && kind === 'markdown') {
    link.anchorExists = await targetFileHasAnchor(resolvedPath, anchor)
  }

  return link
}

async function inspectWikiImage(
  reference: ParsedWikiReference,
  rootDir: string,
  lineStart: number,
): Promise<MarkdownImageInfo> {
  const resolved = await resolveCliWikiTarget(rootDir, reference.path, reference.resourceKind)
  return {
    alt: reference.displayText,
    target: reference.rawTarget,
    kind: 'local',
    exists: resolved.exists,
    ...(resolved.path ? { resolvedPath: resolved.path } : {}),
    lineStart,
  }
}

async function inspectWikiLink(
  reference: ParsedWikiReference,
  rootDir: string,
  currentHeadings: MarkdownHeadingInfo[],
  lineStart: number,
): Promise<MarkdownLinkInfo> {
  const anchor = reference.fragment
  if (!reference.path && anchor) {
    return {
      text: reference.displayText,
      target: reference.rawTarget,
      kind: 'anchor',
      anchor,
      ...(reference.fragmentKind === 'heading'
        ? { anchorExists: currentHeadings.some(heading => markdownAnchorMatches(heading.id, anchor)) }
        : {}),
      lineStart,
    }
  }

  let bareName = false
  try { bareName = !reference.isEmbed && isBareWikiDocumentName(decodeURIComponent(reference.path).trim()) } catch { /* Invalid encoding is not an unchecked alias. */ }
  const resolved = await resolveCliWikiTarget(rootDir, reference.path, reference.resourceKind, bareName)
  const kind = reference.resourceKind === 'markdown' || (bareName && (!resolved.path || MARKDOWN_EXTENSIONS.has(path.extname(resolved.path).toLowerCase())))
    ? 'markdown' : 'local-resource'
  const link: MarkdownLinkInfo = {
    text: reference.displayText,
    target: reference.rawTarget,
    kind,
    ...(bareName && !resolved.exists && !resolved.ambiguous ? { checkStatus: 'alias-not-checked' as const } : { exists: resolved.exists }),
    ...(resolved.path ? { resolvedPath: resolved.path } : {}),
    ...(resolved.ambiguous ? { ambiguous: true } : {}),
    ...(anchor ? { anchor } : {}),
    lineStart,
  }
  if (
    resolved.exists
    && resolved.path
    && kind === 'markdown'
    && anchor
    && reference.fragmentKind === 'heading'
  ) {
    link.anchorExists = await targetFileHasAnchor(resolved.path, anchor)
  }
  return link
}

async function resolveCliWikiTarget(
  rootDir: string,
  rawPath: string,
  resourceKind: ParsedWikiReference['resourceKind'],
  bareDocumentName = false,
): Promise<{ path?: string, exists: boolean, ambiguous: boolean }> {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(rawPath).trim()
  } catch {
    return { exists: false, ambiguous: false }
  }
  if (!isSafeLocalResourceReference(decodedPath)) return { exists: false, ambiguous: false }

  const extension = path.extname(decodedPath).toLowerCase()
  if (bareDocumentName && extension) {
    const resource = await resolveCliWikiTarget(rootDir, rawPath, 'attachment')
    if (resource.exists || resource.ambiguous) return resource
  }
  const names = bareDocumentName || (resourceKind === 'markdown' && !extension)
    ? [...MARKDOWN_EXTENSIONS].map(candidate => `${decodedPath}${candidate}`)
    : [decodedPath]
  if (decodedPath.includes('/') || decodedPath.includes('\\')) {
    for (const name of names) {
      const candidate = path.resolve(rootDir, name)
      if (await pathExists(candidate)) return { path: candidate, exists: true, ambiguous: false }
    }
    return { path: path.resolve(rootDir, names[0]), exists: false, ambiguous: false }
  }

  for (const name of names) {
    const nearby = path.resolve(rootDir, name)
    if (await pathExists(nearby)) return { path: nearby, exists: true, ambiguous: false }
  }

  const patterns = names.map(name => `**/${escape(path.basename(name))}`)
  const matches = await glob(patterns, {
    cwd: rootDir,
    absolute: true,
    nodir: true,
    nocase: process.platform === 'win32',
    ignore: ['**/.git/**', '**/.claude/**', '**/node_modules/**'],
  })
  const unique = [...new Set(matches)]
  if (unique.length === 1) return { path: unique[0], exists: true, ambiguous: false }
  return { exists: false, ambiguous: unique.length > 1 }
}

async function targetFileHasAnchor(filePath: string, anchor: string): Promise<boolean> {
  try {
    const markdown = await readFile(filePath, 'utf8')
    const headings = extractHeadings(md.parse(markdown, {}))
    return headings.some(heading => markdownAnchorMatches(heading.id, anchor))
  } catch {
    return false
  }
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
  const targetKind = classifyMarkdownTarget(target)
  if (targetKind === 'data') return 'data'
  if (targetKind === 'external') return 'external'
  if (targetKind === 'unsupported') return 'unsupported'
  return options.image ? 'local' : 'unsupported'
}

async function resolveLocalTarget(baseDir: string, target: string): Promise<{ path: string; exists: boolean } | null> {
  const targetKind = classifyMarkdownTarget(target)
  if (targetKind === 'external' || targetKind === 'unsupported' || targetKind === 'data') {
    return null
  }
  const cleanTarget = splitMarkdownTarget(target).decodedPath
  const resolvedPath = path.resolve(baseDir, cleanTarget)
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

function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  const latinWords = text.match(/[A-Za-z0-9_]+/g) ?? []
  const cjkChars = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []
  return latinWords.length + cjkChars.length
}
