/**
 * DOCX 导出专用的图表渲染管线
 *
 * 策略：先尝试调渲染器生成 SVG，失败则从 DOM 抓已渲染的 SVG 作为 fallback。
 * SVG → PNG 转换：无 foreignObject 走 canvas（快），有 foreignObject 走 BrowserWindow 截图。
 */

import { renderEChartsToSvg } from './echartsRenderer'
import { renderMermaidToSvg } from './mermaidRenderer'
import { renderGraphvizToSvg } from './graphvizRenderer'
import { renderPlantUMLToSvg } from './plantumlRenderer'
import { renderVegaLiteToSvg } from './vegaLiteRenderer'
import { renderD2ToSvg } from './d2Renderer'
import { isMissingReadBpmnFileHandlerError, renderBpmnToSvg, resolveBpmnFallbackPath } from './bpmnRenderer'
import { renderWaveDromToSvg } from './wavedromRenderer'
import { renderStructurizrToSvg } from './structurizrRenderer'
import { renderPlotlyToSvg } from './plotlyRenderer'
import { renderDbmlToSvg } from './dbmlRenderer'
import { renderAntvG6ToSvg } from './antvG6Renderer'
import { renderKrokiToSvg } from './krokiRenderer'
import { cleanUserFacingError } from './userFacingErrors'

export interface ChartImage {
  id: string
  pngBase64: string
  widthCm: number
}

export interface ChartRenderResult {
  modifiedMarkdown: string
  images: ChartImage[]
  warnings: string[]
}

type ChartType = 'echarts' | 'mermaid' | 'dot' | 'graphviz' | 'markmap' | 'plantuml' | 'drawio' | 'excalidraw' | 'infographic' | 'vega-lite' | 'd2' | 'bpmn' | 'wavedrom' | 'c4plantuml' | 'structurizr' | 'plotly' | 'dbml' | 'antv-g6' | 'kroki'

export interface DocxChartRenderOptions {
  markdownFilePath?: string
  onProgress?: (current: number, total: number, type: string) => void
}

const CHART_LANGS = new Set<string>([
  'echarts', 'mermaid', 'dot', 'graphviz', 'markmap', 'plantuml', 'drawio', 'dio', 'excalidraw', 'excalidraw-json', 'infographic',
  'vega-lite', 'vegalite', 'd2', 'bpmn', 'wavedrom', 'c4', 'c4plantuml',
  'structurizr', 'structurizr-dsl', 'plotly', 'plotly-json', 'dbml', 'antv-g6', 'g6',
  'kroki', 'kroki-pikchr', 'kroki-nomnoml', 'kroki-svgbob', 'kroki-bytefield', 'kroki-tikz',
  'pikchr', 'nomnoml', 'svgbob', 'bytefield', 'tikz',
])

