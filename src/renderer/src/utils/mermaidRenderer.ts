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
 * 验证颜色值是否安全（防 XSS）
 * 只允许标准颜色格式，拒绝任何可疑字符
 */
function isValidColor(color: string): boolean {
  if (!color || typeof color !== 'string' || color.length > 100) {
    return false
  }
  const colorPatterns = [
    /^#[a-fA-F0-9]{3,8}$/,                                           // hex: #fff, #ffffff
    /^hsl\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*\)$/i,          // hsl(240, 100%, 50%)
    /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i,           // rgb(255, 255, 255)
    /^[a-zA-Z]{1,20}$/,                                               // 命名颜色: red, blue
  ]
  return colorPatterns.some(pattern => pattern.test(color))
}

/**
 * 获取安全的颜色值，如果不合法则返回 fallback
 */
function getSafeColor(color: string | undefined, fallback: string): string {
  if (color && isValidColor(color)) {
    return color
  }
  return fallback
}

/**
 * 默认连线颜色序列（与 Mermaid 默认主题一致）
 */
const DEFAULT_EDGE_COLORS = [
  'hsl(60, 100%, 73.5%)',   // section-edge-0 - 黄色
  'hsl(80, 100%, 76.3%)',   // section-edge-1 - 黄绿色
  'hsl(270, 100%, 76.3%)',  // section-edge-2 - 紫色
  'hsl(300, 100%, 76.3%)',  // section-edge-3 - 洋红色
  'hsl(330, 100%, 76.3%)',  // section-edge-4 - 红紫色
  'hsl(0, 100%, 76.3%)',    // section-edge-5 - 红色
  'hsl(30, 100%, 76.3%)',   // section-edge-6 - 橙色
  'hsl(90, 100%, 76.3%)',   // section-edge-7 - 黄绿色
  'hsl(150, 100%, 76.3%)',  // section-edge-8 - 青绿色
  'hsl(180, 100%, 76.3%)',  // section-edge-9 - 青色
  'hsl(210, 100%, 76.3%)',  // section-edge-10 - 蓝色
]

/**
 * 默认节点颜色序列（与 Mermaid 默认主题一致）
 */
const DEFAULT_NODE_COLORS = [
  'hsl(60, 100%, 73.5%)',   // section-0
  'hsl(80, 100%, 76.3%)',   // section-1
  'hsl(270, 100%, 76.3%)',  // section-2
  'hsl(300, 100%, 76.3%)',  // section-3
  'hsl(330, 100%, 76.3%)',  // section-4
  'hsl(0, 100%, 76.3%)',    // section-5
  'hsl(30, 100%, 76.3%)',   // section-6
  'hsl(90, 100%, 76.3%)',   // section-7
  'hsl(150, 100%, 76.3%)',  // section-8
  'hsl(180, 100%, 76.3%)',  // section-9
  'hsl(210, 100%, 76.3%)',  // section-10
]

const DEFAULT_ROOT_COLOR = 'hsl(240, 100%, 46.3%)'

/**
 * 从 SVG 中提取 mindmap 颜色定义
 */
