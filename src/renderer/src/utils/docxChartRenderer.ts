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

type ChartType = 'echarts' | 'mermaid' | 'dot' | 'graphviz' | 'markmap' | 'plantuml' | 'drawio'

const CHART_LANGS = new Set<string>([
  'echarts', 'mermaid', 'dot', 'graphviz', 'markmap', 'plantuml', 'drawio',
])

const CODE_BLOCK_RE = /```(\w+)\n([\s\S]*?)```/g

const CONTAINER_CLASS_MAP: Record<string, string> = {
  mermaid: 'mermaid-container',
  echarts: 'echarts-container',
  dot: 'graphviz-container',
  graphviz: 'graphviz-container',
  markmap: 'markmap-container',
  plantuml: 'plantuml-container',
  drawio: 'drawio-container',
}

const DOCX_CHART_SAFE_PADDING_PX = 32
const DOCX_CHART_TRIM_PADDING_PX = DOCX_CHART_SAFE_PADDING_PX * 2
const DOCX_CHART_WHITE_THRESHOLD = 248
const DOCX_CHART_ALPHA_THRESHOLD = 16
const DOCX_CHART_MAX_MARGIN_RATIO = 0.18

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
  // 高窄图表（如雷达图、思维导图）常通过左右留白保持页面友好的纵横比，只裁上下同时过大的框式白边。
  const hasExcessiveVerticalFrame = topMargin > maxMarginRatio && bottomMargin > maxMarginRatio
  if (!hasExcessiveVerticalFrame) {
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

function grabNthSvgFromDom(containerClass: string, nth: number): string | null {
  const svgs = document.querySelectorAll<SVGSVGElement>(
    `.split-leaf-panel.active .${containerClass} svg, .markdown-body .${containerClass} svg`
  )
  const svg = svgs[nth]
  if (!svg) return null

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

async function renderChartCodeToPng(
  type: ChartType,
  code: string,
  globalIndex: number,
  typeIndex: number,
): Promise<{ pngBase64: string } | null> {
  try {
    let svgString: string | null = null

    // DrawIO 直接从 DOM 抓（无法离线重新渲染）
    if (type === 'drawio') {
      svgString = grabNthSvgFromDom('drawio-container', typeIndex)
      if (!svgString) {
        console.warn(`[DocxChart] drawio #${globalIndex}: DOM SVG not found (index=${typeIndex})`)
        return null
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
            svgString = await renderPlantUMLToSvg(code)
            break
        }
      } catch (renderErr) {
        console.warn(`[DocxChart] ${type} #${globalIndex}: renderer threw:`, renderErr)
        svgString = null
      }

      // 渲染器失败或返回错误 HTML → DOM fallback
      const isError = !svgString || (svgString.includes('error') && svgString.includes('<div')) || !svgString.includes('<svg')
      if (isError) {
        const containerClass = CONTAINER_CLASS_MAP[type]
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
    if (pngBase64) return { pngBase64 }

    return null
  } catch (err) {
    console.warn(`[DocxChart] ${type} #${globalIndex} render failed:`, err)
    return null
  }
}

export async function renderChartsForDocx(
  markdown: string,
  onProgress?: (current: number, total: number, type: string) => void
): Promise<ChartRenderResult> {
  const images: ChartImage[] = []
  const warnings: string[] = []

  const blocks: { fullMatch: string; lang: string; code: string }[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(CODE_BLOCK_RE.source, CODE_BLOCK_RE.flags)
  while ((match = re.exec(markdown)) !== null) {
    const lang = match[1].toLowerCase()
    if (CHART_LANGS.has(lang)) {
      blocks.push({ fullMatch: match[0], lang, code: match[2] })
    }
  }

  if (blocks.length === 0) {
    return { modifiedMarkdown: markdown, images, warnings }
  }

  // 计算每个 block 在同类型中的序号（用于 DOM fallback 索引）
  const typeCounters: Record<string, number> = {}
  const typeIndices: number[] = []
  for (const block of blocks) {
    const key = block.lang === 'graphviz' ? 'dot' : block.lang
    typeCounters[key] = (typeCounters[key] || 0)
    typeIndices.push(typeCounters[key]++)
  }

  let modifiedMarkdown = markdown

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    onProgress?.(i + 1, blocks.length, block.lang)

    const result = await renderChartCodeToPng(block.lang as ChartType, block.code, i, typeIndices[i])

    if (result) {
      const placeholderId = generatePlaceholderId()
      images.push({
        id: placeholderId,
        pngBase64: result.pngBase64,
        widthCm: 15.5,
      })
      modifiedMarkdown = modifiedMarkdown.replace(block.fullMatch, `![](${placeholderId})`)
    } else {
      warnings.push(`chart_${i} (${block.lang}) render failed`)
    }
  }

  return { modifiedMarkdown, images, warnings }
}
