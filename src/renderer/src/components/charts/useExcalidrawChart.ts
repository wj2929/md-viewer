/**
 * Excalidraw 静态预览渲染 Hook
 *
 * 支持 Markdown 代码块和 .excalidraw 文件引用两种来源。
 */

import { useEffect } from 'react'
import { renderExcalidrawToSvg, type ExcalidrawRenderResult } from '../../utils/excalidrawRenderer'
import { downloadSvgAsPng } from '../../utils/chartUtils'

const MAX_EXCALIDRAW_BLOCKS = 20

let renderQueue = Promise.resolve()

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const next = renderQueue.then(task, task)
  renderQueue = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  element.className = className
  element.textContent = text
  return element
}

function encodeSource(code: string): string {
  return btoa(unescape(encodeURIComponent(code)))
}

function createToolbar(): HTMLDivElement {
  const toggleBar = document.createElement('div')
  toggleBar.className = 'excalidraw-toggle-bar no-export'
  toggleBar.innerHTML = `
    <button class="excalidraw-action-btn" data-action="toggleCode" title="查看代码" aria-label="查看 Excalidraw 源码">💻</button>
    <button class="excalidraw-action-btn" data-action="zoomIn" title="放大" aria-label="放大 Excalidraw 图表">🔍+</button>
    <button class="excalidraw-action-btn" data-action="zoomOut" title="缩小" aria-label="缩小 Excalidraw 图表">🔍−</button>
    <button class="excalidraw-action-btn" data-action="fit" title="适应大小" aria-label="适应 Excalidraw 图表大小">⊡</button>
    <button class="excalidraw-action-btn" data-action="download" title="下载图片" aria-label="下载 Excalidraw 图片">💾</button>
    <button class="excalidraw-action-btn" data-action="fullscreen" title="全屏查看" aria-label="全屏查看 Excalidraw 图表">⛶</button>
  `
  return toggleBar
}

function createCodeView(code: string): HTMLDivElement {
  const codeView = document.createElement('div')
  codeView.className = 'excalidraw-code-view'
  codeView.dataset.view = 'code'
  codeView.style.display = 'none'

  const backToChartBtn = document.createElement('button')
  backToChartBtn.className = 'excalidraw-back-btn no-export'
  backToChartBtn.textContent = '图表'
  backToChartBtn.title = '返回图表视图'
  codeView.appendChild(backToChartBtn)

  const copyButton = document.createElement('button')
  copyButton.className = 'copy-btn no-export'
  copyButton.textContent = '复制'
  copyButton.title = '复制 Excalidraw 代码'
  codeView.appendChild(copyButton)

  const codeElement = document.createElement('code')
  codeElement.className = 'language-json'
  codeElement.textContent = code

  const preElement = document.createElement('pre')
  preElement.className = 'language-json'
  preElement.appendChild(codeElement)
  codeView.appendChild(preElement)

  return codeView
}

function appendWarnings(container: HTMLElement, warnings: string[]): void {
  warnings.forEach((warning) => {
    const warningElement = document.createElement('div')
    warningElement.className = 'excalidraw-warning'
    warningElement.textContent = warning
    container.appendChild(warningElement)
  })
}

function createErrorContent(title: string, message: string, warnings: string[]): HTMLDivElement {
  const content = document.createElement('div')
  content.className = 'excalidraw-error'
  content.appendChild(createTextElement('div', 'error-title', title))
  content.appendChild(createTextElement('div', 'error-message', message))
  appendWarnings(content, warnings)
  return content
}