function extractMindmapColors(svg: string): {
  sectionColors: Record<string, string>
  edgeColors: Record<string, string>
  rootColor: string
} {
  const sectionColors: Record<string, string> = {}
  const edgeColors: Record<string, string> = {}

  // 匹配 .section-root 样式（添加长度限制防 ReDoS）
  const rootMatch = svg.match(/\.section-root\s+(?:rect|path|circle|polygon)[^{]{0,200}?\{[^}]{0,500}?fill:\s*(hsl\([^)]+\)|rgb\([^)]+\)|#[a-fA-F0-9]{3,8}|[a-zA-Z]{1,20})/i)
  if (rootMatch?.[1]) {
    sectionColors['root'] = rootMatch[1]
  }

  // 匹配 .section-N 样式（限制数字长度防溢出）
  const sectionRegex = /\.section-(-?\d{1,4})\s+(?:rect,|path,|circle,|polygon,)[^{]{0,200}?\{[^}]{0,500}?fill:\s*(hsl\([^)]+\)|rgb\([^)]+\)|#[a-fA-F0-9]{3,8}|[a-zA-Z]{1,20})/gi
  let match
  while ((match = sectionRegex.exec(svg)) !== null) {
    if (match[1] && match[2]) {
      sectionColors[match[1]] = match[2]
    }
  }

  // 匹配 .section-edge-N 样式（连线颜色）
  const edgeRegex = /\.section-edge-(-?\d{1,4})\{stroke:\s*(hsl\([^)]+\)|rgb\([^)]+\)|#[a-fA-F0-9]{3,8}|[a-zA-Z]{1,20})/gi
  while ((match = edgeRegex.exec(svg)) !== null) {
    if (match[1] && match[2]) {
      edgeColors[match[1]] = match[2]
    }
  }

  const rootColor = getSafeColor(sectionColors['root'], DEFAULT_ROOT_COLOR)

  return { sectionColors, edgeColors, rootColor }
}

/**
 * 修复 mindmap 连线样式
 * 使用从 CSS 提取的彩色而非灰色
 */
function fixMindmapEdges(
  svg: string,
  edgeColors: Record<string, string>
): string {
  let edgeIndex = 0
  const colorCount = Math.max(Object.keys(edgeColors).length, DEFAULT_EDGE_COLORS.length)

  // 匹配连线：style="undefined; undefined" 或已被修复的连线
  return svg.replace(
    /<path\s+d="([^"]+)"\s+style="(?:undefined;\s*undefined|stroke:[^"]+)"\s+data-edge="true"([^>]*?)>/g,
    (fullMatch, pathD, otherAttrs) => {
      // 尝试从 data-id 提取目标节点索引
      const dataIdMatch = otherAttrs?.match(/data-id="edge_(\d+)_(\d+)"/)
      let sectionIndex: number

      if (dataIdMatch) {
        // 有 data-id：使用源节点索引确定颜色（一级分支的颜色）
        // edge_0_1 -> section 0, edge_0_2 -> section 1, etc.
        // edge_1_X -> 继承 section 0 (节点 1 属于第一个分支)
        const sourceNode = parseInt(dataIdMatch[1], 10)
        const targetNode = parseInt(dataIdMatch[2], 10)

        // 如果源节点是根节点 (0)，则目标节点索引 - 1 就是 section 索引
        // 否则，需要向上追溯找到一级分支的 section
        if (sourceNode === 0) {
          sectionIndex = (targetNode - 1) % colorCount
        } else {
          // 对于非根节点的边，使用源节点索引作为近似
          // 这是一个启发式方法，假设节点按深度优先编号
          sectionIndex = (sourceNode - 1) % colorCount
        }
      } else {
        // 无 data-id：按顺序循环使用颜色
        sectionIndex = edgeIndex % colorCount
      }

      edgeIndex++

      // 获取颜色，优先使用提取的 edgeColors，fallback 到默认颜色
      const rawColor = edgeColors[String(sectionIndex)] || DEFAULT_EDGE_COLORS[sectionIndex % DEFAULT_EDGE_COLORS.length]
      const color = getSafeColor(rawColor, '#999')

      return `<path d="${pathD}" style="stroke:${color};stroke-width:2;fill:none" data-edge="true"${otherAttrs || ''}>`
    }
  )
}

/**
 * 修复 mindmap 根节点样式
 */
function fixMindmapRootNode(svg: string, rootColor: string): string {
  const safeRootColor = getSafeColor(rootColor, DEFAULT_ROOT_COLOR)

  return svg.replace(
    /(<g\s+transform="translate\([^"]+\)">\s*<circle\s+r="[^"]+"\s+cx="0"\s+cy="0")(\s*(?:style="[^"]*")?\s*><\/circle>)/g,
    (fullMatch, prefix, suffix) => {
      // 移除可能已存在的 style，添加新的
      const cleanSuffix = suffix.replace(/\s*style="[^"]*"/, '')
      return `${prefix} style="fill:${safeRootColor}"${cleanSuffix}`
    }
  )
}

/**
 * 修复 mindmap 子节点样式
 */
function fixMindmapChildNodes(
  svg: string,
  sectionColors: Record<string, string>
): string {
  // 收集所有节点的 path 元素位置
  const pathRegex = /<g\s+transform="translate\([^"]+\)">\s*<path\s+d="M[^"]*Z"(?:\s*style="[^"]*")?><\/path>/g
  const pathMatches: { index: number; length: number; match: string }[] = []
  let pathMatch
  while ((pathMatch = pathRegex.exec(svg)) !== null) {
    pathMatches.push({
      index: pathMatch.index,
      length: pathMatch[0].length,
      match: pathMatch[0]
    })
  }

  let result = svg

  // 逆序处理，避免索引偏移
  for (let i = pathMatches.length - 1; i >= 0; i--) {
    const { index, length, match } = pathMatches[i]
    const colorIndex = i % DEFAULT_NODE_COLORS.length
    const rawColor = sectionColors[String(colorIndex)] || DEFAULT_NODE_COLORS[colorIndex]
    const color = getSafeColor(rawColor, DEFAULT_NODE_COLORS[colorIndex])

    const newMatch = match.replace(
      /<path\s+d="([^"]*)"(?:\s*style="[^"]*")?><\/path>/,
      `<path d="$1" style="fill:${color}"></path>`
    )
    result = result.slice(0, index) + newMatch + result.slice(index + length)
  }

  return result
}

/**
 * 修复 Mermaid mindmap SVG 样式问题
 *
 * Mermaid 11.x 的 mindmap 渲染器存在 bug：
 * - SVG 中定义了 .section-X path { fill: color } 样式
 * - 但节点的父级 <g> 元素没有 section-X class
 * - 导致 path 继承 SVG 根元素的 fill:#333，显示为黑色方块
 * - 连线的 style 属性是 "undefined; undefined"，没有 stroke 颜色
 *
 * 修复策略：
 * 1. 为 mindmap 连线添加彩色 stroke 样式（使用提取的 edgeColors）
 * 2. 为根节点 circle 添加内联 fill 样式
 * 3. 为子节点 path 添加内联 fill 样式
 */
