import { useEffect } from 'react'
import { rendererErrorHtml } from '../../utils/d2Renderer'
import { renderAntvG6ToSvg } from '../../utils/antvG6Renderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'

export function useAntvG6Chart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll('pre.language-antv-g6'))
    if (blocks.length === 0) return

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      const source = (block.querySelector('code') || block).textContent || ''
      const result = renderAntvG6ToSvg(source)
      if (result.ok) {
        const { wrapper, chartContainer } = createChartWrapper('antv-g6', source, 'json')
        wrapper.dataset.antvG6Index = String(index)
        wrapper.setAttribute('role', 'group')
        chartContainer.innerHTML = result.svg
        block.replaceWith(wrapper)
      } else {
        const wrapper = document.createElement('div')
        wrapper.className = 'antv-g6-error'
        wrapper.dataset.antvG6Index = String(index)
        wrapper.setAttribute('role', 'alert')
        wrapper.innerHTML = rendererErrorHtml('AntV G6 渲染失败', result.message, 'antv-g6-error')
        block.replaceWith(wrapper)
      }
    }
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('antv-g6')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
