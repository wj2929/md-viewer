/**
 * Markmap 思维导图渲染 Hook
 *
 * 从 VirtualizedMarkdown.tsx 提取的 Markmap 渲染逻辑：
 * - 渲染 useEffect: 创建 DOM 结构 + 初始化 Markmap 实例
 * - 点击处理 useEffect: 工具栏按钮交互 + 全屏监听
 *
 * @version v1.5.5
 */

import { useEffect } from 'react'
import { Transformer, Markmap, deriveOptions, validateMarkmapCode } from '../../utils/markmapRenderer'
import Prism from 'prismjs'
import { downloadSvgAsPng } from '../../utils/chartUtils'

/**
 * Markmap 思维导图渲染 Hook
 *
 * @param ref - 容器元素引用
 * @param html - Markdown 渲染后的 HTML 内容
 */
export function useMarkmapChart(ref: React.RefObject<HTMLElement | null>, html: string): void {
  // v1.5.4: Markmap 思维导图渲染
  useEffect(() => {
    if (!ref.current) return

    const markmapBlocks = ref.current.querySelectorAll('pre.language-markmap')
    if (markmapBlocks.length === 0) return

    const instances: Markmap[] = []

    markmapBlocks.forEach((block, index) => {
      const code = block.textContent || ''

      const validation = validateMarkmapCode(code)
      if (!validation.valid) {
        const errorDiv = document.createElement('div')
        errorDiv.className = 'markmap-error'
        errorDiv.innerHTML = `
            <div class="error-title">Markmap 配置错误</div>
            <div class="error-message">${validation.error}</div>
          `
        block.replaceWith(errorDiv)
        return
      }

      try {
        // 创建包装容器
        const wrapper = document.createElement('div')
        wrapper.className = 'markmap-wrapper'

        // 存储原始代码（Base64 编码）
        wrapper.dataset.markmapCode = btoa(unescape(encodeURIComponent(code)))

        // 创建切换按钮栏
        const toggleBar = document.createElement('div')
        toggleBar.className = 'markmap-toggle-bar no-export'
        toggleBar.innerHTML = `
              <button class="markmap-action-btn" data-action="toggleCode" title="查看代码">💻</button>
              <button class="markmap-action-btn" data-action="zoomIn" title="放大">🔍+</button>
              <button class="markmap-action-btn" data-action="zoomOut" title="缩小">🔍−</button>
              <button class="markmap-action-btn" data-action="fit" title="适应大小">⊡</button>
              <button class="markmap-action-btn" data-action="download" title="下载图片">💾</button>
              <button class="markmap-action-btn" data-action="fullscreen" title="全屏查看">⛶</button>
            `

        // 创建思维导图容器
        const chartContainer = document.createElement('div')
        chartContainer.className = 'markmap-container'
        chartContainer.dataset.view = 'chart'
        chartContainer.style.width = '100%'
        chartContainer.dataset.markmapIndex = String(index)

        // 创建 SVG 元素
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svgEl.setAttribute('width', '100%')
        svgEl.setAttribute('height', '400')
        svgEl.style.width = '100%'
        svgEl.style.minHeight = '300px'
        chartContainer.appendChild(svgEl)

        // 创建代码视图容器
        const codeView = document.createElement('div')
        codeView.className = 'markmap-code-view'
        codeView.dataset.view = 'code'
        codeView.style.display = 'none'

        // 创建返回图表按钮
        const backToChartBtn = document.createElement('button')
        backToChartBtn.className = 'markmap-back-btn no-export'
        backToChartBtn.textContent = '图表'
        backToChartBtn.title = '返回图表视图'
        codeView.appendChild(backToChartBtn)

        // 创建复制按钮
        const copyButton = document.createElement('button')
        copyButton.className = 'copy-btn no-export'
        copyButton.textContent = '复制'
        copyButton.title = '复制 Markmap 代码'
        codeView.appendChild(copyButton)

        // 代码高亮显示
        const codeElement = document.createElement('code')
        codeElement.className = 'language-markdown'
        if (Prism.languages['markdown']) {
          codeElement.innerHTML = Prism.highlight(code, Prism.languages['markdown'], 'markdown')
        } else {
          codeElement.textContent = code
        }

        const preElement = document.createElement('pre')
        preElement.className = 'language-markdown'
        preElement.appendChild(codeElement)
        codeView.appendChild(preElement)

        // 组装结构
        wrapper.appendChild(toggleBar)
        wrapper.appendChild(chartContainer)
        wrapper.appendChild(codeView)

        block.replaceWith(wrapper)

        // 初始化 Markmap
        const transformer = new Transformer()
        const { root, features } = transformer.transform(code)
        const opts = deriveOptions(features)
        const mm = Markmap.create(svgEl, opts, root)

        // 存储实例到 DOM 元素，供工具栏操作使用
        ;(chartContainer as any).__markmapInstance = mm

        // 渲染后自适应
        requestAnimationFrame(() => {
          mm.fit()
        })

        instances.push(mm)
      } catch (error) {
        console.error('[Markmap] 渲染失败:', error)
        const errorDiv = document.createElement('div')
        errorDiv.className = 'markmap-error'
        errorDiv.innerHTML = `
            <div class="error-title">Markmap 渲染失败</div>
            <div class="error-message">${(error as Error).message}</div>
          `
        if (block.parentNode) {
          block.replaceWith(errorDiv)
        }
      }
    })

    return () => {
      instances.forEach((mm) => {
        try {
          mm.destroy()
        } catch (e) {
          console.warn('[Markmap] destroy error:', e)
        }
      })
    }
  }, [html])

  // v1.5.4: Markmap 切换按钮 + 工具栏点击事件处理
  useEffect(() => {
    if (!ref.current) return

    const handleMarkmapClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // 处理代码视图的「返回图表」按钮
      const backBtn = target.closest('.markmap-back-btn')
      if (backBtn) {
        const wrapper = backBtn.closest('.markmap-wrapper') as HTMLElement
        if (!wrapper) return
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector('.markmap-toggle-bar') as HTMLElement
        if (chartView) chartView.style.display = ''
        if (codeViewEl) codeViewEl.style.display = 'none'
        if (toggleBar) toggleBar.style.display = ''
        return
      }

      // 处理工具栏操作按钮
      const actionBtn = target.closest('.markmap-action-btn')
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action')
        const wrapper = actionBtn.closest('.markmap-wrapper') as HTMLElement
        const container = wrapper?.querySelector('.markmap-container') as any
        if (!container || !action) return

        if (action === 'toggleCode') {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
          const toggleBar = wrapper.querySelector('.markmap-toggle-bar') as HTMLElement
          if (chartView) chartView.style.display = 'none'
          if (codeViewEl) codeViewEl.style.display = ''
          if (toggleBar) toggleBar.style.display = 'none'
          return
        }

        const mm = container.__markmapInstance
        if (!mm && action !== 'fullscreen' && action !== 'download') return

        try {
          switch (action) {
            case 'zoomIn':
              mm.svg.transition().call(mm.zoom.scaleBy, 1.3)
              break
            case 'zoomOut':
              mm.svg.transition().call(mm.zoom.scaleBy, 0.7)
              break
            case 'fit':
              mm.fit()
              break
            case 'download': {
              const svg = container.querySelector('svg') as SVGSVGElement
              if (svg) downloadSvgAsPng(svg, `markmap-${Date.now()}`)
              break
            }
            case 'fullscreen':
              if (document.fullscreenElement) {
                document.exitFullscreen?.()
              } else {
                wrapper?.requestFullscreen?.()
                // 全屏后重新 fit
                setTimeout(() => mm?.fit(), 300)
              }
              break
          }
        } catch (err) {
          console.error('[Markmap] 工具栏操作失败:', err)
        }
        return
      }
    }

    ref.current.addEventListener('click', handleMarkmapClick)

    // 全屏变化时重新 fit markmap
    const handleFullscreenChange = () => {
      const fsEl = document.fullscreenElement
      if (fsEl?.classList.contains('markmap-wrapper')) {
        const container = fsEl.querySelector('.markmap-container') as any
        const mm = container?.__markmapInstance
        if (mm) setTimeout(() => mm.fit(), 300)
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      ref.current?.removeEventListener('click', handleMarkmapClick)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [html])
}
