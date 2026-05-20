import { useEffect } from 'react'
import { rendererErrorHtml } from '../../utils/d2Renderer'
import { renderPlotlyToSvg } from '../../utils/plotlyRenderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'

export function usePlotlyChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll('pre.language-plotly'))
    if (blocks.length === 0) return

    const abortController = new AbortController()
    ;(async () => {
      for (let index = 0; index < blocks.length; index += 1) {
        if (abortController.signal.aborted) break
        const block = blocks[index]
        const source = (block.querySelector('code') || block).textContent || ''
        const result = await renderPlotlyToSvg(source)
        if (abortController.signal.aborted) break
        if (result.ok) {
          const { wrapper, chartContainer } = createChartWrapper('plotly', source, 'json')
          wrapper.dataset.plotlyIndex = String(index)
          wrapper.setAttribute('role', 'group')
          chartContainer.innerHTML = result.svg
          block.replaceWith(wrapper)
        } else {
          const wrapper = document.createElement('div')
          wrapper.className = 'plotly-error'
          wrapper.dataset.plotlyIndex = String(index)
          wrapper.setAttribute('role', 'alert')
          wrapper.innerHTML = rendererErrorHtml('Plotly 渲染失败', result.message, 'plotly-error')
          block.replaceWith(wrapper)
        }
      }
    })()

    return () => abortController.abort()
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('plotly')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
