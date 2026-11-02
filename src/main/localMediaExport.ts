import path from 'node:path'
import { realpath } from 'node:fs/promises'
import {
  IMAGE_MIME_TYPES,
  LOCAL_MEDIA_MARKER_ATTRIBUTE,
  MAX_LOCAL_MEDIA_DIMENSION,
  MAX_LOCAL_MEDIA_SOURCES,
  MAX_LOCAL_MEDIA_TRACKS,
  decodeLocalResourceMarker,
  encodeLocalResourceMarker,
  isSafeLocalResourceReference,
  localMediaMimeType,
  parseLocalMediaReference,
  type CanonicalLocalMediaMarker,
  type LocalResourceResolutionKind,
} from '../shared/localMedia'
import { findExcludedCodeRanges, scanMarkdownLinkDestinations } from '../shared/markdown/sourceLinks'

export type LocalMediaExportMode = 'linked-html' | 'pdf-static' | 'docx-link'

export interface LocalMediaExportResolver {
  (
    ref: string,
    resolutionKind: LocalResourceResolutionKind,
    mediaKind: 'audio' | 'video',
  ): Promise<string>
}

export interface LocalMediaExportResult {
  html: string
  warnings: string[]
  linkedMedia: number
}

export interface LocalMediaExportImage {
  canonicalPath: string
  mimeType: string
  base64?: string
}

export type LocalMediaExportImageResolver = (
  ref: string,
  resolutionKind: LocalResourceResolutionKind,
) => Promise<LocalMediaExportImage>

export async function materializeLocalMediaForExport(options: {
  html: string
  outputPath: string
  mode: LocalMediaExportMode
  resolveMedia: LocalMediaExportResolver
  resolveTrack?: (ref: string, resolutionKind: LocalResourceResolutionKind) => Promise<string>
  resolvePoster?: LocalMediaExportImageResolver
}): Promise<LocalMediaExportResult> {
  const warnings: string[] = []
  const outputPath = await canonicalizeExportPath(options.outputPath)
  let linkedMedia = 0
  const markerPattern = new RegExp(
    `<span\\b(?=[^>]*\\bclass=(?:"[^"]*\\blocal-media-placeholder\\b[^"]*"|'[^']*\\blocal-media-placeholder\\b[^']*'))(?=[^>]*\\b${LOCAL_MEDIA_MARKER_ATTRIBUTE}=(?:"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'))[^>]*><\\/span>`,
    'gi',
  )

  let cursor = 0
  let result = ''
  let match: RegExpExecArray | null
  while ((match = markerPattern.exec(options.html))) {
    result += options.html.slice(cursor, match.index)
    cursor = match.index + match[0].length
    const marker = decodeLocalResourceMarker<CanonicalLocalMediaMarker>(match[1] || match[2] || '')
    if (!isValidMarker(marker)) {
      result += fallbackCard('本地媒体', '媒体引用无效')
      warnings.push('LOCAL_MEDIA_INVALID')
      continue
    }

    const firstSource = marker.sources[0]
    if (!firstSource) {
      result += fallbackCard(marker.label || '本地媒体', '没有可用媒体源')
      warnings.push('LOCAL_MEDIA_UNAVAILABLE')
      continue
    }

    const resolvedSources: Array<{ source: CanonicalLocalMediaMarker['sources'][number], relativeUrl: string }> = []
    let hadCrossVolumeSource = false
    for (const source of marker.sources) {
      try {
        const canonicalPath = await options.resolveMedia(source.ref, marker.resolutionKind, marker.kind)
        const relativeUrl = relativeFileUrl(outputPath, canonicalPath)
        if (relativeUrl) {
          resolvedSources.push({ source, relativeUrl })
        } else {
          hadCrossVolumeSource = true
        }
      } catch {
        // A failed fallback source must not prevent another valid source from being exported.
      }
    }

    if (resolvedSources.length === 0) {
      const reason = hadCrossVolumeSource
        ? '媒体与导出文件不在同一磁盘卷'
        : '本地媒体不可用'
      result += fallbackCard(marker.label || firstSource.ref, reason)
      warnings.push(hadCrossVolumeSource ? 'LOCAL_MEDIA_CROSS_VOLUME' : 'LOCAL_MEDIA_UNAVAILABLE')
      continue
    }

    if (options.mode === 'linked-html') {
      const tag = marker.kind
      const poster = tag === 'video'
        ? await materializePoster(options, marker, outputPath, 'linked-html', warnings)
        : null
      const dimensions = marker.dimensions
        ? ` width="${marker.dimensions.width}"${marker.dimensions.height ? ` height="${marker.dimensions.height}"` : ''}`
        : ''
      const sources = resolvedSources.map(({ source, relativeUrl }) => {
        const timeFragment = source.time ? `#${source.time.normalized}` : ''
        return `<source src="${escapeHtml(relativeUrl + timeFragment)}" type="${escapeHtml(source.mimeType)}">`
      }).join('')
      const tracks = await materializeTracks({ ...options, outputPath }, marker, warnings)
      result += `<${tag} controls preload="metadata"${tag === 'video' ? ' playsinline' : ''}${poster ? ` poster="${escapeHtml(poster)}"` : ''}${dimensions}>${sources}${tracks}</${tag}>`
      linkedMedia += 1
      warnings.push('LOCAL_MEDIA_LINKED')
      if (hadCrossVolumeSource || resolvedSources.length < marker.sources.length) {
        warnings.push('LOCAL_MEDIA_SOURCE_OMITTED')
      }
    } else {
      const label = marker.label || firstSource.ref
      const relativeUrl = resolvedSources[0].relativeUrl
      if (options.mode === 'docx-link') {
        result += `<p class="local-media-export-card">${escapeHtml(marker.kind === 'video' ? '视频' : '音频')}：<a href="${escapeHtml(relativeUrl)}">${escapeHtml(label)}</a></p>`
      } else {
        const poster = marker.kind === 'video'
          ? await materializePoster(options, marker, outputPath, 'pdf-static', warnings)
          : null
        result += poster
          ? `<figure class="local-media-export-poster"><img src="${escapeHtml(poster)}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}（视频未嵌入 PDF）</figcaption></figure>`
          : fallbackCard(label, marker.kind === 'video' ? '视频未嵌入 PDF' : '音频未嵌入 PDF')
      }
      warnings.push('LOCAL_MEDIA_STATIC_FALLBACK')
    }
  }
  result += options.html.slice(cursor)
  return { html: result, warnings: [...new Set(warnings)], linkedMedia }
}

