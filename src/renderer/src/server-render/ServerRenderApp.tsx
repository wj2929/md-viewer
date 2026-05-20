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
import { useVegaLiteChart } from '../components/charts/useVegaLiteChart'
import { useD2Chart } from '../components/charts/useD2Chart'
import { useBpmnChart } from '../components/charts/useBpmnChart'
import { useWaveDromChart } from '../components/charts/useWaveDromChart'
import { useStructurizrChart } from '../components/charts/useStructurizrChart'
import { usePlotlyChart } from '../components/charts/usePlotlyChart'
import { useDbmlChart } from '../components/charts/useDbmlChart'
import { useAntvG6Chart } from '../components/charts/useAntvG6Chart'
import { useKrokiChart } from '../components/charts/useKrokiChart'
import { createBrowserResourceHost } from '../render-core/browserResourceHost'
import { builtinRendererDefinitions } from '../renderers/builtin'
import { createRendererRegistry } from '../renderers/registry'
import { collectFencedRenderSourceLocators } from '../renderers/sourceIdentity'
import type { BrowserPageRenderResult, ServerRenderInput } from './contracts'
import '../assets/main.css'
import '../assets/markdown.css'
import '../assets/prism-theme.css'
import 'katex/dist/katex.min.css'

const rendererRegistry = createRendererRegistry(builtinRendererDefinitions)

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
    mermaid: countSelector(root, 'pre.language-mermaid') + countSelector(root, '.mermaid-wrapper') + countSelector(root, '.mermaid-error'),
    katex: countSelector(root, '.katex'),
    excalidraw: countSelector(root, 'pre.language-excalidraw') + countSelector(root, '.excalidraw-file-placeholder') + countSelector(root, '.excalidraw-wrapper') + countSelector(root, '.excalidraw-error'),
    drawio: countSelector(root, 'pre.language-drawio') + countSelector(root, '.drawio-wrapper') + countSelector(root, '.drawio-error'),
    echarts: countSelector(root, 'pre.language-echarts') + countSelector(root, '.echarts-wrapper') + countSelector(root, '.echarts-error'),
    markmap: countSelector(root, 'pre.language-markmap') + countSelector(root, '.markmap-wrapper') + countSelector(root, '.markmap-error'),
    graphviz: countSelector(root, 'pre.language-graphviz') + countSelector(root, '.graphviz-wrapper') + countSelector(root, '.graphviz-error'),
    infographic: countSelector(root, 'pre.language-infographic') + countSelector(root, '.infographic-wrapper') + countSelector(root, '.infographic-error'),
    plantuml: countSelector(root, 'pre.language-plantuml') + countSelector(root, '.plantuml-wrapper') + countSelector(root, '.plantuml-error'),
    'vega-lite': countSelector(root, 'pre.language-vega-lite') + countSelector(root, '.vega-lite-wrapper') + countSelector(root, '.vega-lite-error'),
    d2: countSelector(root, 'pre.language-d2') + countSelector(root, '.d2-wrapper') + countSelector(root, '.d2-error'),
    bpmn: countSelector(root, 'pre.language-bpmn') + countSelector(root, '.bpmn-file-placeholder') + countSelector(root, '.bpmn-wrapper') + countSelector(root, '.bpmn-error'),
    wavedrom: countSelector(root, 'pre.language-wavedrom') + countSelector(root, '.wavedrom-wrapper') + countSelector(root, '.wavedrom-error'),
    c4plantuml: countSelector(root, 'pre.language-c4plantuml') + countSelector(root, '.c4plantuml-wrapper') + countSelector(root, '.c4plantuml-error'),
    structurizr: countSelector(root, 'pre.language-structurizr') + countSelector(root, '.structurizr-wrapper') + countSelector(root, '.structurizr-error'),
    plotly: countSelector(root, 'pre.language-plotly') + countSelector(root, '.plotly-wrapper') + countSelector(root, '.plotly-error'),
    dbml: countSelector(root, 'pre.language-dbml') + countSelector(root, '.dbml-wrapper') + countSelector(root, '.dbml-error'),
    'antv-g6': countSelector(root, 'pre.language-antv-g6') + countSelector(root, '.antv-g6-wrapper') + countSelector(root, '.antv-g6-error'),
    kroki: countSelector(root, 'pre.language-kroki') + countSelector(root, '.kroki-wrapper') + countSelector(root, '.kroki-error'),
  }
}

