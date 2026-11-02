export type LocalMediaKind = 'audio' | 'video'
export type LocalResourceResolutionKind = 'markdown-relative' | 'workspace-wiki'

export const MAX_LOCAL_MEDIA_SIZE = 4 * 1024 * 1024 * 1024
export const MAX_LOCAL_MEDIA_SOURCES = 4
export const MAX_LOCAL_MEDIA_TRACKS = 4
export const MAX_LOCAL_WEBVTT_SIZE = 1024 * 1024
export const MAX_LOCAL_ATTACHMENT_TEXT_SIZE = 5 * 1024 * 1024
export const LOCAL_ATTACHMENT_TEXT_EXTENSIONS = new Set([
  '.json', '.txt', '.log', '.csv', '.yaml', '.yml',
  '.sql', '.tsv', '.jsonl', '.ndjson',
  '.ini', '.conf', '.cfg', '.toml', '.properties',
  '.xml', '.html', '.htm', '.svg',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rs',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.kt', '.swift', '.rb', '.php',
  '.r', '.lua', '.vue', '.svelte', '.css', '.scss', '.less',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
])

export interface LocalAttachment {
  kind: 'text' | 'file'
  name: string
  relativePath: string
  extension: string
  size: number
  revealLabel: string
  canOpenExternally: boolean
  content?: string
  notice?: 'too-large' | 'not-utf8' | 'binary' | 'unsupported'
}

export type LocalAttachmentResult = LocalAttachment | {
  kind: 'error'
  code: 'invalid-reference' | 'owner-missing' | 'unavailable' | 'stale'
}

export interface LocalAttachmentOpenResult {
  success: boolean
  cancelled?: boolean
  code?: 'invalid-reference' | 'owner-missing' | 'unavailable' | 'stale' | 'busy'
}
export const MAX_LOCAL_RESOURCE_PATH_LENGTH = 4096
export const MAX_LOCAL_MEDIA_DIMENSION = 4096

export const AUDIO_MIME_TYPES = Object.freeze<Record<string, string>>({
  '.3gp': 'audio/3gpp',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
})

export const VIDEO_MIME_TYPES = Object.freeze<Record<string, string>>({
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.webm': 'video/webm',
})

export const IMAGE_MIME_TYPES = Object.freeze<Record<string, string>>({
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
})

export const MARKDOWN_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.mkdn',
])

export const DOCUMENT_EXTENSIONS = new Set([
  '.base',
  '.canvas',
  '.doc',
  '.docx',
  '.odt',
  '.pdf',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
])

export interface MediaTimeFragment {
  start?: number
  end?: number
  normalized: string
}

export interface ParsedLocalMediaReference {
  path: string
  time?: MediaTimeFragment
}

export interface LocalMediaDimensions {
  width: number
  height?: number
}

export interface CanonicalLocalMediaSource {
  ref: string
  mimeType: string
  time?: MediaTimeFragment
}

export interface CanonicalLocalMediaTrack {
  ref: string
  kind: 'subtitles' | 'captions' | 'descriptions' | 'chapters'
  srclang?: string
  label?: string
  default?: boolean
}

export interface CanonicalLocalMediaMarker {
  version: 1
  kind: LocalMediaKind
  resolutionKind: LocalResourceResolutionKind
  sources: CanonicalLocalMediaSource[]
  tracks: CanonicalLocalMediaTrack[]
  poster?: string
  label?: string
  dimensions?: LocalMediaDimensions
  controls: boolean
  muted: boolean
  playsInline: boolean
  preload: 'none' | 'metadata'
  fullWidth: boolean
}

export interface CanonicalLocalImageMarker {
  version: 1
  resolutionKind: LocalResourceResolutionKind
  ref: string
  alt: string
  dimensions?: LocalMediaDimensions
}

export const LOCAL_MEDIA_MARKER_ATTRIBUTE = 'data-mdv-local-media'
export const LOCAL_IMAGE_MARKER_ATTRIBUTE = 'data-mdv-local-image'
export const WIKI_LINK_MARKER_ATTRIBUTE = 'data-mdv-wiki-link'

