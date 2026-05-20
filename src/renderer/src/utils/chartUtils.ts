/**
 * 图表通用工具函数
 *
 * 从 VirtualizedMarkdown.tsx 提取的重复代码：
 * - downloadSvgAsPng: SVG 转 PNG 下载（7 种图表共用）
 * - createChartWrapper: 创建图表包装 DOM 结构（wrapper + toggleBar + container + codeView）
 *
 * @version v1.6.0
 */

import Prism from 'prismjs'
import { Transformer, Markmap, deriveOptions } from './markmapRenderer'

export interface ChartZipImagePayload {
  filename: string
  pngBase64: string
}

interface ExportableChartDefinition {
  type: string
  wrapperSelector: string
  containerSelector: string
}

const EXPORTABLE_CHART_DEFINITIONS: ExportableChartDefinition[] = [
  { type: 'mermaid', wrapperSelector: '.mermaid-wrapper', containerSelector: '.mermaid-container' },
  { type: 'echarts', wrapperSelector: '.echarts-wrapper', containerSelector: '.echarts-container' },
  { type: 'markmap', wrapperSelector: '.markmap-wrapper', containerSelector: '.markmap-container' },
  { type: 'graphviz', wrapperSelector: '.graphviz-wrapper', containerSelector: '.graphviz-container' },
  { type: 'plantuml', wrapperSelector: '.plantuml-wrapper', containerSelector: '.plantuml-container' },
  { type: 'c4plantuml', wrapperSelector: '.c4plantuml-wrapper', containerSelector: '.plantuml-container' },
  { type: 'drawio', wrapperSelector: '.drawio-wrapper', containerSelector: '.drawio-container' },
  { type: 'infographic', wrapperSelector: '.infographic-wrapper', containerSelector: '.infographic-container' },
  { type: 'excalidraw', wrapperSelector: '.excalidraw-wrapper', containerSelector: '.excalidraw-container' },
  { type: 'vega-lite', wrapperSelector: '.vega-lite-wrapper', containerSelector: '.vega-lite-container' },
  { type: 'd2', wrapperSelector: '.d2-wrapper', containerSelector: '.d2-container' },
  { type: 'bpmn', wrapperSelector: '.bpmn-wrapper', containerSelector: '.bpmn-container' },
  { type: 'wavedrom', wrapperSelector: '.wavedrom-wrapper', containerSelector: '.wavedrom-container' },
  { type: 'structurizr', wrapperSelector: '.structurizr-wrapper', containerSelector: '.structurizr-container' },
  { type: 'plotly', wrapperSelector: '.plotly-wrapper', containerSelector: '.plotly-container' },
  { type: 'dbml', wrapperSelector: '.dbml-wrapper', containerSelector: '.dbml-container' },
  { type: 'antv-g6', wrapperSelector: '.antv-g6-wrapper', containerSelector: '.antv-g6-container' },
  { type: 'kroki', wrapperSelector: '.kroki-wrapper', containerSelector: '.kroki-container' },
]

const EXPORTABLE_CHART_SELECTOR = EXPORTABLE_CHART_DEFINITIONS
  .map(definition => definition.wrapperSelector)
  .join(',')

interface ExportableChartTarget {
  type: string
  svg: SVGSVGElement
}

interface SvgViewBoxRect {
  x: number
  y: number
  width: number
  height: number
}

function resolveChartExportType(wrapper: HTMLElement, definition: ExportableChartDefinition): string {
  if (definition.type === 'kroki') {
    const format = wrapper.dataset.krokiFormat?.trim()
    return format ? `kroki-${format}` : 'kroki'
  }
  return definition.type
}

function collectExportableChartTargets(root: ParentNode): ExportableChartTarget[] {
  const rootElement = root instanceof Element ? root : null
  const wrappers = [
    ...(rootElement?.matches(EXPORTABLE_CHART_SELECTOR) ? [rootElement as HTMLElement] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(EXPORTABLE_CHART_SELECTOR)),
  ]
  const seenSvgs = new Set<SVGSVGElement>()

  return wrappers.flatMap((wrapper) => {
    const definition = EXPORTABLE_CHART_DEFINITIONS.find(candidate => wrapper.matches(candidate.wrapperSelector))
    if (!definition) return []

    const svg = (
      wrapper.querySelector(`${definition.containerSelector} svg`) ||
      wrapper.querySelector('[data-view="chart"] svg') ||
      wrapper.querySelector('svg')
    ) as SVGSVGElement | null
    if (!svg || seenSvgs.has(svg)) return []

    seenSvgs.add(svg)
    return [{
      type: resolveChartExportType(wrapper, definition),
      svg,
    }]
  })
}

export function countExportableCharts(root: ParentNode): number {
  return collectExportableChartTargets(root).length
}

function stripPngDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/png;base64,/i, '')
}

