const BLOCKED_SVG_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed'])
const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src'])
const IRI_ATTRIBUTES = new Set([
  'clip-path',
  'cursor',
  'filter',
  'fill',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
])

interface SvgTextClassStyle {
  fontFamily?: string
  fontSize?: string
}

function containsUnsafeCssUrl(value: string): boolean {
  if (/javascript\s*:/i.test(value) || /@import/i.test(value)) return true

  for (const match of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const url = (match[2] || '').trim()
    if (!isSafeReference(url) && !isAllowedInlineFont(url)) return true
  }

  return false
}

function isAllowedInlineImage(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value.trim())
}

function isAllowedInlineFont(value: string): boolean {
  return /^data:(?:font\/(?:woff2?|ttf|otf)|application\/(?:x-)?font-(?:woff2?|ttf|otf));base64,/i.test(value.trim())
}

function isSafeReference(value: string): boolean {
  const clean = value.trim()
  return clean === '' || clean.startsWith('#') || isAllowedInlineImage(clean)
}

function isSafeFontPresentationValue(value: string): boolean {
  return value !== '' && !/[<>]/.test(value) && !/url\s*\(|javascript\s*:|@import/i.test(value)
}

function parseCssDeclarations(css: string): Map<string, string> {
  const declarations = new Map<string, string>()
  for (const declaration of css.split(';')) {
    const [rawName, ...rawValue] = declaration.split(':')
    const name = rawName?.trim().toLowerCase()
    const value = rawValue.join(':').trim()
    if (name && isSafeFontPresentationValue(value)) declarations.set(name, value)
  }
  return declarations
}

function collectTextClassStyles(root: Element): Map<string, SvgTextClassStyle> {
  const styles = new Map<string, SvgTextClassStyle>()
  for (const styleElement of Array.from(root.querySelectorAll('style'))) {
    const css = styleElement.textContent || ''
    for (const match of css.matchAll(/\btext\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
      const declarations = parseCssDeclarations(match[2] || '')
      const fontFamily = declarations.get('font-family')
      const fontSize = declarations.get('font-size')
      if (!fontFamily && !fontSize) continue
      styles.set(match[1], { fontFamily, fontSize })
    }
  }
  return styles
}

function inlineTextClassPresentationAttributes(root: Element): void {
  const textClassStyles = collectTextClassStyles(root)
  if (textClassStyles.size === 0) return

  for (const element of Array.from(root.querySelectorAll('text, tspan'))) {
    for (const className of Array.from(element.classList)) {
      const style = textClassStyles.get(className)
      if (!style) continue
      if (style.fontFamily && !element.hasAttribute('font-family')) {
        element.setAttribute('font-family', style.fontFamily)
      }
      if (style.fontSize && !element.hasAttribute('font-size')) {
        element.setAttribute('font-size', style.fontSize)
      }
      break
    }
  }
}

function stripDangerousSvgByRegex(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:href|xlink:href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '')
}

export function sanitizeRendererSvg(svg: string): string {
  if (!svg || !/<svg[\s>]/i.test(svg)) return svg
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return stripDangerousSvgByRegex(svg)
  }

  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName.toLowerCase() !== 'svg') {
    return ''
  }

  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT)
  const elements: Element[] = []
  let current = walker.currentNode as Element | null
  while (current) {
    elements.push(current)
    current = walker.nextNode() as Element | null
  }

  for (const element of elements) {
    const name = element.localName.toLowerCase()
    if (BLOCKED_SVG_ELEMENTS.has(name)) {
      element.remove()
      continue
    }

    if (name === 'style' && containsUnsafeCssUrl(element.textContent || '')) {
      element.remove()
      continue
    }

    for (const attribute of Array.from(element.attributes)) {
      const attrName = attribute.name.toLowerCase()
      const attrValue = attribute.value
      if (attrName.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (attrName === 'style' && containsUnsafeCssUrl(attrValue)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (URL_ATTRIBUTES.has(attrName) && !isSafeReference(attrValue)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (IRI_ATTRIBUTES.has(attrName) && containsUnsafeCssUrl(attrValue)) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  inlineTextClassPresentationAttributes(doc.documentElement)

  return new XMLSerializer().serializeToString(doc.documentElement)
}

interface RendererSvgResponsiveOptions {
  maxWidth?: number
  minWidth?: number
  cssMaxWidth?: string
}

function readSvgNumber(value: string | null): number | null {
  if (!value || /%|auto/i.test(value)) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readViewBoxSize(value: string | null): { width: number; height: number } | null {
  if (!value) return null
  const parts = value.trim().split(/[\s,]+/).map(Number.parseFloat)
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null
  const width = parts[2]
  const height = parts[3]
  return width > 0 && height > 0 ? { width, height } : null
}

function formatSvgNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function mergeResponsiveStyle(currentStyle: string | null, maxWidth: string): string {
  const declarations = new Map<string, string>()
  for (const item of (currentStyle || '').split(';')) {
    const [rawName, ...rawValue] = item.split(':')
    const name = rawName?.trim()
    const value = rawValue.join(':').trim()
    if (name && value) declarations.set(name.toLowerCase(), value)
  }
  declarations.set('max-width', maxWidth)
  declarations.set('height', 'auto')
  declarations.set('display', 'block')
  return Array.from(declarations.entries()).map(([name, value]) => `${name}: ${value}`).join('; ')
}

function getResponsiveWidth(root: Element, options: RendererSvgResponsiveOptions): number | null {
  const maxWidth = options.maxWidth ?? 960
  const minWidth = options.minWidth ?? 0
  const viewBoxSize = readViewBoxSize(root.getAttribute('viewBox'))
  const intrinsicWidth = readSvgNumber(root.getAttribute('width')) || viewBoxSize?.width
  if (!intrinsicWidth) return null
  return Math.min(Math.max(intrinsicWidth, minWidth), maxWidth)
}

export function makeRendererSvgResponsive(svg: string, options: RendererSvgResponsiveOptions = {}): string {
  if (!svg || !/<svg[\s>]/i.test(svg)) return svg
  const cssMaxWidth = options.cssMaxWidth ?? '100%'
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return svg
      .replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
        const patched = attrs
          .replace(/\s+height=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
          .replace(/\s+style=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        return `<svg${patched} style="max-width: ${cssMaxWidth}; height: auto; display: block;" preserveAspectRatio="xMidYMid meet">`
      })
  }

  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') return svg

  const width = root.getAttribute('width')
  const height = root.getAttribute('height')
  if (!root.getAttribute('viewBox') && width && height) {
    const numericWidth = Number.parseFloat(width)
    const numericHeight = Number.parseFloat(height)
    if (Number.isFinite(numericWidth) && Number.isFinite(numericHeight) && numericWidth > 0 && numericHeight > 0) {
      root.setAttribute('viewBox', `0 0 ${numericWidth} ${numericHeight}`)
    }
  }

  const responsiveWidth = getResponsiveWidth(root, options)
  if (responsiveWidth) {
    root.setAttribute('width', formatSvgNumber(responsiveWidth))
  }
  root.removeAttribute('height')
  root.setAttribute('style', mergeResponsiveStyle(root.getAttribute('style'), cssMaxWidth))
  if (!root.getAttribute('preserveAspectRatio')) {
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  }

  return new XMLSerializer().serializeToString(root)
}