async function materializePoster(
  options: { resolvePoster?: LocalMediaExportImageResolver },
  marker: CanonicalLocalMediaMarker,
  outputPath: string,
  mode: 'linked-html' | 'pdf-static',
  warnings: string[],
): Promise<string | null> {
  if (!marker.poster || !options.resolvePoster) return null
  try {
    const poster = await options.resolvePoster(marker.poster, marker.resolutionKind)
    if (mode === 'pdf-static') {
      if (!poster.base64) throw new Error('海报图片未提供内嵌数据')
      return `data:${poster.mimeType};base64,${poster.base64}`
    }
    const relativeUrl = relativeFileUrl(outputPath, poster.canonicalPath)
    if (!relativeUrl) throw new Error('海报图片与导出文件不在同一磁盘卷')
    return relativeUrl
  } catch {
    warnings.push('LOCAL_MEDIA_POSTER_OMITTED')
    return null
  }
}

export interface LocalMediaDocxMarkdownResult {
  markdown: string
  warnings: string[]
  linkedMedia: number
}

export async function materializeLocalMediaForDocxMarkdown(options: {
  markdown: string
  outputPath: string
  resolveMedia: LocalMediaExportResolver
}): Promise<LocalMediaDocxMarkdownResult> {
  const warnings: string[] = []
  const outputPath = await canonicalizeExportPath(options.outputPath)
  const replacements: Array<{ start: number, end: number, value: string }> = []
  let linkedMedia = 0

  for (const link of scanMarkdownLinkDestinations(options.markdown)) {
    const wiki = link.wikiReference
    if (
      link.syntax !== 'wiki'
      || !wiki?.isEmbed
      || (wiki.resourceKind !== 'audio' && wiki.resourceKind !== 'video')
    ) continue
    const parsed = parseLocalMediaReference(wiki.rawTarget)
    const kind = wiki.resourceKind
    if (!parsed || !localMediaMimeType(parsed.path, kind)) continue
    const replacement = await docxMediaLink(
      { ...options, outputPath },
      parsed.path,
      kind,
      'workspace-wiki',
      wiki.displayText,
      warnings,
    )
    replacements.push({
      start: link.sourceRange.startOffset,
      end: link.sourceRange.endOffset,
      value: replacement,
    })
    if (!replacement.startsWith('[' + localMediaLabel(kind) + '不可用')) linkedMedia += 1
  }

  const excludedRanges = findExcludedCodeRanges(options.markdown)
  const mediaPattern = /<(video|audio)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi
  let match: RegExpExecArray | null
  while ((match = mediaPattern.exec(options.markdown))) {
    if (excludedRanges.some(([start, end]) => match!.index >= start && match!.index < end)) continue
    const kind = match[1].toLowerCase() as 'audio' | 'video'
    const openingSource = htmlAttribute(match[2], 'src')
    const nestedSource = match[3].match(/<source\b([^>]*)>/i)
    const rawSource = openingSource || (nestedSource ? htmlAttribute(nestedSource[1], 'src') : null)
    const parsed = rawSource ? parseLocalMediaReference(rawSource) : null
    const label = htmlAttribute(match[2], 'aria-label') || htmlAttribute(match[2], 'title') || parsed?.path || '本地媒体'
    const replacement = parsed && localMediaMimeType(parsed.path, kind)
      ? await docxMediaLink(
          { ...options, outputPath },
          parsed.path,
          kind,
          'markdown-relative',
          label,
          warnings,
        )
      : `[${localMediaLabel(kind)}不可用：${escapeMarkdownLabel(label)}]`
    replacements.push({ start: match.index, end: match.index + match[0].length, value: replacement })
    if (parsed && !replacement.startsWith('[' + localMediaLabel(kind) + '不可用')) linkedMedia += 1
  }

  let markdown = options.markdown
  let previousStart = markdown.length + 1
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    if (replacement.end > previousStart) continue
    markdown = `${markdown.slice(0, replacement.start)}${replacement.value}${markdown.slice(replacement.end)}`
    previousStart = replacement.start
  }
  return { markdown, warnings: [...new Set(warnings)], linkedMedia }
}

