import { useEffect } from 'react'
import { cleanUserFacingError } from '../../utils/userFacingErrors'
import { cleanBpmnRefPath, isMissingReadBpmnFileHandlerError, renderBpmnToSvg, resolveBpmnFallbackPath } from '../../utils/bpmnRenderer'
import { rendererErrorHtml } from '../../utils/d2Renderer'
import { createChartWrapper, createSvgChartActionHandler } from '../../utils/chartUtils'
import type { ResourceHost } from '../../render-core/hosts'

interface UseBpmnChartOptions {
  markdownFilePath?: string
  resourceHost?: ResourceHost
}

async function readBpmnFile(options: UseBpmnChartOptions, refPath: string): Promise<string> {
  const { markdownFilePath, resourceHost } = options
  const cleanRefPath = cleanBpmnRefPath(refPath)
  if (!markdownFilePath) throw new Error('缺少 Markdown 文件路径，无法读取 BPMN 文件')
  if (resourceHost) {
    const resolvedPath = resourceHost.resolvePath(markdownFilePath, cleanRefPath)
    return resourceHost.readText(resolvedPath)
  }
  if (typeof window.api?.readBpmnFile !== 'function' && typeof window.api?.readFile === 'function') {
    return window.api.readFile(resolveBpmnFallbackPath(markdownFilePath, cleanRefPath))
  }
  if (typeof window.api?.readBpmnFile !== 'function') throw new Error('当前环境不支持读取 BPMN 文件')
  try {
    const result = await window.api.readBpmnFile({
      markdownFilePath,
      refPath: cleanRefPath,
    })
    return result.content
  } catch (error) {
    if (typeof window.api?.readFile === 'function' && isMissingReadBpmnFileHandlerError(error)) {
      return window.api.readFile(resolveBpmnFallbackPath(markdownFilePath, cleanRefPath))
    }
    throw error
  }
}

export function useBpmnChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  options: UseBpmnChartOptions = {},
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    if (!ref.current) return
    const candidates = Array.from(ref.current.querySelectorAll('pre.language-bpmn, .bpmn-file-placeholder'))
    if (candidates.length === 0) return

    const abortController = new AbortController()
    ;(async () => {
      for (let index = 0; index < candidates.length; index += 1) {
        if (abortController.signal.aborted) break
        const candidate = candidates[index]

        try {
          const source = candidate.matches('pre.language-bpmn')
            ? ((candidate.querySelector('code') || candidate).textContent || '')
            : await readBpmnFile(options, (candidate as HTMLElement).dataset.bpmnSrc || '')
          const result = await renderBpmnToSvg(source)
          if (abortController.signal.aborted) break
          if (result.ok) {
            const { wrapper, chartContainer } = createChartWrapper('bpmn', source, 'xml')
            wrapper.dataset.bpmnIndex = String(index)
            wrapper.setAttribute('role', 'group')
            chartContainer.innerHTML = result.svg
            candidate.replaceWith(wrapper)
          } else {
            const wrapper = document.createElement('div')
            wrapper.className = 'bpmn-error'
            wrapper.setAttribute('role', 'alert')
            wrapper.innerHTML = rendererErrorHtml('BPMN 渲染失败', result.message, 'bpmn-error')
            candidate.replaceWith(wrapper)
          }
        } catch (error) {
          const wrapper = document.createElement('div')
          wrapper.className = 'bpmn-error'
          wrapper.setAttribute('role', 'alert')
          wrapper.innerHTML = rendererErrorHtml('BPMN 渲染失败', cleanUserFacingError(error), 'bpmn-error')
          candidate.replaceWith(wrapper)
        }
      }
    })()

    return () => abortController.abort()
  }, [ref, html, options.markdownFilePath, options.resourceHost, enabled])

  useEffect(() => {
    if (!ref.current) return
    const handleClick = createSvgChartActionHandler('bpmn')
    ref.current.addEventListener('click', handleClick)
    return () => ref.current?.removeEventListener('click', handleClick)
  }, [ref])
}
