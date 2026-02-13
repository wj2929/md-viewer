/**
 * Graphviz DOT 图渲染器
 *
 * 基于 @hpcc-js/wasm-graphviz（WASM），支持在 Markdown 中渲染 DOT 有向图。
 * 架构模式与 infographicRenderer.ts 保持一致。
 *
 * 特点：
 * - WASM 懒加载（首次使用时加载，约 535KB）
 * - 无状态渲染（gv.dot() 直接返回 SVG 字符串，无需实例清理）
 *
 * @version v1.5.4
 */

import { Graphviz } from '@hpcc-js/wasm-graphviz'

const GRAPHVIZ_CONFIG = {
  MAX_CODE_SIZE: 100 * 1024, // 100KB
  MAX_PER_PAGE: 20,
}

// 单例 WASM 实例（懒加载）
let graphvizInstance: Graphviz | null = null
let graphvizLoadPromise: Promise<Graphviz> | null = null

/**
 * 获取 Graphviz WASM 实例（懒加载，全局单例）
 */
async function getGraphviz(): Promise<Graphviz> {
  if (graphvizInstance) return graphvizInstance

  if (!graphvizLoadPromise) {
    graphvizLoadPromise = Graphviz.load().then((gv) => {
      graphvizInstance = gv
      return gv
    }).catch((err) => {
      graphvizLoadPromise = null
      throw err
    })
  }

  return graphvizLoadPromise
}

/**
 * 验证 Graphviz DOT 代码
 */
export function validateGraphvizCode(code: string): { valid: boolean; error?: string } {
  if (!code || !code.trim()) {
    return { valid: false, error: '内容为空' }
  }

  if (code.length > GRAPHVIZ_CONFIG.MAX_CODE_SIZE) {
    return {
      valid: false,
      error: `内容过大（${(code.length / 1024).toFixed(1)}KB），最大允许 ${GRAPHVIZ_CONFIG.MAX_CODE_SIZE / 1024}KB`,
    }
  }

  // 基本格式校验：必须包含 graph/digraph/strict 关键字
  const trimmed = code.trim()
  if (!/^(strict\s+)?(di)?graph\b/i.test(trimmed)) {
    return { valid: false, error: '无效的 DOT 格式，需要以 graph 或 digraph 开头' }
  }

  return { valid: true }
}

/**
 * 渲染 Graphviz DOT 为 SVG 字符串
 *
 * Graphviz WASM 直接返回 SVG 字符串，是最简洁的渲染器。
 */
export async function renderGraphvizToSvg(code: string, _id: string): Promise<string> {
  const gv = await getGraphviz()
  return gv.dot(code)
}

/**
 * 处理 HTML 中的 graphviz 代码块（用于导出）
 */
export async function processGraphvizInHtml(html: string): Promise<string> {
  const regex =
    /<pre class="language-graphviz"><code class="language-graphviz">([\s\S]*?)<\/code><\/pre>/g
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
  for (let i = 0; i < Math.min(matches.length, GRAPHVIZ_CONFIG.MAX_PER_PAGE); i++) {
    const { fullMatch, code } = matches[i]
    try {
      const svgString = await renderGraphvizToSvg(code, `export-${i}`)
      const svgHtml = `<div class="graphviz-container" style="width: 100%; text-align: center;">${svgString}</div>`
      result = result.replace(fullMatch, svgHtml)
    } catch (error) {
      console.error(`[Graphviz] 导出渲染失败 #${i}:`, error)
      const errorHtml = `<div class="graphviz-error"><div class="error-title">Graphviz 渲染失败</div><div class="error-message">${(error as Error).message}</div></div>`
      result = result.replace(fullMatch, errorHtml)
    }
  }

  return result
}
