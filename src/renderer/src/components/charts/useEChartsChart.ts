/**
 * ECharts 图表渲染 Hook
 *
 * 从 VirtualizedMarkdown.tsx 提取的 ECharts 渲染逻辑：
 * - useEffect 1: 渲染图表（创建 DOM 结构、初始化 ECharts、响应式调整）
 * - useEffect 2: 处理点击事件（返回图表、切换代码、全屏、下载）
 *
 * @version v1.6.0
 */

import { useEffect } from 'react'
import * as echarts from '../../utils/echartsRenderer'
import { validateEChartsConfig, optimizeEChartsConfig } from '../../utils/echartsRenderer'
import Prism from 'prismjs'

/**
 * ECharts 图表渲染 Hook
 *
 * @param ref - 包含图表的容器 ref
 * @param html - Markdown 渲染后的 HTML 内容
 */
export function useEChartsChart(
  ref: React.RefObject<HTMLElement>,
  html: string
): void {
  // v1.5.1: ECharts 图表渲染（支持图表/代码切换）
  useEffect(() => {
    if (!ref.current) return

    const echartsBlocks = ref.current.querySelectorAll('pre.language-echarts')
    if (echartsBlocks.length === 0) return

    // 存储实例用于清理
    const charts: echarts.echarts.ECharts[] = []
    const observers: ResizeObserver[] = []

    echartsBlocks.forEach((block, index) => {
      const config = block.textContent || ''

      const validation = validateEChartsConfig(config)
      if (!validation.valid) {
        const errorDiv = document.createElement('div')
        errorDiv.className = 'echarts-error'
        errorDiv.innerHTML = `
            <div class="error-title">ECharts 配置错误</div>
            <div class="error-message">${validation.error}</div>
          `
        block.replaceWith(errorDiv)
        return
      }

      try {
        // 创建包装容器
        const wrapper = document.createElement('div')
        wrapper.className = 'echarts-wrapper'

        // 存储原始配置（Base64 编码避免 HTML 转义问题）
        wrapper.dataset.echartsConfig = btoa(unescape(encodeURIComponent(config)))

        // 创建切换按钮栏
        const toggleBar = document.createElement('div')
        toggleBar.className = 'echarts-toggle-bar no-export'
        toggleBar.innerHTML = `
              <button class="echarts-action-btn" data-action="toggleCode" title="查看代码">💻</button>
              <button class="echarts-action-btn" data-action="download" title="下载图片">💾</button>
              <button class="echarts-action-btn" data-action="fullscreen" title="全屏查看">⛶</button>
            `

        // 创建图表容器
        const chartContainer = document.createElement('div')
        chartContainer.className = 'echarts-container'
        chartContainer.dataset.view = 'chart'
        chartContainer.style.width = '100%'
        chartContainer.style.height = '400px'
        chartContainer.dataset.echartsIndex = String(index)

        // 创建代码视图容器
        const codeView = document.createElement('div')
        codeView.className = 'echarts-code-view'
        codeView.dataset.view = 'code'
        codeView.style.display = 'none'

        // 创建返回图表按钮
        const backToChartBtn = document.createElement('button')
        backToChartBtn.className = 'echarts-back-btn no-export'
        backToChartBtn.textContent = '图表'
        backToChartBtn.title = '返回图表视图'
        codeView.appendChild(backToChartBtn)

        // 创建复制按钮（使用统一的 .copy-btn 类）
        const copyButton = document.createElement('button')
        copyButton.className = 'copy-btn no-export'
        copyButton.textContent = '复制'
        copyButton.title = '复制 ECharts 代码'
        codeView.appendChild(copyButton)

        // 使用 Prism 高亮代码
        const codeElement = document.createElement('code')

        // 检测配置格式（JSON 或 JavaScript）
        let language = 'javascript'
        try {
          JSON.parse(config)
          language = 'json'
        } catch {
          // 保持 javascript
        }
        codeElement.className = `language-${language}`

        // 使用 Prism 高亮
        if (Prism.languages[language]) {
          codeElement.innerHTML = Prism.highlight(config, Prism.languages[language], language)
        } else {
          codeElement.textContent = config
        }

        const preElement = document.createElement('pre')
        preElement.className = `language-${language}`
        preElement.appendChild(codeElement)
        codeView.appendChild(preElement)

        // 组装结构
        wrapper.appendChild(toggleBar)
        wrapper.appendChild(chartContainer)
        wrapper.appendChild(codeView)

        block.replaceWith(wrapper)

        // 初始化 ECharts（在 chartContainer 中）
        const chart = echarts.echarts.init(chartContainer, null, { renderer: 'svg' })
        chart.setOption(optimizeEChartsConfig(validation.parsed!))

        // 渲染后根据内容自适应高度
        requestAnimationFrame(() => {
          const svg = chartContainer.querySelector('svg')
          if (svg) {
            try {
              const bbox = (svg as SVGSVGElement).getBBox()
              if (bbox.height > 0) {
                const targetH = Math.max(200, Math.ceil(bbox.height + bbox.y + 40))
                chartContainer.style.height = `${targetH}px`
                chart.resize()
              }
            } catch { /* getBBox may fail if not in DOM */ }
          }
        })

        charts.push(chart)

        // 响应式调整
        const resizeObserver = new ResizeObserver(() => {
          chart.resize()
        })
        resizeObserver.observe(chartContainer)
        observers.push(resizeObserver)
      } catch (error) {
        console.error('[ECharts] 渲染失败:', error)
        const errorDiv = document.createElement('div')
        errorDiv.className = 'echarts-error'
        errorDiv.innerHTML = `
            <div class="error-title">ECharts 渲染失败</div>
            <div class="error-message">${(error as Error).message}</div>
          `
        // 如果 block 还在 DOM 中，替换它
        if (block.parentNode) {
          block.replaceWith(errorDiv)
        }
      }
    })

    // 清理函数：防止内存泄漏
    return () => {
      charts.forEach((chart) => {
        try {
          chart.dispose()
        } catch (e) {
          console.warn('[ECharts] dispose error:', e)
        }
      })
      observers.forEach((observer) => observer.disconnect())
    }
  }, [html])

  // v1.5.1: ECharts 切换按钮 + 工具栏点击事件处理
  useEffect(() => {
    if (!ref.current) return

    const handleEchartsClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // 处理代码视图的「返回图表」按钮
      const backBtn = target.closest('.echarts-back-btn')
      if (backBtn) {
        const wrapper = backBtn.closest('.echarts-wrapper') as HTMLElement
        if (!wrapper) return
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector('.echarts-toggle-bar') as HTMLElement
        if (chartView) chartView.style.display = ''
        if (codeViewEl) codeViewEl.style.display = 'none'
        if (toggleBar) toggleBar.style.display = ''
        return
      }

      // 处理工具栏操作按钮
      const actionBtn = target.closest('.echarts-action-btn')
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action')
        const wrapper = actionBtn.closest('.echarts-wrapper') as HTMLElement
        if (!wrapper || !action) return

        const container = wrapper.querySelector('.echarts-container') as HTMLElement

        if (action === 'toggleCode') {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
          const toggleBar = wrapper.querySelector('.echarts-toggle-bar') as HTMLElement
          if (chartView) chartView.style.display = 'none'
          if (codeViewEl) codeViewEl.style.display = ''
          if (toggleBar) toggleBar.style.display = 'none'
        } else if (action === 'fullscreen') {
          if (document.fullscreenElement) {
            document.exitFullscreen?.()
          } else {
            wrapper.requestFullscreen?.()
            if (container) {
              const chart = echarts.echarts.getInstanceByDom(container)
              if (chart) setTimeout(() => chart.resize(), 300)
            }
          }
        } else if (action === 'download') {
          if (container) {
            const chart = echarts.echarts.getInstanceByDom(container)
            if (chart) {
              const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
              const a = document.createElement('a')
              a.download = `echarts-${Date.now()}.png`
              a.href = url
              a.click()
            }
          }
        }
        return
      }
    }

    // 全屏变化时 resize ECharts
    const handleFullscreenChange = () => {
      const fsEl = document.fullscreenElement
      if (fsEl?.classList.contains('echarts-wrapper')) {
        const container = fsEl.querySelector('.echarts-container') as HTMLElement
        if (container) {
          const chart = echarts.echarts.getInstanceByDom(container)
          if (chart) setTimeout(() => chart.resize(), 300)
        }
      } else {
        // 退出全屏时也需要 resize
        ref.current?.querySelectorAll('.echarts-container').forEach((container) => {
          const chart = echarts.echarts.getInstanceByDom(container as HTMLElement)
          if (chart) setTimeout(() => chart.resize(), 300)
        })
      }
    }

    ref.current.addEventListener('click', handleEchartsClick)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      ref.current?.removeEventListener('click', handleEchartsClick)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [html])
}
