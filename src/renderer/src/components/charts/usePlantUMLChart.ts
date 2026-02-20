/**
 * PlantUML 图表渲染 Hook
 *
 * 从 VirtualizedMarkdown.tsx 提取的 PlantUML 渲染逻辑
 * 包含:
 * 1. PlantUML 图表渲染（异步 fetch 远程服务器）
 * 2. PlantUML 切换按钮 + 工具栏点击事件处理
 *
 * @version v1.6.0
 */

import { useEffect } from 'react'
import { validatePlantUMLCode, renderPlantUMLToSvg } from '../../utils/plantumlRenderer'

export function usePlantUMLChart(ref: React.RefObject<HTMLElement>, html: string): void {
  // v1.6.0: PlantUML 图表渲染（异步 fetch 远程服务器）
  useEffect(() => {
    if (!ref.current) return

    const plantumlBlocks = ref.current.querySelectorAll('pre.language-plantuml')
    if (plantumlBlocks.length === 0) return

    const abortController = new AbortController()
    const { signal } = abortController

    ;(async () => {
      for (let index = 0; index < plantumlBlocks.length; index++) {
        if (signal.aborted) break

        const block = plantumlBlocks[index]
        const codeEl = block.querySelector('code') || block
        const code = codeEl.textContent || ''

        const validation = validatePlantUMLCode(code)
        if (!validation.valid) {
          const errorDiv = document.createElement('div')
          errorDiv.className = 'plantuml-error'
          errorDiv.innerHTML = `
            <div class="error-title">PlantUML 配置错误</div>
            <div class="error-message">${validation.error}</div>
          `
          if (block.parentNode) block.replaceWith(errorDiv)
          continue
        }

        try {
          const svgString = await renderPlantUMLToSvg(code)

          if (signal.aborted) break

          // 创建包装容器
          const wrapper = document.createElement('div')
          wrapper.className = 'plantuml-wrapper'

          // 存储原始代码
          wrapper.dataset.plantumlCode = btoa(unescape(encodeURIComponent(code)))

          // 创建切换按钮栏
          const toggleBar = document.createElement('div')
          toggleBar.className = 'plantuml-toggle-bar no-export'
          toggleBar.innerHTML = `
            <button class="plantuml-action-btn" data-action="toggleCode" title="查看代码">💻</button>
            <button class="plantuml-action-btn" data-action="zoomIn" title="放大">🔍+</button>
            <button class="plantuml-action-btn" data-action="zoomOut" title="缩小">🔍−</button>
            <button class="plantuml-action-btn" data-action="fit" title="适应大小">⊡</button>
            <button class="plantuml-action-btn" data-action="download" title="下载图片">💾</button>
            <button class="plantuml-action-btn" data-action="fullscreen" title="全屏查看">⛶</button>
          `

          // 创建图表容器
          const chartContainer = document.createElement('div')
          chartContainer.className = 'plantuml-container'
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
          codeView.className = 'plantuml-code-view'
          codeView.dataset.view = 'code'
          codeView.style.display = 'none'

          // 创建返回图表按钮
          const backToChartBtn = document.createElement('button')
          backToChartBtn.className = 'plantuml-back-btn no-export'
          backToChartBtn.textContent = '图表'
          backToChartBtn.title = '返回图表视图'
          codeView.appendChild(backToChartBtn)

          // 创建复制按钮
          const copyButton = document.createElement('button')
          copyButton.className = 'copy-btn no-export'
          copyButton.textContent = '复制'
          copyButton.title = '复制 PlantUML 代码'
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
          console.error('[PlantUML] 渲染失败:', error)
          // 错误降级：显示错误提示 + 原始代码
          const errorWrapper = document.createElement('div')
          errorWrapper.className = 'plantuml-wrapper'
          errorWrapper.innerHTML = `
            <div class="plantuml-error">
              <div class="error-title">PlantUML 渲染失败</div>
              <div class="error-message">${(error as Error).message}</div>
            </div>
            <pre class="language-plaintext"><code class="language-plaintext">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
          `
          if (block.parentNode) {
            block.replaceWith(errorWrapper)
          }
        }
      }
    })()

    return () => {
      abortController.abort()
    }
  }, [html])

  // v1.6.0: PlantUML 切换按钮 + 工具栏点击事件处理
  useEffect(() => {
    if (!ref.current) return

    const handlePlantUMLClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // 处理代码视图的「返回图表」按钮
      const backBtn = target.closest('.plantuml-back-btn')
      if (backBtn) {
        const wrapper = backBtn.closest('.plantuml-wrapper') as HTMLElement
        if (!wrapper) return
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector('.plantuml-toggle-bar') as HTMLElement
        if (chartView) chartView.style.display = ''
        if (codeViewEl) codeViewEl.style.display = 'none'
        if (toggleBar) toggleBar.style.display = ''
        return
      }

      // 处理工具栏操作按钮
      const actionBtn = target.closest('.plantuml-action-btn')
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action')
        const wrapper = actionBtn.closest('.plantuml-wrapper') as HTMLElement
        const container = wrapper?.querySelector('.plantuml-container') as HTMLElement
        if (!container || !action) return

        if (action === 'toggleCode') {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
          const toggleBar = wrapper.querySelector('.plantuml-toggle-bar') as HTMLElement
          if (chartView) chartView.style.display = 'none'
          if (codeViewEl) codeViewEl.style.display = ''
          if (toggleBar) toggleBar.style.display = 'none'
          return
        }

        const svg = container.querySelector('svg') as SVGSVGElement
        if (!svg && action !== 'fullscreen') return

        try {
          const applyPlantUMLZoom = (percent: number): void => {
            if (!svg) return
            const scale = percent / 100
            svg.style.transform = `scale(${scale})`
            svg.style.transformOrigin = 'center top'
            if (percent > 100) {
              container.classList.add('zoomed')
              wrapper.classList.add('zoomed-wrapper')
            } else {
              container.classList.remove('zoomed')
              wrapper.classList.remove('zoomed-wrapper')
            }
          }

          switch (action) {
            case 'zoomIn': {
              const level = parseInt(container.dataset.zoomLevel || '100', 10)
              const newLevel = Math.min(level + 20, 300)
              container.dataset.zoomLevel = String(newLevel)
              applyPlantUMLZoom(newLevel)
              break
            }
            case 'zoomOut': {
              const level = parseInt(container.dataset.zoomLevel || '100', 10)
              const newLevel = Math.max(level - 20, 30)
              container.dataset.zoomLevel = String(newLevel)
              applyPlantUMLZoom(newLevel)
              break
            }
            case 'fit':
              container.dataset.zoomLevel = '100'
              applyPlantUMLZoom(100)
              break
            case 'download': {
              const svgClone = svg.cloneNode(true) as SVGSVGElement
              const svgData = new XMLSerializer().serializeToString(svgClone)
              const canvas = document.createElement('canvas')
              const scale = 2
              canvas.width = svg.clientWidth * scale
              canvas.height = svg.clientHeight * scale
              const ctx = canvas.getContext('2d')!
              const img = new Image()
              img.onload = (): void => {
                ctx.fillStyle = '#ffffff'
                ctx.fillRect(0, 0, canvas.width, canvas.height)
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                const a = document.createElement('a')
                a.download = `plantuml-${Date.now()}.png`
                a.href = canvas.toDataURL('image/png')
                a.click()
              }
              img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData)
              break
            }
            case 'fullscreen':
              if (document.fullscreenElement) {
                document.exitFullscreen?.()
              } else {
                wrapper?.requestFullscreen?.()
              }
              break
          }
        } catch (err) {
          console.error('[PlantUML] 工具栏操作失败:', err)
        }
        return
      }
    }

    ref.current.addEventListener('click', handlePlantUMLClick)
    return () => ref.current?.removeEventListener('click', handlePlantUMLClick)
  }, [html])
}