const CODE_BLOCK_RE = /```([\w-]+)\n([\s\S]*?)```/g
const FENCED_BLOCK_RE = /(```|~~~)[^\n]*\n[\s\S]*?\1/g

const CONTAINER_CLASS_MAP: Record<string, string> = {
  mermaid: 'mermaid-container',
  echarts: 'echarts-container',
  dot: 'graphviz-container',
  graphviz: 'graphviz-container',
  markmap: 'markmap-container',
  plantuml: 'plantuml-container',
  drawio: 'drawio-container',
  excalidraw: 'excalidraw-container',
  infographic: 'infographic-container',
  'vega-lite': 'vega-lite-container',
  d2: 'd2-container',
  bpmn: 'bpmn-container',
  wavedrom: 'wavedrom-container',
  c4plantuml: 'plantuml-container',
  structurizr: 'structurizr-container',
  plotly: 'plotly-container',
  dbml: 'dbml-container',
  'antv-g6': 'antv-g6-container',
  kroki: 'kroki-container',
}

const DOCX_CHART_SAFE_PADDING_PX = 32
const DOCX_CHART_TRIM_PADDING_PX = DOCX_CHART_SAFE_PADDING_PX * 2
const DOCX_CHART_WHITE_THRESHOLD = 248
const DOCX_CHART_ALPHA_THRESHOLD = 16
const DOCX_CHART_MAX_MARGIN_RATIO = 0.18
const DOCX_CHART_MAX_WIDTH_CM = 15.5
const DOCX_CHART_MAX_HEIGHT_CM = 24
const DOCX_CHART_EXPORT_WIDTH_PX = 1170
const DOCX_COMPACT_TALL_MAX_HEIGHT_CM = 11.8
const DOCX_COMPACT_TALL_MAX_PIXELS = 3_200_000
const DOCX_PREVIEW_MATCH_MIN_WIDTH_CM = 1
const DOCX_PREVIEW_MATCH_TINY_WIDTH_THRESHOLD_CM = 4
const DOCX_PREVIEW_MATCH_READABLE_MIN_WIDTH_CM = 6
const DOCX_READABLE_DIAGRAM_PREVIEW_THRESHOLD_CM = 7
const LOCAL_MARKDOWN_IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i

export interface DocxChartTrimRect {
  x: number
  y: number
  width: number
  height: number
}

interface DocxChartTrimOptions {
  paddingPx?: number
  whiteThreshold?: number
  alphaThreshold?: number
  maxMarginRatio?: number
  minContentSizePx?: number
}

interface SvgBox {
  x: number
  y: number
  width: number
  height: number
}

interface MarkdownRange {
  start: number
  end: number
}

interface ChartBlock {
  fullMatch: string
  lang: string
  code: string
  start: number
  end: number
}

interface ExcalidrawImageRef {
  fullMatch: string
  alt: string
  refPath: string
  cleanRefPath: string
  start: number
  end: number
}

interface BpmnImageRef {
  fullMatch: string
  alt: string
  refPath: string
  cleanRefPath: string
  start: number
  end: number
}

interface LocalMarkdownImageRef {
  fullMatch: string
  alt: string
  refPath: string
  cleanRefPath: string
  start: number
  end: number
}

interface RenderChartCodeToPngOptions {
  allowDomFallback?: boolean
  excalidrawSourceKind?: 'code-block' | 'file-reference'
  excalidrawSourceLabel?: string
  sourceLanguage?: string
}

interface MarkdownReplacement {
  start: number
  end: number
  value: string
}

function parseSvgViewBoxValue(viewBox: string | null): SvgBox | null {
  if (!viewBox) return null
  const parts = viewBox.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0) {
    return null
  }
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

function parseSvgLength(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readSvgTagAttribute(svgTag: string, attrName: string): string | null {
  const match = svgTag.match(new RegExp(`\\s${attrName}\\s*=\\s*(['"])(.*?)\\1`, 'i'))
  return match?.[2] ?? null
}

function parseSvgTagSize(svgTag: string): SvgBox | null {
  const width = parseSvgLength(readSvgTagAttribute(svgTag, 'width'))
  const height = parseSvgLength(readSvgTagAttribute(svgTag, 'height'))
  if (!width || !height) return null
  return { x: 0, y: 0, width, height }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

function formatViewBox(box: SvgBox): string {
  return [box.x, box.y, box.width, box.height].map(formatNumber).join(' ')
}

function setSvgTagAttribute(svgTag: string, attrName: string, attrValue: string): string {
  const attrPattern = new RegExp(`(\\s${attrName}\\s*=\\s*)(['"])(.*?)\\2`, 'i')
  if (attrPattern.test(svgTag)) {
    return svgTag.replace(attrPattern, (_match, prefix) => `${prefix}"${attrValue}"`)
  }
  return svgTag.replace(/\s*\/?>$/, end => ` ${attrName}="${attrValue}"${end}`)
}

export function addSvgSafePaddingForDocx(svgString: string, paddingPx = DOCX_CHART_SAFE_PADDING_PX): string {
  const svgTagMatch = svgString.match(/<svg\b[^>]*>/i)
  if (!svgTagMatch) return svgString

  const svgTag = svgTagMatch[0]
  const box = parseSvgViewBoxValue(readSvgTagAttribute(svgTag, 'viewBox')) || parseSvgTagSize(svgTag)
  if (!box) return svgString

  const padding = Math.max(0, paddingPx)
  let nextSvgTag = setSvgTagAttribute(svgTag, 'viewBox', formatViewBox({
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  }))
  nextSvgTag = setSvgTagAttribute(nextSvgTag, 'preserveAspectRatio', 'xMidYMid meet')

  return `${svgString.slice(0, svgTagMatch.index)}${nextSvgTag}${svgString.slice((svgTagMatch.index || 0) + svgTag.length)}`
}

export function calculateDocxChartTrimRect(
  imageData: ImageData,
  options: DocxChartTrimOptions = {},
): DocxChartTrimRect | null {
  const width = imageData.width
  const height = imageData.height
  if (width <= 0 || height <= 0) return null

  const data = imageData.data
  const whiteThreshold = options.whiteThreshold ?? DOCX_CHART_WHITE_THRESHOLD
  const alphaThreshold = options.alphaThreshold ?? DOCX_CHART_ALPHA_THRESHOLD
  const maxMarginRatio = options.maxMarginRatio ?? DOCX_CHART_MAX_MARGIN_RATIO
  const minContentSizePx = options.minContentSizePx ?? 8

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3]
      if (alpha <= alphaThreshold) continue

      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
      const lum = 0.299 * red + 0.587 * green + 0.114 * blue
      if (lum >= whiteThreshold) continue

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < 0 || maxY < 0) return null

  const contentWidth = maxX - minX + 1
  const contentHeight = maxY - minY + 1
  if (contentWidth < minContentSizePx || contentHeight < minContentSizePx) return null

  const topMargin = minY / height
  const bottomMargin = (height - 1 - maxY) / height
  const verticalMargin = topMargin + bottomMargin
  const leftMargin = minX / width
  const rightMargin = (width - 1 - maxX) / width
  const horizontalImbalance = Math.abs(leftMargin - rightMargin)
  const sourceAspectRatio = width / height
  const contentAspectRatio = contentWidth / contentHeight
  // 高窄图表常通过左右留白保持页面友好的纵横比。
  // 宽幅图表有时会产生整块画布白边，只看单边阈值会漏裁，
  // 导致 DOCX 中图表实际内容明显偏小；因此只在存在明显上下画框时裁剪整张图。
  const hasExcessiveVerticalFrame = (
    (topMargin > maxMarginRatio && bottomMargin > maxMarginRatio)
    || verticalMargin > maxMarginRatio * 1.65
  )
  const hasAsymmetricLandscapeFrame = (
    sourceAspectRatio >= 1.1
    && contentAspectRatio >= 1.1
    && Math.max(leftMargin, rightMargin) > maxMarginRatio
    && horizontalImbalance > Math.max(0.08, maxMarginRatio * 0.5)
  )
  if (!hasExcessiveVerticalFrame && !hasAsymmetricLandscapeFrame) {
    return null
  }

  const padding = Math.max(0, Math.round(options.paddingPx ?? DOCX_CHART_TRIM_PADDING_PX))
  const cropX = Math.max(0, minX - padding)
  const cropY = Math.max(0, minY - padding)
  const cropRight = Math.min(width - 1, maxX + padding)
  const cropBottom = Math.min(height - 1, maxY + padding)
  const cropWidth = cropRight - cropX + 1
  const cropHeight = cropBottom - cropY + 1

  if (cropWidth >= width && cropHeight >= height) return null

  return { x: cropX, y: cropY, width: cropWidth, height: cropHeight }
}

export function calculateDocxImageWidthCm(
  pixelWidth: number,
  pixelHeight: number,
  maxHeightCm: number = DOCX_CHART_MAX_HEIGHT_CM,
  preferredWidthCm?: number,
): number {
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) {
    return DOCX_CHART_MAX_WIDTH_CM
  }

  const heightToWidthRatio = pixelHeight / pixelWidth
  const widthByHeightBudget = maxHeightCm / heightToWidthRatio
  const hasPreferredWidth = Number.isFinite(preferredWidthCm) && Number(preferredWidthCm) > 0
  const isReadableLandscapeDiagram = hasPreferredWidth
    && Number(preferredWidthCm) >= DOCX_READABLE_DIAGRAM_PREVIEW_THRESHOLD_CM
    && pixelWidth >= 900
    && pixelHeight >= 300
    && heightToWidthRatio >= 0.25
    && heightToWidthRatio <= 1.25
  const maxWidthCm = hasPreferredWidth
    ? Math.min(DOCX_CHART_MAX_WIDTH_CM, isReadableLandscapeDiagram ? DOCX_CHART_MAX_WIDTH_CM : Number(preferredWidthCm))
    : DOCX_CHART_MAX_WIDTH_CM
  const tinyPreviewWidthFloor = hasPreferredWidth && Number(preferredWidthCm) < DOCX_PREVIEW_MATCH_TINY_WIDTH_THRESHOLD_CM
    ? Math.min(widthByHeightBudget, DOCX_PREVIEW_MATCH_READABLE_MIN_WIDTH_CM)
    : DOCX_PREVIEW_MATCH_MIN_WIDTH_CM
  const widthCm = Math.min(maxWidthCm, widthByHeightBudget)
  if (hasPreferredWidth) {
    return Math.max(tinyPreviewWidthFloor, Number(widthCm.toFixed(2)))
  }
  return Math.max(4, Number(widthCm.toFixed(2)))
}

