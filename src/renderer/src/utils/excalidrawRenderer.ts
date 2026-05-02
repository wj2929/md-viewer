const TEXT_ENCODER = new TextEncoder()

export const EXCALIDRAW_LIMITS = {
  maxSourceBytes: 1024 * 1024,
  maxElements: 2000,
  maxFilesBytes: 10 * 1024 * 1024,
} as const

export interface ExcalidrawRenderContext {
  sourceKind: 'code-block' | 'file-reference'
  sourceLabel?: string
  rawCode?: string
}

export type ExcalidrawValidationResult =
  | {
    ok: true
    data: {
      type?: string
      elements: unknown[]
      appState: Record<string, unknown>
      files: Record<string, unknown>
    }
    warnings: string[]
  }
  | {
    ok: false
    error: string
    warnings: string[]
  }

export type ExcalidrawRenderResult =
  | {
    ok: true
    svg: string
    width: number
    height: number
    warnings: string[]
    sourceKind: ExcalidrawRenderContext['sourceKind']
    sourceLabel?: string
    rawCode?: string
  }
  | {
    ok: false
    error: string
    warnings: string[]
    sourceKind: ExcalidrawRenderContext['sourceKind']
    sourceLabel?: string
    rawCode?: string
  }

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).length
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function readSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }

  const width = Number.parseFloat(svg.getAttribute('width') || '')
  const height = Number.parseFloat(svg.getAttribute('height') || '')

  return {
    width: Number.isFinite(width) && width > 0 ? width : 800,
    height: Number.isFinite(height) && height > 0 ? height : 600,
  }
}

function estimateFilesBytes(files: Record<string, unknown>): number {
  return byteLength(safeStringify(files))
}

function collectWarnings(elements: unknown[], files: Record<string, unknown>): string[] {
  const missingImageCount = elements.filter((element) => {
    if (!element || typeof element !== 'object') return false

    const typedElement = element as { type?: unknown; fileId?: unknown }
    return typedElement.type === 'image'
      && typeof typedElement.fileId === 'string'
      && !files[typedElement.fileId]
  }).length

  const warnings: string[] = []
  if (missingImageCount > 0) {
    warnings.push(`有 ${missingImageCount} 个图片资源缺失，已渲染其余元素`)
  }

  return warnings
}

function sanitizeExcalidrawSvg(svg: SVGSVGElement): string {
  const cloned = svg.cloneNode(true) as SVGSVGElement
  const nodes = [cloned, ...Array.from(cloned.querySelectorAll('*'))]

  for (const node of nodes) {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()

      if (name.startsWith('on')) {
        node.removeAttribute(attr.name)
        continue
      }

      if (/^(javascript:|https?:\/\/)/i.test(value)) {
        node.removeAttribute(attr.name)
      }
    }
  }

  cloned.querySelectorAll('foreignObject').forEach((element) => element.remove())
  cloned.removeAttribute('width')
  cloned.removeAttribute('height')
  cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  cloned.setAttribute('style', 'max-width: 100%; height: auto; display: block; margin: 0 auto;')

  return new XMLSerializer().serializeToString(cloned)
}

export function validateExcalidrawSource(source: string): ExcalidrawValidationResult {
  if (byteLength(source) > EXCALIDRAW_LIMITS.maxSourceBytes) {
    return {
      ok: false,
      error: 'Excalidraw 内容超过 1MB，未渲染',
      warnings: [],
    }
  }

  let data: unknown
  try {
    data = JSON.parse(source)
  } catch {
    return {
      ok: false,
      error: 'Excalidraw JSON 格式错误',
      warnings: [],
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      error: 'Excalidraw 内容必须是 JSON 对象',
      warnings: [],
    }
  }

  const record = data as {
    type?: unknown
    elements?: unknown
    appState?: unknown
    files?: unknown
  }

  if (!Array.isArray(record.elements)) {
    return {
      ok: false,
      error: 'Excalidraw JSON 缺少 elements 数组',
      warnings: [],
    }
  }

  if (record.elements.length > EXCALIDRAW_LIMITS.maxElements) {
    return {
      ok: false,
      error: `Excalidraw 元素超过 ${EXCALIDRAW_LIMITS.maxElements} 个，未渲染`,
      warnings: [],
    }
  }

  const files = record.files && typeof record.files === 'object' && !Array.isArray(record.files)
    ? (record.files as Record<string, unknown>)
    : {}

  if (estimateFilesBytes(files) > EXCALIDRAW_LIMITS.maxFilesBytes) {
    return {
      ok: false,
      error: 'Excalidraw 图片资源超过 10MB，未渲染',
      warnings: [],
    }
  }

  const warnings = collectWarnings(record.elements, files)
  if (record.type !== 'excalidraw') {
    warnings.push('未声明 type: excalidraw，已按兼容模式渲染')
  }

  return {
    ok: true,
    data: {
      type: typeof record.type === 'string' ? record.type : undefined,
      elements: record.elements,
      appState: record.appState && typeof record.appState === 'object' && !Array.isArray(record.appState)
        ? (record.appState as Record<string, unknown>)
        : {},
      files,
    },
    warnings,
  }
}

export async function renderExcalidrawToSvg(
  source: string,
  context: ExcalidrawRenderContext
): Promise<ExcalidrawRenderResult> {
  const rawCode = context.rawCode ?? source
  const validation = validateExcalidrawSource(source)

  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      warnings: validation.warnings,
      sourceKind: context.sourceKind,
      sourceLabel: context.sourceLabel,
      rawCode,
    }
  }

  try {
    const { exportToSvg } = await import('@excalidraw/excalidraw')
    const svg = await exportToSvg({
      elements: validation.data.elements,
      appState: validation.data.appState,
      files: validation.data.files,
      exportPadding: 16,
      renderEmbeddables: false,
      skipInliningFonts: true,
    })

    const { width, height } = readSvgSize(svg)

    return {
      ok: true,
      svg: sanitizeExcalidrawSvg(svg),
      width,
      height,
      warnings: validation.warnings,
      sourceKind: context.sourceKind,
      sourceLabel: context.sourceLabel,
      rawCode,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Excalidraw 渲染失败',
      warnings: validation.warnings,
      sourceKind: context.sourceKind,
      sourceLabel: context.sourceLabel,
      rawCode,
    }
  }
}
