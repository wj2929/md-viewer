/**
 * 统一的 HTML 导出内容构建
 *
 * 为什么统一到这一条路径：
 * 历史上 useExport.ts（clone DOM）和 useIPC.ts（读磁盘重渲染）两条路径并存，
 * 每次加新图表类型都得两边同步，历史 bug 多次因此复发（Mermaid 配置、DrawIO 支持、
 * ECharts 是否注册等）。现在两条路径（预览区右键、文件树右键）都调这个函数。
 *
 * 取舍（已和用户确认）：
 * - 导出基于磁盘文件，不反映编辑器未保存的修改（md-viewer 本来就是只读预览器）
 * - 预览的缩放/视图切换不带到导出里
 * - DrawIO 图能否导出取决于"文件已打开 + 滚过 drawio 块"（drawio 不能离线渲染）
 */

import { createMarkdownRenderer } from './markdownRenderer'
import { processMermaidInHtml } from './mermaidRenderer'
import { processEChartsInHtml } from './echartsRenderer'
import { processInfographicInHtml } from './infographicRenderer'
import { processMarkmapInHtml } from './markmapRenderer'
import { processGraphvizInHtml } from './graphvizRenderer'
import { processDrawioInHtml } from './drawioRenderer'
import { processPlantUMLInHtml } from './plantumlRenderer'
import { renderExcalidrawToSvg } from './excalidrawRenderer'
import { processVegaLiteInHtml } from './vegaLiteRenderer'
import { processD2InHtml } from './d2Renderer'
import { processBpmnInHtml } from './bpmnRenderer'
import { processWaveDromInHtml } from './wavedromRenderer'
import { processStructurizrInHtml } from './structurizrRenderer'
import { processPlotlyInHtml } from './plotlyRenderer'
import { processDbmlInHtml } from './dbmlRenderer'
import { processAntvG6InHtml } from './antvG6Renderer'
import { processKrokiInHtml } from './krokiRenderer'
import { cleanUserFacingError } from './userFacingErrors'

export interface ExportHtmlOptions {
  markdownFilePath?: string
}

