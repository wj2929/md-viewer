import json5 from 'json5'
import wavedrom from 'wavedrom'
import { cleanUserFacingError } from './userFacingErrors'
import { rendererErrorHtml, serializeTemplate } from './d2Renderer'
import { makeRendererSvgResponsive, sanitizeRendererSvg } from './rendererSvgSanitizer'

export type WaveDromValidationResult =
  | { ok: true; source: Record<string, unknown> }
  | { ok: false; code: 'WAVEDROM_SOURCE_TOO_LARGE' | 'WAVEDROM_INVALID_JSON5' | 'WAVEDROM_INVALID_SPEC'; message: string }

type WaveDromValidationErrorCode = Extract<WaveDromValidationResult, { ok: false }>['code']

export type WaveDromRenderResult =
  | { ok: true; svg: string }
  | { ok: false; code: WaveDromValidationErrorCode | 'WAVEDROM_RENDER_FAILED'; message: string }

const MAX_WAVEDROM_SOURCE_LENGTH = 65_000

export function validateWaveDromSource(source: string): WaveDromValidationResult {
  if (source.length > MAX_WAVEDROM_SOURCE_LENGTH) {
    return {
      ok: false,
      code: 'WAVEDROM_SOURCE_TOO_LARGE',
      message: 'WaveDrom 内容超过 65KB，已阻止渲染',
    }
  }

  let parsed: unknown
  try {
    parsed = json5.parse(source)
  } catch (error) {
    return { ok: false, code: 'WAVEDROM_INVALID_JSON5', message: cleanUserFacingError(error) }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'WAVEDROM_INVALID_SPEC', message: 'WaveDrom 配置必须是对象' }
  }
  const record = parsed as Record<string, unknown>
  if (!Array.isArray(record.signal) && !Array.isArray(record.assign) && !record.reg) {
    return { ok: false, code: 'WAVEDROM_INVALID_SPEC', message: 'WaveDrom 配置必须包含 signal、assign 或 reg' }
  }

  return { ok: true, source: record }
}

export function renderWaveDromToSvg(source: string): WaveDromRenderResult {
  const validation = validateWaveDromSource(source)
  if (!validation.ok) return validation

  try {
    const tree = wavedrom.renderAny(0, validation.source, wavedrom.waveSkin, false)
    const svg = wavedrom.onml.stringify(tree)
    return { ok: true, svg: makeRendererSvgResponsive(sanitizeRendererSvg(svg), { minWidth: 640 }) }
  } catch (error) {
    return { ok: false, code: 'WAVEDROM_RENDER_FAILED', message: cleanUserFacingError(error) }
  }
}

export async function processWaveDromInHtml(html: string): Promise<string> {
  if (!/\blanguage-wavedrom\b/i.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const blocks = Array.from(template.content.querySelectorAll('pre.language-wavedrom'))

  for (const block of blocks) {
    const result = renderWaveDromToSvg(block.textContent || '')
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'wavedrom-wrapper' : 'wavedrom-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.innerHTML = result.ok
      ? `<div class="wavedrom-container">${result.svg}</div>`
      : rendererErrorHtml('WaveDrom 渲染失败', result.message, 'wavedrom-error')
    block.replaceWith(wrapper)
  }

  return serializeTemplate(template)
}
