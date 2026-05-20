import type { RendererRegistry, RendererSourceKind, RendererType } from './types'

export interface CreateRenderSourceLocatorInput {
  rendererType: RendererType
  sourceKind: RendererSourceKind
  canonicalLanguage: string
  sourceIndex: number
  startOffset: number
  endOffset: number
  source: string
  resolvedPath?: string
}

export interface RenderSourceLocator {
  blockId: string
  sourceKind: RendererSourceKind
  rendererType: RendererType
  canonicalLanguage: string
  sourceIndex: number
  startOffset: number
  endOffset: number
  sourceHash: string
  resolvedPath?: string
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase()
}

export function createRenderSourceLocator(input: CreateRenderSourceLocatorInput): RenderSourceLocator {
  const canonicalLanguage = normalizeLanguage(input.canonicalLanguage)
  const normalizedPath = input.resolvedPath?.replace(/\\/g, '/')
  const sourceHash = stableHash(input.source)
  const identityParts = [
    input.rendererType,
    input.sourceKind,
    canonicalLanguage,
    String(input.startOffset),
    String(input.endOffset),
    sourceHash,
    normalizedPath ?? '',
  ]
  const identityHash = stableHash(identityParts.join('\n'))

  return {
    blockId: `mdv-${input.rendererType}-${identityHash}`,
    sourceKind: input.sourceKind,
    rendererType: input.rendererType,
    canonicalLanguage,
    sourceIndex: input.sourceIndex,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    sourceHash,
    ...(normalizedPath ? { resolvedPath: normalizedPath } : {}),
  }
}

const FENCED_BLOCK_RE = /^(```|~~~)(?<language>[\w-]+)\b[^\n]*\n(?<source>[\s\S]*?)^\1\s*$/gim
const IMAGE_REF_RE = /!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g

interface LocatorCandidate {
  rendererType: RendererType
  sourceKind: RendererSourceKind
  canonicalLanguage: string
  startOffset: number
  endOffset: number
  source: string
  resolvedPath?: string
}

function cleanMarkdownRefPath(refPath: string): string {
  return refPath.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0].replace(/\\/g, '/') || refPath
}

function isInsideRanges(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some(range => index >= range.start && index < range.end)
}

function fileExtension(refPath: string): string | null {
  const match = cleanMarkdownRefPath(refPath).match(/\.([a-z0-9]+)$/i)
  return match?.[1]?.toLowerCase() ?? null
}

export function collectFencedRenderSourceLocators(
  markdown: string,
  registry: RendererRegistry,
): RenderSourceLocator[] {
  const candidates: LocatorCandidate[] = []
  const fencedRanges: Array<{ start: number; end: number }> = []
  const sourceIndexes = new Map<RendererType, number>()

  for (const match of markdown.matchAll(FENCED_BLOCK_RE)) {
    const language = match.groups?.language || ''
    const source = match.groups?.source || ''
    const startOffset = match.index || 0
    const endOffset = startOffset + match[0].length
    fencedRanges.push({ start: startOffset, end: endOffset })

    const renderer = registry.resolveLanguage(language)
    if (!renderer?.sourceKinds.includes('fence')) continue

    candidates.push({
      rendererType: renderer.type,
      sourceKind: 'fence',
      canonicalLanguage: renderer.languages[0] || renderer.type,
      startOffset,
      endOffset,
      source,
    })
  }

  const fileExtensionRenderers = new Map<string, LocatorCandidate['rendererType']>()
  const canonicalLanguages = new Map<RendererType, string>()
  for (const renderer of registry.definitions) {
    canonicalLanguages.set(renderer.type, renderer.languages[0] || renderer.type)
    for (const extension of renderer.replacement.fileExtensions || []) {
      fileExtensionRenderers.set(extension.toLowerCase(), renderer.type)
    }
  }

  let imageMatch: RegExpExecArray | null
  const imageRe = new RegExp(IMAGE_REF_RE.source, IMAGE_REF_RE.flags)
  while ((imageMatch = imageRe.exec(markdown)) !== null) {
    if (isInsideRanges(imageMatch.index, fencedRanges)) continue

    const refPath = imageMatch[2] || imageMatch[3] || ''
    const extension = fileExtension(refPath)
    if (!extension) continue

    const rendererType = fileExtensionRenderers.get(extension)
    if (!rendererType) continue

    const startOffset = imageMatch.index
    const endOffset = imageMatch.index + imageMatch[0].length
    const cleanRefPath = cleanMarkdownRefPath(refPath)
    candidates.push({
      rendererType,
      sourceKind: 'imageRef',
      canonicalLanguage: canonicalLanguages.get(rendererType) || rendererType,
      startOffset,
      endOffset,
      source: imageMatch[0],
      resolvedPath: cleanRefPath,
    })
  }

  return candidates
    .sort((a, b) => a.startOffset - b.startOffset)
    .map(candidate => {
      const sourceIndex = sourceIndexes.get(candidate.rendererType) || 0
      sourceIndexes.set(candidate.rendererType, sourceIndex + 1)
      return createRenderSourceLocator({
        ...candidate,
        sourceIndex,
      })
    })
}

export const collectRenderSourceLocators = collectFencedRenderSourceLocators
