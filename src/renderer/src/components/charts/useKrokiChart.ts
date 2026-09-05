import { useEffect } from 'react'
import { renderKrokiToSvg, resolveKrokiFormat } from '../../utils/krokiRenderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'
import {
  createRemoteChartError,
  type RemoteChartPolicy,
} from './remoteChartConsent'

const KROKI_SELECTOR = 'pre.language-kroki, pre.language-nomnoml, pre.language-pikchr, pre.language-svgbob, pre.language-bytefield, pre.language-tikz'

function getKrokiLanguage(block: Element): string {
  const element = block as HTMLElement
  return element.dataset.rendererLanguage || Array.from(element.classList)
    .find(cls => cls.startsWith('language-'))
    ?.replace('language-', '') || 'kroki'
}

async function renderKrokiBlock(
  source: string,
  language: string,
  index: number,
): Promise<HTMLElement> {
  const result = await renderKrokiToSvg(source, { language })
  if (!result.ok) throw new Error(result.message)

  const { wrapper, chartContainer } = createChartWrapper('kroki', source, 'plaintext')
  wrapper.dataset.krokiIndex = String(index)
  wrapper.dataset.krokiFormat = resolveKrokiFormat(language, source)
  wrapper.setAttribute('role', 'group')
  chartContainer.innerHTML = result.svg
  return wrapper
}

export function useKrokiChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
  remotePolicy: RemoteChartPolicy = 'prompt',
): void {
  useEffect(() => {
    if (!enabled || !ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll(KROKI_SELECTOR))
    if (blocks.length === 0) return

    const abortController = new AbortController()
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      const source = (block.querySelector('code') || block).textContent || ''
      const language = getKrokiLanguage(block)
      const format = resolveKrokiFormat(language, source)
      const render = () => renderKrokiBlock(source, language, index)

      if (remotePolicy === 'prompt') continue

      if (remotePolicy === 'block') {
        createRemoteChartError(block, 'kroki', 'Kroki', index, '当前渲染策略禁止远程 Kroki 请求。')
        continue
      }

      void render().then(wrapper => {
        if (!abortController.signal.aborted && block.isConnected) block.replaceWith(wrapper)
      }).catch(error => {
        if (abortController.signal.aborted || !block.isConnected) return
        console.error('[Kroki] 渲染失败:', error)
        createRemoteChartError(
          block,
          'kroki',
          'Kroki',
          index,
          error instanceof Error ? error.message : String(error),
          render,
        )
      })
    }

    return () => abortController.abort()
  }, [ref, html, enabled, remotePolicy])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('kroki')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