function getPreviewMatchedWidthCm(containerClass: string, typeIndex: number): number | undefined {
  if (typeof document === 'undefined') return undefined
  const containers = document.querySelectorAll(`.${containerClass}`)
  const container = containers[typeIndex] as HTMLElement | undefined
  if (!container) return undefined

  const markdownBody = container.closest('.markdown-body') || document.querySelector('.markdown-body')
  const bodyRect = markdownBody?.getBoundingClientRect()
  const target = container.querySelector('svg, canvas, img, .mxgraph') as HTMLElement | SVGElement | null
  const targetRect = (target || container).getBoundingClientRect()
  if (!bodyRect || bodyRect.width <= 0 || targetRect.width <= 0) return undefined

  const effectivePreviewWidth = Math.min(bodyRect.width, DOCX_CHART_EXPORT_WIDTH_PX)
  const relativeWidth = Math.min(1, targetRect.width / effectivePreviewWidth)
  if (!Number.isFinite(relativeWidth) || relativeWidth <= 0) return undefined
  return Number((relativeWidth * DOCX_CHART_MAX_WIDTH_CM).toFixed(2))
}

function getDocxChartMaxHeightCm(pixelWidth: number, pixelHeight: number): number {
  const pixelCount = pixelWidth * pixelHeight
  if (
    Number.isFinite(pixelWidth)
    && Number.isFinite(pixelHeight)
    && pixelWidth > 0
    && pixelHeight > 0
    && pixelHeight / pixelWidth > 1.25
    && pixelCount <= DOCX_COMPACT_TALL_MAX_PIXELS
  ) {
    return DOCX_COMPACT_TALL_MAX_HEIGHT_CM
  }
  return DOCX_CHART_MAX_HEIGHT_CM
}

