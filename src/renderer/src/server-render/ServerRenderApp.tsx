import { useEffect, useMemo, useRef, useState } from 'react'
import { createMarkdownRenderer, sanitizeHtml, setupDOMPurifyHooks } from '../utils/markdownRenderer'
import { useMermaidChart } from '../components/charts/useMermaidChart'
import { useExcalidrawChart } from '../components/charts/useExcalidrawChart'
import { useDrawIOChart } from '../components/charts/useDrawIOChart'
import { useEChartsChart } from '../components/charts/useEChartsChart'
import { useMarkmapChart } from '../components/charts/useMarkmapChart'
import { useGraphvizChart } from '../components/charts/useGraphvizChart'
import { useInfographicChart } from '../components/charts/useInfographicChart'
import { usePlantUMLChart } from '../components/charts/usePlantUMLChart'
import { createBrowserResourceHost } from '../render-core/browserResourceHost'
import type { BrowserPageRenderResult, ServerRenderInput } from './contracts'
import '../assets/main.css'
import '../assets/markdown.css'
import '../assets/prism-theme.css'
import 'katex/dist/katex.min.css'

function createEmptyResult(): BrowserPageRenderResult {
  return {
    schemaVersion: '1.0',
    ok: false,
    status: 'failed',
    html: '',
    images: [],
    stats: {
      totalBlocks: 0,
      renderedBlocks: 0,
      failedBlocks: 0,
      durationMs: 0,
    },
    warnings: [],
  }
}

function countSelector(root: HTMLElement | null, selector: string): number {
  return root?.querySelectorAll(selector).length || 0
}

function countRenderableBlocks(root: HTMLElement | null): Record<string, number> {
  return {
    mermaid: countSelector(root, 'pre.language-mermaid'),
    katex: countSelector(root, '.katex'),
    excalidraw: countSelector(root, 'pre.language-excalidraw') + countSelector(root, '.excalidraw-file-placeholder'),
    drawio: countSelector(root, 'pre.language-drawio'),
    echarts: countSelector(root, 'pre.language-echarts'),
    markmap: countSelector(root, 'pre.language-markmap'),
    graphviz: countSelector(root, 'pre.language-graphviz'),
    infographic: countSelector(root, 'pre.language-infographic'),
    plantuml: countSelector(root, 'pre.language-plantuml'),
  }
}

