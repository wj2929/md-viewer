/**
 * Mermaid 图表渲染 Hook
 *
 * 从 VirtualizedMarkdown.tsx 提取的 Mermaid 渲染和交互逻辑：
 * - 模块级 Mermaid 初始化和串行渲染队列
 * - 图表渲染 useEffect（串行化 + 可取消）
 * - 工具栏点击事件处理 useEffect（切换代码、缩放、下载、全屏）
 *
 * @version v1.5.5
 */

import { useEffect } from 'react'
import mermaid from 'mermaid'
import { downloadSvgAsPng } from '../../utils/chartUtils'

// ==================== 模块级状态 ====================

let mermaidInitialized = false

// 串行渲染锁：确保同一时刻只有一个 mermaid.render() 在执行
let mermaidRenderQueue: Promise<void> = Promise.resolve()

function initializeMermaid(force = false): void {
  if (mermaidInitialized && !force) return

  try {
    const isDark = typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
      suppressErrorRendering: true,

      sankey: {
        width: 600,
        height: 400,
        linkColor: 'gradient',
        nodeAlignment: 'justify',
        useMaxWidth: true
      },

      flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
      sequence: { useMaxWidth: true, wrap: true, width: 150 },
      gantt: { useMaxWidth: true, barHeight: 20, fontSize: 11 },
      pie: { useMaxWidth: true }
    })

    mermaidInitialized = true
  } catch {
    // Mermaid 初始化失败，静默处理
  }
}

/**
 * 串行化 mermaid.render() 调用，避免并发污染内部状态
 * 支持通过 AbortSignal 取消排队中的渲染任务
 */
function queueMermaidRender(
  id: string,
  code: string,
  signal?: AbortSignal
): Promise<{ svg: string } | null> {
  const task = mermaidRenderQueue.then(async () => {
    if (signal?.aborted) return null
    try {
      const result = await mermaid.render(id, code)
      return result
    } catch {
      // 渲染失败时重置 Mermaid 状态，防止后续渲染也失败
      mermaidInitialized = false
      initializeMermaid(true)
      return null
    }
  })
  // 无论成功失败，都推进队列（不让错误阻塞后续任务）
  mermaidRenderQueue = task.then(() => {}, () => {})
  return task
}

/**
 * 清理 Mermaid 渲染残留的临时 DOM 元素
 * mermaid.render() 会在 body 中创建临时容器，失败时可能不会自动清理
 */
function cleanupMermaidTempElements(): void {
  const tempElements = document.querySelectorAll('div[id^="dmermaid-"], div[id^="mermaid-"] svg[id^="mermaid-"]')
  tempElements.forEach(el => {
    // 只清理 body 直接子元素中的临时容器
    if (el.parentElement === document.body) {
      el.remove()
    }
  })
}

// 立即执行初始化
if (typeof window !== 'undefined') {
  initializeMermaid()
}

// ==================== Hook ====================

/**
 * Mermaid 图表渲染和交互 Hook
 *
 * @param ref - 包含 Markdown 内容的 DOM 元素引用
 * @param html - Markdown 渲染后的 HTML 字符串（作为依赖项）
 */
