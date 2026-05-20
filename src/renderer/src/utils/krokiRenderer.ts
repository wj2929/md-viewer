import { rendererErrorHtml, serializeTemplate } from './d2Renderer'
import { finishSvg, simpleError, type SimpleRenderResult } from './simpleSvgRenderer'
import { cleanUserFacingError } from './userFacingErrors'

const KROKI_ENDPOINT = 'https://kroki.io'
const MAX_KROKI_SOURCE_LENGTH = 128_000
const KROKI_FORMATS = new Set(['pikchr', 'nomnoml', 'svgbob', 'bytefield', 'tikz', 'plantuml', 'erd', 'graphviz', 'd2'])

function getElectronKrokiBridge(): ((payload: { format: string; source: string }) => Promise<{ ok: boolean; svg?: string; error?: string }>) | undefined {
  if (typeof window === 'undefined') return undefined
  return window.api?.renderKrokiSvg
}

export function resolveKrokiFormat(language: string, source = ''): string {
  const normalized = language.trim().toLowerCase()
  if (normalized.startsWith('kroki-')) return normalized.slice('kroki-'.length)
  if (normalized && normalized !== 'kroki') return normalized
  const directive = source.match(/^\s*(?:format|type)\s*:\s*([a-z0-9-]+)/i)
  return directive?.[1]?.toLowerCase() || 'nomnoml'
}

function stripKrokiDirective(source: string): string {
  return source.replace(/^\s*(?:format|type)\s*:\s*[a-z0-9-]+\s*\n/i, '')
}

export async function renderKrokiToSvg(
  source: string,
  options: { language?: string; endpoint?: string } = {},
): Promise<SimpleRenderResult> {
  const body = stripKrokiDirective(source.trim())
  if (!body) return simpleError('KROKI_EMPTY_SOURCE', 'Kroki 图表内容为空')
  if (body.length > MAX_KROKI_SOURCE_LENGTH) return simpleError('KROKI_SOURCE_TOO_LARGE', 'Kroki 图表内容超过 128KB，已阻止渲染')

  const format = resolveKrokiFormat(options.language || 'kroki', source)
  if (!KROKI_FORMATS.has(format)) {
    return simpleError('KROKI_UNSUPPORTED_FORMAT', `暂不支持 Kroki 格式：${format}`)
  }

  const endpoint = (options.endpoint || KROKI_ENDPOINT).replace(/\/+$/, '')
  try {
    const bridge = !options.endpoint || endpoint === KROKI_ENDPOINT
      ? getElectronKrokiBridge()
      : undefined
    if (bridge) {
      const bridged = await bridge({ format, source: body })
      if (!bridged.ok || !bridged.svg) {
        return simpleError('KROKI_REMOTE_FAILED', bridged.error || 'Kroki 主进程渲染失败')
      }
      if (!/<svg[\s>]/i.test(bridged.svg)) {
        return simpleError('KROKI_INVALID_SVG', 'Kroki 服务未返回 SVG')
      }
      return { ok: true, svg: finishSvg(bridged.svg, 1800) }
    }

    const response = await fetch(`${endpoint}/${format}/svg`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body,
    })
    const svg = await response.text()
    if (!response.ok) {
      return simpleError('KROKI_REMOTE_FAILED', svg || `Kroki 服务返回 ${response.status}`)
    }
    if (!/<svg[\s>]/i.test(svg)) {
      return simpleError('KROKI_INVALID_SVG', 'Kroki 服务未返回 SVG')
    }
    return { ok: true, svg: finishSvg(svg, 1800) }
  } catch (error) {
    return simpleError('KROKI_REMOTE_FAILED', cleanUserFacingError(error))
  }
}

export async function processKrokiInHtml(html: string): Promise<string> {
  if (!/\blanguage-(?:kroki|nomnoml|pikchr|svgbob|bytefield|tikz)\b/i.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const blocks = Array.from(template.content.querySelectorAll('pre.language-kroki, pre.language-nomnoml, pre.language-pikchr, pre.language-svgbob, pre.language-bytefield, pre.language-tikz'))

  for (const block of blocks) {
    const element = block as HTMLElement
    const source = block.textContent || ''
    const language = element.dataset.rendererLanguage || Array.from(element.classList)
      .find(cls => cls.startsWith('language-'))
      ?.replace('language-', '') || 'kroki'
    const result = await renderKrokiToSvg(source, { language })
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'kroki-wrapper' : 'kroki-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.setAttribute('data-kroki-format', resolveKrokiFormat(language, source))
    wrapper.innerHTML = result.ok
      ? `<div class="kroki-container">${result.svg}</div>`
      : rendererErrorHtml('Kroki 渲染失败', result.message, 'kroki-error')
    block.replaceWith(wrapper)
  }

  return serializeTemplate(template)
}
