// @ts-nocheck
import { describe, expect, it, vi } from 'vitest'
import { buildExportHtmlContent } from '../../src/utils/exportHtml'

vi.mock('../../src/utils/markdownRenderer', () => ({
  createMarkdownRenderer: () => ({
    render: (markdown: string) => markdown,
  }),
}))

vi.mock('../../src/utils/mermaidRenderer', () => ({ processMermaidInHtml: (html: string) => Promise.resolve(html) }))
vi.mock('../../src/utils/echartsRenderer', () => ({ processEChartsInHtml: (html: string) => Promise.resolve(html) }))
vi.mock('../../src/utils/infographicRenderer', () => ({ processInfographicInHtml: (html: string) => Promise.resolve(html) }))
vi.mock('../../src/utils/markmapRenderer', () => ({ processMarkmapInHtml: (html: string) => Promise.resolve(html) }))
vi.mock('../../src/utils/graphvizRenderer', () => ({ processGraphvizInHtml: (html: string) => Promise.resolve(html) }))
vi.mock('../../src/utils/excalidrawRenderer', () => ({ renderExcalidrawToSvg: vi.fn() }))
vi.mock('../../src/utils/drawioRenderer', () => ({ processDrawioInHtml: (html: string) => Promise.resolve(html) }))
vi.mock('../../src/utils/plantumlRenderer', () => ({ processPlantUMLInHtml: (html: string) => Promise.resolve(html) }))
vi.mock('../../src/utils/vegaLiteRenderer', () => ({
  processVegaLiteInHtml: (html: string) => Promise.resolve(html.replace('language-vega-lite', 'vega-lite-container')),
}))
vi.mock('../../src/utils/d2Renderer', () => ({
  processD2InHtml: (html: string) => Promise.resolve(html.replace('language-d2', 'd2-container')),
}))
vi.mock('../../src/utils/bpmnRenderer', () => ({
  processBpmnInHtml: (html: string) => Promise.resolve(html.replace('language-bpmn', 'bpmn-container')),
}))
vi.mock('../../src/utils/wavedromRenderer', () => ({
  processWaveDromInHtml: (html: string) => Promise.resolve(html.replace('language-wavedrom', 'wavedrom-container')),
}))
vi.mock('../../src/utils/structurizrRenderer', () => ({
  processStructurizrInHtml: (html: string) => Promise.resolve(html.replace('language-structurizr', 'structurizr-container')),
}))
vi.mock('../../src/utils/plotlyRenderer', () => ({
  processPlotlyInHtml: (html: string) => Promise.resolve(html.replace('language-plotly', 'plotly-container')),
}))
vi.mock('../../src/utils/dbmlRenderer', () => ({
  processDbmlInHtml: (html: string) => Promise.resolve(html.replace('language-dbml', 'dbml-container')),
}))
vi.mock('../../src/utils/antvG6Renderer', () => ({
  processAntvG6InHtml: (html: string) => Promise.resolve(html.replace('language-antv-g6', 'antv-g6-container')),
}))
vi.mock('../../src/utils/krokiRenderer', () => ({
  processKrokiInHtml: (html: string) => Promise.resolve(html.replace('language-kroki', 'kroki-container')),
}))

describe('buildExportHtmlContent renderer plugins', () => {
  it('passes new renderer plugin blocks through the export pipeline', async () => {
    const html = [
      '<pre class="language-vega-lite"><code>{}</code></pre>',
      '<pre class="language-d2"><code>a -> b</code></pre>',
      '<pre class="language-bpmn"><code>&lt;definitions /&gt;</code></pre>',
      '<pre class="language-wavedrom"><code>{ signal: [] }</code></pre>',
      '<pre class="language-structurizr"><code>workspace "x" {}</code></pre>',
      '<pre class="language-plotly"><code>{"data":[]}</code></pre>',
      '<pre class="language-dbml"><code>Table users { id int }</code></pre>',
      '<pre class="language-antv-g6"><code>{"nodes":[]}</code></pre>',
      '<pre class="language-kroki"><code>[A]-&gt;[B]</code></pre>',
    ].join('\n')

    const result = await buildExportHtmlContent(html)

    expect(result).toContain('vega-lite-container')
    expect(result).toContain('d2-container')
    expect(result).toContain('bpmn-container')
    expect(result).toContain('wavedrom-container')
    expect(result).toContain('structurizr-container')
    expect(result).toContain('plotly-container')
    expect(result).toContain('dbml-container')
    expect(result).toContain('antv-g6-container')
    expect(result).toContain('kroki-container')
  })
})
