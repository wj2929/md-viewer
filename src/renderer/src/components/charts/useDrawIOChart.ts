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
import { downloadSvgAsPng } from '../../utils/chartUtils'

let drawioLightboxObserver: MutationObserver | null = null
let drawioLightboxRetryTimer: number | null = null
let drawioLightboxPointerHandlerInstalled = false
let drawioLightboxKeyHandlerInstalled = false

type DrawioWindow = Window & {
  urlParams?: Record<string, string | undefined>
}

function withDrawioLightboxToolbarCloseDisabled(showLightbox: () => void): void {
  const urlParams = (window as DrawioWindow).urlParams
  if (!urlParams) {
    showLightbox()
    return
  }

  const previousToolbarConfig = urlParams['toolbar-config']
  let toolbarConfig: Record<string, unknown> = {}
  if (previousToolbarConfig) {
    try {
      toolbarConfig = JSON.parse(decodeURIComponent(previousToolbarConfig)) as Record<string, unknown>
    } catch {
      toolbarConfig = {}
    }
  }

  toolbarConfig.noCloseBtn = true
  urlParams['toolbar-config'] = encodeURIComponent(JSON.stringify(toolbarConfig))

  try {
    showLightbox()
  } finally {
    if (previousToolbarConfig === undefined) {
      delete urlParams['toolbar-config']
    } else {
      urlParams['toolbar-config'] = previousToolbarConfig
    }
  }
}

function findDrawioLightboxOverlay(): HTMLElement | null {
  return Array.from(document.body.children).find((element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false
    const style = element.getAttribute('style') || ''
    return (
      style.includes('position: fixed') &&
      style.includes('z-index: 999') &&
      style.includes('background-color: rgb(0, 0, 0)')
    )
  }) ?? null
}

function rememberDrawioLightboxBodyOverflow(): void {
  if (!('drawioLightboxPreviousOverflow' in document.body.dataset)) {
    document.body.dataset.drawioLightboxPreviousOverflow = document.body.style.overflow
  }
}

function restoreDrawioLightboxBodyOverflow(): void {
  const previousOverflow = document.body.dataset.drawioLightboxPreviousOverflow
  if (previousOverflow !== undefined) {
    document.body.style.overflow = previousOverflow
    delete document.body.dataset.drawioLightboxPreviousOverflow
  }
}

function removeDrawioLightboxCloseButton(): void {
  const lightboxOpen = Boolean(document.querySelector('.geDiagramContainer'))
  document.querySelectorAll('.drawio-lightbox-close').forEach((element) => element.remove())
  document.querySelectorAll<HTMLElement>('.drawio-lightbox-native-close-hidden').forEach((element) => {
    if (!lightboxOpen) {
      element.remove()
      return
    }
    element.classList.remove('drawio-lightbox-native-close-hidden')
    element.style.removeProperty('opacity')
    element.style.removeProperty('pointer-events')
    element.removeAttribute('aria-hidden')
  })
}

function isNativeDrawioLightboxCloseButton(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return (
    style.position === 'fixed' &&
    style.cursor === 'pointer' &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > window.innerWidth - 96 &&
    rect.top < 96
  )
}

function findNativeDrawioLightboxCloseButton(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('img.geAdaptiveAsset'))
    .find(isNativeDrawioLightboxCloseButton) ?? null
}

