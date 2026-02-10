/**
 * ECharts 渲染器
 * 支持在 Markdown 中渲染 ECharts 图表
 */

// 按需引入 ECharts
import * as echarts from 'echarts/core'
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  GaugeChart,
  FunnelChart,
  CustomChart,
} from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  MarkPointComponent,
  MarkLineComponent,
  RadarComponent,
  PolarComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

// 注册组件
echarts.use([
  // 图表类型
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  GaugeChart,
  FunnelChart,
  CustomChart,
  // 组件
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  MarkPointComponent,
  MarkLineComponent,
  RadarComponent,
  PolarComponent,
  // 渲染器
  SVGRenderer,
])

// 配置常量
const ECHARTS_CONFIG = {
  MAX_CONFIG_SIZE: 50 * 1024, // 50KB
  MAX_CHARTS_PER_PAGE: 20,
  DEFAULT_WIDTH: 600,
  DEFAULT_HEIGHT: 400,
}

// 验证结果类型
interface ValidationResult {
  valid: boolean
  error?: string
  parsed?: EChartsOption
}

/**
 * 解析 JavaScript 格式的 ECharts 配置
 * 支持变量声明、函数、注释等 JavaScript 语法
 */
function parseJavaScriptConfig(code: string): EChartsOption | null {
  try {
    // 1. 清理代码
    let cleaned = code
      .replace(/\/\/.*$/gm, '')           // 移除单行注释
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 移除多行注释
      .trim()

    // 2. 提取对象字面量
    // 支持多种格式：
    // - const option = { ... }
    // - var option = { ... };
    // - let option = { ... }
    // - option = { ... }  (无声明关键字的赋值)
    // - { ... }
    const patterns = [
      /(?:const|var|let)\s+\w+\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,  // 变量声明
      /^\w+\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,                      // 无声明关键字的赋值 (option = {...})
      /^(\{[\s\S]*\})\s*;?\s*$/                                 // 直接对象
    ]

    let objectCode: string | null = null
    for (const pattern of patterns) {
      const match = cleaned.match(pattern)
      if (match) {
        objectCode = match[1]
        break
      }
    }

    if (!objectCode) {
      console.warn('[ECharts] 无法提取对象字面量')
      return null
    }

    // 3. 使用 Function 构造器执行代码（比 eval 更安全）
    // 添加 'use strict' 模式增强安全性
    const fn = new Function(`'use strict'; return (${objectCode})`)
    const option = fn()

    return option as EChartsOption
  } catch (err) {
    console.error('[ECharts] JavaScript 配置解析失败:', err)
    return null
  }
}

/**
 * 验证 ECharts 配置
 */
export function validateEChartsConfig(config: string): ValidationResult {
  if (config.length > ECHARTS_CONFIG.MAX_CONFIG_SIZE) {
    return { valid: false, error: '配置过大，请简化图表配置' }
  }

  // 1. 先尝试 JSON 格式（纯 JSON 配置）
  try {
    const parsed = JSON.parse(config) as EChartsOption
    return { valid: true, parsed }
  } catch {
    // JSON 解析失败，继续尝试 JavaScript 格式
  }

  // 2. 尝试 JavaScript 格式（包含函数、变量声明等）
  try {
    const parsed = parseJavaScriptConfig(config)
    if (parsed) {
      return { valid: true, parsed }
    }
  } catch (err) {
    console.error('[ECharts] JavaScript 配置解析错误:', err)
  }

  return { valid: false, error: '配置格式错误（需要 JSON 或 JavaScript 对象）' }
}

/**
 * HTML 实体解码
 */
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * 检测图表类型
 */
function detectChartTypes(option: EChartsOption): {
  hasPie: boolean
  hasRadar: boolean
  hasAxis: boolean
  hasGauge: boolean
  hasFunnel: boolean
} {
  const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : []

  return {
    hasPie: series.some((s: { type?: string }) => s.type === 'pie'),
    hasRadar: series.some((s: { type?: string }) => s.type === 'radar'),
    hasAxis: !!(option.xAxis || option.yAxis),
    hasGauge: series.some((s: { type?: string }) => s.type === 'gauge'),
    hasFunnel: series.some((s: { type?: string }) => s.type === 'funnel'),
  }
}