export function useMermaidChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string
): void {
  // Mermaid 图表渲染（串行化 + 可取消）
  useEffect(() => {
    if (!ref.current) return

    // 强制重新初始化 Mermaid，确保预览配置正确
    // （mermaidRenderer.ts 的导出功能会将全局配置覆盖为 strict/htmlLabels:false）
    initializeMermaid(true)

    const mermaidBlocks = ref.current.querySelectorAll('pre.language-mermaid')
    if (mermaidBlocks.length === 0) return

    // 用 AbortController 实现取消机制
    const abortController = new AbortController()
    const { signal } = abortController

    // 串行渲染所有 mermaid 图表（不再用 forEach + async 并发）
    ;(async () => {
      for (let index = 0; index < mermaidBlocks.length; index++) {
        if (signal.aborted) break

        const block = mermaidBlocks[index]

        // 优先从 data-mermaid-code 属性读取原始代码（保留换行符）
        const base64Code = block.getAttribute('data-mermaid-code')
        let code: string

        if (base64Code) {
          try {
            code = decodeURIComponent(escape(atob(base64Code)))
          } catch {
            code = block.textContent || ''
          }
        } else {
          code = block.textContent || ''
        }

        const id = `mermaid-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`

        // 通过队列串行渲染，避免并发污染 Mermaid 内部状态
        const result = await queueMermaidRender(id, code, signal)

        // 渲染完成后检查是否已取消（组件可能已卸载或 html 已变化）
        if (signal.aborted) break

        if (result) {
          // 创建包装容器
          const wrapper = document.createElement('div')
          wrapper.className = 'mermaid-wrapper'
          wrapper.dataset.mermaidCode = btoa(unescape(encodeURIComponent(code)))
          wrapper.dataset.mermaidIndex = String(index)

          // 创建切换按钮栏
          const toggleBar = document.createElement('div')
          toggleBar.className = 'mermaid-toggle-bar no-export'
          toggleBar.innerHTML = `
            <button class="mermaid-action-btn" data-action="toggleCode" title="查看代码">💻</button>
            <button class="mermaid-action-btn" data-action="zoomIn" title="放大">🔍+</button>
            <button class="mermaid-action-btn" data-action="zoomOut" title="缩小">🔍−</button>
            <button class="mermaid-action-btn" data-action="fit" title="适应大小">⊡</button>
            <button class="mermaid-action-btn" data-action="download" title="下载图片">💾</button>
            <button class="mermaid-action-btn" data-action="fullscreen" title="全屏查看">⛶</button>
          `

          // 创建图表容器
          const chartContainer = document.createElement('div')
          chartContainer.className = 'mermaid-container'
          chartContainer.dataset.view = 'chart'
          chartContainer.innerHTML = result.svg

          // 创建代码视图容器
          const codeView = document.createElement('div')
          codeView.className = 'mermaid-code-view'
          codeView.dataset.view = 'code'
          codeView.style.display = 'none'

          // 创建返回图表按钮
          const backToChartBtn = document.createElement('button')
          backToChartBtn.className = 'mermaid-back-btn no-export'
          backToChartBtn.textContent = '图表'
          backToChartBtn.title = '返回图表视图'
          codeView.appendChild(backToChartBtn)

          // 创建复制按钮
          const copyButton = document.createElement('button')
          copyButton.className = 'copy-btn no-export'
          copyButton.textContent = '复制'
          copyButton.title = '复制 Mermaid 代码'
          codeView.appendChild(copyButton)

          // 代码高亮显示
          const codeElement = document.createElement('code')
          codeElement.className = 'language-mermaid'
          codeElement.textContent = code

          const preElement = document.createElement('pre')
          preElement.className = 'language-mermaid'
          preElement.appendChild(codeElement)
          codeView.appendChild(preElement)

          // 组装结构
          wrapper.appendChild(toggleBar)
          wrapper.appendChild(chartContainer)
          wrapper.appendChild(codeView)

          // 确保 block 仍在 DOM 中再替换
          if (block.parentNode) {
            block.replaceWith(wrapper)
          }
        } else {
          // 渲染失败时显示原始代码
          const wrapper = document.createElement('div')
          wrapper.className = 'mermaid-error mermaid-error-fallback'
          wrapper.innerHTML = `
            <div class="error-title">Mermaid 渲染失败</div>
            <pre class="language-mermaid"><code class="language-mermaid"></code></pre>
          `
          const codeElement = wrapper.querySelector('code')
          if (codeElement) codeElement.textContent = code
          if (block.parentNode) {
            block.replaceWith(wrapper)
          }
        }
      }
    })()

    // cleanup：取消未完成的渲染 + 清理临时 DOM
    return () => {
      abortController.abort()
      cleanupMermaidTempElements()
    }
  }, [html])

  // v1.5.5: Mermaid 切换按钮 + 工具栏点击事件处理
  useEffect(() => {
    if (!ref.current) return

    const handleMermaidClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // 处理代码视图的「返回图表」按钮
      const backBtn = target.closest('.mermaid-back-btn')
      if (backBtn) {
        const wrapper = backBtn.closest('.mermaid-wrapper') as HTMLElement
        if (!wrapper) return
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector('.mermaid-toggle-bar') as HTMLElement
        if (chartView) chartView.style.display = ''
        if (codeViewEl) codeViewEl.style.display = 'none'
        if (toggleBar) toggleBar.style.display = ''
        return
      }

      // 处理工具栏操作按钮
      const actionBtn = target.closest('.mermaid-action-btn')
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action')
        const wrapper = actionBtn.closest('.mermaid-wrapper') as HTMLElement
        const container = wrapper?.querySelector('.mermaid-container') as HTMLElement
        if (!container || !action) return

        const svg = container.querySelector('svg') as SVGSVGElement
        if (!svg && action !== 'fullscreen' && action !== 'toggleCode') return

        try {
          const applyMermaidZoom = (percent: number) => {
            const wrapper = container.closest('.mermaid-wrapper') as HTMLElement
            if (!wrapper) return

            // 获取 SVG 内在尺寸（viewBox 宽度），而非渲染宽度
            // SVG width="100%" 时 getBoundingClientRect 返回容器宽度，不能用
            let baseWidth = parseFloat(container.dataset.baseWidth || '')
            if (!(baseWidth > 0)) {
              const vb = svg.viewBox?.baseVal
              if (vb && vb.width > 0) {
                baseWidth = vb.width
              } else {
                // fallback: 尝试从 width 属性解析像素值
                const attrW = svg.getAttribute('width')
                if (attrW && !attrW.includes('%')) {
                  baseWidth = parseFloat(attrW)
                }
              }
              if (!(baseWidth > 0)) return
              container.dataset.baseWidth = String(baseWidth)
              container.dataset.origSvgWidth = svg.getAttribute('width') || ''
            }

            // 清除旧方案残留
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
            case 'toggleCode': {
              const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
              const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
              const toggleBar = wrapper.querySelector('.mermaid-toggle-bar') as HTMLElement
              const isShowingCode = codeViewEl?.style.display !== 'none'
              if (isShowingCode) {
                // 切回图表
                if (chartView) chartView.style.display = ''
                if (codeViewEl) codeViewEl.style.display = 'none'
                if (toggleBar) toggleBar.style.display = ''
              } else {
                // 切到代码：隐藏整个 toggle-bar，代码视图有自己的复制按钮
                if (chartView) chartView.style.display = 'none'
                if (codeViewEl) codeViewEl.style.display = ''
                if (toggleBar) toggleBar.style.display = 'none'
              }
              break
            }
            case 'zoomIn': {
              const level = parseInt(container.dataset.zoomLevel || '100', 10)
              const newLevel = Math.min(level + 20, 300)
              container.dataset.zoomLevel = String(newLevel)
              applyMermaidZoom(newLevel)
              break
            }
            case 'zoomOut': {
              const level = parseInt(container.dataset.zoomLevel || '100', 10)
              const newLevel = Math.max(level - 20, 30)
              container.dataset.zoomLevel = String(newLevel)
              applyMermaidZoom(newLevel)
              break
            }
            case 'fit':
              container.dataset.zoomLevel = '100'
              applyMermaidZoom(100)
              break
            case 'download': {
              downloadSvgAsPng(svg, `mermaid-${Date.now()}`)
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
          console.error('[Mermaid] 工具栏操作失败:', err)
        }
        return
      }
    }

    ref.current.addEventListener('click', handleMermaidClick)
    return () => ref.current?.removeEventListener('click', handleMermaidClick)
  }, [html])
}
