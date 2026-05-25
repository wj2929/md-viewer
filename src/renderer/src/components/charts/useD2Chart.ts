import { useEffect } from 'react'
import { renderD2ToSvg, rendererErrorHtml } from '../../utils/d2Renderer'
import { createChartToggleHandler, createChartWrapper, downloadSvgAsPng, toggleChartFullscreen } from '../../utils/chartUtils'

function readSvgWidth(svg: SVGSVGElement): number | null {
  const attrWidth = svg.getAttribute('width')
  if (attrWidth && !/%|auto/i.test(attrWidth)) {
    const parsed = Number.parseFloat(attrWidth)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const renderedWidth = svg.getBoundingClientRect().width
  if (renderedWidth > 0) return renderedWidth

  const viewBox = svg.viewBox?.baseVal
  return viewBox && viewBox.width > 0 ? viewBox.width : null
}

function formatZoomWidth(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function applyD2Zoom(container: HTMLElement, svg: SVGSVGElement, percent: number): void {
  const wrapper = container.closest('.d2-wrapper') as HTMLElement | null
  if (!wrapper) return

  let baseWidth = Number.parseFloat(container.dataset.baseWidth || '')
  if (!(baseWidth > 0)) {
    const measuredWidth = readSvgWidth(svg)
    if (!(measuredWidth && measuredWidth > 0)) return
    baseWidth = measuredWidth
    container.dataset.baseWidth = String(baseWidth)
    container.dataset.origSvgWidth = svg.getAttribute('width') || ''
    container.dataset.origSvgStyle = svg.getAttribute('style') || ''
  }

  if (percent === 100) {
    const origWidth = container.dataset.origSvgWidth
    if (origWidth) {
      svg.setAttribute('width', origWidth)
    } else {
      svg.removeAttribute('width')
    }
    const origStyle = container.dataset.origSvgStyle
    if (origStyle) {
      svg.setAttribute('style', origStyle)
    } else {
      svg.removeAttribute('style')
    }
    container.classList.remove('zoomed')
    wrapper.classList.remove('zoomed-wrapper')
    return
  }

  const targetWidth = baseWidth * percent / 100
  const formattedWidth = formatZoomWidth(targetWidth)
  svg.setAttribute('width', formattedWidth)
  svg.removeAttribute('height')
  svg.style.width = `${formattedWidth}px`
  svg.style.maxWidth = 'none'
  svg.style.maxHeight = 'none'
  svg.style.height = 'auto'
  svg.style.display = 'block'
  svg.style.flexShrink = '0'
  container.classList.add('zoomed')
  wrapper.classList.toggle('zoomed-wrapper', percent > 100)
}

export function useD2Chart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    if (!ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll('pre.language-d2'))
    if (blocks.length === 0) return

    const abortController = new AbortController()
    ;(async () => {
      for (let index = 0; index < blocks.length; index += 1) {
        if (abortController.signal.aborted) break
        const block = blocks[index]
        const source = (block.querySelector('code') || block).textContent || ''
        const result = await renderD2ToSvg(source)
        if (abortController.signal.aborted) break

        if (result.ok) {
          const { wrapper, chartContainer } = createChartWrapper('d2', source, 'plaintext')
          wrapper.dataset.d2Index = String(index)
          wrapper.setAttribute('role', 'group')
          chartContainer.innerHTML = result.svg
          block.replaceWith(wrapper)
        } else {
          const errorWrapper = document.createElement('div')
          errorWrapper.className = 'd2-error'
          errorWrapper.dataset.d2Index = String(index)
          errorWrapper.setAttribute('role', 'alert')
          errorWrapper.innerHTML = rendererErrorHtml('D2 渲染失败', result.message, 'd2-error')
          block.replaceWith(errorWrapper)
        }
      }
    })()

    return () => abortController.abort()
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return

    const handleToggle = createChartToggleHandler('d2')
    const handleD2Click = (event: MouseEvent): void => {
      if (handleToggle(event)) return

      const target = event.target as HTMLElement
      const actionBtn = target.closest('.d2-action-btn') as HTMLElement | null
      if (!actionBtn) return

      const action = actionBtn.getAttribute('data-action')
      const wrapper = actionBtn.closest('.d2-wrapper') as HTMLElement | null
      const container = wrapper?.querySelector('.d2-container') as HTMLElement | null
      const svg = container?.querySelector('svg') as SVGSVGElement | null
      if (!wrapper || !container || !action) return

      if (!svg && action !== 'fullscreen') return

      try {
        switch (action) {
          case 'zoomIn': {
            const level = Number.parseInt(container.dataset.zoomLevel || '100', 10)
            const newLevel = Math.min(level + 20, 300)
            container.dataset.zoomLevel = String(newLevel)
            applyD2Zoom(container, svg!, newLevel)
            break
          }
          case 'zoomOut': {
            const level = Number.parseInt(container.dataset.zoomLevel || '100', 10)
            const newLevel = Math.max(level - 20, 40)
            container.dataset.zoomLevel = String(newLevel)
            applyD2Zoom(container, svg!, newLevel)
            break
          }
          case 'fit':
            container.dataset.zoomLevel = '100'
            applyD2Zoom(container, svg!, 100)
            break
          case 'download':
            downloadSvgAsPng(svg!, `d2-${Date.now()}`)
            break
          case 'fullscreen':
            toggleChartFullscreen(wrapper)
            break
        }
      } catch (error) {
        console.error('[D2] 工具栏操作失败:', error)
      }
    }

    ref.current.addEventListener('click', handleD2Click)
    return () => ref.current?.removeEventListener('click', handleD2Click)
  }, [ref])
}
