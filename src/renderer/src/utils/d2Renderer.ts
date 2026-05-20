import { D2 } from '@terrastruct/d2'
import { cleanUserFacingError } from './userFacingErrors'
import { makeRendererSvgResponsive, sanitizeRendererSvg } from './rendererSvgSanitizer'

export type D2ValidationResult =
  | { ok: true; source: string }
  | { ok: false; code: 'D2_EMPTY_SOURCE' | 'D2_SOURCE_TOO_LARGE'; message: string }

type D2ValidationErrorCode = Extract<D2ValidationResult, { ok: false }>['code']

export type D2RenderResult =
  | { ok: true; svg: string }
  | { ok: false; code: D2ValidationErrorCode | 'D2_RENDER_FAILED'; message: string }

const MAX_D2_SOURCE_LENGTH = 128_000

export function validateD2Source(source: string): D2ValidationResult {
  const trimmed = source.trim()
  if (!trimmed) {
    return { ok: false, code: 'D2_EMPTY_SOURCE', message: 'D2 内容为空' }
  }
  if (source.length > MAX_D2_SOURCE_LENGTH) {
    return { ok: false, code: 'D2_SOURCE_TOO_LARGE', message: 'D2 内容超过 128KB，已阻止渲染' }
  }
  return { ok: true, source: trimmed }
}

async function terminateD2Worker(d2: D2): Promise<void> {
  const worker = (d2 as unknown as { worker?: { terminate?: () => void | Promise<void> } }).worker
  await worker?.terminate?.()
}

export async function renderD2ToSvg(source: string): Promise<D2RenderResult> {
  const validation = validateD2Source(source)
  if (!validation.ok) return validation

  const d2 = new D2()
  try {
    const compiled = await d2.compile({
      fs: { index: validation.source },
      inputPath: 'index',
      options: {
        layout: 'dagre',
        pad: 40,
        noXMLTag: true,
      },
    })
    const svg = await d2.render(compiled.diagram, {
      ...compiled.renderOptions,
      noXMLTag: true,
    })
    return { ok: true, svg: makeRendererSvgResponsive(sanitizeRendererSvg(svg), { maxWidth: 1800 }) }
  } catch (error) {
    return { ok: false, code: 'D2_RENDER_FAILED', message: cleanUserFacingError(error) }
  } finally {
    await terminateD2Worker(d2)
  }
}

export async function processD2InHtml(html: string): Promise<string> {
  if (!/\blanguage-d2\b/i.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const blocks = Array.from(template.content.querySelectorAll('pre.language-d2'))

  for (const block of blocks) {
    const source = block.textContent || ''
    const result = await renderD2ToSvg(source)
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'd2-wrapper' : 'd2-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.innerHTML = result.ok
      ? `<div class="d2-container">${result.svg}</div>`
      : rendererErrorHtml('D2 渲染失败', result.message, 'd2-error')
    block.replaceWith(wrapper)
  }

  return serializeTemplate(template)
}

export function rendererErrorHtml(title: string, message: string, className: string): string {
  return `<div class="${className}" role="alert"><div class="error-title">${escapeHtml(title)}</div><div class="error-message">${escapeHtml(message)}</div></div>`
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
}

export function serializeTemplate(template: HTMLTemplateElement): string {
  const container = document.createElement('div')
  container.appendChild(template.content.cloneNode(true))
  return container.innerHTML
}