function buildChartTypeIndexByStart(
  blocks: ChartBlock[],
  imageRefs: ExcalidrawImageRef[],
  bpmnImageRefs: BpmnImageRef[],
): Map<number, number> {
  const items = [
    ...blocks.map(block => ({ start: block.start, type: normalizeChartType(block.lang) })),
    ...imageRefs.map(ref => ({ start: ref.start, type: 'excalidraw' as ChartType })),
    ...bpmnImageRefs.map(ref => ({ start: ref.start, type: 'bpmn' as ChartType })),
  ].sort((a, b) => a.start - b.start)
  const counters: Record<string, number> = {}
  const result = new Map<number, number>()
  for (const item of items) {
    const index = counters[item.type] || 0
    result.set(item.start, index)
    counters[item.type] = index + 1
  }
  return result
}

function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

function canvasToTrimmedPngBase64(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvasToPngBase64(canvas)

  let trimRect: DocxChartTrimRect | null = null
  try {
    trimRect = calculateDocxChartTrimRect(ctx.getImageData(0, 0, canvas.width, canvas.height))
  } catch {
    return canvasToPngBase64(canvas)
  }

  if (!trimRect) return canvasToPngBase64(canvas)

  const trimmedCanvas = document.createElement('canvas')
  trimmedCanvas.width = trimRect.width
  trimmedCanvas.height = trimRect.height
  const trimmedCtx = trimmedCanvas.getContext('2d')
  if (!trimmedCtx) return canvasToPngBase64(canvas)

  trimmedCtx.fillStyle = '#ffffff'
  trimmedCtx.fillRect(0, 0, trimRect.width, trimRect.height)
  trimmedCtx.drawImage(
    canvas,
    trimRect.x,
    trimRect.y,
    trimRect.width,
    trimRect.height,
    0,
    0,
    trimRect.width,
    trimRect.height,
  )
  return canvasToPngBase64(trimmedCanvas)
}

export async function trimPngWhitespaceForDocx(pngBase64: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')
      if (!ctx || canvas.width <= 0 || canvas.height <= 0) {
        resolve(pngBase64)
        return
      }

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvasToTrimmedPngBase64(canvas))
    }
    img.onerror = () => resolve(pngBase64)
    img.src = `data:image/png;base64,${pngBase64}`
  })
}

function generatePlaceholderId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return `mdv__chart__${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}__`
}

function normalizeChartType(lang: string): ChartType {
  if (lang === 'graphviz') return 'dot'
  if (lang === 'excalidraw-json') return 'excalidraw'
  if (lang === 'dio') return 'drawio'
  if (lang === 'vegalite') return 'vega-lite'
  if (lang === 'c4') return 'c4plantuml'
  if (lang === 'structurizr-dsl') return 'structurizr'
  if (lang === 'plotly-json') return 'plotly'
  if (lang === 'g6') return 'antv-g6'
  if (/^(?:kroki|kroki-|pikchr|nomnoml|svgbob|bytefield|tikz)/.test(lang)) return 'kroki'
  return lang as ChartType
}

function cleanExcalidrawRefPath(refPath: string): string {
  return refPath.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0] || refPath
}