function fixMindmapStyles(svg: string): string {
  // 只处理 mindmap 图表
  if (!svg.includes('aria-roledescription="mindmap"')) {
    return svg
  }

  // 1. 提取颜色定义
  const { sectionColors, edgeColors, rootColor } = extractMindmapColors(svg)

  // 如果没有找到颜色定义，返回原 SVG
  if (Object.keys(sectionColors).length === 0 && Object.keys(edgeColors).length === 0) {
    return svg
  }

  let result = svg

  // 2. 修复连线样式（使用彩色）
  result = fixMindmapEdges(result, edgeColors)

  // 3. 修复根节点样式
  result = fixMindmapRootNode(result, rootColor)

  // 4. 修复子节点样式
  result = fixMindmapChildNodes(result, sectionColors)

  return result
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
 *
 * v1.4.7 增强：
 * - 更完整的 script 标签匹配（包括未闭合的情况）
 * - 更全面的事件处理器检测（包括无引号和反引号的情况）
 * - 处理 javascript: 的实体编码和空白字符插入绕过
 */
/**
 * 修复 timeline/pie 等图表中 marker 缺少 id 属性的问题
 * Mermaid 某些图表类型生成的 <marker> 元素没有 id 属性，
 * 但连线引用了 marker-end="url(#arrowhead)"，导致箭头不显示
 */
function fixMissingMarkerIds(svg: string): string {
  // 只处理包含未定义 marker 引用的 SVG
  if (!svg.includes('url(#arrowhead)')) {
    return svg
  }

  // 检查是否已经有 id="arrowhead" 的 marker
  if (svg.includes('id="arrowhead"')) {
    return svg
  }

  // 查找没有 id 属性的 marker 元素并添加 id="arrowhead"
  // 匹配: <marker refX="..." ...> 但没有 id 属性
  return svg.replace(
    /<marker\s+(?!id=)([^>]*?)>/g,
    (match, attrs) => {
      // 检查 attrs 中是否真的没有 id
      if (/\bid\s*=/.test(attrs)) {
        return match // 已有 id，不修改
      }
      return `<marker id="arrowhead" ${attrs}>`
    }
  )
}

/**
 * 修复 flowchart 箭头在导出 HTML 中不显示的问题
 * 问题：Mermaid 生成的 marker 内的 path/circle 元素没有 fill 属性，
 * 依赖 CSS 类 .marker { fill: #333 } 来着色，但该 CSS 规则在独立 HTML 中无法正确应用
 * 解决：为 marker 内的 path 和 circle 元素添加内联 fill 属性
 */
function fixMarkerFill(svg: string): string {
  // 匹配 <marker ...>...</marker> 并处理其中的 path 和 circle
  return svg.replace(
    /<marker\s+[^>]*>[\s\S]*?<\/marker>/gi,
    (markerBlock) => {
      // 从 SVG 样式中提取 marker 的 fill 颜色
      const fillMatch = svg.match(/\.marker\s*\{[^}]*fill:\s*([^;}\s]+)/i)
      const fillColor = fillMatch?.[1] || '#333333'

      // 为没有 fill 属性的 path 添加 fill
      let result = markerBlock.replace(
        /<path\s+(?![^>]*\bfill=)([^>]*?)>/gi,
        (match, attrs) => `<path fill="${fillColor}" ${attrs}>`
      )

      // 为没有 fill 属性的 circle 添加 fill
      result = result.replace(
        /<circle\s+(?![^>]*\bfill=)([^>]*?)>/gi,
        (match, attrs) => `<circle fill="${fillColor}" ${attrs}>`
      )

      return result
    }
  )
}

function sanitizeSvg(svg: string): string {
  // 先修复 mindmap 样式问题
  let result = fixMindmapStyles(svg)

  // 修复 timeline/pie 等图表的 marker id 缺失问题
  result = fixMissingMarkerIds(result)

  // 修复 flowchart 等图表的箭头 fill 缺失问题
  result = fixMarkerFill(result)

  // 移除明显的危险内容（双重保险，Mermaid strict 模式已经处理过）
  return result
    // 移除 script 标签（包括未正确闭合的情况）
    .replace(/<script[\s\S]*?(?:<\/script>|$)/gi, '')
    // 移除事件处理器属性（覆盖有引号、无引号、反引号的情况）
    .replace(/\s+on\w+\s*=\s*(?:["'][^"']*["']|`[^`]*`|[^\s>]+)/gi, '')
    // 移除 javascript: URLs（处理空白字符插入绕过）
    .replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '')
    // 移除 vbscript: URLs
    .replace(/v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '')
    // 移除 data: URLs（除了图片）
    .replace(/data\s*:\s*(?!image\/)[^"'\s]*/gi, '')
    // 移除 expression() CSS 表达式（IE 专用但仍需防护）
    .replace(/expression\s*\(/gi, 'blocked(')
    // 移除 -moz-binding CSS（Firefox 特有）
    .replace(/-moz-binding\s*:/gi, '-blocked-binding:')
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
    // C4 架构图
    'c4context', 'c4container', 'c4component', 'c4dynamic', 'c4deployment',
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
