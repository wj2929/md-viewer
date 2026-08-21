export const DOCUMENT_MARK_COLORS = [
  'red',
  'green',
  'yellow',
  'blue',
  'cyan',
  'purple',
] as const

export type DocumentMarkColor = typeof DOCUMENT_MARK_COLORS[number]

const DOCUMENT_MARK_COLOR_SET = new Set<string>(DOCUMENT_MARK_COLORS)
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn'])

export function isDocumentMarkColor(value: unknown): value is DocumentMarkColor {
  return typeof value === 'string' && DOCUMENT_MARK_COLOR_SET.has(value)
}

export function isMarkdownPath(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string') return false
  const lastSegment = filePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const dotIndex = lastSegment.lastIndexOf('.')
  const extension = dotIndex >= 0 ? lastSegment.slice(dotIndex).toLowerCase() : ''
  return MARKDOWN_EXTENSIONS.has(extension)
}
