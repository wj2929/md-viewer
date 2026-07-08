import { builtinRendererDefinitions } from '../renderers/builtin'

/**
 * W2：把"未渲染/失败的图表块"归一化为中性占位，避免源码/工具错误信息漏进交付产物。
 *
 * 规则（安全保守）：
 *  - 成功渲染的图表：wrapper 内含 <svg> → 其保留的源码 <pre> 一律不动。
 *  - 失败的图表：.X-error 错误块（可能内嵌源码）/ 无 wrapper 的裸 <pre.language-X>（如网络封禁的 kroki）
 *    → 替换为中性占位 `[图表未渲染]`。诊断细节留给报警器(W1)，不进交付文档。
 *
 * 图表类型集合从 registry(builtinRendererDefinitions) 派生，不自建第 4 份图表清单。
 */
const CHART_TYPES = builtinRendererDefinitions.map(d => d.type)
const ERROR_SELECTOR = CHART_TYPES.map(t => `.${t}-error`).join(', ')
const WRAPPER_SELECTOR = CHART_TYPES.map(t => `.${t}-wrapper`).join(', ')
const CHART_LANG_CLASSES = new Set(CHART_TYPES.map(t => `language-${t}`))

const PLACEHOLDER_TEXT = '[图表未渲染]'

function makePlaceholder(doc: Document, type: string): HTMLElement {
  const div = doc.createElement('div')
  div.className = 'chart-export-placeholder'
  div.setAttribute('data-chart-type', type)
  div.setAttribute('style', 'color:#999;text-align:center;padding:12px 16px;border:1px dashed #ccc;border-radius:6px;margin:1em 0;font-size:14px;')
  div.textContent = PLACEHOLDER_TEXT
  return div
}

function errorChartType(el: Element): string {
  for (const t of CHART_TYPES) if (el.classList.contains(`${t}-error`)) return t
  return 'chart'
}

function preChartType(pre: Element): string | null {
  for (const cls of Array.from(pre.classList)) {
    if (CHART_LANG_CLASSES.has(cls)) return cls.replace('language-', '')
  }
  return null
}

/** wrapper 是否承载了成功渲染的内容（有 svg） */
function wrapperHasRender(wrapper: Element | null): boolean {
  return wrapper != null && wrapper.querySelector('svg') != null
}

/**
 * 归一化 root 内未渲染的图表块为中性占位。返回替换数量。
 * 不改动成功渲染的图表及其保留源码。
 */
export function normalizeFailedChartBlocks(root: HTMLElement | null | undefined): number {
  if (!root) return 0
  const doc = root.ownerDocument
  if (!doc) return 0
  let replaced = 0

  // 1) 图表错误块 → 占位。若错误块在一个未成功渲染的 wrapper 内，替换整个 wrapper。
  root.querySelectorAll(ERROR_SELECTOR).forEach(err => {
    if (!err.isConnected) return
    const wrapper = err.closest(WRAPPER_SELECTOR)
    const target = wrapper && !wrapperHasRender(wrapper) ? wrapper : err
    if (!target.isConnected) return
    target.replaceWith(makePlaceholder(doc, errorChartType(err)))
    replaced++
  })

  // 2) 裸的图表源码 <pre.language-X>（不在已成功渲染的 wrapper 内）→ 占位。
  root.querySelectorAll('pre[class*="language-"]').forEach(pre => {
    if (!pre.isConnected) return
    const type = preChartType(pre)
    if (!type) return
    const wrapper = pre.closest(WRAPPER_SELECTOR)
    if (wrapperHasRender(wrapper)) return // 成功图的保留源码 → 保留
    pre.replaceWith(makePlaceholder(doc, type))
    replaced++
  })

  return replaced
}
