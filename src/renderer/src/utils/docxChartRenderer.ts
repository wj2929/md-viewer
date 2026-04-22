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
      const dataUrl = canvas.toDataURL('image/png')
      resolve(dataUrl.replace(/^data:image\/png;base64,/, ''))
    }
    img.onerror = () => reject(new Error('SVG to PNG conversion failed'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData)
  })
}

async function svgToPng(svgString: string, type: string, index: number): Promise<string | null> {
  const hasForeignObject = svgString.includes('foreignObject')

  if (!hasForeignObject) {
    try {
      const b64 = await svgToPngBase64(svgString)
      if (b64 && b64.length > 200) return b64
    } catch { /* canvas failed */ }
  }

  try {
    const result = await window.api.renderSvgToPng(svgString, 1170)
    if (result.success && result.data && result.data.length > 200) return result.data
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