function createWrapper(result: ExcalidrawRenderResult, fallbackCode: string): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'excalidraw-wrapper'
  wrapper.dataset.excalidrawCode = encodeSource(result.rawCode || fallbackCode)
  wrapper.dataset.excalidrawSourceKind = result.sourceKind
  if (result.sourceLabel) {
    wrapper.dataset.excalidrawSourceLabel = result.sourceLabel
  }

  const chartContainer = document.createElement('div')
  chartContainer.className = 'excalidraw-container'
  chartContainer.dataset.view = 'chart'
  chartContainer.style.width = '100%'

  if (result.ok) {
    chartContainer.innerHTML = result.svg
    const svg = chartContainer.querySelector('svg')
    if (svg) {
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', result.sourceLabel ? `Excalidraw 图表：${result.sourceLabel}` : 'Excalidraw 图表')
      svg.style.height = 'auto'
    }
    appendWarnings(chartContainer, result.warnings)
  } else {
    chartContainer.appendChild(createErrorContent('Excalidraw 渲染失败', result.error, result.warnings))
  }

  wrapper.appendChild(createToolbar())
  wrapper.appendChild(chartContainer)
  wrapper.appendChild(createCodeView(result.rawCode || fallbackCode))

  return wrapper
}

async function renderCodeBlock(block: Element): Promise<HTMLDivElement> {
  const codeEl = block.querySelector('code') || block
  const code = codeEl.textContent || ''
  const result = await enqueueRender(() =>
    renderExcalidrawToSvg(code, {
      sourceKind: 'code-block',
      sourceLabel: '代码块',
      rawCode: code,
    })
  )
  return createWrapper(result, code)
}

async function renderFilePlaceholder(
  placeholder: HTMLElement,
  markdownFilePath: string
): Promise<HTMLDivElement> {
  const refPath = placeholder.dataset.excalidrawSrc || ''
  const alt = placeholder.dataset.excalidrawAlt || ''
  const file = await window.api.readExcalidrawFile({ markdownFilePath, refPath })
  const result = await enqueueRender(() =>
    renderExcalidrawToSvg(file.content, {
      sourceKind: 'file-reference',
      sourceLabel: alt || file.resolvedPath || refPath,
      rawCode: file.content,
    })
  )
  return createWrapper(result, file.content)
}

function createFileErrorWrapper(error: unknown, placeholder: HTMLElement): HTMLDivElement {
  const refPath = placeholder.dataset.excalidrawSrc || ''
  const alt = placeholder.dataset.excalidrawAlt || ''
  const message = error instanceof Error ? error.message : '读取 Excalidraw 文件失败'

  const wrapper = document.createElement('div')
  wrapper.className = 'excalidraw-wrapper'
  wrapper.dataset.excalidrawCode = encodeSource('')
  wrapper.dataset.excalidrawSourceKind = 'file-reference'
  if (alt || refPath) {
    wrapper.dataset.excalidrawSourceLabel = alt || refPath
  }

  const chartContainer = document.createElement('div')
  chartContainer.className = 'excalidraw-container'
  chartContainer.dataset.view = 'chart'
  chartContainer.appendChild(createErrorContent('Excalidraw 文件读取失败', message, []))

  wrapper.appendChild(createToolbar())
  wrapper.appendChild(chartContainer)
  wrapper.appendChild(createCodeView(''))
  return wrapper
}