async function docxMediaLink(
  options: {
    outputPath: string
    resolveMedia: LocalMediaExportResolver
  },
  ref: string,
  kind: 'audio' | 'video',
  resolutionKind: LocalResourceResolutionKind,
  label: string,
  warnings: string[],
): Promise<string> {
  try {
    const canonicalPath = await options.resolveMedia(ref, resolutionKind, kind)
    const relativeUrl = relativeFileUrl(options.outputPath, canonicalPath)
    if (!relativeUrl) {
      warnings.push('LOCAL_MEDIA_CROSS_VOLUME')
      return `[${localMediaLabel(kind)}不可用：${escapeMarkdownLabel(label)}]`
    }
    warnings.push('LOCAL_MEDIA_STATIC_FALLBACK')
    return `[${localMediaLabel(kind)}：${escapeMarkdownLabel(label)}](${relativeUrl})`
  } catch {
    warnings.push('LOCAL_MEDIA_UNAVAILABLE')
    return `[${localMediaLabel(kind)}不可用：${escapeMarkdownLabel(label)}]`
  }
}

function localMediaLabel(kind: 'audio' | 'video'): '音频' | '视频' {
  return kind === 'video' ? '视频' : '音频'
}

function htmlAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  if (!match) return null
  return decodeHtmlAttribute(match[1] ?? match[2] ?? '')
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\\]]/g, '\\$&').replace(/[\r\n]+/g, ' ').slice(0, 200)
}