function parseSvgViewBoxRect(value: string | null): SvgViewBoxRect | null {
  if (!value) return null
  const parts = value.trim().split(/[\s,]+/).map(part => Number.parseFloat(part))
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null
  const [x, y, width, height] = parts
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

function isUsableSvgRect(rect: SvgViewBoxRect | DOMRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
}

function isSaneSvgBBox(bbox: DOMRect, viewBox: SvgViewBoxRect | null): boolean {
  if (!isUsableSvgRect(bbox)) return false
  if (!viewBox) return true

  const maxDimensionRatio = 4
  return bbox.width <= viewBox.width * maxDimensionRatio
    && bbox.height <= viewBox.height * maxDimensionRatio
}

function svgContainsForeignObject(svg: SVGSVGElement): boolean {
  return Boolean(svg.querySelector('foreignObject'))
}

function getRenderedSvgRect(svg: SVGSVGElement): SvgViewBoxRect | null {
  const renderedWidth = svg.clientWidth || svg.getBoundingClientRect().width
  const renderedHeight = svg.clientHeight || svg.getBoundingClientRect().height
  return renderedWidth > 0 && renderedHeight > 0
    ? { x: 0, y: 0, width: renderedWidth, height: renderedHeight }
    : null
}

function expandForeignObjectExportBounds(svg: SVGSVGElement): void {
  const extra = 32
  svg.querySelectorAll<SVGForeignObjectElement>('foreignObject').forEach((element) => {
    const width = Number.parseFloat(element.getAttribute('width') || '')
    if (Number.isFinite(width) && width > 0) {
      element.setAttribute('width', String(width + extra))
    }

    const height = Number.parseFloat(element.getAttribute('height') || '')
    if (Number.isFinite(height) && height > 0) {
      element.setAttribute('height', String(height + extra / 2))
    }
  })
}

function buildSvgPngSource(svg: SVGSVGElement, padding: number): {
  svgData: string
  width: number
  height: number
} {
  const svgClone = svg.cloneNode(true) as SVGSVGElement
  if (!svgClone.getAttribute('xmlns')) {
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }

  const applyViewBox = (rect: SvgViewBoxRect): { width: number; height: number } => {
    const vx = rect.x - padding
    const vy = rect.y - padding
    const vw = rect.width + padding * 2
    const vh = rect.height + padding * 2
    svgClone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`)
    svgClone.setAttribute('width', String(vw))
    svgClone.setAttribute('height', String(vh))
    return { width: vw, height: vh }
  }

  const originalViewBox = parseSvgViewBoxRect(svg.getAttribute('viewBox'))
  const renderedViewport = svgContainsForeignObject(svg) ? getRenderedSvgRect(svg) : null
  let width: number
  let height: number
  try {
    const bbox = svg.getBBox()
    if (renderedViewport) {
      const size = applyViewBox(renderedViewport)
      width = size.width
      height = size.height
    } else if (isSaneSvgBBox(bbox, originalViewBox)) {
      const size = applyViewBox({
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
      })
      width = size.width
      height = size.height
    } else {
      if (originalViewBox) {
        const size = applyViewBox(originalViewBox)
        width = size.width
        height = size.height
      } else {
        width = svg.clientWidth || 800
        height = svg.clientHeight || 600
      }
    }
  } catch {
    if (renderedViewport) {
      const size = applyViewBox(renderedViewport)
      width = size.width
      height = size.height
    } else if (originalViewBox) {
      const size = applyViewBox(originalViewBox)
      width = size.width
      height = size.height
    } else {
      width = svg.clientWidth || 800
      height = svg.clientHeight || 600
    }
  }

  if (renderedViewport) {
    expandForeignObjectExportBounds(svgClone)
  }

  return {
    svgData: new XMLSerializer().serializeToString(svgClone),
    width,
    height,
  }
}

function isContentPixel(data: Uint8ClampedArray, offset: number): boolean {
  const alpha = data[offset + 3]
  if (alpha === 0) return false

  const whiteThreshold = 250
  return data[offset] < whiteThreshold
    || data[offset + 1] < whiteThreshold
    || data[offset + 2] < whiteThreshold
}

function trimCanvasWhitespace(canvas: HTMLCanvasElement, paddingPixels: number): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  let imageData: ImageData
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  } catch {
    return canvas
  }

  const { data, width, height } = imageData
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (!isContentPixel(data, offset)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < minX || maxY < minY) return canvas

  const sourceX = Math.max(0, minX - paddingPixels)
  const sourceY = Math.max(0, minY - paddingPixels)
  const sourceRight = Math.min(width, maxX + 1 + paddingPixels)
  const sourceBottom = Math.min(height, maxY + 1 + paddingPixels)
  const outputWidth = sourceRight - sourceX
  const outputHeight = sourceBottom - sourceY
  if (outputWidth <= 0 || outputHeight <= 0) return canvas
  if (outputWidth === width && outputHeight === height) return canvas

  const trimmedCanvas = document.createElement('canvas')
  trimmedCanvas.width = outputWidth
  trimmedCanvas.height = outputHeight
  const trimmedCtx = trimmedCanvas.getContext('2d')
  if (!trimmedCtx) return canvas
  trimmedCtx.fillStyle = '#ffffff'
  trimmedCtx.fillRect(0, 0, outputWidth, outputHeight)
  trimmedCtx.drawImage(canvas, sourceX, sourceY, outputWidth, outputHeight, 0, 0, outputWidth, outputHeight)
  return trimmedCanvas
}

export function svgToPngDataUrl(
  svg: SVGSVGElement,
  scale = 2,
  padding = 10
): Promise<string> {
  const { svgData, width, height } = buildSvgPngSource(svg, padding)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return Promise.reject(new Error('无法创建 Canvas 2D 上下文'))
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const outputCanvas = trimCanvasWhitespace(canvas, Math.max(0, Math.round(padding * scale)))
      resolve(outputCanvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('SVG 转 PNG 失败'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData)
  })
}

export async function collectExportableChartPngs(root: ParentNode): Promise<ChartZipImagePayload[]> {
  const charts = collectExportableChartTargets(root)
  const width = Math.max(2, String(charts.length).length)
  return Promise.all(charts.map(async (chart, index) => {
    const dataUrl = await svgToPngDataUrl(chart.svg)
    return {
      filename: `${String(index + 1).padStart(width, '0')}-${chart.type}.png`,
      pngBase64: stripPngDataUrl(dataUrl),
    }
  }))
}

/**
 * 将 SVG 元素导出为 PNG 并触发下载
 *
 * @param svg - 要导出的 SVG 元素
 * @param filename - 下载文件名（不含扩展名）
 * @param scale - 缩放倍数（默认 2x 高清）
 */
export function downloadSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
  scale = 2,
  padding = 10
): void {
  svgToPngDataUrl(svg, scale, padding)
    .then((dataUrl) => {
      const a = document.createElement('a')
      a.download = `${filename}.png`
      a.href = dataUrl
      a.click()
    })
    .catch(error => {
      console.error('[Chart] 下载 PNG 失败:', error)
    })
}

/**
 * 工具栏按钮配置
 */
export interface ToolbarButton {
  action: string
  title: string
  label: string
}

/** 默认工具栏按钮集（含缩放） */
export const TOOLBAR_BUTTONS_WITH_ZOOM: ToolbarButton[] = [
  { action: 'toggleCode', title: '查看代码', label: '💻' },
  { action: 'zoomOut', title: '缩小', label: '🔍−' },
  { action: 'zoomIn', title: '放大', label: '🔍+' },
  { action: 'fit', title: '适应大小', label: '⊡' },
  { action: 'download', title: '下载图片', label: '💾' },
  { action: 'fullscreen', title: '全屏查看', label: '⛶' },
]

/** 简化工具栏按钮集（无缩放） */
export const TOOLBAR_BUTTONS_SIMPLE: ToolbarButton[] = [
  { action: 'toggleCode', title: '查看代码', label: '💻' },
  { action: 'download', title: '下载图片', label: '💾' },
  { action: 'fullscreen', title: '全屏查看', label: '⛶' },
]

const CHART_FULLSCREEN_CLASS = 'chart-fullscreen'
const CHART_FULLSCREEN_BODY_CLASS = 'chart-fullscreen-active'
const CHART_LIGHTBOX_CLOSE_CLASS = 'chart-lightbox-close'
const CHART_FULLSCREEN_MAX_SCALE = 2.1
const CHART_FULLSCREEN_VIEWPORT_RATIO = 0.82
const CHART_FULLSCREEN_ABSOLUTE_MAX_WIDTH = 2200
const CHART_FULLSCREEN_WIDE_ASPECT_RATIO = 2.4
const CHART_FULLSCREEN_WIDE_VIEWPORT_RATIO = 0.88
const CHART_FULLSCREEN_WIDE_ABSOLUTE_MAX_WIDTH = 2800
const CHART_FULLSCREEN_MIN_EXTENT = 360
const CHART_FULLSCREEN_MIN_WIDTH_GUTTER = 80
const CHART_FULLSCREEN_MAX_WIDTH_GUTTER = 176
const CHART_FULLSCREEN_GUTTER_RATIO = 0.16
const CHART_FULLSCREEN_WIDE_MIN_WIDTH_GUTTER = 56
const CHART_FULLSCREEN_WIDE_MAX_WIDTH_GUTTER = 144
const CHART_FULLSCREEN_WIDE_GUTTER_RATIO = 0.08
const CHART_FULLSCREEN_MIN_HEIGHT_GUTTER = 120
const CHART_FULLSCREEN_MAX_HEIGHT_GUTTER = 190
const CHART_FULLSCREEN_HEIGHT_GUTTER_RATIO = 0.16

const chartFullscreenClones = new WeakMap<HTMLElement, HTMLElement>()
const chartFullscreenClickHandlers = new WeakMap<HTMLElement, (event: MouseEvent) => void>()

type MarkmapChartContainer = HTMLElement & {
  __markmapInstance?: Markmap
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const CHART_FULLSCREEN_ACTION_ICONS: Record<string, string> = {
  zoomOut: svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400ZM280-540v-80h200v80H280Z"/></svg>'),
  zoomIn: svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Zm-40-60v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Z"/></svg>'),
  fit: svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M480-320q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-80q33 0 56.5-23.5T560-480q0-33-23.5-56.5T480-560q-33 0-56.5 23.5T400-480q0 33 23.5 56.5T480-400Zm0-80ZM200-120q-33 0-56.5-23.5T120-200v-160h80v160h160v80H200Zm400 0v-80h160v-160h80v160q0 33-23.5 56.5T760-120H600ZM120-600v-160q0-33 23.5-56.5T200-840h160v80H200v160h-80Zm640 0v-160H600v-80h160q33 0 56.5 23.5T840-760v160h-80Z"/></svg>'),
  download: svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>'),
}

interface FullscreenSvgChartBinding {
  chartType: string
  containerSelector: string
  codeViewSelector: string
  toggleBarSelector: string
  actionButtonSelector: string
  backButtonSelector: string
  filenamePrefix: string
}

function resolveFullscreenSvgChartBinding(wrapper: HTMLElement): FullscreenSvgChartBinding | null {
  if (wrapper.classList.contains('mermaid-wrapper')) {
    return {
      chartType: 'mermaid',
      containerSelector: '.mermaid-container',
      codeViewSelector: '.mermaid-code-view',
      toggleBarSelector: '.mermaid-toggle-bar',
      actionButtonSelector: '.mermaid-action-btn',
      backButtonSelector: '.mermaid-back-btn',
      filenamePrefix: 'mermaid',
    }
  }
  if (wrapper.classList.contains('echarts-wrapper')) {
    return {
      chartType: 'echarts',
      containerSelector: '.echarts-container',
      codeViewSelector: '.echarts-code-view',
      toggleBarSelector: '.echarts-toggle-bar',
      actionButtonSelector: '.echarts-action-btn',
      backButtonSelector: '.echarts-back-btn',
      filenamePrefix: 'echarts',
    }
  }
  if (wrapper.classList.contains('infographic-wrapper')) {
    return {
      chartType: 'infographic',
      containerSelector: '.infographic-container',
      codeViewSelector: '.infographic-code-view',
      toggleBarSelector: '.infographic-toggle-bar',
      actionButtonSelector: '.infographic-action-btn',
      backButtonSelector: '.infographic-back-btn',
      filenamePrefix: 'infographic',
    }
  }
  if (wrapper.classList.contains('markmap-wrapper')) {
    return {
      chartType: 'markmap',
      containerSelector: '.markmap-container',
      codeViewSelector: '.markmap-code-view',
      toggleBarSelector: '.markmap-toggle-bar',
      actionButtonSelector: '.markmap-action-btn',
      backButtonSelector: '.markmap-back-btn',
      filenamePrefix: 'markmap',
    }
  }
  if (wrapper.classList.contains('graphviz-wrapper')) {
    return {
      chartType: 'graphviz',
      containerSelector: '.graphviz-container',
      codeViewSelector: '.graphviz-code-view',
      toggleBarSelector: '.graphviz-toggle-bar',
      actionButtonSelector: '.graphviz-action-btn',
      backButtonSelector: '.graphviz-back-btn',
      filenamePrefix: 'graphviz',
    }
  }
  if (wrapper.classList.contains('vega-lite-wrapper')) {
    return {
      chartType: 'vega-lite',
      containerSelector: '.vega-lite-container',
      codeViewSelector: '.vega-lite-code-view',
      toggleBarSelector: '.vega-lite-toggle-bar',
      actionButtonSelector: '.vega-lite-action-btn',
      backButtonSelector: '.vega-lite-back-btn',
      filenamePrefix: 'vega-lite',
    }
  }
  if (wrapper.classList.contains('d2-wrapper')) {
    return {
      chartType: 'd2',
      containerSelector: '.d2-container',
      codeViewSelector: '.d2-code-view',
      toggleBarSelector: '.d2-toggle-bar',
      actionButtonSelector: '.d2-action-btn',
      backButtonSelector: '.d2-back-btn',
      filenamePrefix: 'd2',
    }
  }
  if (wrapper.classList.contains('bpmn-wrapper')) {
    return {
      chartType: 'bpmn',
      containerSelector: '.bpmn-container',
      codeViewSelector: '.bpmn-code-view',
      toggleBarSelector: '.bpmn-toggle-bar',
      actionButtonSelector: '.bpmn-action-btn',
      backButtonSelector: '.bpmn-back-btn',
      filenamePrefix: 'bpmn',
    }
  }
  if (wrapper.classList.contains('wavedrom-wrapper')) {
    return {
      chartType: 'wavedrom',
      containerSelector: '.wavedrom-container',
      codeViewSelector: '.wavedrom-code-view',
      toggleBarSelector: '.wavedrom-toggle-bar',
      actionButtonSelector: '.wavedrom-action-btn',
      backButtonSelector: '.wavedrom-back-btn',
      filenamePrefix: 'wavedrom',
    }
  }
  if (wrapper.classList.contains('structurizr-wrapper')) {
    return {
      chartType: 'structurizr',
      containerSelector: '.structurizr-container',
      codeViewSelector: '.structurizr-code-view',
      toggleBarSelector: '.structurizr-toggle-bar',
      actionButtonSelector: '.structurizr-action-btn',
      backButtonSelector: '.structurizr-back-btn',
      filenamePrefix: 'structurizr',
    }
  }
  if (wrapper.classList.contains('plotly-wrapper')) {
    return {
      chartType: 'plotly',
      containerSelector: '.plotly-container',
      codeViewSelector: '.plotly-code-view',
      toggleBarSelector: '.plotly-toggle-bar',
      actionButtonSelector: '.plotly-action-btn',
      backButtonSelector: '.plotly-back-btn',
      filenamePrefix: 'plotly',
    }
  }
  if (wrapper.classList.contains('dbml-wrapper')) {
    return {
      chartType: 'dbml',
      containerSelector: '.dbml-container',
      codeViewSelector: '.dbml-code-view',
      toggleBarSelector: '.dbml-toggle-bar',
      actionButtonSelector: '.dbml-action-btn',
      backButtonSelector: '.dbml-back-btn',
      filenamePrefix: 'dbml',
    }
  }
  if (wrapper.classList.contains('antv-g6-wrapper')) {
    return {
      chartType: 'antv-g6',
      containerSelector: '.antv-g6-container',
      codeViewSelector: '.antv-g6-code-view',
      toggleBarSelector: '.antv-g6-toggle-bar',
      actionButtonSelector: '.antv-g6-action-btn',
      backButtonSelector: '.antv-g6-back-btn',
      filenamePrefix: 'antv-g6',
    }
  }
  if (wrapper.classList.contains('kroki-wrapper')) {
    return {
      chartType: 'kroki',
      containerSelector: '.kroki-container',
      codeViewSelector: '.kroki-code-view',
      toggleBarSelector: '.kroki-toggle-bar',
      actionButtonSelector: '.kroki-action-btn',
      backButtonSelector: '.kroki-back-btn',
      filenamePrefix: 'kroki',
    }
  }
  if (wrapper.classList.contains('plantuml-wrapper') || wrapper.classList.contains('c4plantuml-wrapper')) {
    return {
      chartType: 'plantuml',
      containerSelector: '.plantuml-container',
      codeViewSelector: '.plantuml-code-view',
      toggleBarSelector: '.plantuml-toggle-bar',
      actionButtonSelector: '.plantuml-action-btn',
      backButtonSelector: '.plantuml-back-btn',
      filenamePrefix: 'plantuml',
    }
  }
  if (wrapper.classList.contains('excalidraw-wrapper')) {
    return {
      chartType: 'excalidraw',
      containerSelector: '.excalidraw-container',
      codeViewSelector: '.excalidraw-code-view',
      toggleBarSelector: '.excalidraw-toggle-bar',
      actionButtonSelector: '.excalidraw-action-btn',
      backButtonSelector: '.excalidraw-back-btn',
      filenamePrefix: 'excalidraw',
    }
  }
  return null
}

function createFullscreenSvgChartClickHandler(wrapper: HTMLElement): (event: MouseEvent) => void {
  return (event: MouseEvent): void => {
    const eventTarget = event.target as HTMLElement
    const closeButton = eventTarget.closest(`.${CHART_LIGHTBOX_CLOSE_CLASS}`)
    if (closeButton && wrapper.contains(closeButton)) {
      event.preventDefault()
      event.stopPropagation()
      setChartFullscreen(wrapper, false)
      return
    }

    const binding = resolveFullscreenSvgChartBinding(wrapper)
    if (!binding) return

    const target = eventTarget
    const backButton = target.closest(binding.backButtonSelector)
    if (backButton && wrapper.contains(backButton)) {
      event.stopPropagation()
      const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement | null
      const codeView = wrapper.querySelector(binding.codeViewSelector) as HTMLElement | null
      const toggleBar = wrapper.querySelector(binding.toggleBarSelector) as HTMLElement | null
      if (chartView) chartView.style.display = ''
      if (codeView) codeView.style.display = 'none'
      if (toggleBar) toggleBar.style.display = ''
      return
    }

    const actionButton = target.closest(binding.actionButtonSelector) as HTMLElement | null
    if (!actionButton || !wrapper.contains(actionButton)) return

    event.stopPropagation()
    const action = actionButton.getAttribute('data-action')
    const container = wrapper.querySelector(binding.containerSelector) as HTMLElement | null
    const svg = container?.querySelector('svg') as SVGSVGElement | null
    if (!container || !action) return

    if (action === 'toggleCode') {
      const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement | null
      const codeView = wrapper.querySelector(binding.codeViewSelector) as HTMLElement | null
      const toggleBar = wrapper.querySelector(binding.toggleBarSelector) as HTMLElement | null
      if (chartView) chartView.style.display = 'none'
      if (codeView) codeView.style.display = ''
      if (toggleBar) toggleBar.style.display = 'none'
      return
    }

    if (!svg && action !== 'fullscreen') return

    try {
      if (binding.chartType === 'markmap') {
        const markmapContainer = container as MarkmapChartContainer
        const markmap = markmapContainer.__markmapInstance
        if (!markmap) return

        switch (action) {
          case 'zoomIn':
            markmap.svg.transition().call(markmap.zoom.scaleBy, 1.3)
            return
          case 'zoomOut':
            markmap.svg.transition().call(markmap.zoom.scaleBy, 0.7)
            return
          case 'fit':
            applyMarkmapFullscreenSize(wrapper)
            scheduleMarkmapFullscreenFit(wrapper)
            return
          case 'download':
            downloadSvgAsPng(svg!, `${binding.filenamePrefix}-${Date.now()}`)
            return
        }
      }

      switch (action) {
        case 'zoomIn': {
          const level = Number.parseInt(container.dataset.zoomLevel || '100', 10)
          const newLevel = Math.min(level + 20, 300)
          container.dataset.zoomLevel = String(newLevel)
          applySvgChartZoom(binding.chartType, container, svg!, newLevel)
          break
        }
        case 'zoomOut': {
          const level = Number.parseInt(container.dataset.zoomLevel || '100', 10)
          const newLevel = Math.max(level - 20, 40)
          container.dataset.zoomLevel = String(newLevel)
          applySvgChartZoom(binding.chartType, container, svg!, newLevel)
          break
        }
        case 'fit':
          container.dataset.zoomLevel = '100'
          applySvgChartZoom(binding.chartType, container, svg!, 100)
          break
        case 'download':
          downloadSvgAsPng(svg!, `${binding.filenamePrefix}-${Date.now()}`)
          break
        case 'fullscreen':
          toggleChartFullscreen(wrapper)
          break
      }
    } catch (error) {
      console.error(`[${binding.chartType}] 全屏工具栏操作失败:`, error)
    }
  }
}

function bindFullscreenWrapperClickHandler(wrapper: HTMLElement): void {
  if (chartFullscreenClickHandlers.has(wrapper)) return

  const handler = createFullscreenSvgChartClickHandler(wrapper)
  chartFullscreenClickHandlers.set(wrapper, handler)
  wrapper.addEventListener('click', handler)
}

function unbindFullscreenWrapperClickHandler(wrapper: HTMLElement): void {
  const handler = chartFullscreenClickHandlers.get(wrapper)
  if (!handler) return

  wrapper.removeEventListener('click', handler)
  chartFullscreenClickHandlers.delete(wrapper)
}

interface SvgSize {
  width: number
  height: number
}

function readSvgIntrinsicSize(svg: SVGSVGElement): SvgSize | null {
  const viewBox = svg.viewBox?.baseVal
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height }
  }

  const rawAttrWidth = svg.getAttribute('width') || ''
  const rawAttrHeight = svg.getAttribute('height') || ''
  const attrWidth = /%|auto/i.test(rawAttrWidth) ? Number.NaN : Number.parseFloat(rawAttrWidth)
  const attrHeight = /%|auto/i.test(rawAttrHeight) ? Number.NaN : Number.parseFloat(rawAttrHeight)
  if (attrWidth > 0 && attrHeight > 0) {
    return { width: attrWidth, height: attrHeight }
  }

  try {
    const bbox = svg.getBBox()
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height }
    }
  } catch {
    // getBBox can fail when the SVG is not fully laid out.
  }

  const rect = svg.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height }
  }

  return null
}

function readSvgRenderedSize(svg: SVGSVGElement): SvgSize | null {
  const rect = svg.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height }
  }

  return readSvgIntrinsicSize(svg)
}

function parseCssPx(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function applyMarkmapFullscreenSize(wrapper: HTMLElement): boolean {
  if (!wrapper.classList.contains('markmap-wrapper')) return false

  const container = wrapper.querySelector('.markmap-container') as MarkmapChartContainer | null
  const svg = container?.querySelector('svg') as SVGSVGElement | null
  if (!container || !svg) return true

  const style = getComputedStyle(container)
  const horizontalPadding = parseCssPx(style.paddingLeft) + parseCssPx(style.paddingRight)
  const verticalPadding = parseCssPx(style.paddingTop) + parseCssPx(style.paddingBottom)
  const targetWidth = Math.max(320, Math.floor(container.clientWidth - horizontalPadding))
  const targetHeight = Math.max(260, Math.floor(container.clientHeight - verticalPadding))

  wrapper.style.setProperty('--chart-fullscreen-svg-width', `${targetWidth}px`)
  wrapper.style.setProperty('--chart-fullscreen-svg-height', `${targetHeight}px`)
  container.dataset.fullscreenBaseWidth = String(targetWidth)
  container.dataset.fullscreenBaseHeight = String(targetHeight)
  svg.setAttribute('width', String(targetWidth))
  svg.setAttribute('height', String(targetHeight))
  svg.style.width = `${targetWidth}px`
  svg.style.height = `${targetHeight}px`
  svg.style.minHeight = '0'
  svg.style.maxWidth = '100%'
  svg.style.maxHeight = '100%'
  return true
}

function scheduleMarkmapFullscreenFit(wrapper: HTMLElement): void {
  const container = wrapper.querySelector('.markmap-container') as MarkmapChartContainer | null
  const markmap = container?.__markmapInstance
  if (!markmap) return

  requestAnimationFrame(() => {
    applyMarkmapFullscreenSize(wrapper)
    requestAnimationFrame(() => {
      void markmap.fit()
    })
  })
}

function applyChartFullscreenSize(wrapper: HTMLElement): void {
  if (applyMarkmapFullscreenSize(wrapper)) {
    scheduleMarkmapFullscreenFit(wrapper)
    return
  }

  const svg = wrapper.querySelector('[data-view="chart"] svg') as SVGSVGElement | null
  const intrinsic = svg ? readSvgIntrinsicSize(svg) : null
  if (!intrinsic) {
    wrapper.style.removeProperty('--chart-fullscreen-svg-width')
    wrapper.style.removeProperty('--chart-fullscreen-svg-height')
    return
  }

  const aspectRatio = intrinsic.width / Math.max(intrinsic.height, 1)
  const isWideChart = aspectRatio >= CHART_FULLSCREEN_WIDE_ASPECT_RATIO
  const widthGutter = Math.min(
    isWideChart ? CHART_FULLSCREEN_WIDE_MAX_WIDTH_GUTTER : CHART_FULLSCREEN_MAX_WIDTH_GUTTER,
    Math.max(
      isWideChart ? CHART_FULLSCREEN_WIDE_MIN_WIDTH_GUTTER : CHART_FULLSCREEN_MIN_WIDTH_GUTTER,
      window.innerWidth * (isWideChart ? CHART_FULLSCREEN_WIDE_GUTTER_RATIO : CHART_FULLSCREEN_GUTTER_RATIO),
    ),
  )
  const heightGutter = Math.min(
    CHART_FULLSCREEN_MAX_HEIGHT_GUTTER,
    Math.max(CHART_FULLSCREEN_MIN_HEIGHT_GUTTER, window.innerHeight * CHART_FULLSCREEN_HEIGHT_GUTTER_RATIO),
  )
  const availableWidth = Math.max(
    320,
    Math.min(
      window.innerWidth - widthGutter,
      isWideChart
        ? Math.min(window.innerWidth * CHART_FULLSCREEN_WIDE_VIEWPORT_RATIO, CHART_FULLSCREEN_WIDE_ABSOLUTE_MAX_WIDTH)
        : Math.min(window.innerWidth * CHART_FULLSCREEN_VIEWPORT_RATIO, CHART_FULLSCREEN_ABSOLUTE_MAX_WIDTH),
    ),
  )
  const availableHeight = Math.max(240, window.innerHeight - heightGutter)
  const maxFitScale = Math.min(
    availableWidth / intrinsic.width,
    availableHeight / intrinsic.height,
  )
  const defaultScale = Math.min(
    CHART_FULLSCREEN_MAX_SCALE,
    maxFitScale,
  )
  const minReadableScale = CHART_FULLSCREEN_MIN_EXTENT / Math.max(intrinsic.width, intrinsic.height)
  const scale = Math.min(maxFitScale, Math.max(defaultScale, minReadableScale))
  const targetWidth = Math.max(1, Math.round(intrinsic.width * scale))
  const targetHeight = Math.max(1, Math.round(intrinsic.height * scale))

  wrapper.style.setProperty('--chart-fullscreen-svg-width', `${targetWidth}px`)
  wrapper.style.setProperty('--chart-fullscreen-svg-height', `${targetHeight}px`)

  const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement | null
  if (chartView) {
    chartView.dataset.fullscreenBaseWidth = String(targetWidth)
    chartView.dataset.fullscreenBaseHeight = String(targetHeight)
  }
}

function clearChartFullscreenSize(wrapper: HTMLElement): void {
  wrapper.style.removeProperty('--chart-fullscreen-svg-width')
  wrapper.style.removeProperty('--chart-fullscreen-svg-height')
}

function decodeChartCode(encoded: string | undefined): string | null {
  if (!encoded) return null

  try {
    return decodeURIComponent(escape(atob(encoded)))
  } catch {
    return null
  }
}

function hydrateMarkmapFullscreenClone(clone: HTMLElement): void {
  if (!clone.classList.contains('markmap-wrapper')) return

  const code = decodeChartCode(clone.dataset.markmapCode)
  const container = clone.querySelector('.markmap-container') as MarkmapChartContainer | null
  const svg = container?.querySelector('svg') as SVGSVGElement | null
  if (!code || !container || !svg) return

  try {
    svg.replaceChildren()
    applyMarkmapFullscreenSize(clone)

    const transformer = new Transformer()
    const { root, features } = transformer.transform(code)
    const options = deriveOptions(features)
    const markmap = Markmap.create(svg, options, root)
    container.__markmapInstance = markmap
    scheduleMarkmapFullscreenFit(clone)
  } catch (error) {
    console.error('[Markmap] 全屏渲染失败:', error)
  }
}

function destroyMarkmapFullscreenClone(clone: HTMLElement): void {
  const container = clone.querySelector('.markmap-container') as MarkmapChartContainer | null
  const markmap = container?.__markmapInstance
  if (!markmap) return

  try {
    markmap.destroy()
  } catch (error) {
    console.warn('[Markmap] fullscreen destroy error:', error)
  } finally {
    delete container.__markmapInstance
  }
}

function resetClonedChartZoomState(clone: HTMLElement): void {
  const binding = resolveFullscreenSvgChartBinding(clone)
  if (!binding) return

  const container = clone.querySelector(binding.containerSelector) as HTMLElement | null
  const svg = container?.querySelector('svg') as SVGSVGElement | null
  if (!container) return

  if (svg && Object.prototype.hasOwnProperty.call(container.dataset, 'origSvgWidth')) {
    const origWidth = container.dataset.origSvgWidth
    if (origWidth) {
      svg.setAttribute('width', origWidth)
    } else {
      svg.removeAttribute('width')
    }
  }

  if (svg && Object.prototype.hasOwnProperty.call(container.dataset, 'origSvgHeight')) {
    const origHeight = container.dataset.origSvgHeight
    if (origHeight) {
      svg.setAttribute('height', origHeight)
    } else {
      svg.removeAttribute('height')
    }
  }

  if (svg && Object.prototype.hasOwnProperty.call(container.dataset, 'origSvgStyle')) {
    const origStyle = container.dataset.origSvgStyle
    if (origStyle) {
      svg.setAttribute('style', origStyle)
    } else {
      svg.removeAttribute('style')
    }
  }

  container.dataset.zoomLevel = '100'
  delete container.dataset.baseWidth
  delete container.dataset.origSvgWidth
  delete container.dataset.origSvgHeight
  delete container.dataset.origSvgStyle
  delete container.dataset.fullscreenBaseWidth
  delete container.dataset.fullscreenBaseHeight
  container.classList.remove('zoomed')
  clone.classList.remove('zoomed-wrapper')
}

function normalizeChartFullscreenToolbar(wrapper: HTMLElement): void {
  const binding = resolveFullscreenSvgChartBinding(wrapper)
  if (!binding) return

  const toggleBar = wrapper.querySelector(binding.toggleBarSelector) as HTMLElement | null
  if (!toggleBar) return

  const actionOrder = ['zoomOut', 'zoomIn', 'fit', 'download']
  const buttons = Array.from(toggleBar.querySelectorAll<HTMLElement>(binding.actionButtonSelector))
  buttons.forEach((button) => {
    const action = button.getAttribute('data-action') || ''
    if (!actionOrder.includes(action)) {
      button.remove()
    }
  })
  actionOrder.forEach((action) => {
    const button = toggleBar.querySelector<HTMLElement>(`${binding.actionButtonSelector}[data-action="${action}"]`)
    if (!button) return
    const icon = CHART_FULLSCREEN_ACTION_ICONS[action]
    if (icon) {
      button.textContent = ''
      const image = document.createElement('img')
      image.setAttribute('border', '0')
      image.src = icon
      image.alt = ''
      image.setAttribute('aria-hidden', 'true')
      button.appendChild(image)
    }
    toggleBar.appendChild(button)
  })
}

function createChartFullscreenClone(wrapper: HTMLElement): HTMLElement {
  const clone = wrapper.cloneNode(true) as HTMLElement
  clone.classList.add(CHART_FULLSCREEN_CLASS)
  clone.setAttribute('data-chart-fullscreen', 'true')
  clone.setAttribute('aria-modal', 'true')
  clone.setAttribute('role', 'dialog')
  resetClonedChartZoomState(clone)
  clone.querySelectorAll('[data-action="fullscreen"], [data-action="toggleCode"]').forEach((button) => {
    button.remove()
  })
  normalizeChartFullscreenToolbar(clone)
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = `${CHART_LIGHTBOX_CLOSE_CLASS} no-export`
  closeButton.title = '关闭全屏预览'
  closeButton.setAttribute('aria-label', '关闭全屏预览')
  clone.appendChild(closeButton)
  document.body.appendChild(clone)
  chartFullscreenClones.set(wrapper, clone)
  bindFullscreenWrapperClickHandler(clone)
  applyChartFullscreenSize(clone)
  hydrateMarkmapFullscreenClone(clone)
  return clone
}

function removeChartFullscreenClone(clone: HTMLElement): void {
  destroyMarkmapFullscreenClone(clone)
  clearChartFullscreenSize(clone)
  unbindFullscreenWrapperClickHandler(clone)
  clone.remove()
  for (const candidate of document.querySelectorAll<HTMLElement>('[data-chart-fullscreen-source="true"]')) {
    const activeClone = chartFullscreenClones.get(candidate)
    if (activeClone === clone) {
      candidate.removeAttribute('data-chart-fullscreen-source')
      chartFullscreenClones.delete(candidate)
    }
  }
}

function setChartFullscreen(wrapper: HTMLElement, active: boolean): void {
  if (active) {
    if (wrapper.classList.contains(CHART_FULLSCREEN_CLASS)) return
    const existingClone = chartFullscreenClones.get(wrapper)
    if (existingClone?.isConnected) return
    wrapper.setAttribute('data-chart-fullscreen-source', 'true')
    createChartFullscreenClone(wrapper)
  } else {
    if (wrapper.classList.contains(CHART_FULLSCREEN_CLASS)) {
      removeChartFullscreenClone(wrapper)
    } else {
      const clone = chartFullscreenClones.get(wrapper)
      if (clone) removeChartFullscreenClone(clone)
      wrapper.removeAttribute('data-chart-fullscreen-source')
      chartFullscreenClones.delete(wrapper)
    }
  }

  const activeCount = document.querySelectorAll(`.${CHART_FULLSCREEN_CLASS}`).length
  document.body.classList.toggle(CHART_FULLSCREEN_BODY_CLASS, activeCount > 0)
}

function closeAllChartFullscreen(): void {
  document.querySelectorAll<HTMLElement>(`.${CHART_FULLSCREEN_CLASS}`).forEach((element) => {
    setChartFullscreen(element, false)
  })
}

let chartFullscreenEscapeBound = false

function ensureChartFullscreenEscapeHandler(): void {
  if (chartFullscreenEscapeBound) return
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllChartFullscreen()
    }
  })
  window.addEventListener('resize', () => {
    document.querySelectorAll<HTMLElement>(`.${CHART_FULLSCREEN_CLASS}`).forEach(applyChartFullscreenSize)
  })
  chartFullscreenEscapeBound = true
}

export function toggleChartFullscreen(wrapper: HTMLElement): void {
  const isActive = wrapper.classList.contains(CHART_FULLSCREEN_CLASS)
  if (isActive) {
    setChartFullscreen(wrapper, false)
    return
  }

  closeAllChartFullscreen()
  setChartFullscreen(wrapper, true)
  ensureChartFullscreenEscapeHandler()
}

/**
 * 图表包装器创建结果
 */
export interface ChartWrapperResult {
  wrapper: HTMLDivElement
  toggleBar: HTMLDivElement
  chartContainer: HTMLDivElement
  codeView: HTMLDivElement
}

/**
 * 创建图表通用 DOM 包装结构
 *
 * 生成统一的 wrapper > toggleBar + chartContainer + codeView 结构，
 * 包含返回按钮、复制按钮和代码高亮显示。
 *
 * @param chartType - 图表类型标识（如 'mermaid', 'echarts'）
 * @param code - 原始代码内容
 * @param language - 代码高亮语言（如 'javascript', 'yaml', 'markdown'）
 * @param buttons - 工具栏按钮配置
 */
export function createChartWrapper(
  chartType: string,
  code: string,
  language: string,
  buttons: ToolbarButton[] = TOOLBAR_BUTTONS_WITH_ZOOM
): ChartWrapperResult {
  // 包装容器
  const wrapper = document.createElement('div')
  wrapper.className = `${chartType}-wrapper`
  wrapper.setAttribute(`data-${chartType}-code`, btoa(unescape(encodeURIComponent(code))))

  // 工具栏
  const toggleBar = document.createElement('div')
  toggleBar.className = `${chartType}-toggle-bar no-export`
  toggleBar.innerHTML = buttons
    .map(
      (btn) =>
        `<button class="${chartType}-action-btn" data-action="${btn.action}" title="${btn.title}">${btn.label}</button>`
    )
    .join('\n')

  // 图表容器
  const chartContainer = document.createElement('div')
  chartContainer.className = `${chartType}-container`
  chartContainer.dataset.view = 'chart'
  chartContainer.style.width = '100%'

  // 代码视图
  const codeView = document.createElement('div')
  codeView.className = `${chartType}-code-view`
  codeView.dataset.view = 'code'
  codeView.style.display = 'none'

  // 返回按钮
  const backBtn = document.createElement('button')
  backBtn.className = `${chartType}-back-btn no-export`
  backBtn.textContent = '图表'
  backBtn.title = '返回图表视图'
  codeView.appendChild(backBtn)

  // 复制按钮
  const copyBtn = document.createElement('button')
  copyBtn.className = 'copy-btn no-export'
  copyBtn.textContent = '复制'
  copyBtn.title = `复制 ${chartType.charAt(0).toUpperCase() + chartType.slice(1)} 代码`
  codeView.appendChild(copyBtn)

  // 代码高亮
  const codeElement = document.createElement('code')
  codeElement.className = `language-${language}`
  if (Prism.languages[language]) {
    codeElement.innerHTML = Prism.highlight(code, Prism.languages[language], language)
  } else {
    codeElement.textContent = code
  }

  const preElement = document.createElement('pre')
  preElement.className = `language-${language}`
  preElement.appendChild(codeElement)
  codeView.appendChild(preElement)

  // 组装
  wrapper.appendChild(toggleBar)
  wrapper.appendChild(chartContainer)
  wrapper.appendChild(codeView)

  return { wrapper, toggleBar, chartContainer, codeView }
}

/**
 * 创建图表切换按钮点击处理器（通用模式）
 *
 * 处理 backBtn（返回图表）和 toggleCode（切换到代码视图）的通用逻辑。
 * 返回一个事件处理函数，可直接用于 addEventListener。
 *
 * @param chartType - 图表类型标识
 */
export function createChartToggleHandler(chartType: string) {
  return (e: MouseEvent) => {
    const target = e.target as HTMLElement

    // 返回图表按钮
    const backBtn = target.closest(`.${chartType}-back-btn`)
    if (backBtn) {
      const wrapper = backBtn.closest(`.${chartType}-wrapper`) as HTMLElement
      if (!wrapper) return
      const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
      const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
      const toggleBar = wrapper.querySelector(`.${chartType}-toggle-bar`) as HTMLElement
      if (chartView) chartView.style.display = ''
      if (codeViewEl) codeViewEl.style.display = 'none'
      if (toggleBar) toggleBar.style.display = ''
      return true // handled
    }

    // 工具栏按钮
    const actionBtn = target.closest(`.${chartType}-action-btn`)
    if (actionBtn) {
      const action = actionBtn.getAttribute('data-action')
      if (action === 'toggleCode') {
        const wrapper = actionBtn.closest(`.${chartType}-wrapper`) as HTMLElement
        if (!wrapper) return false
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector(`.${chartType}-toggle-bar`) as HTMLElement
        if (chartView) chartView.style.display = 'none'
        if (codeViewEl) codeViewEl.style.display = ''
        if (toggleBar) toggleBar.style.display = 'none'
        return true // handled
      }
    }

    return false // not handled
  }
}

interface SvgChartActionOptions {
  filenamePrefix?: string
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
}

function readSvgWidth(svg: SVGSVGElement): number | null {
  const renderedWidth = svg.getBoundingClientRect().width
  if (renderedWidth > 0) return renderedWidth

  const attrWidth = svg.getAttribute('width')
  if (attrWidth && !/%|auto/i.test(attrWidth)) {
    const parsed = Number.parseFloat(attrWidth)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const viewBox = svg.viewBox?.baseVal
  return viewBox && viewBox.width > 0 ? viewBox.width : null
}

function formatSvgWidth(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function applySvgChartZoom(chartType: string, container: HTMLElement, svg: SVGSVGElement, percent: number): void {
  const wrapper = (
    container.closest(`.${chartType}-wrapper`) ||
    (chartType === 'plantuml' ? container.closest('.c4plantuml-wrapper') : null)
  ) as HTMLElement | null
  if (!wrapper) return

  if (wrapper.classList.contains(CHART_FULLSCREEN_CLASS)) {
    if (percent === 100) {
      container.classList.remove('zoomed')
      wrapper.classList.remove('zoomed-wrapper')
      applyChartFullscreenSize(wrapper)
      return
    }

    let baseWidth = Number.parseFloat(container.dataset.fullscreenBaseWidth || '')
    let baseHeight = Number.parseFloat(container.dataset.fullscreenBaseHeight || '')
    if (!(baseWidth > 0) || !(baseHeight > 0)) {
      const renderedSize = readSvgRenderedSize(svg)
      if (!renderedSize) return
      baseWidth = renderedSize.width
      baseHeight = renderedSize.height
      container.dataset.fullscreenBaseWidth = String(baseWidth)
      container.dataset.fullscreenBaseHeight = String(baseHeight)
    }

    const targetWidth = Math.max(1, Math.round(baseWidth * percent / 100))
    const targetHeight = Math.max(1, Math.round(baseHeight * percent / 100))
    wrapper.style.setProperty('--chart-fullscreen-svg-width', `${targetWidth}px`)
    wrapper.style.setProperty('--chart-fullscreen-svg-height', `${targetHeight}px`)
    container.classList.add('zoomed')
    wrapper.classList.toggle('zoomed-wrapper', percent > 100)
    return
  }

  let baseWidth = Number.parseFloat(container.dataset.baseWidth || '')
  if (!(baseWidth > 0)) {
    const measuredWidth = readSvgWidth(svg)
    if (!(measuredWidth && measuredWidth > 0)) return
    baseWidth = measuredWidth
    container.dataset.baseWidth = String(baseWidth)
    container.dataset.origSvgWidth = svg.getAttribute('width') || ''
    container.dataset.origSvgHeight = svg.getAttribute('height') || ''
    container.dataset.origSvgStyle = svg.getAttribute('style') || ''
  }

  if (percent === 100) {
    const origWidth = container.dataset.origSvgWidth
    if (origWidth) {
      svg.setAttribute('width', origWidth)
    } else {
      svg.removeAttribute('width')
    }
    const origHeight = container.dataset.origSvgHeight
    if (origHeight) {
      svg.setAttribute('height', origHeight)
    } else {
      svg.removeAttribute('height')
    }
    const origStyle = container.dataset.origSvgStyle
    if (origStyle) {
      svg.setAttribute('style', origStyle)
    } else {
      svg.removeAttribute('style')
    }
    container.classList.remove('zoomed')
    wrapper.classList.remove('zoomed-wrapper')
    return
  }

  const targetWidth = baseWidth * percent / 100
  const formattedWidth = formatSvgWidth(targetWidth)
  svg.setAttribute('width', formattedWidth)
  svg.removeAttribute('height')
  svg.style.width = `${formattedWidth}px`
  svg.style.maxWidth = 'none'
  svg.style.maxHeight = 'none'
  svg.style.height = 'auto'
  svg.style.display = 'block'
  svg.style.flexShrink = '0'
  container.classList.add('zoomed')
  wrapper.classList.toggle('zoomed-wrapper', percent > 100)
}

export function createSvgChartActionHandler(
  chartType: string,
  options: SvgChartActionOptions = {}
) {
  const toggleHandler = createChartToggleHandler(chartType)
  const filenamePrefix = options.filenamePrefix ?? chartType
  const minZoom = options.minZoom ?? 40
  const maxZoom = options.maxZoom ?? 300
  const zoomStep = options.zoomStep ?? 20

  return (event: MouseEvent): void => {
    if (toggleHandler(event)) return

    const target = event.target as HTMLElement
    const actionBtn = target.closest(`.${chartType}-action-btn`) as HTMLElement | null
    if (!actionBtn) return

    const action = actionBtn.getAttribute('data-action')
    const wrapper = actionBtn.closest(`.${chartType}-wrapper`) as HTMLElement | null
    const container = wrapper?.querySelector(`.${chartType}-container`) as HTMLElement | null
    const svg = container?.querySelector('svg') as SVGSVGElement | null
    if (!wrapper || !container || !action) return
    if (!svg && action !== 'fullscreen') return

    try {
      switch (action) {
        case 'zoomIn': {
          const level = Number.parseInt(container.dataset.zoomLevel || '100', 10)
          const newLevel = Math.min(level + zoomStep, maxZoom)
          container.dataset.zoomLevel = String(newLevel)
          applySvgChartZoom(chartType, container, svg!, newLevel)
          break
        }
        case 'zoomOut': {
          const level = Number.parseInt(container.dataset.zoomLevel || '100', 10)
          const newLevel = Math.max(level - zoomStep, minZoom)
          container.dataset.zoomLevel = String(newLevel)
          applySvgChartZoom(chartType, container, svg!, newLevel)
          break
        }
        case 'fit':
          container.dataset.zoomLevel = '100'
          applySvgChartZoom(chartType, container, svg!, 100)
          break
        case 'download':
          downloadSvgAsPng(svg!, `${filenamePrefix}-${Date.now()}`)
          break
        case 'fullscreen':
          toggleChartFullscreen(wrapper)
          break
      }
    } catch (error) {
      console.error(`[${chartType}] 工具栏操作失败:`, error)
    }
  }
}