/**
 * 优化 ECharts 配置，减少空白区域
 * 根据图表类型智能调整 grid、center、radius 等参数
 */
export function optimizeEChartsConfig(option: EChartsOption): EChartsOption {
  const types = detectChartTypes(option)
  const optimized = { ...option }

  // 对于有坐标轴的图表（柱状图、折线图等），优化 grid
  if (types.hasAxis && !optimized.grid) {
    optimized.grid = {
      left: '8%',
      right: '8%',
      top: option.title ? '15%' : '10%',
      bottom: option.legend ? '15%' : '10%',
      containLabel: true,
    }
  }

  // 对于饼图，优化 center 和 radius
  if (types.hasPie && Array.isArray(optimized.series)) {
    optimized.series = (optimized.series as any[]).map((s) => {
      if (s.type === 'pie') {
        return {
          ...s,
          center: s.center || ['50%', '50%'],
          radius: s.radius || (s.roseType ? ['20%', '55%'] : ['0%', '60%']),
        }
      }
      return s
    })
  }

  // 对于雷达图，优化 radar 配置
  if (types.hasRadar && !optimized.radar) {
    optimized.radar = {
      ...((optimized.radar ?? {}) as Record<string, unknown>),
      center: ['50%', '55%'],
      radius: '65%',
    }
  }

  // 对于仪表盘，优化 center 和 radius
  if (types.hasGauge && Array.isArray(optimized.series)) {
    optimized.series = (optimized.series as any[]).map((s) => {
      if (s.type === 'gauge') {
        return {
          ...s,
          center: s.center || ['50%', '55%'],
          radius: s.radius || '70%',
        }
      }
      return s
    })
  }

  // 对于漏斗图，优化位置
  if (types.hasFunnel && Array.isArray(optimized.series)) {
    optimized.series = (optimized.series as any[]).map((s) => {
      if (s.type === 'funnel') {
        return {
          ...s,
          left: s.left || '10%',
          right: s.right || '10%',
          top: s.top || '10%',
          bottom: s.bottom || '10%',
        }
      }
      return s
    })
  }

  // 当 title 和 legend 同时存在时，自动调整 legend.top 避免重叠
  if (option.title && option.legend) {
    const legend = optimized.legend as Record<string, unknown>
    // 仅在用户没有设置足够大的 top 值时才调整
    const legendTop = legend?.top
    if (legendTop === undefined || (typeof legendTop === 'number' && legendTop < 40)) {
      optimized.legend = { ...legend, top: 40 }
    }
  }

  return optimized
}

/**
 * 渲染 ECharts 为 SVG（用于导出）
 * 使用可见容器确保正确渲染
 */
