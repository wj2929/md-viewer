/**
 * PlantUML / C4-PlantUML 图表渲染 Hook。
 * 普通预览由文档级策略决定是否启动；服务端渲染与设置页可显式传入 allow/block。
 */

import { useEffect } from 'react'
import {
  validatePlantUMLCode,
  renderPlantUMLToSvg,
} from '../../utils/plantumlRenderer'
import { downloadSvgAsPng, toggleChartFullscreen } from '../../utils/chartUtils'
import { sanitizeRendererSvg } from '../../utils/rendererSvgSanitizer'
import {
  createRemoteChartError,
  type RemoteChartPolicy,
} from './remoteChartConsent'

function createActionButton(action: string, title: string, text: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'plantuml-action-btn'
  button.dataset.action = action
  button.title = title
  button.textContent = text
  return button
}

function createPlantUMLWrapper(
  code: string,
  isC4Plantuml: boolean,
  sourceIndex: number,
  svgString: string,
): HTMLElement {
  const safeSvg = sanitizeRendererSvg(svgString)
  if (!safeSvg || !/<svg[\s>]/i.test(safeSvg)) {
    throw new Error('PlantUML 服务未返回有效 SVG')
  }

  const wrapper = document.createElement('div')
  wrapper.className = isC4Plantuml ? 'c4plantuml-wrapper' : 'plantuml-wrapper'
  if (isC4Plantuml) wrapper.dataset.c4plantumlIndex = String(sourceIndex)
  else wrapper.dataset.plantumlIndex = String(sourceIndex)
  wrapper.dataset.plantumlCode = btoa(unescape(encodeURIComponent(code)))

  const toggleBar = document.createElement('div')
  toggleBar.className = 'plantuml-toggle-bar no-export'
  toggleBar.append(
    createActionButton('toggleCode', '查看代码', '💻'),
    createActionButton('zoomIn', '放大', '🔍+'),
    createActionButton('zoomOut', '缩小', '🔍−'),
    createActionButton('fit', '适应大小', '⊡'),
    createActionButton('download', '下载图片', '💾'),
    createActionButton('fullscreen', '全屏查看', '⛶'),
  )

  const chartContainer = document.createElement('div')
  chartContainer.className = 'plantuml-container'
  chartContainer.dataset.view = 'chart'
  chartContainer.style.width = '100%'
  chartContainer.innerHTML = safeSvg
  const svg = chartContainer.querySelector('svg')
  if (svg) svg.style.height = 'auto'

  const codeView = document.createElement('div')
  codeView.className = 'plantuml-code-view'
  codeView.dataset.view = 'code'
  codeView.style.display = 'none'

  const backToChartButton = document.createElement('button')
  backToChartButton.type = 'button'
  backToChartButton.className = 'plantuml-back-btn no-export'
  backToChartButton.textContent = '图表'
  backToChartButton.title = '返回图表视图'

  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'copy-btn no-export'
  copyButton.textContent = '复制'
  copyButton.title = '复制 PlantUML 代码'

  const codeElement = document.createElement('code')
  codeElement.className = 'language-plaintext'
  codeElement.textContent = code
  const preElement = document.createElement('pre')
  preElement.className = 'language-plaintext'
  preElement.appendChild(codeElement)
  codeView.append(backToChartButton, copyButton, preElement)
  wrapper.append(toggleBar, chartContainer, codeView)
  return wrapper
}

async function renderPlantUMLBlock(
  code: string,
  isC4Plantuml: boolean,
  sourceIndex: number,
): Promise<HTMLElement> {
  const validation = validatePlantUMLCode(code)
  if (!validation.valid) throw new Error(validation.error || 'PlantUML 配置无效')
  const svg = await renderPlantUMLToSvg(code, isC4Plantuml ? 'c4plantuml' : 'plantuml')
  return createPlantUMLWrapper(code, isC4Plantuml, sourceIndex, svg)
}

