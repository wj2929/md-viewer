import {
  IMAGE_MIME_TYPES,
  MAX_LOCAL_MEDIA_DIMENSION,
  MAX_LOCAL_MEDIA_SOURCES,
  MAX_LOCAL_MEDIA_TRACKS,
  LOCAL_IMAGE_MARKER_ATTRIBUTE,
  LOCAL_MEDIA_MARKER_ATTRIBUTE,
  WIKI_LINK_MARKER_ATTRIBUTE,
  encodeLocalResourceMarker,
  decodeLocalResourceMarker,
  extensionOfResourcePath,
  isSafeLocalResourceReference,
  localMediaMimeType,
  parseLocalMediaReference,
  type CanonicalLocalImageMarker,
  type CanonicalLocalMediaMarker,
  type CanonicalLocalMediaSource,
  type CanonicalLocalMediaTrack,
  type LocalMediaKind,
} from '../../../shared/localMedia'
import type { ParsedWikiReference } from '../../../shared/markdown/obsidianSyntax'

export function wikiMediaPlaceholderHtml(reference: ParsedWikiReference): string {
  const kind = reference.resourceKind === 'audio' ? 'audio' : 'video'
  const parsed = parseLocalMediaReference(reference.rawTarget)
  const mimeType = parsed ? localMediaMimeType(parsed.path, kind) : null
  const marker: CanonicalLocalMediaMarker = {
    version: 1,
    kind,
    resolutionKind: 'workspace-wiki',
    sources: parsed && mimeType
      ? [{ ref: parsed.path, mimeType, ...(parsed.time ? { time: parsed.time } : {}) }]
      : [],
    tracks: [],
    label: reference.displayText,
    ...(reference.dimensions ? { dimensions: reference.dimensions } : {}),
    controls: true,
    muted: false,
    playsInline: kind === 'video',
    preload: 'metadata',
    fullWidth: kind === 'video' && !reference.dimensions,
  }
  return `<span class="local-media-placeholder" ${LOCAL_MEDIA_MARKER_ATTRIBUTE}="${encodeLocalResourceMarker(marker)}"></span>`
}

export function wikiImagePlaceholderHtml(reference: ParsedWikiReference): string {
  const marker: CanonicalLocalImageMarker = {
    version: 1,
    resolutionKind: 'workspace-wiki',
    ref: reference.path,
    alt: reference.displayText,
    ...(reference.dimensions ? { dimensions: reference.dimensions } : {}),
  }
  return `<img alt="" ${LOCAL_IMAGE_MARKER_ATTRIBUTE}="${encodeLocalResourceMarker(marker)}">`
}

export function canonicalizeLocalMediaMarkup(html: string): string {
  if (typeof document === 'undefined') return html
  const template = document.createElement('template')
  template.innerHTML = html

  for (const media of Array.from(template.content.querySelectorAll<HTMLMediaElement>('video, audio'))) {
    const kind: LocalMediaKind = media.tagName.toLowerCase() === 'audio' ? 'audio' : 'video'
    const sources = collectSources(media, kind)
    const marker: CanonicalLocalMediaMarker = {
      version: 1,
      kind,
      resolutionKind: 'markdown-relative',
      sources,
      tracks: collectTracks(media),
      ...collectPoster(media),
      ...collectLabel(media),
      ...collectDimensions(media),
      controls: media.hasAttribute('controls'),
      muted: media.hasAttribute('muted'),
      playsInline: kind === 'video' && media.hasAttribute('playsinline'),
      preload: media.getAttribute('preload') === 'none' ? 'none' : 'metadata',
      fullWidth: hasFullWidthStyle(media.getAttribute('style')),
    }
    media.replaceWith(createMediaPlaceholder(marker))
  }

  for (const source of template.content.querySelectorAll('source')) source.remove()
  for (const track of template.content.querySelectorAll('track')) track.remove()

  return serializeFragment(template.content)
}

export function decodeLocalMediaMarker(value: string): CanonicalLocalMediaMarker | null {
  const marker = decodeLocalResourceMarker<CanonicalLocalMediaMarker>(value)
  if (!marker || marker.version !== 1 || (marker.kind !== 'audio' && marker.kind !== 'video')) return null
  if (marker.resolutionKind !== 'markdown-relative' && marker.resolutionKind !== 'workspace-wiki') return null
  if (
    !Array.isArray(marker.sources)
    || marker.sources.length > MAX_LOCAL_MEDIA_SOURCES
    || marker.sources.some(source => (
      !source
      || !isSafeLocalResourceReference(source.ref)
      || localMediaMimeType(source.ref, marker.kind) !== source.mimeType
    ))
  ) return null
  if (
    !Array.isArray(marker.tracks)
    || marker.tracks.length > MAX_LOCAL_MEDIA_TRACKS
    || marker.tracks.some(track => (
      !track
      || !isSafeLocalResourceReference(track.ref)
      || extensionOfResourcePath(track.ref) !== '.vtt'
      || !['subtitles', 'captions', 'descriptions', 'chapters'].includes(track.kind)
    ))
  ) return null
  if (marker.poster && (
    !isSafeLocalResourceReference(marker.poster)
    || !IMAGE_MIME_TYPES[extensionOfResourcePath(marker.poster)]
  )) return null
  if (marker.dimensions && (
    !Number.isInteger(marker.dimensions.width)
    || marker.dimensions.width < 1
    || marker.dimensions.width > MAX_LOCAL_MEDIA_DIMENSION
    || (marker.dimensions.height !== undefined && (
      !Number.isInteger(marker.dimensions.height)
      || marker.dimensions.height < 1
      || marker.dimensions.height > MAX_LOCAL_MEDIA_DIMENSION
    ))
  )) return null
  return marker
}