const LOCAL_IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i
const DRAWIO_EXPORT_MAX_HEIGHT_PX = 680
const DRAWIO_EXPORT_TALL_RATIO = 1.25

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isEmbeddableLocalImageSrc(src: string): boolean {
  if (!src) return false
  if (/^(?:https?:|data:|blob:|local-image:)/i.test(src)) return false
  if (/\.excalidraw(?:[?#].*)?$/i.test(src)) return false
  if (/\.bpmn(?:[?#].*)?$/i.test(src)) return false
  return LOCAL_IMAGE_EXTENSIONS.test(src)
}

async function embedLocalImagesInHtml(html: string, options: ExportHtmlOptions = {}): Promise<string> {
  if (!options.markdownFilePath || !window.api?.readLocalAssetBase64) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'))

  for (const img of images) {
    const src = img.getAttribute('src') || ''
    if (!isEmbeddableLocalImageSrc(src)) continue

    try {
      const result = await window.api.readLocalAssetBase64({
        markdownFilePath: options.markdownFilePath,
        refPath: safeDecodeURIComponent(src),
      })
      img.setAttribute('src', `data:${result.mimeType};base64,${result.base64}`)
    } catch (error) {
      console.warn('[exportHtml] 本地图片导出内嵌失败:', src, error)
    }
  }

  return serializeFragment(root)
}

/**
 * 借预览 DOM 里已渲染的 DrawIO SVG 覆盖导出 HTML 里的占位。
 * 选取当前活动预览面板下的 .drawio-container svg，顺序替换 HTML 字符串里
 * processDrawioInHtml 生成的占位 <div>。
 *
 * drawio 预览 SVG 默认没 viewBox + 没 width/height，独立浏览器打开会按 300x150
 * 默认尺寸显示一小块，必须补 viewBox + 清尺寸属性。
 */
function overrideDrawioWithPreviewSvgs(html: string): string {
  if (typeof document === 'undefined') return html
  const previewSvgs = document.querySelectorAll<SVGSVGElement>(
    '.split-leaf-panel.active .drawio-container svg, .markdown-body .drawio-container svg'
  )
  if (previewSvgs.length === 0) return html

  let idx = 0
  return html.replace(
    /<div class="drawio-container" style="[^"]*"[^>]*>DrawIO 图表（需在应用内查看）<\/div>/g,
    () => {
      const svg = previewSvgs[idx++]
      if (!svg) {
        return '<div class="drawio-container" style="width: 100%; text-align: center; padding: 20px; border: 1px dashed #ccc; color: #999;">DrawIO 图表（需在应用内查看）</div>'
      }
      const cloned = svg.cloneNode(true) as SVGSVGElement

      normalizeDrawioSvgForExport(cloned, svg)
      return `<div class="drawio-container" style="width: 100%; text-align: center; margin: 1.5em 0;">${cloned.outerHTML}</div>`
    }
  )
}

interface SvgBounds {
  x: number
  y: number
  width: number
  height: number
}

function transformSvgPoint(matrix: DOMMatrixReadOnly, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

function mergeSvgBounds(bounds: SvgBounds | null, next: SvgBounds): SvgBounds {
  if (!bounds) return next
  const minX = Math.min(bounds.x, next.x)
  const minY = Math.min(bounds.y, next.y)
  const maxX = Math.max(bounds.x + bounds.width, next.x + next.width)
  const maxY = Math.max(bounds.y + bounds.height, next.y + next.height)
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function getVisibleSvgBounds(svg: SVGSVGElement): SvgBounds | null {
  const ctm = svg.getScreenCTM()
  if (!ctm) return null

  const inverse = ctm.inverse()
  let bounds: SvgBounds | null = null
  const includeTags = new Set([
    'rect',
    'path',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'image',
    'use',
    'text',
  ])
  const skipTags = new Set(['defs', 'clipPath', 'mask', 'title', 'desc', 'metadata', 'style', 'foreignObject', 'g'])

  for (const element of Array.from(svg.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase()
    if (skipTags.has(tag)) continue
    if (!includeTags.has(tag)) continue

    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue

    const rect = element.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) continue

    const points = [
      transformSvgPoint(inverse, rect.left, rect.top),
      transformSvgPoint(inverse, rect.right, rect.top),
      transformSvgPoint(inverse, rect.left, rect.bottom),
      transformSvgPoint(inverse, rect.right, rect.bottom),
    ]
    const minX = Math.min(...points.map(point => point.x))
    const minY = Math.min(...points.map(point => point.y))
    const maxX = Math.max(...points.map(point => point.x))
    const maxY = Math.max(...points.map(point => point.y))
    bounds = mergeSvgBounds(bounds, {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    })
  }

  if (bounds && bounds.width > 0 && bounds.height > 0) {
    return bounds
  }

  try {
    const b = svg.getBBox()
    if (b.width > 0 && b.height > 0) {
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }
  } catch {
    // ignore
  }

  const rect = svg.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return { x: 0, y: 0, width: rect.width, height: rect.height }
  }

  return null
}

export function normalizeDrawioSvgForExport(svg: SVGSVGElement, sourceSvg: SVGSVGElement = svg): boolean {
  if (svg.getAttribute('viewBox')) return false

  const bounds = getVisibleSvgBounds(sourceSvg)
  if (!bounds) return false

  const pad = 10
  const exportWidth = bounds.width + pad * 2
  const exportHeight = bounds.height + pad * 2
  svg.setAttribute(
    'viewBox',
    `${bounds.x - pad} ${bounds.y - pad} ${exportWidth} ${exportHeight}`
  )
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  const heightToWidthRatio = exportHeight / exportWidth
  const widthStyle = heightToWidthRatio > DRAWIO_EXPORT_TALL_RATIO
    ? `min(100%, ${Math.min(Math.round(exportWidth), Math.max(120, Math.round((exportWidth / exportHeight) * DRAWIO_EXPORT_MAX_HEIGHT_PX)))}px)`
    : `min(100%, ${Math.round(exportWidth)}px)`
  svg.setAttribute('style', `width: ${widthStyle}; max-height: ${DRAWIO_EXPORT_MAX_HEIGHT_PX}px; height: auto; display: block; margin: 0 auto;`)
  return true
}

/**
 * 让 Graphviz / PlantUML / Infographic 产出的 SVG 自适应容器宽度。
 *
 * 这类 WASM / 服务端渲染产物通常自带 width="1800" height="600" 硬像素属性
 * （因为它们是按原始坐标系渲染的）。独立 HTML 里容器 max-width:900 时会横向
 * 溢出被浏览器裁切或 PDF 按纸张边缘裁掉。
 *
 * 只要剥掉硬编码的 width/height，保留 viewBox，并用自身 viewBox 宽度作为
 * `width: min(100%, Xpx)` 上限，浏览器就会在小图不放大、大图可缩小之间取平衡。
 *
 * 为什么用正则而不是 DOMParser：
 * 1. 字符串替换阶段只有 HTML 片段，没有 DOM
 * 2. 实测每个容器内部 SVG 是单层，正则可读且稳定
 */
function makeSvgsResponsiveInContainers(html: string, containerClasses: string[]): string {
  const parseViewBoxWidth = (attrs: string): number | null => {
    const match = attrs.match(/\sviewBox=(["'])([^"']+)\1/i)
    if (!match) return null
    const parts = match[2].trim().split(/[\s,]+/).map(Number)
    const width = parts[2]
    return Number.isFinite(width) && width > 0 ? width : null
  }

  const parseDimensionPx = (attrs: string, name: 'width' | 'height'): number | null => {
    const match = attrs.match(new RegExp(`\\s${name}=(["'])([^"']+)\\1`, 'i'))
    if (!match) return null
    const value = match[2].trim()
    const number = Number.parseFloat(value)
    if (!Number.isFinite(number) || number <= 0) return null
    if (/pt$/i.test(value)) return number * (4 / 3)
    if (/in$/i.test(value)) return number * 96
    if (/cm$/i.test(value)) return number * (96 / 2.54)
    if (/mm$/i.test(value)) return number * (96 / 25.4)
    return number
  }

  for (const cls of containerClasses) {
    // 匹配 <div class="xxx-container" ...>...<svg ...>...</svg>...</div>
    // 非贪婪，且限定在单个容器内
    const containerRe = new RegExp(
      `(<div class="${cls}"[^>]*>)([\\s\\S]*?)(<\\/div>)`,
      'g'
    )
    html = html.replace(containerRe, (_full, open, inner, close) => {
      // 只改第一个 <svg ...> 开始标签
      const patched = inner.replace(
        /<svg\b([^>]*)>/,
        (_svgTag: string, attrs: string) => {
          const viewBoxWidth = parseViewBoxWidth(attrs)
          const widthPx = viewBoxWidth ?? parseDimensionPx(attrs, 'width')
          // 去掉硬编码的 width / height
          let a = attrs
            .replace(/\s+width="[^"]*"/gi, '')
            .replace(/\s+height="[^"]*"/gi, '')
            .replace(/\s+width='[^']*'/gi, '')
            .replace(/\s+height='[^']*'/gi, '')
          // 合并/追加 style
          const widthStyle = widthPx ? `width: min(100%, ${Math.round(widthPx)}px);` : 'max-width: 100%;'
          const responsiveStyle = `${widthStyle} height: auto; display: block; margin: 0 auto;`
          if (/\s+style="[^"]*"/i.test(a)) {
            a = a.replace(/\s+style="([^"]*)"/i, (_s, existing) => ` style="${existing}; ${responsiveStyle}"`)
          } else {
            a += ` style="${responsiveStyle}"`
          }
          // preserveAspectRatio 没就加
          if (!/\bpreserveAspectRatio\s*=/i.test(a)) {
            a += ' preserveAspectRatio="xMidYMid meet"'
          }
          return `<svg${a}>`
        }
      )
      return `${open}${patched}${close}`
    })
  }
  return html
}

function cleanExcalidrawRefPath(refPath: string): string {
  return refPath.split(/[?#]/, 1)[0] || refPath
}

function hasExcalidrawHtml(html: string): boolean {
  return /\blanguage-excalidraw\b/i.test(html) || /\.excalidraw(?:[?#][^"'\s<>]*)?/i.test(html)
}

function serializeFragment(fragment: DocumentFragment): string {
  const container = document.createElement('div')
  container.appendChild(fragment.cloneNode(true))
  return container.innerHTML
}

async function readExcalidrawForExport(markdownFilePath: string | undefined, refPath: string): Promise<string> {
  if (!markdownFilePath) throw new Error('缺少 Markdown 文件路径，无法导出 Excalidraw 文件引用')
  if (!window.api?.readExcalidrawFile) throw new Error('当前环境不支持读取 Excalidraw 文件')
  const result = await window.api.readExcalidrawFile({
    markdownFilePath,
    refPath: cleanExcalidrawRefPath(refPath),
  })
  return result.content
}

function excalidrawErrorHtml(message: string, label: string): string {
  const safeMessage = message.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
  const safeLabel = label.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
  return `<div class="excalidraw-error" role="alert"><div class="error-title">Excalidraw 渲染失败</div><div class="error-message">${safeLabel}: ${safeMessage}</div></div>`
}

export async function processExcalidrawInHtml(html: string, options: ExportHtmlOptions = {}): Promise<string> {
  if (!hasExcalidrawHtml(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content

  const blocks = Array.from(root.querySelectorAll('pre.language-excalidraw'))
  for (const block of blocks) {
    const code = block.textContent || ''
    const result = await renderExcalidrawToSvg(code, { sourceKind: 'code-block' })
    const holder = document.createElement('div')
    holder.className = result.ok ? 'excalidraw-container' : 'excalidraw-error'
    holder.setAttribute('style', 'width:100%; text-align:center; margin:1.5em 0;')
    holder.innerHTML = result.ok ? result.svg : excalidrawErrorHtml(result.error, '代码块')
    block.replaceWith(holder)
  }

  const placeholders = Array.from(root.querySelectorAll<HTMLElement>('.excalidraw-file-placeholder'))
  for (const placeholder of placeholders) {
    const src = placeholder.dataset.excalidrawSrc || ''
    const alt = placeholder.dataset.excalidrawAlt || src
    const holder = document.createElement('div')
    holder.className = 'excalidraw-container'
    holder.setAttribute('style', 'width:100%; text-align:center; margin:1.5em 0;')
    try {
      const code = await readExcalidrawForExport(options.markdownFilePath, src)
      const result = await renderExcalidrawToSvg(code, { sourceKind: 'file-reference', sourceLabel: alt })
      holder.innerHTML = result.ok ? result.svg : excalidrawErrorHtml(result.error, src)
    } catch (error) {
      holder.className = 'excalidraw-error'
      holder.innerHTML = excalidrawErrorHtml(cleanUserFacingError(error), src)
    }
    placeholder.replaceWith(holder)
  }

  const imgs = Array.from(root.querySelectorAll('img')).filter(img => /\.excalidraw(?:[?#].*)?$/i.test(img.getAttribute('src') || ''))
  for (const img of imgs) {
    const src = img.getAttribute('src') || ''
    const alt = img.getAttribute('alt') || src
    const holder = document.createElement('div')
    holder.className = 'excalidraw-container'
    holder.setAttribute('style', 'width:100%; text-align:center; margin:1.5em 0;')
    try {
      const code = await readExcalidrawForExport(options.markdownFilePath, src)
      const result = await renderExcalidrawToSvg(code, { sourceKind: 'file-reference', sourceLabel: alt })
      holder.innerHTML = result.ok ? result.svg : excalidrawErrorHtml(result.error, src)
    } catch (error) {
      holder.innerHTML = excalidrawErrorHtml(cleanUserFacingError(error), src)
    }
    img.replaceWith(holder)
  }

  return serializeFragment(root)
}

/**
 * 把 Markdown 文本构建成导出用的 HTML 内容（不含 HTML 模板外壳，只是 body 内容）。
 * 主进程 ipcMain.handle('export:html') 会再套上 <!DOCTYPE html>... 模板。
 */
export async function buildExportHtmlContent(markdown: string, options: ExportHtmlOptions = {}): Promise<string> {
  const md = createMarkdownRenderer()
  let html = md.render(markdown)

  // 所有图表类型按固定顺序处理
  html = await processMermaidInHtml(html)
  html = await processEChartsInHtml(html)
  html = await processInfographicInHtml(html)
  html = await processMarkmapInHtml(html)
  html = await processGraphvizInHtml(html)
  html = await processExcalidrawInHtml(html, options)
  html = await processDrawioInHtml(html)
  html = await processPlantUMLInHtml(html)
  html = await processVegaLiteInHtml(html)
  html = await processD2InHtml(html)
  html = await processBpmnInHtml(html, options)
  html = await processWaveDromInHtml(html)
  html = await processStructurizrInHtml(html)
  html = await processPlotlyInHtml(html)
  html = await processDbmlInHtml(html)
  html = await processAntvG6InHtml(html)
  html = await processKrokiInHtml(html)
  html = await embedLocalImagesInHtml(html, options)

  // DrawIO 特殊：借预览 DOM 的 SVG 覆盖占位（如果当前有打开的预览）
  html = overrideDrawioWithPreviewSvgs(html)

  // SVG 自适应：剥硬编码 width/height，按自身宽度设置上限，避免小图被撑满整行
  html = makeSvgsResponsiveInContainers(html, [
    'graphviz-container',
    'plantuml-container',
    'infographic-container',
    'excalidraw-container',
    'vega-lite-container',
    'd2-container',
    'bpmn-container',
    'wavedrom-container',
    'structurizr-container',
    'plotly-container',
    'dbml-container',
    'antv-g6-container',
    'kroki-container',
  ])

  return html
}
