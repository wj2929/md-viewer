export const DOCX_STYLE_ORDER = ['preview', 'standard', 'official', 'internal', 'report'] as const

export type DocxStyle = typeof DOCX_STYLE_ORDER[number]

export const DEFAULT_DOCX_STYLE: DocxStyle = 'preview'
export const FALLBACK_DOCX_STYLE: DocxStyle = 'standard'

export const DOCX_STYLE_LABELS: Record<DocxStyle, string> = {
  preview: '预览一致',
  standard: '通用 Word',
  official: '正式公文',
  internal: '机关内部',
  report: '调研报告',
}

export function isDocxStyle(value: unknown): value is DocxStyle {
  return typeof value === 'string' && DOCX_STYLE_ORDER.includes(value as DocxStyle)
}

export function normalizeDocxStyle(value: unknown): DocxStyle {
  return isDocxStyle(value) ? value : DEFAULT_DOCX_STYLE
}
