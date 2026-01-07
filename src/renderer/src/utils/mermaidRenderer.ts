/**
 * Mermaid 安全渲染模块
 * 提供 XSS 防护和安全的 SVG 输出
 */

import mermaid from 'mermaid'

let initialized = false

// 用于强制重新初始化（开发模式热更新时需要）
export function resetMermaidInit(): void {
  initialized = false
}

/**
 * 安全初始化 Mermaid
 */
function initMermaidSecure(): void {
  if (initialized) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',  // 关键：严格安全模式
    maxTextSize: 50000,       // 限制输入大小
    maxEdges: 500,            // 限制复杂度
    // 使用纯 SVG text 元素渲染文本（不使用 foreignObject）
    // 这样可以确保中文等文字正确显示，同时避免 XSS 风险
    flowchart: {
      htmlLabels: false,      // 使用 SVG text 而非 foreignObject
    },
    sequence: {
      useMaxWidth: true,
    },
    // 设置支持中文的字体
    themeVariables: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
  })

  initialized = true
}

/**
 * HTML 转义（用于错误消息）
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, c => map[c])
}

/**
 * 安全提取错误消息
 */
function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // 移除敏感信息
    const safeMsg = error.message
      .replace(/at\s+.*$/gm, '')    // 移除堆栈信息
      .replace(/\/[\w/.-]+/g, '')   // 移除文件路径
      .slice(0, 200)
      .trim()
    return escapeHtml(safeMsg)
  }
  return '渲染时发生错误'
}

/**
 * 清理 SVG 输出（防 XSS）
 *
 * 安全策略说明：
 * 由于 Mermaid 已经在 securityLevel: 'strict' 模式下运行，
 * 并且我们对输入代码进行了验证（validateMermaidCode），
 * 加上导出的 HTML 有 CSP 头禁止脚本执行，
 * 我们只需要做最小化的清理（移除明显危险的内容）。
 *
 * 注意：DOMPurify 的 SVG profile 会删除很多必要的 SVG 属性（如 path 的 d 属性），
 * 导致图表显示不完整，所以这里只做简单的字符串替换清理。
 */
function sanitizeSvg(svg: string): string {
  // 移除明显的危险内容（双重保险，Mermaid strict 模式已经处理过）
  return svg
    // 移除 script 标签
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // 移除事件处理器属性
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    // 移除 javascript: URLs
    .replace(/javascript\s*:/gi, '')
    // 移除 data: URLs（除了图片）
    .replace(/data\s*:\s*(?!image\/)[^"'\s]*/gi, '')
}

/**
 * 验证 Mermaid 代码安全性
 * 注意：不检查 foreignObject，因为 Mermaid 自己会生成它来渲染文本
 */
function validateMermaidCode(code: string): { valid: boolean; error?: string } {
  if (code.length > 50000) {
    return { valid: false, error: '代码长度超出限制' }
  }

  // 检测危险模式（用户输入的恶意代码）
  const dangerousPatterns = [
    /click\s+\w+\s+["']javascript:/i,
    /click\s+\w+\s+["']data:/i,
    /<script[\s>]/i,
    /on\w+\s*=/i,
    /<iframe[\s>]/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(code)) {
      return { valid: false, error: '检测到不安全的内容' }
    }
  }

  return { valid: true }
}

/**
 * 安全渲染 Mermaid 为 SVG
 *
 * @param code - Mermaid 代码
 * @param id - 唯一标识符
 * @returns SVG 字符串或错误消息 HTML
 */
export async function renderMermaidToSvg(
  code: string,
  id: string
): Promise<string> {
  initMermaidSecure()

  // 验证输入
  const validation = validateMermaidCode(code)
  if (!validation.valid) {
    return `<div class="mermaid-error" role="alert">${escapeHtml(validation.error || '无效代码')}</div>`
  }

  try {
    // 生成安全的 ID
    const safeId = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const { svg } = await mermaid.render(safeId, code)

    // 清理 SVG 输出
    return sanitizeSvg(svg)
  } catch (error) {
    const safeError = getSafeErrorMessage(error)
    return `<div class="mermaid-error" role="alert">图表渲染失败: ${safeError}</div>`
  }
}

/**
 * 判断是否是 Mermaid 代码
 *
 * @param code - 代码内容
 * @returns 是否是有效的 Mermaid 代码
 */
export function isMermaidCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false

  const lines = code.trim().split('\n')

  // 跳过注释找到第一个有效行
  const firstContentLine = lines.find(line => {
    const trimmed = line.trim()
    return trimmed && !trimmed.startsWith('%%')
  })

  if (!firstContentLine) return false

  const normalized = firstContentLine.trim().toLowerCase()

  // 有方向参数的图表
  const directedCharts = ['graph', 'flowchart']
  for (const chart of directedCharts) {
    if (normalized === chart ||
        (normalized.startsWith(chart) && /\s/.test(normalized[chart.length]))) {
      return true
    }
  }

  // 独立图表类型
  const standaloneCharts = [
    'sequencediagram', 'classdiagram', 'statediagram',
    'statediagram-v2', 'erdiagram', 'journey', 'gantt',
    'pie', 'gitgraph', 'mindmap', 'timeline',
    'quadrantchart', 'sankey', 'xychart', 'block',
  ]

  return standaloneCharts.some(chart =>
    normalized === chart || normalized.startsWith(chart + ' ')
  )
}

/**
 * HTML 实体解码（安全版本）
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
  }
  return text.replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, m => entities[m])
}

/**
 * 处理 HTML 中的所有 Mermaid 代码块
 * 用于 HTML 导出时将 Mermaid 代码块转换为 SVG
 *
 * @param html - 包含 Mermaid 代码块的 HTML
 * @returns 处理后的 HTML（Mermaid 代码块已替换为 SVG）
 */
export async function processMermaidInHtml(html: string): Promise<string> {
  initMermaidSecure()

  const mermaidRegex = /<pre\s+class="language-mermaid">\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g

  const matches: { match: string; code: string; index: number }[] = []
  let m: RegExpExecArray | null
  let matchCount = 0
  const MAX_MATCHES = 100  // 限制数量，防止 DoS

  while ((m = mermaidRegex.exec(html)) !== null && matchCount < MAX_MATCHES) {
    const code = decodeHtmlEntities(m[1])
    if (isMermaidCode(code)) {
      matches.push({ match: m[0], code, index: m.index })
      matchCount++
    }
  }

  // 逆序处理，避免索引偏移
  for (let i = matches.length - 1; i >= 0; i--) {
    const { match, code, index } = matches[i]
    const svg = await renderMermaidToSvg(code, `mermaid-export-${i}`)
    const wrapper = `<div class="mermaid-container" role="img" aria-label="Mermaid 图表">${svg}</div>`
    html = html.slice(0, index) + wrapper + html.slice(index + match.length)
  }

  return html
}
