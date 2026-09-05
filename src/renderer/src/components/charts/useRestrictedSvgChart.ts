import { useEffect } from 'react'
import { rendererErrorHtml } from '../../utils/d2Renderer'
import { renderRestrictedSvgToSvg } from '../../utils/restrictedSvgRenderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'

const rootNamespaces = new WeakMap<HTMLElement, string>()
let nextRootNamespace = 0

function getRootNamespace(root: HTMLElement): string {
  const existing = rootNamespaces.get(root)
  if (existing) return existing
  nextRootNamespace += 1
  const namespace = `preview-root-${nextRootNamespace}`
  rootNamespaces.set(root, namespace)
  return namespace
}

export function useRestrictedSvgChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !ref.current) return
    const blocks = Array.from(ref.current.querySelectorAll('pre.language-svg'))
    const rootNamespace = getRootNamespace(ref.current)

    blocks.forEach((block, index) => {
      const source = (block.querySelector('code') || block).textContent || ''
      const result = renderRestrictedSvgToSvg(source, `${rootNamespace}-${index}`)
      if (result.ok) {
        const { wrapper, chartContainer } = createChartWrapper('svg', source, 'xml')
        wrapper.dataset.svgIndex = String(index)
        wrapper.setAttribute('role', 'group')
        chartContainer.innerHTML = result.svg
        block.replaceWith(wrapper)
      } else {
        const wrapper = document.createElement('div')
        wrapper.className = 'svg-error'
        wrapper.dataset.svgIndex = String(index)
        wrapper.setAttribute('role', 'alert')
        wrapper.innerHTML = rendererErrorHtml('SVG 渲染失败', result.message, 'renderer-error-content')
        block.replaceWith(wrapper)
      }
    })
  }, [ref, html, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('svg')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