function isExcalidrawRefPath(refPath: string): boolean {
  return /\.excalidraw(?:[?#].*)?$/i.test(refPath.trim().replace(/^<|>$/g, ''))
}

function cleanBpmnRefPath(refPath: string): string {
  return refPath.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0] || refPath
}

function isBpmnRefPath(refPath: string): boolean {
  return /\.bpmn(?:[?#].*)?$/i.test(refPath.trim().replace(/^<|>$/g, ''))
}

function cleanLocalMarkdownImageRefPath(refPath: string): string {
  return refPath.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0] || refPath
}

function isLocalMarkdownImageRefPath(refPath: string): boolean {
  const normalized = refPath.trim().replace(/^<|>$/g, '')
  if (!normalized) return false
  if (/^(?:https?:|data:|blob:|local-image:|file:)/i.test(normalized)) return false
  if (isExcalidrawRefPath(normalized) || isBpmnRefPath(normalized)) return false
  return LOCAL_MARKDOWN_IMAGE_EXTENSIONS.test(normalized)
}

function collectFencedBlockRanges(markdown: string): MarkdownRange[] {
  const ranges: MarkdownRange[] = []
  const re = new RegExp(FENCED_BLOCK_RE.source, FENCED_BLOCK_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  return ranges
}

function isInsideRanges(index: number, ranges: MarkdownRange[]): boolean {
  return ranges.some(range => index >= range.start && index < range.end)
}

function collectExcalidrawImageRefs(markdown: string, fencedRanges: MarkdownRange[]): ExcalidrawImageRef[] {
  const refs: ExcalidrawImageRef[] = []
  const imageRefRe = /!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
  let imageMatch: RegExpExecArray | null

  while ((imageMatch = imageRefRe.exec(markdown)) !== null) {
    if (isInsideRanges(imageMatch.index, fencedRanges)) continue

    const refPath = imageMatch[2] || imageMatch[3] || ''
    if (!isExcalidrawRefPath(refPath)) continue

    refs.push({
      fullMatch: imageMatch[0],
      alt: imageMatch[1],
      refPath,
      cleanRefPath: cleanExcalidrawRefPath(refPath),
      start: imageMatch.index,
      end: imageMatch.index + imageMatch[0].length,
    })
  }

  return refs
}

function collectBpmnImageRefs(markdown: string, fencedRanges: MarkdownRange[]): BpmnImageRef[] {
  const refs: BpmnImageRef[] = []
  const imageRefRe = /!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
  let imageMatch: RegExpExecArray | null

  while ((imageMatch = imageRefRe.exec(markdown)) !== null) {
    if (isInsideRanges(imageMatch.index, fencedRanges)) continue

    const refPath = imageMatch[2] || imageMatch[3] || ''
    if (!isBpmnRefPath(refPath)) continue

    refs.push({
      fullMatch: imageMatch[0],
      alt: imageMatch[1],
      refPath,
      cleanRefPath: cleanBpmnRefPath(refPath),
      start: imageMatch.index,
      end: imageMatch.index + imageMatch[0].length,
    })
  }

  return refs
}

function collectLocalMarkdownImageRefs(markdown: string, fencedRanges: MarkdownRange[]): LocalMarkdownImageRef[] {
  const refs: LocalMarkdownImageRef[] = []
  const imageRefRe = /!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
  let imageMatch: RegExpExecArray | null

  while ((imageMatch = imageRefRe.exec(markdown)) !== null) {
    if (isInsideRanges(imageMatch.index, fencedRanges)) continue

    const refPath = imageMatch[2] || imageMatch[3] || ''
    if (!isLocalMarkdownImageRefPath(refPath)) continue

    refs.push({
      fullMatch: imageMatch[0],
      alt: imageMatch[1],
      refPath,
      cleanRefPath: cleanLocalMarkdownImageRefPath(refPath),
      start: imageMatch.index,
      end: imageMatch.index + imageMatch[0].length,
    })
  }

  return refs
}

function applyMarkdownReplacements(markdown: string, replacements: MarkdownReplacement[]): string {
  return [...replacements]
    .sort((a, b) => b.start - a.start)
    .reduce((nextMarkdown, replacement) =>
      `${nextMarkdown.slice(0, replacement.start)}${replacement.value}${nextMarkdown.slice(replacement.end)}`,
    markdown)
}

function grabNthSvgFromDom(containerClass: string, nth: number): string | null {
  const svgs = document.querySelectorAll<SVGSVGElement>(
    `.split-leaf-panel.active .${containerClass} svg, .markdown-body .${containerClass} svg`
  )
  const svg = svgs[nth]
  if (!svg) return null

  return normalizeSvgElementForDocx(svg)
}

function normalizeSvgElementForDocx(svg: SVGSVGElement): string {
  const cloned = svg.cloneNode(true) as SVGSVGElement
  if (!cloned.getAttribute('viewBox')) {
    try {
      const b = svg.getBBox()
      if (b.width > 0 && b.height > 0) {
        const pad = 10
        cloned.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`)
      }
    } catch {
      const rect = svg.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        cloned.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`)
      }
    }
  }
  cloned.setAttribute('width', '1170')
  cloned.removeAttribute('height')
  cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  cloned.setAttribute('style', 'width: 1170px; height: auto; display: block;')
  return cloned.outerHTML
}

function waitForDrawioSvg(container: HTMLElement, timeoutMs = 8000): Promise<SVGSVGElement | null> {
  const existing = container.querySelector<SVGSVGElement>('svg')
  if (existing) return Promise.resolve(existing)

  return new Promise(resolve => {
    let settled = false
    const finish = (svg: SVGSVGElement | null) => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timeout)
      resolve(svg)
    }

    const observer = new MutationObserver(() => {
      const svg = container.querySelector<SVGSVGElement>('svg')
      if (svg) finish(svg)
    })
    const timeout = window.setTimeout(() => {
      finish(container.querySelector<SVGSVGElement>('svg'))
    }, timeoutMs)

    observer.observe(container, { childList: true, subtree: true })
  })
}

async function renderDrawioToSvgForDocx(code: string, globalIndex: number): Promise<string | null> {
  const { validateDrawioCode, renderDrawioInElement } = await import('./drawioRenderer')
  const validation = validateDrawioCode(code)
  if (!validation.valid) {
    console.warn(`[DocxChart] drawio #${globalIndex}: invalid DrawIO code: ${validation.error}`)
    return null
  }

  const container = document.createElement('div')
  container.className = 'drawio-container docx-drawio-render-host'
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = '1170px'
  container.style.minHeight = '200px'
  container.style.background = '#ffffff'
  container.style.pointerEvents = 'none'
  container.style.opacity = '0.01'
  document.body.appendChild(container)

  try {
    await renderDrawioInElement(code, container)
    const svg = await waitForDrawioSvg(container)
    if (!svg) {
      console.warn(`[DocxChart] drawio #${globalIndex}: offscreen SVG not generated`)
      return null
    }
    return normalizeSvgElementForDocx(svg)
  } catch (error) {
    console.warn(`[DocxChart] drawio #${globalIndex}: offscreen render failed:`, error)
    return null
  } finally {
    container.remove()
  }
}

