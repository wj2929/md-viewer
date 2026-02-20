/**
 * DrawIO 图表渲染 Hook
 *
 * 从 VirtualizedMarkdown.tsx 提取的 DrawIO 渲染逻辑，
 * 包含图表渲染和交互工具栏处理。
 *
 * @version v1.5.5
 */

import { useEffect } from 'react'
import {
  validateDrawioCode,
  renderDrawioInElement,
  type HTMLElementWithViewer,
} from '../../utils/drawioRenderer'

/**
 * DrawIO 图表渲染 Hook
 *
 * @param ref - 容器元素的 ref
 * @param html - Markdown 渲染后的 HTML 内容（用于触发重新渲染）
 */
export function useDrawIOChart(ref: React.RefObject<HTMLElement>, html: string): void {
  // v1.5.5: DrawIO 图表渲染（异步加载 viewer.min.js）
  useEffect(() => {
    if (!ref.current) return

    const drawioBlocks = ref.current.querySelectorAll('pre.language-drawio')
    if (drawioBlocks.length === 0) return

    const abortController = new AbortController()
    const { signal } = abortController
    // 跟踪所有 DrawIO 容器，用于 cleanup 时销毁 viewer 实例
    const drawioContainers: HTMLElementWithViewer[] = []

    ;(async () => {
      for (let index = 0; index < drawioBlocks.length; index++) {
        if (signal.aborted) break

        const block = drawioBlocks[index]
        const code = block.textContent || ''

        const validation = validateDrawioCode(code)
        if (!validation.valid) {
          const errorDiv = document.createElement('div')
          errorDiv.className = 'drawio-error'
          errorDiv.innerHTML = `
            <div class="error-title">DrawIO 配置错误</div>
            <div class="error-message">${validation.error}</div>
          `
          if (block.parentNode) block.replaceWith(errorDiv)
          continue
        }

        try {
          // 创建包装容器
          const wrapper = document.createElement('div')
          wrapper.className = 'drawio-wrapper'

          // 存储原始代码
          wrapper.dataset.drawioCode = btoa(unescape(encodeURIComponent(code)))

          // 创建切换按钮栏
          const toggleBar = document.createElement('div')
          toggleBar.className = 'drawio-toggle-bar no-export'
          toggleBar.innerHTML = `
            <button class="drawio-action-btn" data-action="toggleCode" title="查看代码">💻</button>
            <button class="drawio-action-btn" data-action="zoomIn" title="放大">🔍+</button>
            <button class="drawio-action-btn" data-action="zoomOut" title="缩小">🔍−</button>
            <button class="drawio-action-btn" data-action="fit" title="适应大小">⊡</button>
            <button class="drawio-action-btn" data-action="download" title="下载图片">💾</button>
            <button class="drawio-action-btn" data-action="lightbox" title="全屏查看">⛶</button>
          `

          // 创建图表容器
          const chartContainer = document.createElement('div')
          chartContainer.className = 'drawio-container'
          chartContainer.dataset.view = 'chart'
          chartContainer.style.width = '100%'

          // 创建代码视图容器
          const codeView = document.createElement('div')
          codeView.className = 'drawio-code-view'
          codeView.dataset.view = 'code'
          codeView.style.display = 'none'

          // 创建返回图表按钮
          const backToChartBtn = document.createElement('button')
          backToChartBtn.className = 'drawio-back-btn no-export'
          backToChartBtn.textContent = '图表'
          backToChartBtn.title = '返回图表视图'
          codeView.appendChild(backToChartBtn)

          // 创建复制按钮
          const copyButton = document.createElement('button')
          copyButton.className = 'copy-btn no-export'
          copyButton.textContent = '复制'
          copyButton.title = '复制 DrawIO 代码'
          codeView.appendChild(copyButton)

          // 代码显示（XML 格式）
          const codeElement = document.createElement('code')
          codeElement.className = 'language-xml'
          codeElement.textContent = code

          const preElement = document.createElement('pre')
          preElement.className = 'language-xml'
          preElement.appendChild(codeElement)
          codeView.appendChild(preElement)

          // 组装结构
          wrapper.appendChild(toggleBar)
          wrapper.appendChild(chartContainer)
          wrapper.appendChild(codeView)

          if (block.parentNode) {
            block.replaceWith(wrapper)
          }

          // 渲染 DrawIO
          await renderDrawioInElement(code, chartContainer)
          drawioContainers.push(chartContainer as HTMLElementWithViewer)

          if (signal.aborted) break
        } catch (error) {
          if (signal.aborted) break
          console.error('[DrawIO] 渲染失败:', error)
          const errorDiv = document.createElement('div')
          errorDiv.className = 'drawio-error'
          errorDiv.innerHTML = `
            <div class="error-title">DrawIO 渲染失败</div>
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
      // 销毁 DrawIO viewer 实例，防止内存泄漏
      drawioContainers.forEach((container) => {
        try {
          const viewer = container.__drawioViewer
          if (viewer?.graph) {
            viewer.graph = null as unknown as typeof viewer.graph
          }
          delete container.__drawioViewer
        } catch (e) {
          console.warn('[DrawIO] cleanup error:', e)
        }
      })
    }
  }, [html])

  // v1.5.5: DrawIO 切换按钮 + 工具栏点击事件处理
  useEffect(() => {
    if (!ref.current) return

    const handleToggleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // 处理代码视图的「返回图表」按钮
      const backBtn = target.closest('.drawio-back-btn')
      if (backBtn) {
        const wrapper = backBtn.closest('.drawio-wrapper') as HTMLElement
        if (!wrapper) return
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector('.drawio-toggle-bar') as HTMLElement
        if (chartView) chartView.style.display = ''
        if (codeViewEl) codeViewEl.style.display = 'none'
        if (toggleBar) toggleBar.style.display = ''
        return
      }

      // 处理工具栏操作按钮
      const actionBtn = target.closest('.drawio-action-btn')
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action')
        const wrapper = actionBtn.closest('.drawio-wrapper')
        const container = wrapper?.querySelector('.drawio-container') as HTMLElementWithViewer | null
        const viewer = container?.__drawioViewer
        if (!action) return

        if (action === 'toggleCode') {
          const wrapperEl = wrapper as HTMLElement
          const chartView = wrapperEl?.querySelector('[data-view="chart"]') as HTMLElement
          const codeViewEl = wrapperEl?.querySelector('[data-view="code"]') as HTMLElement
          const toggleBar = wrapperEl?.querySelector('.drawio-toggle-bar') as HTMLElement
          if (chartView) chartView.style.display = 'none'
          if (codeViewEl) codeViewEl.style.display = ''
          if (toggleBar) toggleBar.style.display = 'none'
          return
        }

        if (!viewer && action !== 'download') return

        try {
          switch (action) {
            case 'zoomIn':
              viewer?.graph.zoomIn()
              break
            case 'zoomOut':
              viewer?.graph.zoomOut()
              break
            case 'fit':
              viewer?.graph.fit()
              break
            case 'download': {
              const svg = container?.querySelector('svg') as SVGSVGElement
              if (svg) {
                const svgClone = svg.cloneNode(true) as SVGSVGElement
                const svgData = new XMLSerializer().serializeToString(svgClone)
                const canvas = document.createElement('canvas')
                const scale = 2
                canvas.width = svg.clientWidth * scale
                canvas.height = svg.clientHeight * scale
                const ctx = canvas.getContext('2d')!
                const img = new Image()
                img.onload = () => {
                  ctx.fillStyle = '#ffffff'
                  ctx.fillRect(0, 0, canvas.width, canvas.height)
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                  const a = document.createElement('a')
                  a.download = `drawio-${Date.now()}.png`
                  a.href = canvas.toDataURL('image/png')
                  a.click()
                }
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData)
              }
              break
            }
            case 'lightbox':
              viewer?.showLightbox()
              break
          }
        } catch (err) {
          console.error('[DrawIO] 工具栏操作失败:', err)
        }
        return
      }
    }

    ref.current.addEventListener('click', handleToggleClick)
    return () => ref.current?.removeEventListener('click', handleToggleClick)
  }, [html])
}

