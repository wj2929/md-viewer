/**
 * Markmap 思维导图渲染器
 *
 * 基于 markmap-lib + markmap-view，支持在 Markdown 中渲染思维导图。
 * 架构模式与 infographicRenderer.ts 保持一致。
 *
 * @version v1.5.4
 */

import { Transformer } from 'markmap-lib'
import { Markmap, deriveOptions } from 'markmap-view'

const MARKMAP_CONFIG = {
  MAX_CODE_SIZE: 50 * 1024, // 50KB
  MAX_PER_PAGE: 20,
  DEFAULT_WIDTH: 800,
  DEFAULT_HEIGHT: 500,
}

// 模块级 Transformer 单例（无状态，可复用）
let transformerInstance: Transformer | null = null

function getTransformer(): Transformer {
  if (!transformerInstance) {
    transformerInstance = new Transformer()
  }
  return transformerInstance
}

/**
 * 验证 markmap 代码
 */
export function validateMarkmapCode(code: string): { valid: boolean; error?: string } {
  if (!code || !code.trim()) {
    return { valid: false, error: '内容为空' }
  }

  if (code.length > MARKMAP_CONFIG.MAX_CODE_SIZE) {
    return {
      valid: false,
      error: `内容过大（${(code.length / 1024).toFixed(1)}KB），最大允许 ${MARKMAP_CONFIG.MAX_CODE_SIZE / 1024}KB`,
    }
  }

  return { valid: true }
}

/**
 * 渲染 markmap 为静态 SVG 字符串（用于导出）
 *
 * markmap-view 生成交互式 SVG（含 d3-zoom），导出时需要：
 * 1. 在离屏容器中创建 Markmap 实例
 * 2. 调用 fit() 确保布局完成
 * 3. 克隆 SVG 并设置固定 viewBox
 * 4. 销毁实例，返回静态 SVG
 */
export async function renderMarkmapToSvg(code: string, id: string): Promise<string> {
  // 离屏容器用 visibility:hidden（而非 left:-9999px），保留正常布局以便 getBBox 准确
  const container = document.createElement('div')
  container.id = `markmap-offscreen-${id}`
  container.style.cssText = `position: absolute; left: 0; top: 0; visibility: hidden; pointer-events: none; width: ${MARKMAP_CONFIG.DEFAULT_WIDTH}px; height: ${MARKMAP_CONFIG.DEFAULT_HEIGHT}px;`
  document.body.appendChild(container)

  let mm: Markmap | null = null

  try {
    const transformer = getTransformer()
    const { root, features } = transformer.transform(code)
    const opts = deriveOptions(features)

    // SVG 占满容器
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svgEl.setAttribute('width', String(MARKMAP_CONFIG.DEFAULT_WIDTH))
    svgEl.setAttribute('height', String(MARKMAP_CONFIG.DEFAULT_HEIGHT))
    svgEl.style.cssText = `width: ${MARKMAP_CONFIG.DEFAULT_WIDTH}px; height: ${MARKMAP_CONFIG.DEFAULT_HEIGHT}px;`
    container.appendChild(svgEl)

    mm = Markmap.create(svgEl, opts, root)

    // fit 之前等一帧让 foreignObject 测量文本宽度；fit 之后再等两帧让 d3 transition 完成
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await mm.fit()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    // markmap 的 fit() 已经把内容 transform 到 SVG 可视区正中
    // 我们不自己算 viewBox（getBBox 在离屏场景下经常测错），
    // 直接让导出 SVG 用 0 0 W H 的 viewBox，保持和屏幕显示一样的比例
    const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement
    clonedSvg.setAttribute(
      'viewBox',
      `0 0 ${MARKMAP_CONFIG.DEFAULT_WIDTH} ${MARKMAP_CONFIG.DEFAULT_HEIGHT}`
    )
    clonedSvg.removeAttribute('width')
    clonedSvg.removeAttribute('height')
    clonedSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    clonedSvg.setAttribute(
      'style',
      `width: 100%; max-width: ${MARKMAP_CONFIG.DEFAULT_WIDTH}px; height: auto; display: block; margin: 0 auto;`
    )

    return clonedSvg.outerHTML
  } finally {
    if (mm) {
      try {
        mm.destroy()
      } catch {
        /* ignore */
      }
    }
    container.remove()
  }
}

/**
 * 处理 HTML 中的 markmap 代码块（用于导出）
 */
export async function processMarkmapInHtml(html: string): Promise<string> {
  const regex =
    /<pre class="language-markmap"><code class="language-markmap">([\s\S]*?)<\/code><\/pre>/g
  const matches: { fullMatch: string; code: string }[] = []

  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    matches.push({
      fullMatch: match[0],
      code: match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    })
  }

  if (matches.length === 0) return html

  let result = html
  for (let i = 0; i < Math.min(matches.length, MARKMAP_CONFIG.MAX_PER_PAGE); i++) {
    const { fullMatch, code } = matches[i]
    try {
      const svgString = await renderMarkmapToSvg(code, `export-${i}`)
      const svgHtml = `<div class="markmap-container" style="width: 100%; text-align: center;">${svgString}</div>`
      result = result.replace(fullMatch, svgHtml)
    } catch (error) {
      console.error(`[Markmap] 导出渲染失败 #${i}:`, error)
      const errorHtml = `<div class="markmap-error"><div class="error-title">Markmap 渲染失败</div><div class="error-message">${(error as Error).message}</div></div>`
      result = result.replace(fullMatch, errorHtml)
    }
  }

  return result
}

export { Transformer, Markmap, deriveOptions, validateMarkmapCode as validate }
