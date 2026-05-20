import { useEffect } from 'react'
import { rendererErrorHtml } from '../../utils/d2Renderer'
import { renderKrokiToSvg, resolveKrokiFormat } from '../../utils/krokiRenderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'

const KROKI_SELECTOR = 'pre.language-kroki, pre.language-nomnoml, pre.language-pikchr, pre.language-svgbob, pre.language-bytefield, pre.language-tikz'

function getKrokiLanguage(block: Element): string {
  const element = block as HTMLElement
  return element.dataset.rendererLanguage || Array.from(element.classList)
    .find(cls => cls.startsWith('language-'))
    ?.replace('language-', '') || 'kroki'
}

export function useKrokiChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll(KROKI_SELECTOR))
    if (blocks.length === 0) return

    const abortController = new AbortController()
    ;(async () => {
      for (let index = 0; index < blocks.length; index += 1) {
        if (abortController.signal.aborted) break
        const block = blocks[index]
        const source = (block.querySelector('code') || block).textContent || ''
        const language = getKrokiLanguage(block)
        const result = await renderKrokiToSvg(source, { language })
        if (abortController.signal.aborted) break
        if (result.ok) {
          const { wrapper, chartContainer } = createChartWrapper('kroki', source, 'plaintext')
          wrapper.dataset.krokiIndex = String(index)
          wrapper.dataset.krokiFormat = resolveKrokiFormat(language, source)
          wrapper.setAttribute('role', 'group')
          chartContainer.innerHTML = result.svg
          block.replaceWith(wrapper)
        } else {
          const wrapper = document.createElement('div')
          wrapper.className = 'kroki-error'
          wrapper.dataset.krokiIndex = String(index)
          wrapper.dataset.krokiFormat = resolveKrokiFormat(language, source)
          wrapper.setAttribute('role', 'alert')
          wrapper.innerHTML = rendererErrorHtml('Kroki 渲染失败', result.message, 'kroki-error')
          block.replaceWith(wrapper)
        }
      }
    })()

    return () => abortController.abort()
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('kroki')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
