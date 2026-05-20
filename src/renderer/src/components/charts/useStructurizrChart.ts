import { useEffect } from 'react'
import { rendererErrorHtml } from '../../utils/d2Renderer'
import { renderStructurizrToSvg } from '../../utils/structurizrRenderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'

export function useStructurizrChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll('pre.language-structurizr'))
    if (blocks.length === 0) return

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      const source = (block.querySelector('code') || block).textContent || ''
      const result = renderStructurizrToSvg(source)
      if (result.ok) {
        const { wrapper, chartContainer } = createChartWrapper('structurizr', source, 'plaintext')
        wrapper.dataset.structurizrIndex = String(index)
        wrapper.setAttribute('role', 'group')
        chartContainer.innerHTML = result.svg
        block.replaceWith(wrapper)
      } else {
        const wrapper = document.createElement('div')
        wrapper.className = 'structurizr-error'
        wrapper.dataset.structurizrIndex = String(index)
        wrapper.setAttribute('role', 'alert')
        wrapper.innerHTML = rendererErrorHtml('Structurizr 渲染失败', result.message, 'structurizr-error')
        block.replaceWith(wrapper)
      }
    }
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('structurizr')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