export function usePlantUMLChart(
  ref: React.RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
  enabledTypes: { plantuml?: boolean; c4plantuml?: boolean } = { plantuml: true, c4plantuml: true },
  remotePolicy: RemoteChartPolicy = 'prompt',
): void {
  useEffect(() => {
    if (!enabled || !ref.current) return

    const blocks = Array.from(ref.current.querySelectorAll('pre.language-plantuml, pre.language-c4plantuml'))
    if (blocks.length === 0) return

    const abortController = new AbortController()
    let plantumlIndex = 0
    let c4PlantumlIndex = 0

    for (const block of blocks) {
      const isC4Plantuml = block.classList.contains('language-c4plantuml')
      if (isC4Plantuml && enabledTypes.c4plantuml === false) continue
      if (!isC4Plantuml && enabledTypes.plantuml === false) continue

      const sourceIndex = isC4Plantuml ? c4PlantumlIndex++ : plantumlIndex++
      const code = (block.querySelector('code') || block).textContent || ''
      const rendererType = isC4Plantuml ? 'c4plantuml' : 'plantuml'
      const rendererName = isC4Plantuml ? 'C4-PlantUML' : 'PlantUML'
      const render = () => renderPlantUMLBlock(code, isC4Plantuml, sourceIndex)

      if (remotePolicy === 'prompt') continue

      if (remotePolicy === 'block') {
        createRemoteChartError(block, rendererType, rendererName, sourceIndex, '当前渲染策略禁止远程 PlantUML 请求。')
        continue
      }

      void render().then(wrapper => {
        if (!abortController.signal.aborted && block.isConnected) block.replaceWith(wrapper)
      }).catch(error => {
        if (abortController.signal.aborted || !block.isConnected) return
        console.error('[PlantUML] 渲染失败:', error)
        createRemoteChartError(
          block,
          rendererType,
          rendererName,
          sourceIndex,
          error instanceof Error ? error.message : String(error),
          render,
        )
      })
    }

    return () => abortController.abort()
  }, [html, enabled, enabledTypes.plantuml, enabledTypes.c4plantuml, remotePolicy, ref])

  useEffect(() => {
    if (!ref.current) return

    const handlePlantUMLClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const backButton = target.closest('.plantuml-back-btn')
      if (backButton) {
        const wrapper = backButton.closest('.plantuml-wrapper, .c4plantuml-wrapper') as HTMLElement | null
        const chartView = wrapper?.querySelector<HTMLElement>('[data-view="chart"]')
        const codeView = wrapper?.querySelector<HTMLElement>('[data-view="code"]')
        const toggleBar = wrapper?.querySelector<HTMLElement>('.plantuml-toggle-bar')
        if (chartView) chartView.style.display = ''
        if (codeView) codeView.style.display = 'none'
        if (toggleBar) toggleBar.style.display = ''
        return
      }

      const actionButton = target.closest<HTMLElement>('.plantuml-action-btn')
      if (!actionButton) return
      const action = actionButton.dataset.action
      const wrapper = actionButton.closest('.plantuml-wrapper, .c4plantuml-wrapper') as HTMLElement | null
      const container = wrapper?.querySelector<HTMLElement>('.plantuml-container')
      if (!wrapper || !container || !action) return

      if (action === 'toggleCode') {
        const chartView = wrapper.querySelector<HTMLElement>('[data-view="chart"]')
        const codeView = wrapper.querySelector<HTMLElement>('[data-view="code"]')
        const toggleBar = wrapper.querySelector<HTMLElement>('.plantuml-toggle-bar')
        if (chartView) chartView.style.display = 'none'
        if (codeView) codeView.style.display = ''
        if (toggleBar) toggleBar.style.display = 'none'
        return
      }

      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg && action !== 'fullscreen') return

      const applyZoom = (percent: number) => {
        if (!svg) return
        svg.style.transform = `scale(${percent / 100})`
        svg.style.transformOrigin = 'center top'
        container.classList.toggle('zoomed', percent > 100)
        wrapper.classList.toggle('zoomed-wrapper', percent > 100)
      }

      try {
        switch (action) {
          case 'zoomIn': {
            const next = Math.min(Number.parseInt(container.dataset.zoomLevel || '100', 10) + 20, 300)
            container.dataset.zoomLevel = String(next)
            applyZoom(next)
            break
          }
          case 'zoomOut': {
            const next = Math.max(Number.parseInt(container.dataset.zoomLevel || '100', 10) - 20, 30)
            container.dataset.zoomLevel = String(next)
            applyZoom(next)
            break
          }
          case 'fit':
            container.dataset.zoomLevel = '100'
            applyZoom(100)
            break
          case 'download':
            if (svg) downloadSvgAsPng(svg, `plantuml-${Date.now()}`)
            break
          case 'fullscreen':
            toggleChartFullscreen(wrapper)
            break
        }
      } catch (error) {
        console.error('[PlantUML] 工具栏操作失败:', error)
      }
    }

    ref.current.addEventListener('click', handlePlantUMLClick)
    return () => ref.current?.removeEventListener('click', handlePlantUMLClick)
  }, [html, ref])
}