export function decodeLocalImageMarker(value: string): CanonicalLocalImageMarker | null {
  const marker = decodeLocalResourceMarker<CanonicalLocalImageMarker>(value)
  if (!marker || marker.version !== 1 || !isSafeLocalResourceReference(marker.ref)) return null
  if (marker.resolutionKind !== 'markdown-relative' && marker.resolutionKind !== 'workspace-wiki') return null
  return marker
}

function createMediaPlaceholder(marker: CanonicalLocalMediaMarker): HTMLSpanElement {
  const placeholder = document.createElement('span')
  placeholder.className = 'local-media-placeholder'
  placeholder.setAttribute(LOCAL_MEDIA_MARKER_ATTRIBUTE, encodeLocalResourceMarker(marker))
  return placeholder
}

function collectSources(media: HTMLMediaElement, kind: LocalMediaKind): CanonicalLocalMediaSource[] {
  const rawSources = [
    media.getAttribute('src'),
    ...Array.from(media.querySelectorAll(':scope > source')).map(source => source.getAttribute('src')),
  ]
  const sources: CanonicalLocalMediaSource[] = []
  for (const rawSource of rawSources) {
    if (!rawSource || sources.length >= MAX_LOCAL_MEDIA_SOURCES) continue
    const parsed = parseLocalMediaReference(rawSource)
    if (!parsed) continue
    const mimeType = localMediaMimeType(parsed.path, kind)
    if (!mimeType) continue
    sources.push({ ref: parsed.path, mimeType, ...(parsed.time ? { time: parsed.time } : {}) })
  }
  return sources
}

function collectTracks(media: HTMLMediaElement): CanonicalLocalMediaTrack[] {
  const tracks: CanonicalLocalMediaTrack[] = []
  for (const track of Array.from(media.querySelectorAll<HTMLTrackElement>(':scope > track'))) {
    if (tracks.length >= MAX_LOCAL_MEDIA_TRACKS) break
    const ref = track.getAttribute('src')?.trim() ?? ''
    if (!isSafeLocalResourceReference(ref) || extensionOfResourcePath(ref) !== '.vtt') continue
    const rawKind = track.getAttribute('kind')?.toLowerCase() ?? 'subtitles'
    if (!isTrackKind(rawKind)) continue
    const srclang = track.getAttribute('srclang')?.trim()
    if (rawKind === 'subtitles' && (!srclang || !isLanguageTag(srclang))) continue
    const label = track.getAttribute('label')?.trim().slice(0, 100)
    tracks.push({
      ref,
      kind: rawKind,
      ...(srclang && isLanguageTag(srclang) ? { srclang } : {}),
      ...(label ? { label } : {}),
      ...(track.hasAttribute('default') && !tracks.some(item => item.default) ? { default: true } : {}),
    })
  }
  return tracks
}

function collectPoster(media: HTMLMediaElement): Pick<CanonicalLocalMediaMarker, 'poster'> {
  if (media.tagName.toLowerCase() !== 'video') return {}
  const poster = media.getAttribute('poster')?.trim() ?? ''
  if (!isSafeLocalResourceReference(poster)) return {}
  return Object.hasOwn(IMAGE_MIME_TYPES, extensionOfResourcePath(poster)) ? { poster } : {}
}

function collectLabel(media: HTMLMediaElement): Pick<CanonicalLocalMediaMarker, 'label'> {
  const label = (media.getAttribute('aria-label') || media.getAttribute('title') || '').trim().slice(0, 200)
  return label ? { label } : {}
}

function collectDimensions(media: HTMLMediaElement): Pick<CanonicalLocalMediaMarker, 'dimensions'> {
  const width = parseDimensionAttribute(media.getAttribute('width'))
  const height = parseDimensionAttribute(media.getAttribute('height'))
  if (!width) return {}
  return { dimensions: { width, ...(height ? { height } : {}) } }
}

function parseDimensionAttribute(value: string | null): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null
  const number = Number(value)
  return number >= 1 && number <= MAX_LOCAL_MEDIA_DIMENSION ? number : null
}

function hasFullWidthStyle(style: string | null): boolean {
  if (!style) return false
  return style.split(';').some(declaration => /^\s*width\s*:\s*100%\s*$/i.test(declaration))
}

function isTrackKind(value: string): value is CanonicalLocalMediaTrack['kind'] {
  return value === 'subtitles' || value === 'captions' || value === 'descriptions' || value === 'chapters'
}

function isLanguageTag(value: string): boolean {
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)
}

function serializeFragment(fragment: DocumentFragment): string {
  const container = document.createElement('div')
  container.append(fragment.cloneNode(true))
  return container.innerHTML
}
