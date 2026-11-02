import {
  AUDIO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  extensionOfResourcePath,
  isSafeLocalResourceReference,
  type LocalResourceResolutionKind,
} from '../localMedia'
import { findExcludedCodeRanges, scanMarkdownLinkDestinations } from './sourceLinks'
import { splitMarkdownTarget } from './semantics'

export interface LocalResourceDependency {
  ref: string
  resolutionKind: LocalResourceResolutionKind
}

const SPECIAL_RESOURCE_EXTENSIONS = new Set(['.bpmn', '.excalidraw'])
const REFRESHABLE_RESOURCE_EXTENSIONS = new Set([
  ...Object.keys(AUDIO_MIME_TYPES),
  ...Object.keys(VIDEO_MIME_TYPES),
  ...Object.keys(IMAGE_MIME_TYPES),
  ...SPECIAL_RESOURCE_EXTENSIONS,
  '.vtt',
])
const MEDIA_TAG_PATTERN = /<(video|audio|source|track)\b[^>]*>/gi

export function isRefreshableLocalResourcePath(filePath: string): boolean {
  return REFRESHABLE_RESOURCE_EXTENSIONS.has(extensionOfResourcePath(filePath))
}

export function markdownDependsOnLocalResource(
  source: string,
  markdownFilePath: string,
  workspaceRoot: string,
  changedPath: string,
): boolean {
  const normalizedMarkdownPath = normalizeAbsolutePath(markdownFilePath)
  const normalizedRoot = normalizeAbsolutePath(workspaceRoot)
  const normalizedChangedPath = normalizeAbsolutePath(changedPath)
  if (!normalizedMarkdownPath || !normalizedRoot || !normalizedChangedPath) return false

  return localResourceDependenciesContainPath(
    collectLocalResourceDependencies(source),
    normalizedMarkdownPath,
    normalizedRoot,
    normalizedChangedPath,
  )
}

export function localResourceDependenciesContainPath(
  dependencies: readonly LocalResourceDependency[],
  markdownFilePath: string,
  workspaceRoot: string,
  changedPath: string,
): boolean {
  const normalizedMarkdownPath = normalizeAbsolutePath(markdownFilePath)
  const normalizedRoot = normalizeAbsolutePath(workspaceRoot)
  const normalizedChangedPath = normalizeAbsolutePath(changedPath)
  if (!normalizedMarkdownPath || !normalizedRoot || !normalizedChangedPath) return false

  return dependencies.some(dependency => (
    dependencyMatchesPath(
      dependency,
      normalizedMarkdownPath,
      normalizedRoot,
      normalizedChangedPath,
    )
  ))
}

export function collectLocalResourceDependencies(source: string): LocalResourceDependency[] {
  const dependencies: LocalResourceDependency[] = []

  for (const link of scanMarkdownLinkDestinations(source)) {
    if (link.syntax === 'wiki') {
      const reference = link.wikiReference
      if (
        reference?.isEmbed
        && ['audio', 'video', 'image', 'special'].includes(reference.resourceKind)
      ) {
        dependencies.push({
          ref: reference.path,
          resolutionKind: 'workspace-wiki',
        })
      }
      continue
    }

    if (link.isImage && isRenderableImageReference(link.rawTarget)) {
      dependencies.push({
        ref: decodeMarkdownEscapes(link.rawTarget),
        resolutionKind: 'markdown-relative',
      })
    }
  }

  dependencies.push(...scanHtmlMediaDependencies(source))
  return deduplicateDependencies(dependencies)
}

function scanHtmlMediaDependencies(source: string): LocalResourceDependency[] {
  const dependencies: LocalResourceDependency[] = []
  const excludedRanges = [
    ...findExcludedCodeRanges(source),
    ...findHtmlCommentRanges(source),
  ]
  let match: RegExpExecArray | null

  while ((match = MEDIA_TAG_PATTERN.exec(source))) {
    if (isOffsetExcluded(match.index, excludedRanges)) continue
    const tagName = match[1].toLowerCase()
    const sourceRef = readHtmlAttribute(match[0], 'src')
    if (sourceRef && isRenderableMediaReference(sourceRef, tagName)) {
      dependencies.push({ ref: sourceRef, resolutionKind: 'markdown-relative' })
    }

    if (tagName === 'video') {
      const posterRef = readHtmlAttribute(match[0], 'poster')
      if (posterRef && isRenderableImageReference(posterRef)) {
        dependencies.push({ ref: posterRef, resolutionKind: 'markdown-relative' })
      }
    }
  }

  return dependencies
}

