import { useEffect } from 'react'
import { rendererErrorHtml } from '../../utils/d2Renderer'
import { renderDbmlToSvg } from '../../utils/dbmlRenderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'

export function useDbmlChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll('pre.language-dbml'))
    if (blocks.length === 0) return

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      const source = (block.querySelector('code') || block).textContent || ''
      const result = renderDbmlToSvg(source)
      if (result.ok) {
        const { wrapper, chartContainer } = createChartWrapper('dbml', source, 'plaintext')
        wrapper.dataset.dbmlIndex = String(index)
        wrapper.setAttribute('role', 'group')
        chartContainer.innerHTML = result.svg
        block.replaceWith(wrapper)
      } else {
        const wrapper = document.createElement('div')
        wrapper.className = 'dbml-error'
        wrapper.dataset.dbmlIndex = String(index)
        wrapper.setAttribute('role', 'alert')
        wrapper.innerHTML = rendererErrorHtml('DBML 渲染失败', result.message, 'dbml-error')
        block.replaceWith(wrapper)
      }
    }
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('dbml')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