function isRendererEnabled(input: ServerRenderInput, type: string): boolean {
  return input.enabledRenderers?.includes(type) === true
}

function renderElementType(element: Element): string {
  if (element.classList.contains('mermaid-wrapper')) return 'mermaid'
  if (element.classList.contains('excalidraw-wrapper')) return 'excalidraw'
  if (element.classList.contains('drawio-wrapper')) return 'drawio'
  if (element.classList.contains('echarts-wrapper')) return 'echarts'
  if (element.classList.contains('markmap-wrapper')) return 'markmap'
  if (element.classList.contains('graphviz-wrapper')) return 'graphviz'
  if (element.classList.contains('infographic-wrapper')) return 'infographic'
  if (element.classList.contains('plantuml-wrapper')) return 'plantuml'
  if (element.classList.contains('vega-lite-wrapper')) return 'vega-lite'
  if (element.classList.contains('d2-wrapper')) return 'd2'
  if (element.classList.contains('bpmn-wrapper')) return 'bpmn'
  if (element.classList.contains('wavedrom-wrapper')) return 'wavedrom'
  if (element.classList.contains('c4plantuml-wrapper')) return 'c4plantuml'
  if (element.classList.contains('structurizr-wrapper')) return 'structurizr'
  if (element.classList.contains('plotly-wrapper')) return 'plotly'
  if (element.classList.contains('dbml-wrapper')) return 'dbml'
  if (element.classList.contains('antv-g6-wrapper')) return 'antv-g6'
  if (element.classList.contains('kroki-wrapper')) return 'kroki'
  return 'katex'
}

function isSuccessfulRenderElement(element: Element): boolean {
  return !element.querySelector([
    '.mermaid-error',
    '.excalidraw-error',
    '.drawio-error',
    '.echarts-error',
    '.markmap-error',
    '.graphviz-error',
    '.infographic-error',
    '.plantuml-error',
    '.vega-lite-error',
    '.d2-error',
    '.bpmn-error',
    '.wavedrom-error',
    '.structurizr-error',
    '.plotly-error',
    '.dbml-error',
    '.antv-g6-error',
    '.kroki-error',
  ].join(', '))
}

function applyEnabledRendererFilter(expected: Record<string, number>, input: ServerRenderInput): Record<string, number> {
  const next = { ...expected }
  for (const type of Object.keys(next)) {
    if (!isRendererEnabled(input, type) || (type === 'kroki' && input.networkPolicy === 'blocked')) {
      next[type] = 0
    }
  }
  return next
}