function readNumberAttribute(element: Element | null, attribute: string): number | undefined {
  const raw = element?.getAttribute(attribute)
  if (raw == null || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function replaceExcalidrawImageReferences(root: HTMLElement): void {
  const images = Array.from(root.querySelectorAll('img'))
  for (const img of images) {
    const src = img.getAttribute('src') || ''
    if (!/\.excalidraw(?:[?#].*)?$/i.test(src)) continue

    const placeholder = document.createElement('div')
    placeholder.className = 'excalidraw-file-placeholder'
    placeholder.dataset.excalidrawSrc = src.split('#')[0].split('?')[0]
    placeholder.dataset.excalidrawAlt = img.getAttribute('alt') || ''
    img.replaceWith(placeholder)
  }
}

export function ServerRenderApp(): React.JSX.Element {
  const input: ServerRenderInput = window.__MDV_RENDER_INPUT__ || {
    schemaVersion: '1.0',
    markdown: '',
    theme: 'light',
    enabledRenderers: ['mermaid'],
    networkPolicy: 'blocked',
    timeoutMs: 15000,
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState('')

  const md = useMemo(() => {
    setupDOMPurifyHooks()
    return createMarkdownRenderer()
  }, [])
  const resourceHost = useMemo(() => createBrowserResourceHost(input), [input])

  useEffect(() => {
    const rendered = sanitizeHtml(md.render(input.markdown))
    setHtml(rendered)
  }, [input.markdown, md])

  useMermaidChart(rootRef, html)
  useDrawIOChart(rootRef, html)
  useEChartsChart(rootRef, html)
  useMarkmapChart(rootRef, html)
  useGraphvizChart(rootRef, html)
  useInfographicChart(rootRef, html)
  usePlantUMLChart(rootRef, html, input.enabledRenderers?.includes('plantuml') === true)
  useEffect(() => {
    if (!rootRef.current) return
    replaceExcalidrawImageReferences(rootRef.current)
  }, [html])
  useExcalidrawChart(rootRef, html, {
    markdownFilePath: input.markdownFilePath || 'index.md',
    resourceHost,
  })

  useEffect(() => {
    let attempts = 0
    const startedAt = Date.now()
    const expected = countRenderableBlocks(rootRef.current)
    if (input.enabledRenderers?.includes('plantuml') !== true) {
      expected.plantuml = 0
    }
    const totalBlocks = Object.values(expected).reduce((sum, count) => sum + count, 0)
    const timeoutMs = input.timeoutMs ?? 15000

    const timer = window.setInterval(() => {
      attempts += 1
      const root = rootRef.current
      const mermaidCount = countSelector(root, '.mermaid-wrapper svg')
      const katexCount = countSelector(root, '.katex')
      const excalidrawCount = countSelector(root, '.excalidraw-wrapper svg')
      const drawioCount = countSelector(root, '.drawio-container[data-drawio-ready="true"] svg')
      const echartsCount = countSelector(root, '.echarts-wrapper .echarts-container svg')
      const markmapCount = countSelector(root, '.markmap-wrapper .markmap-container svg')
      const graphvizCount = countSelector(root, '.graphviz-wrapper .graphviz-container svg')
      const infographicCount = countSelector(root, '.infographic-wrapper .infographic-container svg')
      const plantumlCount = countSelector(root, '.plantuml-wrapper .plantuml-container svg')
      const mermaidFailed = countSelector(root, '.mermaid-error')
      const excalidrawFailed = countSelector(root, '.excalidraw-error')
      const drawioFailed = countSelector(root, '.drawio-error')
      const echartsFailed = countSelector(root, '.echarts-error')
      const markmapFailed = countSelector(root, '.markmap-error')
      const graphvizFailed = countSelector(root, '.graphviz-error')
      const infographicFailed = countSelector(root, '.infographic-error')
      const plantumlFailed = countSelector(root, '.plantuml-error')
      const renderedBlocks = mermaidCount + katexCount + excalidrawCount + drawioCount + echartsCount + markmapCount + graphvizCount + infographicCount + plantumlCount
      const failedBlocks = mermaidFailed + excalidrawFailed + drawioFailed + echartsFailed + markmapFailed + graphvizFailed + infographicFailed + plantumlFailed
      const elapsed = Date.now() - startedAt
      const finished = totalBlocks === 0 || (
        mermaidCount + mermaidFailed >= expected.mermaid
        && katexCount >= expected.katex
        && excalidrawCount + excalidrawFailed >= expected.excalidraw
        && drawioCount + drawioFailed >= expected.drawio
        && echartsCount + echartsFailed >= expected.echarts
        && markmapCount + markmapFailed >= expected.markmap
        && graphvizCount + graphvizFailed >= expected.graphviz
        && infographicCount + infographicFailed >= expected.infographic
        && plantumlCount + plantumlFailed >= expected.plantuml
      )

      if (finished || elapsed >= timeoutMs) {
        window.clearInterval(timer)

        const result: BrowserPageRenderResult = {
          schemaVersion: '1.0',
          ok: finished && failedBlocks === 0,
          status: finished ? (failedBlocks > 0 ? 'partial' : 'success') : 'timeout',
          html: rootRef.current?.innerHTML || html,
          images: Array.from(rootRef.current?.querySelectorAll('.mermaid-wrapper, .katex, .excalidraw-wrapper, .drawio-wrapper, .echarts-wrapper, .markmap-wrapper, .graphviz-wrapper, .infographic-wrapper, .plantuml-wrapper') || []).map((element, index) => {
            const isMermaid = element.classList.contains('mermaid-wrapper')
            const isExcalidraw = element.classList.contains('excalidraw-wrapper')
            const isDrawio = element.classList.contains('drawio-wrapper')
            const isECharts = element.classList.contains('echarts-wrapper')
            const isMarkmap = element.classList.contains('markmap-wrapper')
            const isGraphviz = element.classList.contains('graphviz-wrapper')
            const isInfographic = element.classList.contains('infographic-wrapper')
            const isPlantuml = element.classList.contains('plantuml-wrapper')
            const echartsContainer = element.querySelector('.echarts-container')
            const markmapContainer = element.querySelector('.markmap-container')
            const graphvizContainer = element.querySelector('.graphviz-container')
            const infographicContainer = element.querySelector('.infographic-container')
            const plantumlContainer = element.querySelector('.plantuml-container')
            const target = (
              isMermaid
                ? element.querySelector('svg')
                : isExcalidraw
                  ? element.querySelector('.excalidraw-container svg')
                  : isDrawio
                    ? element.querySelector('.drawio-container svg')
                    : isECharts
                      ? echartsContainer?.querySelector('svg')
                      : isMarkmap
                        ? markmapContainer?.querySelector('svg')
                        : isGraphviz
                          ? graphvizContainer?.querySelector('svg')
                          : isInfographic
                          ? infographicContainer?.querySelector('svg')
                          : isPlantuml
                            ? plantumlContainer?.querySelector('svg')
                            : element.querySelector('.katex-html') || element
            ) as HTMLElement | SVGSVGElement | null
            const sourceIndex = isMermaid
              ? readNumberAttribute(element, 'data-mermaid-index')
              : isDrawio
                ? readNumberAttribute(element, 'data-drawio-index')
                : isECharts
                  ? readNumberAttribute(echartsContainer, 'data-echarts-index')
                  : isMarkmap
                    ? readNumberAttribute(markmapContainer, 'data-markmap-index')
                    : isGraphviz
                      ? readNumberAttribute(element, 'data-graphviz-index')
                      : isInfographic
                        ? readNumberAttribute(infographicContainer, 'data-infographic-index')
                        : isPlantuml
                          ? readNumberAttribute(element, 'data-plantuml-index')
                          : undefined
            const id = `mdv__chart__${index.toString(16).padStart(8, '0')}__`
            if (!isMermaid && !isExcalidraw && !isDrawio && !isECharts && !isMarkmap && !isGraphviz && !isInfographic && !isPlantuml && target instanceof HTMLElement) {
              target.style.display = 'inline-block'
              target.style.width = 'max-content'
            }
            target?.setAttribute('data-mdv-render-id', id)
            const rect = target?.getBoundingClientRect()
            return {
              id,
              type: isMermaid ? 'mermaid' : isExcalidraw ? 'excalidraw' : isDrawio ? 'drawio' : isECharts ? 'echarts' : isMarkmap ? 'markmap' : isGraphviz ? 'graphviz' : isInfographic ? 'infographic' : isPlantuml ? 'plantuml' : 'katex',
              selector: `[data-mdv-render-id="${id}"]`,
              widthPx: Math.max(1, Math.round(rect?.width || 800)),
              heightPx: Math.max(1, Math.round(rect?.height || 400)),
              widthCm: isMermaid || isExcalidraw || isDrawio || isECharts || isMarkmap || isGraphviz || isInfographic || isPlantuml ? 15.5 : 12,
              durationMs: elapsed,
              sourceIndex,
            }
          }),
          stats: {
            totalBlocks,
            renderedBlocks,
            failedBlocks: finished ? failedBlocks : Math.max(0, totalBlocks - renderedBlocks),
            durationMs: elapsed,
          },
          warnings: [],
        }

        window.__MDV_RENDER_DONE__ = true
        window.__MDV_RENDER_RESULT__ = result
      }
    }, 50)

    return () => window.clearInterval(timer)
  }, [html, input.markdown, input.markdownFilePath, resourceHost])

  return (
    <div className="markdown-body" ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