async function materializeTracks(
  options: {
    outputPath: string
    resolveTrack?: (ref: string, resolutionKind: LocalResourceResolutionKind) => Promise<string>
  },
  marker: CanonicalLocalMediaMarker,
  warnings: string[],
): Promise<string> {
  if (marker.tracks.length === 0) return ''
  if (!options.resolveTrack) {
    warnings.push('LOCAL_MEDIA_TRACK_OMITTED')
    return ''
  }

  const tracks: string[] = []
  for (const track of marker.tracks) {
    try {
      const canonicalPath = await options.resolveTrack(track.ref, marker.resolutionKind)
      const relativeUrl = relativeFileUrl(options.outputPath, canonicalPath)
      if (!relativeUrl) {
        warnings.push('LOCAL_MEDIA_TRACK_OMITTED')
        continue
      }
      const srclang = track.srclang ? ` srclang="${escapeHtml(track.srclang)}"` : ''
      const label = track.label ? ` label="${escapeHtml(track.label)}"` : ''
      tracks.push(`<track src="${escapeHtml(relativeUrl)}" kind="${escapeHtml(track.kind)}"${srclang}${label}${track.default ? ' default' : ''}>`)
    } catch {
      warnings.push('LOCAL_MEDIA_TRACK_OMITTED')
    }
  }
  return tracks.join('')
}

function isValidMarker(value: CanonicalLocalMediaMarker | null): value is CanonicalLocalMediaMarker {
  return Boolean(
    value
    && value.version === 1
    && (value.kind === 'audio' || value.kind === 'video')
    && (value.resolutionKind === 'markdown-relative' || value.resolutionKind === 'workspace-wiki')
    && (value.label === undefined || (typeof value.label === 'string' && value.label.length <= 200))
    && (!value.dimensions || (
      Number.isInteger(value.dimensions.width)
      && value.dimensions.width >= 1
      && value.dimensions.width <= MAX_LOCAL_MEDIA_DIMENSION
      && (value.dimensions.height === undefined || (
        Number.isInteger(value.dimensions.height)
        && value.dimensions.height >= 1
        && value.dimensions.height <= MAX_LOCAL_MEDIA_DIMENSION
      ))
    ))
    && Array.isArray(value.sources)
    && value.sources.length <= MAX_LOCAL_MEDIA_SOURCES
    && value.sources.every(source => (
      Boolean(source)
      && typeof source.ref === 'string'
      && typeof source.mimeType === 'string'
      && isSafeLocalResourceReference(source.ref)
      && localMediaMimeType(source.ref, value.kind) === source.mimeType
    ))
    && Array.isArray(value.tracks)
    && value.tracks.length <= MAX_LOCAL_MEDIA_TRACKS
    && value.tracks.every(track => (
      Boolean(track)
      && typeof track.ref === 'string'
      && typeof track.kind === 'string'
      && isSafeLocalResourceReference(track.ref)
      && path.extname(track.ref).toLowerCase() === '.vtt'
      && ['subtitles', 'captions', 'descriptions', 'chapters'].includes(track.kind)
    ))
    && (!value.poster || (
      typeof value.poster === 'string'
      && isSafeLocalResourceReference(value.poster)
      && Boolean(IMAGE_MIME_TYPES[path.extname(value.poster).toLowerCase()])
    ))
  )
}

async function canonicalizeExportPath(outputPath: string): Promise<string> {
  try {
    const directory = await realpath(path.dirname(outputPath))
    return path.join(directory, path.basename(outputPath))
  } catch {
    return outputPath
  }
}

function relativeFileUrl(outputPath: string, targetPath: string): string | null {
  const relative = path.relative(path.dirname(outputPath), targetPath)
  if (!relative || path.isAbsolute(relative)) return relative ? null : `./${encodeURIComponent(path.basename(targetPath))}`
  const normalized = relative.split(path.sep).map(segment => encodeURIComponent(segment)).join('/')
  return normalized.startsWith('.') ? normalized : `./${normalized}`
}

function fallbackCard(label: string, reason: string): string {
  return `<p class="local-media-export-card">${escapeHtml(reason)}：${escapeHtml(label)}</p>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
}

export function encodeMediaExportMarker(marker: CanonicalLocalMediaMarker): string {
  return encodeLocalResourceMarker(marker)
}
