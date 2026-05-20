import { useEffect } from 'react'
import { renderWaveDromToSvg } from '../../utils/wavedromRenderer'
import { rendererErrorHtml } from '../../utils/d2Renderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'

export function useWaveDromChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    if (!ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll('pre.language-wavedrom'))
    if (blocks.length === 0) return

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      const source = (block.querySelector('code') || block).textContent || ''
      const result = renderWaveDromToSvg(source)
      if (result.ok) {
        const { wrapper, chartContainer } = createChartWrapper('wavedrom', source, 'javascript')
        wrapper.dataset.wavedromIndex = String(index)
        wrapper.setAttribute('role', 'group')
        chartContainer.innerHTML = result.svg
        block.replaceWith(wrapper)
      } else {
        const wrapper = document.createElement('div')
        wrapper.className = 'wavedrom-error'
        wrapper.dataset.wavedromIndex = String(index)
        wrapper.setAttribute('role', 'alert')
        wrapper.innerHTML = rendererErrorHtml('WaveDrom 渲染失败', result.message, 'wavedrom-error')
        block.replaceWith(wrapper)
      }
    }
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('wavedrom')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
