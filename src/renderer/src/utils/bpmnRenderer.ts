import { cleanUserFacingError } from './userFacingErrors'
import { escapeHtml, rendererErrorHtml, serializeTemplate } from './d2Renderer'
import { makeRendererSvgResponsive, sanitizeRendererSvg } from './rendererSvgSanitizer'

export interface BpmnHtmlOptions {
  markdownFilePath?: string
}

export type BpmnValidationResult =
  | { ok: true; xml: string }
  | { ok: false; code: 'BPMN_EMPTY_SOURCE' | 'BPMN_INVALID_XML'; message: string }

type BpmnValidationErrorCode = Extract<BpmnValidationResult, { ok: false }>['code']

export type BpmnRenderResult =
  | { ok: true; svg: string }
  | { ok: false; code: BpmnValidationErrorCode | 'BPMN_RENDER_FAILED' | 'BPMN_FILE_READ_FAILED'; message: string }

const BPMN_EXTENSION_RE = /\.bpmn(?:[?#].*)?$/i
const BPMN_HTML_REF_RE = /\.bpmn(?:[?#][^"'<>\s]*)?/i
const BPMN_DEFAULT_STROKE = 'rgb(34, 36, 42)'

export function cleanBpmnRefPath(refPath: string): string {
  return refPath.split(/[?#]/, 1)[0] || refPath
}

export function validateBpmnSource(source: string): BpmnValidationResult {
  const xml = source.trim()
  if (!xml) return { ok: false, code: 'BPMN_EMPTY_SOURCE', message: 'BPMN 内容为空' }

  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    return {
      ok: false,
      code: 'BPMN_INVALID_XML',
      message: parseError.textContent?.trim() || 'BPMN XML 格式错误',
    }
  }
  if (!doc.documentElement || !/definitions$/i.test(doc.documentElement.localName || doc.documentElement.nodeName)) {
    return { ok: false, code: 'BPMN_INVALID_XML', message: 'BPMN XML 必须包含 definitions 根节点' }
  }
  return { ok: true, xml }
}

function ensureBpmnSvgDomApis(): void {
  const prototype = typeof SVGElement !== 'undefined' ? SVGElement.prototype as SVGElement & {
    getBBox?: () => { x: number; y: number; width: number; height: number }
    getScreenCTM?: () => DOMMatrix
  } : null
  if (!prototype) return
  if (typeof prototype.getBBox !== 'function') {
    prototype.getBBox = function getBBox() {
      const rect = this.getBoundingClientRect?.()
      return {
        x: 0,
        y: 0,
        width: rect?.width || 1200,
        height: rect?.height || 800,
      }
    }
  }
  if (typeof prototype.getScreenCTM !== 'function' && typeof DOMMatrix !== 'undefined') {
    prototype.getScreenCTM = () => new DOMMatrix()
  }
}

export function resolveBpmnRefPath(markdownFilePath: string | undefined, refPath: string): string {
  const cleanRef = cleanBpmnRefPath(refPath).replace(/\\/g, '/')
  const hasUrlScheme = /^[a-z][a-z0-9+.-]*:/i.test(cleanRef)
  const isWindowsAbsolutePath = /^[a-z]:[\\/]/i.test(cleanRef)
  if (hasUrlScheme && !isWindowsAbsolutePath) {
    throw new Error('不支持 URL 形式的 .bpmn 文件')
  }
  if (!BPMN_EXTENSION_RE.test(cleanRef)) {
    throw new Error('只能读取 .bpmn 文件')
  }
  if (cleanRef.split('/').includes('..')) {
    throw new Error('不能引用 Markdown 所在目录之外的 .bpmn 文件')
  }
  if (!markdownFilePath) {
    throw new Error('缺少 Markdown 文件路径，无法读取 BPMN 文件')
  }
  return cleanRef
}

export function resolveBpmnFallbackPath(markdownFilePath: string, refPath: string): string {
  const cleanRef = resolveBpmnRefPath(markdownFilePath, refPath)
  const separator = markdownFilePath.includes('\\') ? '\\' : '/'
  if (/^(?:\/|[a-z]:[\\/])/i.test(cleanRef)) return cleanRef

  const baseDir = markdownFilePath.replace(/[/\\][^/\\]*$/, '')
  const parts = `${baseDir}${separator}${cleanRef}`.replace(/\\/g, '/').split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    normalized.push(part)
  }
  const prefix = markdownFilePath.startsWith('/') ? '/' : ''
  return `${prefix}${normalized.join('/')}`
}

export function isMissingReadBpmnFileHandlerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /No handler registered[^'"]*['"]fs:readBpmnFile['"]/i.test(message)
    || /['"]fs:readBpmnFile['"][^N]*No handler registered/i.test(message)
}

function isSingleCjkCharacter(value: string): boolean {
  return /^[\u3400-\u9fff\uf900-\ufaff]$/.test(value.trim())
}

function mergeShortCjkLabelTspans(root: Element): void {
  const labels = Array.from(root.querySelectorAll('text.djs-label'))
  for (const label of labels) {
    const tspans = Array.from(label.children).filter(element => element.localName.toLowerCase() === 'tspan')
    if (tspans.length < 2 || tspans.length > 6) continue

    const parts = tspans.map(tspan => tspan.textContent?.trim() || '')
    if (!parts.every(isSingleCjkCharacter)) continue

    const first = tspans[0]
    const merged = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'tspan')
    for (const attr of Array.from(first.attributes)) {
      merged.setAttribute(attr.name, attr.value)
    }
    merged.textContent = parts.join('')

    for (const tspan of tspans) {
      tspan.remove()
    }
    label.appendChild(merged)
  }
}

function normalizeBpmnExportSvg(svg: string): string {
  if (!svg || !/<svg[\s>]/i.test(svg)) return svg
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svg

  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') return svg

  const connectionVisuals = Array.from(root.querySelectorAll('.djs-element.djs-connection > .djs-visual'))
  for (const visual of connectionVisuals) {
    const endMarker = visual.querySelector('defs marker[id]')
    const markerId = endMarker?.getAttribute('id')?.trim()
    const paths = Array.from(visual.children).filter(element => {
      const className = element.getAttribute('class') || ''
      return element.localName.toLowerCase() === 'path'
        && element.hasAttribute('data-corner-radius')
        && !className.split(/\s+/).includes('djs-hit')
    })

    for (const path of paths) {
      if (!path.getAttribute('fill')) path.setAttribute('fill', 'none')
      if (!path.getAttribute('stroke')) path.setAttribute('stroke', BPMN_DEFAULT_STROKE)
      if (!path.getAttribute('stroke-width')) path.setAttribute('stroke-width', '2')
      if (!path.getAttribute('stroke-linecap')) path.setAttribute('stroke-linecap', 'round')
      if (!path.getAttribute('stroke-linejoin')) path.setAttribute('stroke-linejoin', 'round')
      if (markerId && !path.getAttribute('marker-end')) {
        path.setAttribute('marker-end', `url(#${markerId})`)
      }
    }
  }
  mergeShortCjkLabelTspans(root)

  return new XMLSerializer().serializeToString(root)
}

export async function renderBpmnToSvg(source: string): Promise<BpmnRenderResult> {
  const validation = validateBpmnSource(source)
  if (!validation.ok) return validation
  if (typeof document === 'undefined') {
    return { ok: false, code: 'BPMN_RENDER_FAILED', message: '当前环境不支持 BPMN 渲染' }
  }
  ensureBpmnSvgDomApis()

  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = '1200px'
  container.style.height = '800px'
  document.body.appendChild(container)

  let viewer: { importXML: (xml: string) => Promise<unknown>; saveSVG: () => Promise<{ svg: string }>; destroy: () => void } | null = null
  try {
    const mod = await import('bpmn-js/lib/Viewer')
    const BpmnViewer = mod.default as new (options: { container: HTMLElement }) => NonNullable<typeof viewer>
    viewer = new BpmnViewer({ container })
    await viewer.importXML(validation.xml)
    const { svg } = await viewer.saveSVG()
    return { ok: true, svg: makeRendererSvgResponsive(sanitizeRendererSvg(normalizeBpmnExportSvg(svg))) }
  } catch (error) {
    return { ok: false, code: 'BPMN_RENDER_FAILED', message: cleanUserFacingError(error) }
  } finally {
    viewer?.destroy()
    container.remove()
  }
}

async function readBpmnForExport(markdownFilePath: string | undefined, refPath: string): Promise<string> {
  const cleanRef = resolveBpmnRefPath(markdownFilePath, refPath)
  if (!window.api?.readBpmnFile && typeof window.api?.readFile === 'function' && markdownFilePath) {
    return window.api.readFile(resolveBpmnFallbackPath(markdownFilePath, cleanRef))
  }
  if (!window.api?.readBpmnFile) throw new Error('当前环境不支持读取 BPMN 文件')
  try {
    const result = await window.api.readBpmnFile({
      markdownFilePath: markdownFilePath || '',
      refPath: cleanRef,
    })
    return result.content
  } catch (error) {
    if (markdownFilePath && typeof window.api?.readFile === 'function' && isMissingReadBpmnFileHandlerError(error)) {
      return window.api.readFile(resolveBpmnFallbackPath(markdownFilePath, cleanRef))
    }
    throw error
  }
}

async function renderBpmnReferenceForExport(
  refPath: string,
  label: string,
  options: BpmnHtmlOptions
): Promise<HTMLElement> {
  const wrapper = document.createElement('div')
  wrapper.className = 'bpmn-wrapper'
  wrapper.setAttribute('role', 'group')
  try {
    const source = await readBpmnForExport(options.markdownFilePath, refPath)
    const result = await renderBpmnToSvg(source)
    wrapper.innerHTML = result.ok
      ? `<div class="bpmn-container" aria-label="${escapeHtml(label || refPath)}">${result.svg}</div>`
      : rendererErrorHtml('BPMN 渲染失败', result.message, 'bpmn-error')
  } catch (error) {
    wrapper.className = 'bpmn-error'
    wrapper.setAttribute('role', 'alert')
    wrapper.innerHTML = rendererErrorHtml('BPMN 渲染失败', cleanUserFacingError(error), 'bpmn-error')
  }
  return wrapper
}

export async function processBpmnInHtml(html: string, options: BpmnHtmlOptions = {}): Promise<string> {
  if (!/\blanguage-bpmn\b/i.test(html) && !BPMN_HTML_REF_RE.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content

  const blocks = Array.from(root.querySelectorAll('pre.language-bpmn'))
  for (const block of blocks) {
    const result = await renderBpmnToSvg(block.textContent || '')
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'bpmn-wrapper' : 'bpmn-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.innerHTML = result.ok
      ? `<div class="bpmn-container">${result.svg}</div>`
      : rendererErrorHtml('BPMN 渲染失败', result.message, 'bpmn-error')
    block.replaceWith(wrapper)
  }

  const placeholders = Array.from(root.querySelectorAll<HTMLElement>('.bpmn-file-placeholder'))
  for (const placeholder of placeholders) {
    const src = placeholder.dataset.bpmnSrc || ''
    const label = placeholder.dataset.bpmnAlt || src
    const wrapper = await renderBpmnReferenceForExport(src, label, options)
    placeholder.replaceWith(wrapper)
  }

  const imgs = Array.from(root.querySelectorAll('img')).filter(img => BPMN_EXTENSION_RE.test(img.getAttribute('src') || ''))
  for (const img of imgs) {
    const src = img.getAttribute('src') || ''
    const wrapper = await renderBpmnReferenceForExport(src, img.getAttribute('alt') || src, options)
    img.replaceWith(wrapper)
  }

  return serializeTemplate(template)
}