export function useExcalidrawChart(
  ref: React.RefObject<HTMLElement>,
  html: string,
  options: { markdownFilePath?: string } = {}
): void {
  useEffect(() => {
    if (!ref.current) return

    const candidates = Array.from(
      ref.current.querySelectorAll('pre.language-excalidraw, .excalidraw-file-placeholder')
    ).slice(0, MAX_EXCALIDRAW_BLOCKS)

    if (candidates.length === 0) return

    const abortController = new AbortController()
    const { signal } = abortController

    ;(async () => {
      for (const candidate of candidates) {
        if (signal.aborted) break

        try {
          let wrapper: HTMLDivElement | null = null

          if (candidate.matches('pre.language-excalidraw')) {
            wrapper = await renderCodeBlock(candidate)
          } else if (candidate.matches('.excalidraw-file-placeholder')) {
            if (!options.markdownFilePath) {
              throw new Error('缺少 Markdown 文件路径，无法读取 Excalidraw 文件引用')
            }
            if (typeof window.api?.readExcalidrawFile !== 'function') {
              throw new Error('当前环境不支持读取 Excalidraw 文件')
            }
            wrapper = await renderFilePlaceholder(candidate as HTMLElement, options.markdownFilePath)
          }

          if (!signal.aborted && wrapper && candidate.parentNode) {
            candidate.replaceWith(wrapper)
          }
        } catch (error) {
          if (signal.aborted) break
          console.error('[Excalidraw] 渲染失败:', error)
          if (candidate.matches('.excalidraw-file-placeholder')) {
            candidate.replaceWith(createFileErrorWrapper(error, candidate as HTMLElement))
          } else {
            const code = candidate.textContent || ''
            const result: ExcalidrawRenderResult = {
              ok: false,
              error: error instanceof Error ? error.message : 'Excalidraw 渲染失败',
              warnings: [],
              sourceKind: 'code-block',
              sourceLabel: '代码块',
              rawCode: code,
            }
            candidate.replaceWith(createWrapper(result, code))
          }
        }
      }
    })()

    return () => {
      abortController.abort()
    }
  }, [html, options.markdownFilePath])

  useEffect(() => {
    if (!ref.current) return

    const handleExcalidrawClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      const backBtn = target.closest('.excalidraw-back-btn')
      if (backBtn) {
        const wrapper = backBtn.closest('.excalidraw-wrapper') as HTMLElement
        const chartView = wrapper?.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper?.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper?.querySelector('.excalidraw-toggle-bar') as HTMLElement
        if (chartView) chartView.style.display = ''
        if (codeViewEl) codeViewEl.style.display = 'none'
        if (toggleBar) toggleBar.style.display = ''
        return
      }

      const actionBtn = target.closest('.excalidraw-action-btn')
      if (!actionBtn) return

      const action = actionBtn.getAttribute('data-action')
      const wrapper = actionBtn.closest('.excalidraw-wrapper') as HTMLElement
      const container = wrapper?.querySelector('.excalidraw-container') as HTMLElement
      if (!wrapper || !container || !action) return

      if (action === 'toggleCode') {
        const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
        const codeViewEl = wrapper.querySelector('[data-view="code"]') as HTMLElement
        const toggleBar = wrapper.querySelector('.excalidraw-toggle-bar') as HTMLElement
        if (chartView) chartView.style.display = 'none'
        if (codeViewEl) codeViewEl.style.display = ''
        if (toggleBar) toggleBar.style.display = 'none'
        return
      }

      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg && action !== 'fullscreen') return

      const applyZoom = (percent: number): void => {
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

      try {
        switch (action) {
          case 'zoomIn': {
            const level = parseInt(container.dataset.zoomLevel || '100', 10)
            const newLevel = Math.min(level + 20, 300)
            container.dataset.zoomLevel = String(newLevel)
            applyZoom(newLevel)
            break
          }
          case 'zoomOut': {
            const level = parseInt(container.dataset.zoomLevel || '100', 10)
            const newLevel = Math.max(level - 20, 30)
            container.dataset.zoomLevel = String(newLevel)
            applyZoom(newLevel)
            break
          }
          case 'fit':
            container.dataset.zoomLevel = '100'
            applyZoom(100)
            break
          case 'download':
            if (svg) downloadSvgAsPng(svg, `excalidraw-${Date.now()}`)
            break
          case 'fullscreen':
            if (document.fullscreenElement) {
              document.exitFullscreen?.()
            } else {
              wrapper.requestFullscreen?.()
            }
            break
        }
      } catch (err) {
        console.error('[Excalidraw] 工具栏操作失败:', err)
      }
    }

    ref.current.addEventListener('click', handleExcalidrawClick)
    return () => ref.current?.removeEventListener('click', handleExcalidrawClick)
  }, [html])
}
