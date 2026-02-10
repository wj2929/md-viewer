/**
 * Infographic 渲染器
 *
 * 基于 @antv/infographic 库，支持在 Markdown 中渲染信息图。
 * 架构模式与 echartsRenderer.ts 保持一致。
 *
 * @version v1.6.0
 */

import { Infographic, exportToSVG } from '@antv/infographic'
import type { InfographicOptions } from '@antv/infographic'

const INFOGRAPHIC_CONFIG = {
  MAX_CONFIG_SIZE: 100 * 1024, // 100KB
  MAX_PER_PAGE: 10,
  DEFAULT_WIDTH: 800,
  DEFAULT_HEIGHT: 600,
}

/**
 * 验证 infographic 配置
 */
function validateInfographicConfig(code: string): { valid: boolean; error?: string } {
  if (!code || !code.trim()) {
    return { valid: false, error: '配置内容为空' }
  }

  if (code.length > INFOGRAPHIC_CONFIG.MAX_CONFIG_SIZE) {
    return { valid: false, error: `配置内容过大（${(code.length / 1024).toFixed(1)}KB），最大允许 ${INFOGRAPHIC_CONFIG.MAX_CONFIG_SIZE / 1024}KB` }
  }

  return { valid: true }
}

/**
 * 渲染 infographic 为 SVG 字符串（用于导出）
 */
async function renderInfographicToSvg(config: string, id: string): Promise<string> {
  // 创建离屏容器
  const container = document.createElement('div')
  container.id = `infographic-offscreen-${id}`
  container.style.cssText = 'position: fixed; left: -9999px; top: -9999px; opacity: 0; pointer-events: none;'
  container.style.width = `${INFOGRAPHIC_CONFIG.DEFAULT_WIDTH}px`
  container.style.height = `${INFOGRAPHIC_CONFIG.DEFAULT_HEIGHT}px`
  document.body.appendChild(container)

  let infographic: Infographic | null = null

  try {
    // 尝试解析为 JSON，否则作为 infographic 语法字符串
    let options: string | Partial<InfographicOptions>

    try {
      const parsed = JSON.parse(config)
      options = {
        container,
        width: INFOGRAPHIC_CONFIG.DEFAULT_WIDTH,
        height: INFOGRAPHIC_CONFIG.DEFAULT_HEIGHT,
        editable: false,
        ...parsed,
      }
    } catch {
      // 不是 JSON，作为 infographic 语法字符串
      options = config
    }

    if (typeof options === 'string') {
      infographic = new Infographic({
        container,
        width: INFOGRAPHIC_CONFIG.DEFAULT_WIDTH,
        height: INFOGRAPHIC_CONFIG.DEFAULT_HEIGHT,
        editable: false,
      } as Partial<InfographicOptions>)
      infographic.render(options)
    } else {
      options.container = container
      infographic = new Infographic(options)
      infographic.render()
    }

    // 等待渲染完成
    await new Promise<void>((resolve) => {
      let resolved = false
      infographic!.on('rendered', () => {
        if (!resolved) { resolved = true; resolve() }
      })
      // 超时保护
      setTimeout(() => {
        if (!resolved) { resolved = true; resolve() }
      }, 3000)
    })

    // 获取 SVG
    const svgElement = container.querySelector('svg')
    if (!svgElement) {
      throw new Error('渲染后未找到 SVG 元素')
    }

    // 使用 exportToSVG 获取干净的 SVG
    const exportedSvg = await exportToSVG(svgElement as SVGSVGElement)
    return exportedSvg.outerHTML
  } finally {
    if (infographic) {
      try { infographic.destroy() } catch { /* ignore */ }
    }
    container.remove()
  }
}

/**
 * 处理 HTML 中的 infographic 代码块（用于导出）
 */
async function processInfographicInHtml(html: string): Promise<string> {
  const regex = /<pre class="language-infographic"><code class="language-infographic">([\s\S]*?)<\/code><\/pre>/g
  const matches: { fullMatch: string; config: string }[] = []

  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    matches.push({
      fullMatch: match[0],
      config: match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    })
  }

  if (matches.length === 0) return html

  let result = html
  for (let i = 0; i < Math.min(matches.length, INFOGRAPHIC_CONFIG.MAX_PER_PAGE); i++) {
    const { fullMatch, config } = matches[i]
    try {
      const svgString = await renderInfographicToSvg(config, `export-${i}`)
      const svgHtml = `<div class="infographic-container" style="width: 100%; text-align: center;">${svgString}</div>`
      result = result.replace(fullMatch, svgHtml)
    } catch (error) {
      console.error(`[Infographic] 导出渲染失败 #${i}:`, error)
      const errorHtml = `<div class="infographic-error"><div class="error-title">Infographic 渲染失败</div><div class="error-message">${(error as Error).message}</div></div>`
      result = result.replace(fullMatch, errorHtml)
    }
  }

  return result
}

export { Infographic, validateInfographicConfig, processInfographicInHtml }
