/**
 * Infographic 图表渲染 Hook
 *
 * 从 VirtualizedMarkdown.tsx 提取的 Infographic 渲染逻辑：
 * - 渲染 useEffect（1077-1243 行）
 * - 点击处理 useEffect（1245-1312 行）
 *
 * @version v1.6.0
 */

import { useEffect } from 'react'
import { Infographic, validateInfographicConfig } from '../../utils/infographicRenderer'
import Prism from 'prismjs'
import { createSvgChartActionHandler } from '../../utils/chartUtils'

/**
 * Infographic 图表渲染 Hook
 *
 * @param ref - 包含 Markdown 内容的 DOM 元素引用
 * @param html - Markdown 渲染后的 HTML 字符串（用于触发重新渲染）
 */
export function useInfographicChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true
): void {
  // v1.6.0: Infographic 信息图渲染
  useEffect(() => {
    if (!enabled || !ref.current) return

    const infographicBlocks = ref.current.querySelectorAll('pre.language-infographic')
    if (infographicBlocks.length === 0) return

    const abortController = new AbortController()
    const instances: Infographic[] = []
    const cleanups: (() => void)[] = []

    ;(async () => {
      const blocks = Array.from(infographicBlocks)
      for (let index = 0; index < blocks.length; index++) {
        if (abortController.signal.aborted) break

        const block = blocks[index]
        const config = block.textContent || ''

        const validation = validateInfographicConfig(config)
        if (!validation.valid) {
          const errorDiv = document.createElement('div')
          errorDiv.className = 'infographic-error'
          errorDiv.innerHTML = `
            <div class="error-title">Infographic 配置错误</div>
            <div class="error-message">${validation.error}</div>
          `
          block.replaceWith(errorDiv)
          continue
        }

        try {
        // 创建包装容器
          const wrapper = document.createElement('div')
          wrapper.className = 'infographic-wrapper'

        // 存储原始配置（Base64 编码避免 HTML 转义问题）
          wrapper.dataset.infographicConfig = btoa(unescape(encodeURIComponent(config)))

        // 创建切换按钮栏
        const toggleBar = document.createElement('div')
        toggleBar.className = 'infographic-toggle-bar no-export'
        toggleBar.innerHTML = `
              <button class="infographic-action-btn" data-action="toggleCode" title="查看代码">💻</button>
              <button class="infographic-action-btn" data-action="zoomOut" title="缩小">🔍−</button>
              <button class="infographic-action-btn" data-action="zoomIn" title="放大">🔍+</button>
              <button class="infographic-action-btn" data-action="fit" title="适应大小">⊡</button>
              <button class="infographic-action-btn" data-action="download" title="下载图片">💾</button>
              <button class="infographic-action-btn" data-action="fullscreen" title="全屏查看">⛶</button>
            `

        // 创建信息图容器
        const chartContainer = document.createElement('div')
        chartContainer.className = 'infographic-container'
        chartContainer.dataset.view = 'chart'
        chartContainer.style.width = '100%'
        chartContainer.dataset.infographicIndex = String(index)

        // 创建代码视图容器
        const codeView = document.createElement('div')
        codeView.className = 'infographic-code-view'
        codeView.dataset.view = 'code'
        codeView.style.display = 'none'

        // 创建返回图表按钮
        const backToChartBtn = document.createElement('button')
        backToChartBtn.className = 'infographic-back-btn no-export'
        backToChartBtn.textContent = '图表'
        backToChartBtn.title = '返回图表视图'
        codeView.appendChild(backToChartBtn)

        // 创建复制按钮
        const copyButton = document.createElement('button')
        copyButton.className = 'copy-btn no-export'
        copyButton.textContent = '复制'
        copyButton.title = '复制 Infographic 代码'
        codeView.appendChild(copyButton)

        // 使用 Prism 高亮代码
        const codeElement = document.createElement('code')
        codeElement.className = 'language-yaml'

        if (Prism.languages['yaml']) {
          codeElement.innerHTML = Prism.highlight(config, Prism.languages['yaml'], 'yaml')
        } else {
          codeElement.textContent = config
        }

        const preElement = document.createElement('pre')
        preElement.className = 'language-yaml'
        preElement.appendChild(codeElement)
        codeView.appendChild(preElement)

        // 组装结构
        wrapper.appendChild(toggleBar)
        wrapper.appendChild(chartContainer)
        wrapper.appendChild(codeView)

        block.replaceWith(wrapper)

        // 初始化 Infographic
        let infographic: Infographic

        // 尝试解析为 JSON
        let isJson = false
        try {
          JSON.parse(config)
          isJson = true
        } catch {
          // 不是 JSON，使用 infographic 语法
        }

        if (isJson) {
          const parsed = JSON.parse(config)
          infographic = new Infographic({
            container: chartContainer,
            width: '100%',
            editable: false,
            ...parsed,
          })
          infographic.render()
        } else {
          infographic = new Infographic({
            container: chartContainer,
            width: '100%',
            editable: false,
          })
          infographic.render(config)
        }

        // 渲染后调整 SVG 尺寸：自适应容器宽度，按 viewBox 比例计算高度
        const fitSvg = () => {
          const svg = chartContainer.querySelector('svg')
          if (!svg) return
          const vb = svg.getAttribute('viewBox')
          if (!vb) return
          const parts = vb.split(/[\s,]+/).map(Number)
          if (parts.length !== 4 || parts[2] <= 0 || parts[3] <= 0) return
          const vbW = parts[2]
          const vbH = parts[3]
          const containerW = chartContainer.clientWidth - 32
          // 如果 viewBox 比容器窄，用原始尺寸居中；否则缩放到容器宽度
          let w = Math.min(vbW, containerW)
          let h = w * (vbH / vbW)

          // 全屏模式下：如果 SVG 高度超出容器，按高度缩放以确保完整显示
          const isFullscreen = !!document.fullscreenElement?.closest('.infographic-wrapper')
          if (isFullscreen) {
            const maxH = chartContainer.clientHeight - 32
            if (maxH > 0 && h > maxH) {
              h = maxH
              w = h * (vbW / vbH)
            }
          }

          svg.setAttribute('width', String(w))
          svg.setAttribute('height', String(h))
        }

        infographic.on('rendered', () => requestAnimationFrame(fitSvg))
        infographic.on('loaded', () => requestAnimationFrame(fitSvg))
        requestAnimationFrame(fitSvg)

        // 全屏切换时重新计算 SVG 尺寸（进入/退出全屏后容器尺寸变化）
        const onFullscreenChange = () => requestAnimationFrame(fitSvg)
        wrapper.addEventListener('fullscreenchange', onFullscreenChange)

          instances.push(infographic)
          cleanups.push(() => wrapper.removeEventListener('fullscreenchange', onFullscreenChange))
        } catch (error) {
          console.error('[Infographic] 渲染失败:', error)
          const errorDiv = document.createElement('div')
          errorDiv.className = 'infographic-error'
          errorDiv.innerHTML = `
            <div class="error-title">Infographic 渲染失败</div>
            <div class="error-message">${(error as Error).message}</div>
          `
          if (block.parentNode) {
            block.replaceWith(errorDiv)
          }
        }

        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
    })()

    return () => {
      abortController.abort()
      cleanups.forEach((fn) => fn())
      instances.forEach((inst) => {
        try {
          inst.destroy()
        } catch (e) {
          console.warn('[Infographic] destroy error:', e)
        }
      })
    }
  }, [html, enabled])

  // v1.6.0: Infographic 切换按钮 + 工具栏点击事件处理
  useEffect(() => {
    if (!ref.current) return

    const handleInfographicClick = createSvgChartActionHandler('infographic')

    ref.current.addEventListener('click', handleInfographicClick)
    return () => ref.current?.removeEventListener('click', handleInfographicClick)
  }, [html])
}