export function extensionOfResourcePath(value: string): string {
  const clean = value.split(/[?#]/, 1)[0]
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  const dot = clean.lastIndexOf('.')
  return dot > slash ? clean.slice(dot).toLowerCase() : ''
}

export function localMediaMimeType(
  resourcePath: string,
  kind: LocalMediaKind,
): string | null {
  const extension = extensionOfResourcePath(resourcePath)
  return (kind === 'audio' ? AUDIO_MIME_TYPES : VIDEO_MIME_TYPES)[extension] ?? null
}

export function classifyWikiResource(
  resourcePath: string,
): 'audio' | 'video' | 'image' | 'markdown' | 'document' | 'special' | 'attachment' {
  const extension = extensionOfResourcePath(resourcePath)
  if (extension === '.webm') return 'video'
  if (Object.hasOwn(VIDEO_MIME_TYPES, extension)) return 'video'
  if (Object.hasOwn(AUDIO_MIME_TYPES, extension)) return 'audio'
  if (Object.hasOwn(IMAGE_MIME_TYPES, extension)) return 'image'
  if (MARKDOWN_EXTENSIONS.has(extension) || !extension) return 'markdown'
  if (extension === '.bpmn' || extension === '.excalidraw') return 'special'
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document'
  return 'attachment'
}

export function isSafeLocalResourceReference(value: string): boolean {
  if (!value || value.length > MAX_LOCAL_RESOURCE_PATH_LENGTH || value.includes('\0')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  if (/^(?:[a-z]:[\\/]|[\\/]{1,2})/i.test(value)) return false
  return !/[?#]/.test(value)
}

export function parseLocalMediaReference(
  value: string,
): ParsedLocalMediaReference | null {
  const hashIndex = value.indexOf('#')
  const path = (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim()
  if (!isSafeLocalResourceReference(path)) return null

  if (hashIndex < 0) return { path }
  const fragment = value.slice(hashIndex + 1)
  const time = parseMediaTimeFragment(fragment)
  return time ? { path, time } : null
}

export function parseMediaTimeFragment(value: string): MediaTimeFragment | null {
  const match = value.match(/^t=(?:npt:)?([^,]*)(?:,([^,]*))?$/i)
  if (!match) return null

  const parsedStart = match[1] ? parseMediaTimeValue(match[1]) : undefined
  const parsedEnd = match[2] ? parseMediaTimeValue(match[2]) : undefined
  if (match[1] && parsedStart === null) return null
  if (match[2] && parsedEnd === null) return null
  const start = parsedStart ?? undefined
  const end = parsedEnd ?? undefined
  if (start === undefined && end === undefined) return null
  if (start !== undefined && end !== undefined && end <= start) return null

  const normalizedStart = start === undefined ? '' : formatMediaTimeValue(start)
  const normalizedEnd = end === undefined ? '' : `,${formatMediaTimeValue(end)}`
  return {
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
    normalized: `t=${normalizedStart}${normalizedEnd}`,
  }
}

function parseMediaTimeValue(value: string): number | null {
  if (!value) return null
  const parts = value.split(':')
  if (parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return null

  let seconds = 0
  if (parts.length === 1) {
    seconds = Number(parts[0])
  } else if (parts.length === 2) {
    const [minutes, trailingSeconds] = parts.map(Number)
    if (minutes >= 60 || trailingSeconds >= 60) return null
    seconds = minutes * 60 + trailingSeconds
  } else {
    const [hours, minutes, trailingSeconds] = parts.map(Number)
    if (minutes >= 60 || trailingSeconds >= 60) return null
    seconds = hours * 3600 + minutes * 60 + trailingSeconds
  }

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function formatMediaTimeValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

export function parseLocalMediaDimensions(value?: string): LocalMediaDimensions | null {
  if (!value) return null
  const match = value.trim().match(/^(\d{1,4})(?:x(\d{1,4}))?$/i)
  if (!match) return null
  const width = Number(match[1])
  const height = match[2] ? Number(match[2]) : undefined
  if (width < 1 || width > MAX_LOCAL_MEDIA_DIMENSION) return null
  if (height !== undefined && (height < 1 || height > MAX_LOCAL_MEDIA_DIMENSION)) return null
  return { width, ...(height === undefined ? {} : { height }) }
}

export function encodeLocalResourceMarker(value: unknown): string {
  const json = JSON.stringify(value)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeLocalResourceMarker<T>(value: string): T | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T
  } catch {
    return null
  }
}