function readNumberAttribute(element: Element | null, attribute: string): number | undefined {
  const raw = element?.getAttribute(attribute)
  if (raw == null || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function resolveRenderedWidthCm(rectWidth: number, rootWidth: number): number {
  const maxWidthCm = 15.5
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) return maxWidthCm
  if (!Number.isFinite(rootWidth) || rootWidth <= 0) return maxWidthCm
  return Math.max(2.8, Math.min(maxWidthCm, Math.round((rectWidth / rootWidth) * maxWidthCm * 100) / 100))
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

function replaceBpmnImageReferences(root: HTMLElement): void {
  const images = Array.from(root.querySelectorAll('img'))
  for (const img of images) {
    const src = img.getAttribute('src') || ''
    if (!/\.bpmn(?:[?#].*)?$/i.test(src)) continue

    const placeholder = document.createElement('div')
    placeholder.className = 'bpmn-file-placeholder'
    placeholder.dataset.bpmnSrc = src.split('#')[0].split('?')[0]
    placeholder.dataset.bpmnAlt = img.getAttribute('alt') || ''
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
  const sourceLocators = useMemo(
    () => collectFencedRenderSourceLocators(input.markdown, rendererRegistry),
    [input.markdown],
  )

  useEffect(() => {
    const rendered = sanitizeHtml(md.render(input.markdown))
    setHtml(rendered)
  }, [input.markdown, md])

  useEffect(() => {
    if (!rootRef.current) return
    replaceExcalidrawImageReferences(rootRef.current)
    replaceBpmnImageReferences(rootRef.current)
  }, [html])

  useMermaidChart(rootRef, html, isRendererEnabled(input, 'mermaid'))
  useDrawIOChart(rootRef, html, isRendererEnabled(input, 'drawio'))
  useEChartsChart(rootRef, html, isRendererEnabled(input, 'echarts'))
  useMarkmapChart(rootRef, html, isRendererEnabled(input, 'markmap'))
  useGraphvizChart(rootRef, html, isRendererEnabled(input, 'graphviz'))
  useInfographicChart(rootRef, html, isRendererEnabled(input, 'infographic'))
  usePlantUMLChart(rootRef, html, isRendererEnabled(input, 'plantuml') || isRendererEnabled(input, 'c4plantuml'), {
    plantuml: isRendererEnabled(input, 'plantuml'),
    c4plantuml: isRendererEnabled(input, 'c4plantuml'),
  }, input.networkPolicy !== 'blocked')
  useVegaLiteChart(rootRef, html, isRendererEnabled(input, 'vega-lite'))
  useD2Chart(rootRef, html, isRendererEnabled(input, 'd2'))
  useBpmnChart(rootRef, html, {
    markdownFilePath: input.markdownFilePath || 'index.md',
    resourceHost,
  }, isRendererEnabled(input, 'bpmn'))
  useWaveDromChart(rootRef, html, isRendererEnabled(input, 'wavedrom'))
  useStructurizrChart(rootRef, html, isRendererEnabled(input, 'structurizr'))
  usePlotlyChart(rootRef, html, isRendererEnabled(input, 'plotly'))
  useDbmlChart(rootRef, html, isRendererEnabled(input, 'dbml'))
  useAntvG6Chart(rootRef, html, isRendererEnabled(input, 'antv-g6'))
  useKrokiChart(rootRef, html, isRendererEnabled(input, 'kroki') && input.networkPolicy !== 'blocked')
  useExcalidrawChart(rootRef, html, {
    markdownFilePath: input.markdownFilePath || 'index.md',
    resourceHost,
  }, isRendererEnabled(input, 'excalidraw'))

  useEffect(() => {
    let attempts = 0
    const startedAt = Date.now()
    if (input.markdown.trim() && !html) return
    const expected = applyEnabledRendererFilter(countRenderableBlocks(rootRef.current), input)
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
      const vegaLiteCount = countSelector(root, '.vega-lite-wrapper .vega-lite-container svg')
      const d2Count = countSelector(root, '.d2-wrapper .d2-container svg')
      const bpmnCount = countSelector(root, '.bpmn-wrapper .bpmn-container svg')
      const waveDromCount = countSelector(root, '.wavedrom-wrapper .wavedrom-container svg')
      const c4PlantumlCount = countSelector(root, '.c4plantuml-wrapper .plantuml-container svg')
      const structurizrCount = countSelector(root, '.structurizr-wrapper .structurizr-container svg')
      const plotlyCount = countSelector(root, '.plotly-wrapper .plotly-container svg')
      const dbmlCount = countSelector(root, '.dbml-wrapper .dbml-container svg')
      const antvG6Count = countSelector(root, '.antv-g6-wrapper .antv-g6-container svg')
      const krokiCount = countSelector(root, '.kroki-wrapper .kroki-container svg')
      const mermaidFailed = countSelector(root, '.mermaid-error')
      const excalidrawFailed = countSelector(root, '.excalidraw-error')
      const drawioFailed = countSelector(root, '.drawio-error')
      const echartsFailed = countSelector(root, '.echarts-error')
      const markmapFailed = countSelector(root, '.markmap-error')
      const graphvizFailed = countSelector(root, '.graphviz-error')
      const infographicFailed = countSelector(root, '.infographic-error')
      const plantumlFailed = countSelector(root, '.plantuml-wrapper .plantuml-error')
      const vegaLiteFailed = countSelector(root, '.vega-lite-error')
      const d2Failed = countSelector(root, '.d2-error')
      const bpmnFailed = countSelector(root, '.bpmn-error')
      const waveDromFailed = countSelector(root, '.wavedrom-error')
      const c4PlantumlFailed = countSelector(root, '.c4plantuml-wrapper .plantuml-error, .c4plantuml-error')
      const structurizrFailed = countSelector(root, '.structurizr-error')
      const plotlyFailed = countSelector(root, '.plotly-error')
      const dbmlFailed = countSelector(root, '.dbml-error')
      const antvG6Failed = countSelector(root, '.antv-g6-error')
      const krokiFailed = countSelector(root, '.kroki-error')
      const renderedBlocks = [
        ['mermaid', mermaidCount],
        ['katex', katexCount],
        ['excalidraw', excalidrawCount],
        ['drawio', drawioCount],
        ['echarts', echartsCount],
        ['markmap', markmapCount],
        ['graphviz', graphvizCount],
        ['infographic', infographicCount],
        ['plantuml', plantumlCount],
        ['vega-lite', vegaLiteCount],
        ['d2', d2Count],
        ['bpmn', bpmnCount],
        ['wavedrom', waveDromCount],
        ['c4plantuml', c4PlantumlCount],
        ['structurizr', structurizrCount],
        ['plotly', plotlyCount],
        ['dbml', dbmlCount],
        ['antv-g6', antvG6Count],
        ['kroki', krokiCount],
      ].reduce((sum, [type, count]) => sum + (isRendererEnabled(input, String(type)) ? Number(count) : 0), 0)
      const failedBlocks = [
        ['mermaid', mermaidFailed],
        ['excalidraw', excalidrawFailed],
        ['drawio', drawioFailed],
        ['echarts', echartsFailed],
        ['markmap', markmapFailed],
        ['graphviz', graphvizFailed],
        ['infographic', infographicFailed],
        ['plantuml', plantumlFailed],
        ['vega-lite', vegaLiteFailed],
        ['d2', d2Failed],
        ['bpmn', bpmnFailed],
        ['wavedrom', waveDromFailed],
        ['c4plantuml', c4PlantumlFailed],
        ['structurizr', structurizrFailed],
        ['plotly', plotlyFailed],
        ['dbml', dbmlFailed],
        ['antv-g6', antvG6Failed],
        ['kroki', krokiFailed],
      ].reduce((sum, [type, count]) => sum + (isRendererEnabled(input, String(type)) ? Number(count) : 0), 0)
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
        && vegaLiteCount + vegaLiteFailed >= expected['vega-lite']
        && d2Count + d2Failed >= expected.d2
        && bpmnCount + bpmnFailed >= expected.bpmn
        && waveDromCount + waveDromFailed >= expected.wavedrom
        && c4PlantumlCount + c4PlantumlFailed >= expected.c4plantuml
        && structurizrCount + structurizrFailed >= expected.structurizr
        && plotlyCount + plotlyFailed >= expected.plotly
        && dbmlCount + dbmlFailed >= expected.dbml
        && antvG6Count + antvG6Failed >= expected['antv-g6']
        && krokiCount + krokiFailed >= expected.kroki
      )

      if (finished || elapsed >= timeoutMs) {
        window.clearInterval(timer)

        const rootRect = root?.getBoundingClientRect()
        const rootWidth = rootRect?.width || 0
        const result: BrowserPageRenderResult = {
          schemaVersion: '1.0',
          ok: finished && failedBlocks === 0,
          status: finished ? (failedBlocks > 0 ? 'partial' : 'success') : 'timeout',
          html: rootRef.current?.innerHTML || html,
          images: Array.from(rootRef.current?.querySelectorAll('.mermaid-wrapper, .katex, .excalidraw-wrapper, .drawio-wrapper, .echarts-wrapper, .markmap-wrapper, .graphviz-wrapper, .infographic-wrapper, .plantuml-wrapper, .vega-lite-wrapper, .d2-wrapper, .bpmn-wrapper, .wavedrom-wrapper, .c4plantuml-wrapper, .structurizr-wrapper, .plotly-wrapper, .dbml-wrapper, .antv-g6-wrapper, .kroki-wrapper') || [])
            .filter(element => isRendererEnabled(input, renderElementType(element)))
            .filter(isSuccessfulRenderElement)
            .map((element, index) => {
            const isMermaid = element.classList.contains('mermaid-wrapper')
            const isExcalidraw = element.classList.contains('excalidraw-wrapper')
            const isDrawio = element.classList.contains('drawio-wrapper')
            const isECharts = element.classList.contains('echarts-wrapper')
            const isMarkmap = element.classList.contains('markmap-wrapper')
            const isGraphviz = element.classList.contains('graphviz-wrapper')
            const isInfographic = element.classList.contains('infographic-wrapper')
            const isPlantuml = element.classList.contains('plantuml-wrapper')
            const isVegaLite = element.classList.contains('vega-lite-wrapper')
            const isD2 = element.classList.contains('d2-wrapper')
            const isBpmn = element.classList.contains('bpmn-wrapper')
            const isWaveDrom = element.classList.contains('wavedrom-wrapper')
            const isC4Plantuml = element.classList.contains('c4plantuml-wrapper')
            const isStructurizr = element.classList.contains('structurizr-wrapper')
            const isPlotly = element.classList.contains('plotly-wrapper')
            const isDbml = element.classList.contains('dbml-wrapper')
            const isAntvG6 = element.classList.contains('antv-g6-wrapper')
            const isKroki = element.classList.contains('kroki-wrapper')
            const echartsContainer = element.querySelector('.echarts-container')
            const drawioContainer = element.querySelector('.drawio-container')
            const markmapContainer = element.querySelector('.markmap-container')
            const graphvizContainer = element.querySelector('.graphviz-container')
            const infographicContainer = element.querySelector('.infographic-container')
            const plantumlContainer = element.querySelector('.plantuml-container')
            const vegaLiteContainer = element.querySelector('.vega-lite-container')
            const d2Container = element.querySelector('.d2-container')
            const bpmnContainer = element.querySelector('.bpmn-container')
            const waveDromContainer = element.querySelector('.wavedrom-container')
            const structurizrContainer = element.querySelector('.structurizr-container')
            const plotlyContainer = element.querySelector('.plotly-container')
            const dbmlContainer = element.querySelector('.dbml-container')
            const antvG6Container = element.querySelector('.antv-g6-container')
            const krokiContainer = element.querySelector('.kroki-container')
            const target = (
              isMermaid
                ? element.querySelector('svg')
                : isExcalidraw
                  ? element.querySelector('.excalidraw-container svg')
                  : isDrawio
                    ? drawioContainer
                    : isECharts
                      ? echartsContainer
                      : isMarkmap
                        ? markmapContainer?.querySelector('svg')
                        : isGraphviz
                          ? graphvizContainer
                          : isInfographic
                          ? infographicContainer?.querySelector('svg')
                          : isPlantuml
                            ? plantumlContainer?.querySelector('svg')
                            : isVegaLite
                              ? vegaLiteContainer?.querySelector('svg')
                              : isD2
                                ? d2Container?.querySelector('svg')
                                : isBpmn
                                  ? bpmnContainer?.querySelector('svg')
                                  : isWaveDrom
                                    ? waveDromContainer?.querySelector('svg')
                                    : isC4Plantuml
                                      ? plantumlContainer?.querySelector('svg')
                                      : isStructurizr
                                        ? structurizrContainer?.querySelector('svg')
                                        : isPlotly
                                          ? plotlyContainer?.querySelector('svg')
                                          : isDbml
                                            ? dbmlContainer?.querySelector('svg')
                                            : isAntvG6
                                              ? antvG6Container?.querySelector('svg')
                                              : isKroki
                                                ? krokiContainer?.querySelector('svg')
                                                : element.querySelector('.katex-html') || element
            ) as HTMLElement | SVGSVGElement | null
            const sourceIndex = isMermaid
              ? readNumberAttribute(element, 'data-mermaid-index')
              : isExcalidraw
                ? readNumberAttribute(element, 'data-excalidraw-index')
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
                          : isVegaLite
                            ? readNumberAttribute(element, 'data-vega-lite-index')
                            : isD2
                              ? readNumberAttribute(element, 'data-d2-index')
                              : isBpmn
                                ? readNumberAttribute(element, 'data-bpmn-index')
                                  : isWaveDrom
                                    ? readNumberAttribute(element, 'data-wavedrom-index')
                                    : isC4Plantuml
                                      ? readNumberAttribute(element, 'data-c4plantuml-index')
                                      : isStructurizr
                                        ? readNumberAttribute(element, 'data-structurizr-index')
                                        : isPlotly
                                          ? readNumberAttribute(element, 'data-plotly-index')
                                          : isDbml
                                            ? readNumberAttribute(element, 'data-dbml-index')
                                            : isAntvG6
                                              ? readNumberAttribute(element, 'data-antv-g6-index')
                                              : isKroki
                                                ? readNumberAttribute(element, 'data-kroki-index')
                                                : undefined
            const id = `mdv__chart__${index.toString(16).padStart(8, '0')}__`
            const rendererType = isMermaid ? 'mermaid' : isExcalidraw ? 'excalidraw' : isDrawio ? 'drawio' : isECharts ? 'echarts' : isMarkmap ? 'markmap' : isGraphviz ? 'graphviz' : isInfographic ? 'infographic' : isPlantuml ? 'plantuml' : isVegaLite ? 'vega-lite' : isD2 ? 'd2' : isBpmn ? 'bpmn' : isWaveDrom ? 'wavedrom' : isC4Plantuml ? 'c4plantuml' : isStructurizr ? 'structurizr' : isPlotly ? 'plotly' : isDbml ? 'dbml' : isAntvG6 ? 'antv-g6' : isKroki ? 'kroki' : 'katex'
            const blockId = sourceLocators.find(locator => (
              locator.rendererType === rendererType && locator.sourceIndex === sourceIndex
            ))?.blockId
            if (!isMermaid && !isExcalidraw && !isDrawio && !isECharts && !isMarkmap && !isGraphviz && !isInfographic && !isPlantuml && !isVegaLite && !isD2 && !isBpmn && !isWaveDrom && !isC4Plantuml && !isStructurizr && !isPlotly && !isDbml && !isAntvG6 && !isKroki && target instanceof HTMLElement) {
              target.style.display = 'inline-block'
              target.style.width = 'max-content'
            }
            if ((isDrawio || isGraphviz) && target instanceof HTMLElement) {
              const svg = target.querySelector('svg')
              if (svg) {
                svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
                svg.style.width = '100%'
                svg.style.height = 'auto'
                svg.style.display = 'block'
              }
            }
            target?.setAttribute('data-mdv-render-id', id)
            const rect = target?.getBoundingClientRect()
            const renderedWidthCm = resolveRenderedWidthCm(rect?.width || 0, rootWidth)
            return {
              id,
              type: rendererType,
              selector: `[data-mdv-render-id="${id}"]`,
              widthPx: Math.max(1, Math.round(rect?.width || 800)),
              heightPx: Math.max(1, Math.round(rect?.height || 400)),
              widthCm: isMermaid || isExcalidraw || isDrawio || isECharts || isMarkmap || isGraphviz || isInfographic || isPlantuml || isVegaLite || isD2 || isBpmn || isWaveDrom || isC4Plantuml || isStructurizr || isPlotly || isDbml || isAntvG6 || isKroki ? renderedWidthCm : 12,
              durationMs: elapsed,
              sourceIndex,
              ...(blockId ? { blockId } : {}),
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
  }, [html, input.markdown, input.markdownFilePath, resourceHost, sourceLocators])

  return (
    <div className="markdown-body" ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