function isPointerInsideDrawioLightboxCloseButton(event: MouseEvent): boolean {
  const closeButton = document.querySelector<HTMLElement>('.drawio-lightbox-close')
  if (!closeButton) return false

  const rect = closeButton.getBoundingClientRect()
  return (
    Number.isFinite(event.clientX) &&
    Number.isFinite(event.clientY) &&
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

function removeDrawioLightboxToolbarCloseButtons(): void {
  Array.from(document.body.children).forEach((element) => {
    if (!(element instanceof HTMLElement)) return
    const style = element.getAttribute('style') || ''
    if (!style.includes('position: fixed') || !style.includes('bottom: 60px')) return

    element.querySelectorAll<HTMLElement>('[title]').forEach((toolbarItem) => {
      const title = toolbarItem.getAttribute('title') || ''
      if (/^(Close|关闭)/i.test(title)) {
        toolbarItem.remove()
      }
    })
  })
}

function cleanupDrawioLightboxFallback(): void {
  Array.from(document.body.children).forEach((element) => {
    if (!(element instanceof HTMLElement)) return
    const style = element.getAttribute('style') || ''
    const isDrawioLightboxNode =
      element.classList.contains('geDiagramContainer') ||
      element.classList.contains('drawio-lightbox-native-close-hidden') ||
      (
        style.includes('position: fixed') &&
        style.includes('z-index: 999') &&
        (
          style.includes('background-color: rgb(0, 0, 0)') ||
          style.includes('bottom: 60px') ||
          (element.tagName === 'IMG' && element.classList.contains('geAdaptiveAsset'))
        )
      )

    if (isDrawioLightboxNode) element.remove()
  })
  restoreDrawioLightboxBodyOverflow()
}

function teardownDrawioLightboxCloseHandling(): void {
  if (drawioLightboxRetryTimer !== null) {
    window.clearTimeout(drawioLightboxRetryTimer)
    drawioLightboxRetryTimer = null
  }
  drawioLightboxObserver?.disconnect()
  drawioLightboxObserver = null
  if (drawioLightboxPointerHandlerInstalled) {
    document.removeEventListener('pointerdown', handleDrawioLightboxPointer, true)
    document.removeEventListener('mousedown', handleDrawioLightboxPointer, true)
    document.removeEventListener('click', handleDrawioLightboxPointer, true)
    drawioLightboxPointerHandlerInstalled = false
  }
  if (drawioLightboxKeyHandlerInstalled) {
    document.removeEventListener('keydown', handleDrawioLightboxKeydown, true)
    drawioLightboxKeyHandlerInstalled = false
  }
}

function closeDrawioLightbox(): void {
  const overlay = findDrawioLightboxOverlay()
  if (overlay) {
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }))
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  }

  window.setTimeout(() => {
    const overlay = findDrawioLightboxOverlay()
    if (document.querySelector('.geDiagramContainer') && overlay) {
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
      overlay.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }))
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    }
    cleanupDrawioLightboxFallback()
    removeDrawioLightboxCloseButton()
    teardownDrawioLightboxCloseHandling()
  }, 0)
}

function handleDrawioLightboxPointer(event: MouseEvent): void {
  if (!document.querySelector('.geDiagramContainer')) {
    teardownDrawioLightboxCloseHandling()
    return
  }

  const target = event.target instanceof Element ? event.target : null
  const nativeCloseButton = target?.closest('img.geAdaptiveAsset')
  const proxyCloseButton = target?.closest('.drawio-lightbox-close')
  if (
    proxyCloseButton ||
    isPointerInsideDrawioLightboxCloseButton(event) ||
    (nativeCloseButton instanceof HTMLElement && isNativeDrawioLightboxCloseButton(nativeCloseButton))
  ) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    closeDrawioLightbox()
  }
}

function handleDrawioLightboxKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (!document.querySelector('.geDiagramContainer')) {
    teardownDrawioLightboxCloseHandling()
    return
  }

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  closeDrawioLightbox()
}

function bindDrawioLightboxCloseEvents(element: HTMLElement): void {
  const close = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    if ('stopImmediatePropagation' in event) event.stopImmediatePropagation()
    closeDrawioLightbox()
  }
  element.addEventListener('pointerdown', close)
  element.addEventListener('mousedown', close)
  element.addEventListener('click', close)
}