async function svgToPngBase64(svgString: string, width = 1170, scale = 2): Promise<string> {
  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
  if (svgDoc.querySelector('parsererror')) throw new Error('Invalid SVG')
  const svgEl = svgDoc.querySelector('svg')
  if (!svgEl) throw new Error('Invalid SVG')

  let vbWidth = width, vbHeight = 600
  const viewBox = svgEl.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      vbWidth = parts[2]
      vbHeight = parts[3]
    }
  }

  const aspectRatio = vbHeight / vbWidth
  const canvasW = width * scale
  const canvasH = Math.round(width * aspectRatio) * scale
  const maxPixels = 8_000_000
  if (canvasW * canvasH > maxPixels) {
    throw new Error('DOCX 图表图片超过最大像素限制')
  }

  svgEl.setAttribute('width', String(width))
  svgEl.setAttribute('height', String(Math.round(width * aspectRatio)))
  if (!viewBox) {
    svgEl.setAttribute('viewBox', `0 0 ${vbWidth} ${vbHeight}`)
  }

  const svgData = new XMLSerializer().serializeToString(svgEl)

  return new Promise<string>((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')
    if (!ctx) { reject(new Error('Canvas 2D context unavailable')); return }

    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvasW, canvasH)
      ctx.drawImage(img, 0, 0, canvasW, canvasH)
      resolve(canvasToTrimmedPngBase64(canvas))
    }
    img.onerror = () => reject(new Error('SVG to PNG conversion failed'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData)
  })
}

async function svgToPng(svgString: string, type: string, index: number): Promise<string | null> {
  const paddedSvgString = addSvgSafePaddingForDocx(svgString)
  const hasForeignObject = svgString.includes('foreignObject')

  if (!hasForeignObject) {
    try {
      const b64 = await svgToPngBase64(paddedSvgString)
      if (b64 && b64.length > 200) return b64
    } catch { /* canvas failed */ }
  }

  try {
    const result = await window.api.renderSvgToPng(paddedSvgString, 1170)
    if (result.success && result.data && result.data.length > 200) {
      return await trimPngWhitespaceForDocx(result.data)
    }
    console.warn(`[DocxChart] ${type} #${index}: BrowserWindow failed: ${result.error || 'small output'}`)
  } catch (e) {
    console.warn(`[DocxChart] ${type} #${index}: BrowserWindow exception:`, e)
  }

  return null
}

async function getPngNaturalSize(pngBase64: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    })
    img.onerror = () => resolve(null)
    img.src = `data:image/png;base64,${pngBase64}`
  })
}