function dependencyMatchesPath(
  dependency: LocalResourceDependency,
  markdownFilePath: string,
  workspaceRoot: string,
  changedPath: string,
): boolean {
  const decodedRef = decodeResourcePath(dependency.ref)
  if (!decodedRef || !isSafeLocalResourceReference(decodedRef)) return false

  const localCandidate = resolveRelativePath(dirname(markdownFilePath), decodedRef)
  if (localCandidate && isPathInside(localCandidate, workspaceRoot) && samePath(localCandidate, changedPath)) {
    return true
  }
  if (dependency.resolutionKind !== 'workspace-wiki') return false

  const rootCandidate = resolveRelativePath(workspaceRoot, decodedRef)
  if (rootCandidate && isPathInside(rootCandidate, workspaceRoot) && samePath(rootCandidate, changedPath)) {
    return true
  }

  return !/[\\/]/.test(decodedRef) && samePath(basename(changedPath), decodedRef)
}

function decodeMarkdownEscapes(ref: string): string {
  return ref.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
}

function decodeResourcePath(ref: string): string | null {
  const rawPath = splitMarkdownTarget(ref).rawPath
  if (!rawPath) return null
  try {
    return decodeURIComponent(rawPath).trim()
  } catch {
    return null
  }
}

function isRenderableImageReference(ref: string): boolean {
  const extension = extensionOfDecodedReference(ref)
  return Object.hasOwn(IMAGE_MIME_TYPES, extension) || SPECIAL_RESOURCE_EXTENSIONS.has(extension)
}

function isRenderableMediaReference(ref: string, tagName: string): boolean {
  const extension = extensionOfDecodedReference(ref)
  if (tagName === 'track') return extension === '.vtt'
  if (tagName === 'video') return Object.hasOwn(VIDEO_MIME_TYPES, extension)
  if (tagName === 'audio') return Object.hasOwn(AUDIO_MIME_TYPES, extension)
  return Object.hasOwn(VIDEO_MIME_TYPES, extension) || Object.hasOwn(AUDIO_MIME_TYPES, extension)
}

function extensionOfDecodedReference(ref: string): string {
  const decoded = decodeResourcePath(ref)
  return decoded ? extensionOfResourcePath(decoded) : ''
}

function readHtmlAttribute(tag: string, attribute: string): string | null {
  const match = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim() || null
}

function deduplicateDependencies(dependencies: LocalResourceDependency[]): LocalResourceDependency[] {
  const seen = new Set<string>()
  return dependencies.filter(dependency => {
    const key = `${dependency.resolutionKind}\0${dependency.ref}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function findHtmlCommentRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const pattern = /<!--[\s\S]*?(?:-->|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) ranges.push([match.index, match.index + match[0].length])
  return ranges
}

function isOffsetExcluded(offset: number, ranges: readonly [number, number][]): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end)
}

function normalizeAbsolutePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/')
  const driveMatch = normalized.match(/^([a-z]):\//i)
  const isUnc = normalized.startsWith('//')
  if (!driveMatch && !isUnc && !normalized.startsWith('/')) return null

  const prefix = driveMatch ? `${driveMatch[1].toLowerCase()}:/` : isUnc ? '//' : '/'
  const remainder = driveMatch
    ? normalized.slice(3)
    : normalized.slice(isUnc ? 2 : 1)
  const segments: string[] = []
  for (const segment of remainder.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return `${prefix}${segments.join('/')}`
}

function resolveRelativePath(basePath: string, relativePath: string): string | null {
  return normalizeAbsolutePath(`${basePath}/${relativePath}`)
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/')
  return index <= 0 ? filePath.slice(0, index + 1) : filePath.slice(0, index)
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1)
}

function isPathInside(filePath: string, rootPath: string): boolean {
  const root = rootPath.replace(/\/$/, '')
  return samePath(filePath, root) || pathStartsWith(filePath, `${root}/`)
}

function samePath(left: string, right: string): boolean {
  return isWindowsPath(left) || isWindowsPath(right)
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function pathStartsWith(value: string, prefix: string): boolean {
  return isWindowsPath(value) || isWindowsPath(prefix)
    ? value.toLowerCase().startsWith(prefix.toLowerCase())
    : value.startsWith(prefix)
}

function isWindowsPath(value: string): boolean {
  return /^[a-z]:\//i.test(value) || value.startsWith('//')
}
