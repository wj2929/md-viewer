import * as vega from 'vega'
import * as vegaLite from 'vega-lite'
import type { TopLevelSpec } from 'vega-lite'
import { cleanUserFacingError } from './userFacingErrors'
import { sanitizeRendererSvg } from './rendererSvgSanitizer'

export type VegaLiteValidationResult =
  | { ok: true; spec: Record<string, unknown> }
  | { ok: false; code: 'VEGA_LITE_INVALID_JSON' | 'VEGA_LITE_EXTERNAL_DATA_BLOCKED' | 'VEGA_LITE_INVALID_SPEC'; message: string }

type VegaLiteValidationErrorCode = Extract<VegaLiteValidationResult, { ok: false }>['code']

export type VegaLiteRenderResult =
  | { ok: true; svg: string }
  | { ok: false; code: VegaLiteValidationErrorCode; message: string }

function hasExternalDataUrl(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => hasExternalDataUrl(item))

  const record = value as Record<string, unknown>
  if (typeof record.url === 'string' && record.url.trim() !== '') return true
  return Object.values(record).some(item => hasExternalDataUrl(item))
}

function withReadableDefaults(spec: Record<string, unknown>): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>
  if (next.width === undefined) next.width = 560
  if (next.height === undefined) next.height = 320
  if (next.autosize === undefined) {
    next.autosize = { type: 'fit', contains: 'padding' }
  }
  const encoding = next.encoding
  if (encoding && typeof encoding === 'object' && !Array.isArray(encoding)) {
    const x = (encoding as Record<string, unknown>).x
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const xEncoding = x as Record<string, unknown>
      const xType = typeof xEncoding.type === 'string' ? xEncoding.type.toLowerCase() : ''
      const axis = xEncoding.axis
      if ((xType === 'nominal' || xType === 'ordinal') && axis !== null) {
        const axisDefaults = axis && typeof axis === 'object' && !Array.isArray(axis)
          ? { ...(axis as Record<string, unknown>) }
          : {}
        if (axisDefaults.labelAngle === undefined) axisDefaults.labelAngle = 0
        if (axisDefaults.labelOverlap === undefined) axisDefaults.labelOverlap = false
        if (axisDefaults.labelPadding === undefined) axisDefaults.labelPadding = 6
        if (axisDefaults.titlePadding === undefined) axisDefaults.titlePadding = 18
        xEncoding.axis = axisDefaults
      }
    }
  }
  return next
}

export function validateVegaLiteSource(source: string): VegaLiteValidationResult {
  let spec: Record<string, unknown>
  try {
    const parsed = JSON.parse(source)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: 'VEGA_LITE_INVALID_SPEC', message: 'Vega-Lite 配置必须是 JSON 对象' }
    }
    spec = parsed as Record<string, unknown>
  } catch (error) {
    return { ok: false, code: 'VEGA_LITE_INVALID_JSON', message: cleanUserFacingError(error) }
  }

  if (hasExternalDataUrl(spec.data)) {
    return {
      ok: false,
      code: 'VEGA_LITE_EXTERNAL_DATA_BLOCKED',
      message: '已阻止 Vega-Lite 外部数据 URL。请使用 data.values 内联数据。',
    }
  }

  return { ok: true, spec }
}

export async function renderVegaLiteToSvg(source: string): Promise<VegaLiteRenderResult> {
  const validation = validateVegaLiteSource(source)
  if (!validation.ok) return validation

  try {
    const compiled = vegaLite.compile(withReadableDefaults(validation.spec) as unknown as TopLevelSpec).spec
    const runtime = vega.parse(compiled)
    const view = new vega.View(runtime, { renderer: 'none' })
    const svg = await view.toSVG()
    return { ok: true, svg: sanitizeRendererSvg(svg) }
  } catch (error) {
    return { ok: false, code: 'VEGA_LITE_INVALID_SPEC', message: cleanUserFacingError(error) }
  }
}

export async function processVegaLiteInHtml(html: string): Promise<string> {
  if (!/\blanguage-vega-lite\b/i.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const blocks = Array.from(template.content.querySelectorAll('pre.language-vega-lite'))

  for (const block of blocks) {
    const source = block.textContent || ''
    const result = await renderVegaLiteToSvg(source)
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'vega-lite-wrapper' : 'vega-lite-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.innerHTML = result.ok
      ? `<div class="vega-lite-container">${result.svg}</div>`
      : vegaLiteErrorHtml('Vega-Lite 渲染失败', result.message)
    block.replaceWith(wrapper)
  }

  const container = document.createElement('div')
  container.appendChild(template.content.cloneNode(true))
  return container.innerHTML
}

export function vegaLiteErrorHtml(title: string, message: string): string {
  const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
  return `<div class="vega-lite-error" role="alert"><div class="error-title">${escape(title)}</div><div class="error-message">${escape(message)}</div></div>`
}