export async function renderEChartsToSvg(config: string, id: string): Promise<string> {
  const validation = validateEChartsConfig(config)
  if (!validation.valid) {
    return `<div class="echarts-error">${escapeHtml(validation.error!)}</div>`
  }

  // 优化配置，减少空白
  const optimizedOption = optimizeEChartsConfig(validation.parsed!)

  // 创建临时容器 - 使用可见但透明的方式
  const container = document.createElement('div')
  container.style.width = `${ECHARTS_CONFIG.DEFAULT_WIDTH}px`
  container.style.height = `${ECHARTS_CONFIG.DEFAULT_HEIGHT}px`
  container.style.position = 'fixed'
  container.style.left = '0'
  container.style.top = '0'
  container.style.opacity = '0'
  container.style.pointerEvents = 'none'
  container.style.zIndex = '-1'
  document.body.appendChild(container)

  let chart: echarts.ECharts | null = null

  try {
    chart = echarts.init(container, null, { renderer: 'svg' })
    chart.setOption({ ...optimizedOption, animation: false })

    // 等待渲染完成（动画已禁用，只需等待 DOM 更新）
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 获取 SVG 内容
    const svgElement = container.querySelector('svg')
    if (!svgElement) {
      return `<div class="echarts-error">SVG 渲染失败</div>`
    }

    // 克隆 SVG
    const svgClone = svgElement.cloneNode(true) as SVGElement

    // 使用原始 viewBox，不裁剪（避免裁剪出错）
    // ECharts 生成的 SVG viewBox 通常是 0 0 600 400
    const viewBox = svgClone.getAttribute('viewBox') || `0 0 ${ECHARTS_CONFIG.DEFAULT_WIDTH} ${ECHARTS_CONFIG.DEFAULT_HEIGHT}`
    svgClone.setAttribute('viewBox', viewBox)

    // 设置固定的像素尺寸（用于 Pandoc 导出）
    // 使用 624px 宽度（对应 Word 页面宽度 6.5 英寸 @ 96 DPI）
    const exportWidth = 624
    const [, , vbWidth, vbHeight] = viewBox.split(' ').map(Number)
    const aspectRatio = vbHeight / vbWidth
    const exportHeight = Math.round(exportWidth * aspectRatio)

    svgClone.setAttribute('width', String(exportWidth))
    svgClone.setAttribute('height', String(exportHeight))
    svgClone.setAttribute('preserveAspectRatio', 'xMidYMid meet')

    // 移除绝对定位样式
    svgClone.style.position = 'relative'
    svgClone.style.left = ''
    svgClone.style.top = ''
    svgClone.style.display = 'block'
    svgClone.style.margin = '0 auto'

    return svgClone.outerHTML
  } finally {
    // 确保清理资源
    if (chart) {
      chart.dispose()
    }
    document.body.removeChild(container)
  }
}

/**
 * 判断是否是 ECharts 配置
 * 支持 JSON 和 JavaScript 两种格式
 */
export function isEChartsConfig(code: string): boolean {
  // 1. 先尝试 JSON 格式
  try {
    const parsed = JSON.parse(code.trim())
    // 检查是否包含 ECharts 特征属性
    return (
      parsed && (parsed.series || parsed.xAxis || parsed.yAxis || parsed.title || parsed.tooltip)
    )
  } catch {
    // JSON 解析失败，继续尝试 JavaScript 格式
  }

  // 2. 尝试 JavaScript 格式
  try {
    const parsed = parseJavaScriptConfig(code)
    if (parsed) {
      // 检查是否包含 ECharts 特征属性
      return !!(parsed.series || parsed.xAxis || parsed.yAxis || parsed.title || parsed.tooltip)
    }
  } catch {
    // JavaScript 解析也失败
  }

  return false
}

/**
 * 处理 HTML 中的 ECharts 代码块（用于导出）
 */
export async function processEChartsInHtml(html: string): Promise<string> {
  const echartsRegex =
    /<pre\s+class="language-echarts">\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g

  const matches: { match: string; config: string; index: number }[] = []
  let m: RegExpExecArray | null
  let count = 0

  while (
    (m = echartsRegex.exec(html)) !== null &&
    count < ECHARTS_CONFIG.MAX_CHARTS_PER_PAGE
  ) {
    const config = decodeHtmlEntities(m[1])
    if (isEChartsConfig(config)) {
      matches.push({ match: m[0], config, index: m.index })
      count++
    }
  }

  // 逆序处理（从后往前替换，避免索引偏移）
  for (let i = matches.length - 1; i >= 0; i--) {
    const { match, config, index } = matches[i]
    const svg = await renderEChartsToSvg(config, `echarts-export-${i}`)
    const wrapper = `<div class="echarts-container">${svg}</div>`
    html = html.slice(0, index) + wrapper + html.slice(index + match.length)
  }

  return html
}

// 导出 echarts 实例供组件使用
export { echarts }
export type { EChartsOption }