async function renderChartCodeToPng(
  type: ChartType,
  code: string,
  globalIndex: number,
  typeIndex: number,
  options: RenderChartCodeToPngOptions = {},
): Promise<{ pngBase64: string; widthCm: number } | null> {
  try {
    let svgString: string | null = null
    const previewWidthCm = (() => {
      const containerClass = CONTAINER_CLASS_MAP[type]
      return containerClass ? getPreviewMatchedWidthCm(containerClass, typeIndex) : undefined
    })()

    // DrawIO 优先复用预览 DOM；长文档/虚拟列表未挂载时，改用离屏容器主动渲染。
    if (type === 'drawio') {
      svgString = grabNthSvgFromDom('drawio-container', typeIndex)
      if (!svgString) {
        console.warn(`[DocxChart] drawio #${globalIndex}: DOM SVG not found (index=${typeIndex}), trying offscreen render`)
        svgString = await renderDrawioToSvgForDocx(code, globalIndex)
        if (!svgString) return null
      }
    } else {
      // 其他类型：先尝试渲染器
      try {
        switch (type) {
          case 'echarts':
            svgString = await renderEChartsToSvg(code, `docx-export-${globalIndex}`)
            break
          case 'mermaid':
            svgString = await renderMermaidToSvg(code, `docx-export-${globalIndex}`)
            break
          case 'dot':
          case 'graphviz':
            svgString = await renderGraphvizToSvg(code, `docx-export-${globalIndex}`)
            break
          case 'markmap': {
            const { renderMarkmapToSvg } = await import('./markmapRenderer')
            svgString = await renderMarkmapToSvg(code, `docx-export-${globalIndex}`)
            break
          }
          case 'plantuml':
          case 'c4plantuml':
            svgString = await renderPlantUMLToSvg(code, type === 'c4plantuml' ? 'c4plantuml' : 'plantuml')
            break
          case 'excalidraw': {
            const { renderExcalidrawToSvg } = await import('./excalidrawRenderer')
            const result = await renderExcalidrawToSvg(code, {
              sourceKind: options.excalidrawSourceKind || 'code-block',
              sourceLabel: options.excalidrawSourceLabel,
            })
            svgString = result.ok ? result.svg : null
            break
          }
          case 'infographic': {
            const { renderInfographicToSvg } = await import('./infographicRenderer')
            svgString = await renderInfographicToSvg(code, `docx-export-${globalIndex}`)
            break
          }
          case 'vega-lite': {
            const result = await renderVegaLiteToSvg(code)
            svgString = result.ok ? result.svg : null
            break
          }
          case 'd2': {
            const result = await renderD2ToSvg(code)
            svgString = result.ok ? result.svg : null
            break
          }
          case 'bpmn': {
            const result = await renderBpmnToSvg(code)
            svgString = result.ok ? result.svg : null
            break
          }
          case 'wavedrom': {
            const result = renderWaveDromToSvg(code)
            svgString = result.ok ? result.svg : null
            break
          }
          case 'structurizr': {
            const result = renderStructurizrToSvg(code)
            svgString = result.ok ? result.svg : null
            break
          }
          case 'plotly': {
            const result = await renderPlotlyToSvg(code)
            svgString = result.ok ? result.svg : null
            break
          }
          case 'dbml': {
            const result = renderDbmlToSvg(code)
            svgString = result.ok ? result.svg : null
            break
          }
          case 'antv-g6': {
            const result = renderAntvG6ToSvg(code)
            svgString = result.ok ? result.svg : null
            break
          }
          case 'kroki': {
            const result = await renderKrokiToSvg(code, { language: options.sourceLanguage || 'kroki' })
            svgString = result.ok ? result.svg : null
            break
          }
        }
      } catch (renderErr) {
        console.warn(`[DocxChart] ${type} #${globalIndex}: renderer threw:`, renderErr)
        svgString = null
      }

      // 渲染器失败或返回错误 HTML → DOM fallback
      const isError = !svgString || (svgString.includes('error') && svgString.includes('<div')) || !svgString.includes('<svg')
      if (isError) {
        const containerClass = options.allowDomFallback === false ? null : CONTAINER_CLASS_MAP[type]
        if (containerClass) {
          console.warn(`[DocxChart] ${type} #${globalIndex}: renderer failed, trying DOM (${containerClass}[${typeIndex}])`)
          svgString = grabNthSvgFromDom(containerClass, typeIndex)
        }
        if (!svgString) {
          console.warn(`[DocxChart] ${type} #${globalIndex}: all paths failed`)
          return null
        }
      }
    }

    console.log(`[DocxChart] ${type} #${globalIndex}: SVG ${svgString!.length} chars`)

    const pngBase64 = await svgToPng(svgString!, type, globalIndex)
    if (pngBase64) {
      const size = await getPngNaturalSize(pngBase64)
      const maxHeightCm = size && previewWidthCm
        ? DOCX_CHART_MAX_HEIGHT_CM
        : size
          ? getDocxChartMaxHeightCm(size.width, size.height)
          : DOCX_CHART_MAX_HEIGHT_CM
      return {
        pngBase64,
        widthCm: size
          ? calculateDocxImageWidthCm(
            size.width,
            size.height,
            maxHeightCm,
            previewWidthCm,
          )
          : DOCX_CHART_MAX_WIDTH_CM,
      }
    }

    return null
  } catch (err) {
    console.warn(`[DocxChart] ${type} #${globalIndex} render failed:`, err)
    return null
  }
}

