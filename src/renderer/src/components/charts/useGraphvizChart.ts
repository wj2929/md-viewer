/**
 * Graphviz DOT 图表渲染 Hook
 *
 * 从 VirtualizedMarkdown.tsx 提取的 Graphviz 渲染逻辑：
 * - 渲染 useEffect（异步 WASM 加载 + SVG 生成）
 * - 点击处理 useEffect（工具栏操作 + 缩放逻辑）
 *
 * @version v1.6.0
 */

import { useEffect } from 'react'
import { validateGraphvizCode, renderGraphvizToSvg } from '../../utils/graphvizRenderer'
import { downloadSvgAsPng, toggleChartFullscreen } from '../../utils/chartUtils'

/**
 * Graphviz 图表渲染 Hook
 *
 * @param ref - 包含 Graphviz 代码块的容器引用
 * @param html - Markdown 渲染后的 HTML 内容（用于触发重新渲染）
 */
export function useGraphvizChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true
): void {
  // v1.5.4: Graphviz DOT 图渲染（异步 WASM 加载）
  useEffect(() => {
    if (!enabled || !ref.current) return

    const graphvizBlocks = ref.current.querySelectorAll('pre.language-graphviz')
    if (graphvizBlocks.length === 0) return

    const abortController = new AbortController()
    const { signal } = abortController

    ;(async () => {
      for (let index = 0; index < graphvizBlocks.length; index++) {
        if (signal.aborted) break

        const block = graphvizBlocks[index]
        const code = block.textContent || ''

        const validation = validateGraphvizCode(code)
        if (!validation.valid) {
          const errorDiv = document.createElement('div')
          errorDiv.className = 'graphviz-error'
          errorDiv.innerHTML = `
            <div class="error-title">Graphviz 配置错误</div>
            <div class="error-message">${validation.error}</div>
          `
          if (block.parentNode) block.replaceWith(errorDiv)
          continue
        }

        try {
          const svgString = await renderGraphvizToSvg(code, `preview-${index}`)

          if (signal.aborted) break

          // 创建包装容器
          const wrapper = document.createElement('div')
          wrapper.className = 'graphviz-wrapper'

          // 存储原始代码
          wrapper.dataset.graphvizCode = btoa(unescape(encodeURIComponent(code)))
          wrapper.dataset.graphvizIndex = String(index)

          // 创建切换按钮栏
          const toggleBar = document.createElement('div')
          toggleBar.className = 'graphviz-toggle-bar no-export'
          toggleBar.innerHTML = `
            <button class="graphviz-action-btn" data-action="toggleCode" title="查看代码">💻</button>
            <button class="graphviz-action-btn" data-action="zoomIn" title="放大">🔍+</button>
            <button class="graphviz-action-btn" data-action="zoomOut" title="缩小">🔍−</button>
            <button class="graphviz-action-btn" data-action="fit" title="适应大小">⊡</button>
            <button class="graphviz-action-btn" data-action="download" title="下载图片">💾</button>
            <button class="graphviz-action-btn" data-action="fullscreen" title="全屏查看">⛶</button>
          `

          // 创建图表容器
          const chartContainer = document.createElement('div')
          chartContainer.className = 'graphviz-container'
          chartContainer.dataset.view = 'chart'
          chartContainer.style.width = '100%'
          chartContainer.innerHTML = svgString

          // 让 SVG 自适应容器
          const svg = chartContainer.querySelector('svg')
          if (svg) {
            svg.style.height = 'auto'
          }

          // 创建代码视图容器
          const codeView = document.createElement('div')
          codeView.className = 'graphviz-code-view'
          codeView.dataset.view = 'code'
          codeView.style.display = 'none'

          // 创建返回图表按钮
          const backToChartBtn = document.createElement('button')
          backToChartBtn.className = 'graphviz-back-btn no-export'
          backToChartBtn.textContent = '图表'
          backToChartBtn.title = '返回图表视图'
          codeView.appendChild(backToChartBtn)

          // 创建复制按钮
          const copyButton = document.createElement('button')
          copyButton.className = 'copy-btn no-export'
          copyButton.textContent = '复制'
          copyButton.title = '复制 Graphviz 代码'
          codeView.appendChild(copyButton)

          // 代码显示
          const codeElement = document.createElement('code')
          codeElement.className = 'language-plaintext'
          codeElement.textContent = code

          const preElement = document.createElement('pre')
          preElement.className = 'language-plaintext'
          preElement.appendChild(codeElement)
          codeView.appendChild(preElement)

          // 组装结构
          wrapper.appendChild(toggleBar)
          wrapper.appendChild(chartContainer)
          wrapper.appendChild(codeView)

          if (block.parentNode) {
            block.replaceWith(wrapper)
          }
        } catch (error) {
          if (signal.aborted) break
          console.error('[Graphviz] 渲染失败:', error)
          const errorDiv = document.createElement('div')
          errorDiv.className = 'graphviz-error'
          errorDiv.innerHTML = `
            <div class="error-title">Graphviz 渲染失败</div>
            <div class="error-message">${(error as Error).message}</div>
          `
          if (block.parentNode) {
            block.replaceWith(errorDiv)
          }
        }
      }
    })()

    return () => {
      abortController.abort()
    }
  }, [html, enabled])

  // v1.5.4: Graphviz 切换按钮 + 工具栏点击事件处理
  useEffect(() => {
    if (!ref.current) return

    const handleGraphvizClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // 处理代码视图的「返回图表」按钮
      const backBtn = target.closest('.graphviz-back-btn')
      if (backBtn) {
        const wrapper = backBtn.closest('.graphviz-wrapper') as HTMLElement
        if (!wrapper) return
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector('.graphviz-toggle-bar') as HTMLElement
        if (chartView) chartView.style.display = ''
        if (codeViewEl) codeViewEl.style.display = 'none'
        if (toggleBar) toggleBar.style.display = ''
        return
      }

      // 处理工具栏操作按钮
      const actionBtn = target.closest('.graphviz-action-btn')
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action')
        const wrapper = actionBtn.closest('.graphviz-wrapper') as HTMLElement
        const container = wrapper?.querySelector('.graphviz-container') as HTMLElement
        if (!container || !action) return

        if (action === 'toggleCode') {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
          const toggleBar = wrapper.querySelector('.graphviz-toggle-bar') as HTMLElement
          if (chartView) chartView.style.display = 'none'
          if (codeViewEl) codeViewEl.style.display = ''
          if (toggleBar) toggleBar.style.display = 'none'
          return
        }

        const svg = container.querySelector('svg') as SVGSVGElement
        if (!svg && action !== 'fullscreen') return

        try {
          const applyGraphvizZoom = (percent: number) => {
            const wrapper = container.closest('.graphviz-wrapper') as HTMLElement
            if (!wrapper) return

            let baseWidth = parseFloat(container.dataset.baseWidth || '')
            if (!(baseWidth > 0)) {
              const vb = svg.viewBox?.baseVal
              if (vb && vb.width > 0) {
                baseWidth = vb.width
              } else {
                const attrW = svg.getAttribute('width')
                if (attrW && !attrW.includes('%')) {
                  baseWidth = parseFloat(attrW)
                }
              }
              if (!(baseWidth > 0)) return
              container.dataset.baseWidth = String(baseWidth)
              container.dataset.origSvgWidth = svg.getAttribute('width') || ''
            }

            svg.style.transform = ''
            svg.style.transformOrigin = ''
            container.style.height = ''
            container.style.minWidth = ''
            svg.removeAttribute('height')
            svg.style.height = 'auto'

            if (percent === 100) {
              const origWidth = container.dataset.origSvgWidth
              if (origWidth) {
                svg.setAttribute('width', origWidth)
              }
              svg.style.width = ''
              svg.style.maxWidth = ''
              container.classList.remove('zoomed')
              wrapper.classList.remove('zoomed-wrapper')
            } else {
              const targetWidth = baseWidth * percent / 100
              svg.setAttribute('width', String(targetWidth))
              svg.style.width = `${targetWidth}px`
              svg.style.maxWidth = 'none'
              container.classList.add('zoomed')

              if (percent > 100) {
                wrapper.classList.add('zoomed-wrapper')
              } else {
                wrapper.classList.remove('zoomed-wrapper')
              }
            }
          }

          switch (action) {
            case 'zoomIn': {
              const level = parseInt(container.dataset.zoomLevel || '100', 10)
              const newLevel = Math.min(level + 20, 300)
              container.dataset.zoomLevel = String(newLevel)
              applyGraphvizZoom(newLevel)
              break
            }
            case 'zoomOut': {
              const level = parseInt(container.dataset.zoomLevel || '100', 10)
              const newLevel = Math.max(level - 20, 30)
              container.dataset.zoomLevel = String(newLevel)
              applyGraphvizZoom(newLevel)
              break
            }
            case 'fit':
              container.dataset.zoomLevel = '100'
              applyGraphvizZoom(100)
              break
            case 'download': {
              downloadSvgAsPng(svg, `graphviz-${Date.now()}`)
              break
            }
            case 'fullscreen':
              toggleChartFullscreen(wrapper)
              break
          }
        } catch (err) {
          console.error('[Graphviz] 工具栏操作失败:', err)
        }
        return
      }
    }

    ref.current.addEventListener('click', handleGraphvizClick)
    return () => ref.current?.removeEventListener('click', handleGraphvizClick)
  }, [html])
}