function createDrawioLightboxCloseButtonFromNative(nativeCloseButton: HTMLElement): void {
  const rect = nativeCloseButton.getBoundingClientRect()
  const targetSize = 56
  const top = Math.max(8, Math.round(rect.top + rect.height / 2 - targetSize / 2))
  const right = Math.max(8, Math.round(window.innerWidth - (rect.left + rect.width / 2 + targetSize / 2)))
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'drawio-lightbox-close no-export'
  closeButton.title = '关闭 DrawIO 全屏预览'
  closeButton.setAttribute('aria-label', '关闭 DrawIO 全屏预览')
  closeButton.style.top = `${top}px`
  closeButton.style.right = `${right}px`
  bindDrawioLightboxCloseEvents(closeButton)

  nativeCloseButton.remove()
  document.querySelectorAll('.drawio-lightbox-close').forEach((element) => element.remove())
  document.body.appendChild(closeButton)
}

function createDrawioLightboxFallbackCloseButton(): void {
  if (document.querySelector('.drawio-lightbox-close')) return
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'drawio-lightbox-close drawio-lightbox-close-fallback no-export'
  closeButton.title = '关闭 DrawIO 全屏预览'
  closeButton.setAttribute('aria-label', '关闭 DrawIO 全屏预览')
  bindDrawioLightboxCloseEvents(closeButton)
  document.body.appendChild(closeButton)
}

function syncDrawioLightboxCloseButton(): boolean {
  const lightbox = document.querySelector('.geDiagramContainer')
  if (!lightbox) {
    removeDrawioLightboxCloseButton()
    teardownDrawioLightboxCloseHandling()
    return false
  }

  removeDrawioLightboxToolbarCloseButtons()
  document.querySelectorAll('.drawio-lightbox-native-close-hidden').forEach((element) => element.remove())
  const nativeCloseButton = findNativeDrawioLightboxCloseButton()
  if (nativeCloseButton) {
    createDrawioLightboxCloseButtonFromNative(nativeCloseButton)
    return true
  }

  createDrawioLightboxFallbackCloseButton()
  return false
}

function installDrawioLightboxCloseButton(): void {
  const lightbox = document.querySelector('.geDiagramContainer')
  if (!lightbox) return

  if (!drawioLightboxPointerHandlerInstalled) {
    document.addEventListener('pointerdown', handleDrawioLightboxPointer, true)
    document.addEventListener('mousedown', handleDrawioLightboxPointer, true)
    document.addEventListener('click', handleDrawioLightboxPointer, true)
    drawioLightboxPointerHandlerInstalled = true
  }
  if (!drawioLightboxKeyHandlerInstalled) {
    document.addEventListener('keydown', handleDrawioLightboxKeydown, true)
    drawioLightboxKeyHandlerInstalled = true
  }

  syncDrawioLightboxCloseButton()

  drawioLightboxObserver?.disconnect()
  drawioLightboxObserver = new MutationObserver(() => {
    syncDrawioLightboxCloseButton()
  })
  drawioLightboxObserver.observe(document.body, { childList: true, subtree: true })

  let attempts = 0
  const retryUntilNativeCloseIsHandled = () => {
    if (!document.querySelector('.geDiagramContainer')) return
    const handledNativeClose = syncDrawioLightboxCloseButton()
    attempts += 1
    if (!handledNativeClose && attempts < 40) {
      drawioLightboxRetryTimer = window.setTimeout(retryUntilNativeCloseIsHandled, 50)
    }
  }
  retryUntilNativeCloseIsHandled()
}

/**
 * DrawIO 图表渲染 Hook
 *
 * @param ref - 容器元素的 ref
 * @param html - Markdown 渲染后的 HTML 内容（用于触发重新渲染）
 */
export function useDrawIOChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true
): void {
  // v1.5.5: DrawIO 图表渲染（异步加载 viewer.min.js）
  useEffect(() => {
    if (!enabled || !ref.current) return

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
          wrapper.dataset.drawioIndex = String(index)

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
  }, [html, enabled])

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
              if (svg) downloadSvgAsPng(svg, `drawio-${Date.now()}`)
              break
            }
            case 'lightbox':
              rememberDrawioLightboxBodyOverflow()
              if (viewer) {
                withDrawioLightboxToolbarCloseDisabled(() => viewer.showLightbox())
              }
              window.setTimeout(installDrawioLightboxCloseButton, 0)
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
