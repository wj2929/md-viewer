/**
 * 图表通用工具函数
 *
 * 从 VirtualizedMarkdown.tsx 提取的重复代码：
 * - downloadSvgAsPng: SVG 转 PNG 下载（7 种图表共用）
 * - createChartWrapper: 创建图表包装 DOM 结构（wrapper + toggleBar + container + codeView）
 *
 * @version v1.6.0
 */

import Prism from 'prismjs'

/**
 * 将 SVG 元素导出为 PNG 并触发下载
 *
 * @param svg - 要导出的 SVG 元素
 * @param filename - 下载文件名（不含扩展名）
 * @param scale - 缩放倍数（默认 2x 高清）
 */
export function downloadSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
  scale = 2
): void {
  const svgClone = svg.cloneNode(true) as SVGSVGElement
  const svgData = new XMLSerializer().serializeToString(svgClone)
  const canvas = document.createElement('canvas')

  // 优先使用 getBBox 获取精确尺寸，回退到 clientWidth/Height
  let width: number
  let height: number
  try {
    const bbox = svg.getBBox()
    width = (bbox.width + bbox.x * 2) || svg.clientWidth
    height = (bbox.height + bbox.y * 2) || svg.clientHeight
  } catch {
    width = svg.clientWidth
    height = svg.clientHeight
  }

  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  const img = new Image()
  img.onload = () => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const a = document.createElement('a')
    a.download = `${filename}.png`
    a.href = canvas.toDataURL('image/png')
    a.click()
  }
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData)
}

/**
 * 工具栏按钮配置
 */
export interface ToolbarButton {
  action: string
  title: string
  label: string
}

/** 默认工具栏按钮集（含缩放） */
export const TOOLBAR_BUTTONS_WITH_ZOOM: ToolbarButton[] = [
  { action: 'toggleCode', title: '查看代码', label: '💻' },
  { action: 'zoomIn', title: '放大', label: '🔍+' },
  { action: 'zoomOut', title: '缩小', label: '🔍−' },
  { action: 'fit', title: '适应大小', label: '⊡' },
  { action: 'download', title: '下载图片', label: '💾' },
  { action: 'fullscreen', title: '全屏查看', label: '⛶' },
]

/** 简化工具栏按钮集（无缩放） */
export const TOOLBAR_BUTTONS_SIMPLE: ToolbarButton[] = [
  { action: 'toggleCode', title: '查看代码', label: '💻' },
  { action: 'download', title: '下载图片', label: '💾' },
  { action: 'fullscreen', title: '全屏查看', label: '⛶' },
]

/**
 * 图表包装器创建结果
 */
export interface ChartWrapperResult {
  wrapper: HTMLDivElement
  toggleBar: HTMLDivElement
  chartContainer: HTMLDivElement
  codeView: HTMLDivElement
}

/**
 * 创建图表通用 DOM 包装结构
 *
 * 生成统一的 wrapper > toggleBar + chartContainer + codeView 结构，
 * 包含返回按钮、复制按钮和代码高亮显示。
 *
 * @param chartType - 图表类型标识（如 'mermaid', 'echarts'）
 * @param code - 原始代码内容
 * @param language - 代码高亮语言（如 'javascript', 'yaml', 'markdown'）
 * @param buttons - 工具栏按钮配置
 */
export function createChartWrapper(
  chartType: string,
  code: string,
  language: string,
  buttons: ToolbarButton[] = TOOLBAR_BUTTONS_WITH_ZOOM
): ChartWrapperResult {
  // 包装容器
  const wrapper = document.createElement('div')
  wrapper.className = `${chartType}-wrapper`
  wrapper.dataset[`${chartType}Code`] = btoa(unescape(encodeURIComponent(code)))

  // 工具栏
  const toggleBar = document.createElement('div')
  toggleBar.className = `${chartType}-toggle-bar no-export`
  toggleBar.innerHTML = buttons
    .map(
      (btn) =>
        `<button class="${chartType}-action-btn" data-action="${btn.action}" title="${btn.title}">${btn.label}</button>`
    )
    .join('\n')

  // 图表容器
  const chartContainer = document.createElement('div')
  chartContainer.className = `${chartType}-container`
  chartContainer.dataset.view = 'chart'
  chartContainer.style.width = '100%'

  // 代码视图
  const codeView = document.createElement('div')
  codeView.className = `${chartType}-code-view`
  codeView.dataset.view = 'code'
  codeView.style.display = 'none'

  // 返回按钮
  const backBtn = document.createElement('button')
  backBtn.className = `${chartType}-back-btn no-export`
  backBtn.textContent = '图表'
  backBtn.title = '返回图表视图'
  codeView.appendChild(backBtn)

  // 复制按钮
  const copyBtn = document.createElement('button')
  copyBtn.className = 'copy-btn no-export'
  copyBtn.textContent = '复制'
  copyBtn.title = `复制 ${chartType.charAt(0).toUpperCase() + chartType.slice(1)} 代码`
  codeView.appendChild(copyBtn)

  // 代码高亮
  const codeElement = document.createElement('code')
  codeElement.className = `language-${language}`
  if (Prism.languages[language]) {
    codeElement.innerHTML = Prism.highlight(code, Prism.languages[language], language)
  } else {
    codeElement.textContent = code
  }

  const preElement = document.createElement('pre')
  preElement.className = `language-${language}`
  preElement.appendChild(codeElement)
  codeView.appendChild(preElement)

  // 组装
  wrapper.appendChild(toggleBar)
  wrapper.appendChild(chartContainer)
  wrapper.appendChild(codeView)

  return { wrapper, toggleBar, chartContainer, codeView }
}

/**
 * 创建图表切换按钮点击处理器（通用模式）
 *
 * 处理 backBtn（返回图表）和 toggleCode（切换到代码视图）的通用逻辑。
 * 返回一个事件处理函数，可直接用于 addEventListener。
 *
 * @param chartType - 图表类型标识
 */
export function createChartToggleHandler(chartType: string) {
  return (e: MouseEvent) => {
    const target = e.target as HTMLElement

    // 返回图表按钮
    const backBtn = target.closest(`.${chartType}-back-btn`)
    if (backBtn) {
      const wrapper = backBtn.closest(`.${chartType}-wrapper`) as HTMLElement
      if (!wrapper) return
      const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
      const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
      const toggleBar = wrapper.querySelector(`.${chartType}-toggle-bar`) as HTMLElement
      if (chartView) chartView.style.display = ''
      if (codeViewEl) codeViewEl.style.display = 'none'
      if (toggleBar) toggleBar.style.display = ''
      return true // handled
    }

    // 工具栏按钮
    const actionBtn = target.closest(`.${chartType}-action-btn`)
    if (actionBtn) {
      const action = actionBtn.getAttribute('data-action')
      if (action === 'toggleCode') {
        const wrapper = actionBtn.closest(`.${chartType}-wrapper`) as HTMLElement
        if (!wrapper) return false
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector(`.${chartType}-toggle-bar`) as HTMLElement
        if (chartView) chartView.style.display = 'none'
        if (codeViewEl) codeViewEl.style.display = ''
        if (toggleBar) toggleBar.style.display = 'none'
        return true // handled
      }
    }

    return false // not handled
  }
}
