import { useEffect } from 'react'
import { renderVegaLiteToSvg, vegaLiteErrorHtml } from '../../utils/vegaLiteRenderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'

export function useVegaLiteChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    if (!ref.current) return

    const blocks = ref.current.querySelectorAll('pre.language-vega-lite')
    if (blocks.length === 0) return

    const abortController = new AbortController()

    ;(async () => {
      for (let index = 0; index < blocks.length; index++) {
        if (abortController.signal.aborted) break

        const block = blocks[index]
        const source = (block.querySelector('code') || block).textContent || ''
        const result = await renderVegaLiteToSvg(source)
        if (abortController.signal.aborted) break

        if (result.ok) {
          const { wrapper, chartContainer } = createChartWrapper('vega-lite', source, 'json')
          wrapper.dataset.vegaLiteIndex = String(index)
          chartContainer.innerHTML = result.svg
          block.replaceWith(wrapper)
        } else {
          const wrapper = document.createElement('div')
          wrapper.className = 'vega-lite-error'
          wrapper.setAttribute('role', 'alert')
          wrapper.innerHTML = vegaLiteErrorHtml('Vega-Lite 渲染失败', result.message)
          block.replaceWith(wrapper)
        }
      }
    })()

    return () => abortController.abort()
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('vega-lite')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