export async function renderChartsForDocx(
  markdown: string,
  optionsOrProgress?: DocxChartRenderOptions | ((current: number, total: number, type: string) => void)
): Promise<ChartRenderResult> {
  const options: DocxChartRenderOptions = typeof optionsOrProgress === 'function'
    ? { onProgress: optionsOrProgress }
    : optionsOrProgress || {}
  const images: ChartImage[] = []
  const warnings: string[] = []

  const fencedRanges = collectFencedBlockRanges(markdown)
  const blocks: ChartBlock[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(CODE_BLOCK_RE.source, CODE_BLOCK_RE.flags)
  while ((match = re.exec(markdown)) !== null) {
    const lang = match[1].toLowerCase()
    if (CHART_LANGS.has(lang)) {
      blocks.push({
        fullMatch: match[0],
        lang,
        code: match[2],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  const imageRefs = collectExcalidrawImageRefs(markdown, fencedRanges)
  const bpmnImageRefs = collectBpmnImageRefs(markdown, fencedRanges)
  const localImageRefs = collectLocalMarkdownImageRefs(markdown, fencedRanges)
  const totalCharts = blocks.length + imageRefs.length + bpmnImageRefs.length + localImageRefs.length
  let completedCharts = 0

  // 按文档顺序计算同类型序号，用于 DOM fallback 和预览尺寸继承。
  const typeIndexByStart = buildChartTypeIndexByStart(blocks, imageRefs, bpmnImageRefs)

  const replacements: MarkdownReplacement[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const type = normalizeChartType(block.lang)
    completedCharts += 1
    options.onProgress?.(completedCharts, totalCharts, type)

    const typeIndex = typeIndexByStart.get(block.start) ?? 0
    const result = await renderChartCodeToPng(type, block.code, i, typeIndex, { sourceLanguage: block.lang })

    if (result) {
      const placeholderId = generatePlaceholderId()
      images.push({
        id: placeholderId,
        pngBase64: result.pngBase64,
        widthCm: result.widthCm,
      })
      replacements.push({
        start: block.start,
        end: block.end,
        value: `![](${placeholderId})`,
      })
    } else {
      warnings.push(`第 ${i + 1} 个 ${type} 图表渲染失败，已保留源码。`)
    }
  }

  for (const imageRef of imageRefs) {
    completedCharts += 1
    options.onProgress?.(completedCharts, totalCharts, 'excalidraw')

    if (!options.markdownFilePath) {
      warnings.push(`Excalidraw 文件“${imageRef.refPath}”缺少 Markdown 文件路径，已保留原引用。`)
      continue
    }
    try {
      const file = await window.api.readExcalidrawFile({
        markdownFilePath: options.markdownFilePath,
        refPath: imageRef.cleanRefPath,
      })
      const png = await renderChartCodeToPng('excalidraw', file.content, completedCharts - 1, typeIndexByStart.get(imageRef.start) ?? 0, {
        allowDomFallback: false,
        excalidrawSourceKind: 'file-reference',
        excalidrawSourceLabel: imageRef.alt || imageRef.refPath,
      })
      if (!png) {
        warnings.push(`Excalidraw 文件“${imageRef.refPath}”渲染失败，已保留原引用。`)
        continue
      }
      const placeholderId = generatePlaceholderId()
      images.push({ id: placeholderId, pngBase64: png.pngBase64, widthCm: png.widthCm })
      replacements.push({
        start: imageRef.start,
        end: imageRef.end,
        value: `![${imageRef.alt}](${placeholderId})`,
      })
    } catch (error) {
      warnings.push(`Excalidraw 文件“${imageRef.refPath}”读取失败：${cleanUserFacingError(error)}。已保留原引用。`)
    }
  }

  for (const imageRef of bpmnImageRefs) {
    completedCharts += 1
    options.onProgress?.(completedCharts, totalCharts, 'bpmn')

    if (!options.markdownFilePath) {
      warnings.push(`BPMN 文件“${imageRef.refPath}”缺少 Markdown 文件路径，已保留原引用。`)
      continue
    }
    try {
      let content: string
      try {
        const file = await window.api.readBpmnFile({
          markdownFilePath: options.markdownFilePath,
          refPath: imageRef.cleanRefPath,
        })
        content = file.content
      } catch (error) {
        if (typeof window.api?.readFile === 'function' && isMissingReadBpmnFileHandlerError(error)) {
          content = await window.api.readFile(resolveBpmnFallbackPath(options.markdownFilePath, imageRef.cleanRefPath))
        } else {
          throw error
        }
      }
      const png = await renderChartCodeToPng('bpmn', content, completedCharts - 1, typeIndexByStart.get(imageRef.start) ?? 0, {
        allowDomFallback: false,
      })
      if (!png) {
        warnings.push(`BPMN 文件“${imageRef.refPath}”渲染失败，已保留原引用。`)
        continue
      }
      const placeholderId = generatePlaceholderId()
      images.push({ id: placeholderId, pngBase64: png.pngBase64, widthCm: png.widthCm })
      replacements.push({
        start: imageRef.start,
        end: imageRef.end,
        value: `![${imageRef.alt}](${placeholderId})`,
      })
    } catch (error) {
      warnings.push(`BPMN 文件“${imageRef.refPath}”读取失败：${cleanUserFacingError(error)}。已保留原引用。`)
    }
  }

  for (const imageRef of localImageRefs) {
    completedCharts += 1
    options.onProgress?.(completedCharts, totalCharts, 'image')

    if (!options.markdownFilePath) {
      warnings.push(`本地图片“${imageRef.refPath}”缺少 Markdown 文件路径，已保留原引用。`)
      continue
    }
    if (!window.api?.readLocalAssetBase64) {
      warnings.push(`本地图片“${imageRef.refPath}”当前环境不支持读取，已保留原引用。`)
      continue
    }

    try {
      const file = await window.api.readLocalAssetBase64({
        markdownFilePath: options.markdownFilePath,
        refPath: imageRef.cleanRefPath,
      })
      const placeholderId = generatePlaceholderId()
      images.push({
        id: placeholderId,
        pngBase64: file.base64,
        widthCm: DOCX_CHART_MAX_WIDTH_CM,
      })
      replacements.push({
        start: imageRef.start,
        end: imageRef.end,
        value: `![${imageRef.alt}](${placeholderId})`,
      })
    } catch (error) {
      warnings.push(`本地图片“${imageRef.refPath}”读取失败：${cleanUserFacingError(error)}。已保留原引用。`)
    }
  }

  return { modifiedMarkdown: applyMarkdownReplacements(markdown, replacements), images, warnings }
}
