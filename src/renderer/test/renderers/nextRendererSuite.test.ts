import { describe, expect, it, vi } from 'vitest'
import { processAntvG6InHtml, renderAntvG6ToSvg, validateAntvG6Source } from '../../src/utils/antvG6Renderer'
import { processDbmlInHtml, renderDbmlToSvg, validateDbmlSource } from '../../src/utils/dbmlRenderer'
import { processKrokiInHtml, renderKrokiToSvg, resolveKrokiFormat } from '../../src/utils/krokiRenderer'
import { processPlotlyInHtml, renderPlotlyToSvg, validatePlotlySource } from '../../src/utils/plotlyRenderer'
import { processStructurizrInHtml, renderStructurizrToSvg, validateStructurizrSource } from '../../src/utils/structurizrRenderer'

const STRUCTURIZR_DSL = `
workspace "MD Viewer" {
  model {
    user = person "用户"
    app = softwareSystem "MD Viewer" {
      renderer = container "RendererPlugin"
      export = container "Export Pipeline"
    }
    service = softwareSystem "DOCX Service"
    user -> app "预览和编辑 Markdown"
    renderer -> export "提供 SVG/PNG"
    export -> service "full fidelity DOCX"
  }
  views {
    systemContext app "context" {
      include *
      autolayout lr
    }
    container app "containers" {
      include *
      autolayout lr
    }
  }
}`

const STRUCTURIZR_DATA_LAKE_DSL = `
workspace "Data Lake Governance" {
  model {
    analyst = person "数据分析师"
    steward = person "数据管理员"
    platform = softwareSystem "Data Platform" {
      ingest = container "Ingestion API"
      catalog = container "Metadata Catalog"
      quality = container "Quality Engine"
      lineage = container "Lineage Service"
      policy = container "Policy Engine"
      notebook = container "Notebook Gateway"
    }
    lake = softwareSystem "Lakehouse" {
      bronze = container "Bronze Zone"
      silver = container "Silver Zone"
      gold = container "Gold Mart"
    }
    analyst -> notebook "查询数据"
    steward -> catalog "维护元数据"
    ingest -> bronze "写入原始数据"
    quality -> bronze "读取校验"
    quality -> silver "写入清洗数据"
    lineage -> bronze "采集血缘"
    lineage -> silver "采集血缘"
    policy -> catalog "读取分类"
    notebook -> policy "请求授权"
    notebook -> gold "执行分析"
  }
}`

const PLOTLY_SPEC = JSON.stringify({
  data: [
    { type: 'bar', name: '预览', x: ['Mermaid', 'D2', 'BPMN'], y: [18, 12, 9] },
    { type: 'scatter3d', name: '三维质量评分', x: [1, 2, 3], y: [2, 1, 3], z: [4, 2, 5], mode: 'markers+lines' },
  ],
  layout: { title: 'RendererPlugin 复杂图表', width: 760, height: 420 },
})

const DBML_SOURCE = `
Table users {
  id int [pk]
  org_id int [ref: > orgs.id]
  name varchar
}
Table orgs {
  id int [pk]
  name varchar
}
Ref: users.org_id > orgs.id
`

const G6_SOURCE = JSON.stringify({
  nodes: [
    { id: 'gateway', label: 'API Gateway', comboId: 'edge' },
    { id: 'service', label: 'Renderer Service', comboId: 'core' },
    { id: 'docx', label: 'DOCX Service', comboId: 'core' },
    { id: 'store', label: 'Artifact Store', comboId: 'data' },
  ],
  edges: [
    { source: 'gateway', target: 'service', label: 'route' },
    { source: 'service', target: 'docx', label: 'render' },
    { source: 'service', target: 'store', label: 'cache' },
  ],
  combos: [
    { id: 'edge', label: '边界层' },
    { id: 'core', label: '核心服务' },
    { id: 'data', label: '数据层' },
  ],
})

function extractTextY(svg: string, text: string): number {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = svg.match(new RegExp(`<text[^>]*\\by="([^"]+)"[^>]*>${escaped}`))
  if (!match) throw new Error(`Missing text: ${text}`)
  return Number(match[1])
}

function assertSvgRectAndTextInsideViewBox(svg: string): void {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  const viewBox = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number) || []
  expect(viewBox).toHaveLength(4)
  const [minX, minY, width, height] = viewBox
  const maxX = minX + width
  const maxY = minY + height

  for (const rect of Array.from(root.querySelectorAll('rect'))) {
    if (/%/.test(`${rect.getAttribute('width') || ''}${rect.getAttribute('height') || ''}`)) continue
    const x = Number(rect.getAttribute('x') || 0)
    const y = Number(rect.getAttribute('y') || 0)
    const rectWidth = Number(rect.getAttribute('width') || 0)
    const rectHeight = Number(rect.getAttribute('height') || 0)
    expect(x, rect.outerHTML).toBeGreaterThanOrEqual(minX)
    expect(y, rect.outerHTML).toBeGreaterThanOrEqual(minY)
    expect(x + rectWidth, rect.outerHTML).toBeLessThanOrEqual(maxX)
    expect(y + rectHeight, rect.outerHTML).toBeLessThanOrEqual(maxY)
  }

  for (const text of Array.from(root.querySelectorAll('text'))) {
    const x = Number(text.getAttribute('x') || 0)
    const y = Number(text.getAttribute('y') || 0)
    expect(x, text.outerHTML).toBeGreaterThanOrEqual(minX)
    expect(y, text.outerHTML).toBeGreaterThanOrEqual(minY)
    expect(x, text.outerHTML).toBeLessThanOrEqual(maxX)
    expect(y, text.outerHTML).toBeLessThanOrEqual(maxY)
  }
}

function assertNodeRectsDoNotOverlap(svg: string): void {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const nodeRects = Array.from(doc.documentElement.querySelectorAll('rect'))
    .filter(rect => rect.getAttribute('fill') === '#ffffff' && rect.getAttribute('stroke') === '#9fb1c3')
    .map(rect => ({
      x: Number(rect.getAttribute('x') || 0),
      y: Number(rect.getAttribute('y') || 0),
      width: Number(rect.getAttribute('width') || 0),
      height: Number(rect.getAttribute('height') || 0),
      html: rect.outerHTML,
    }))

  for (let i = 0; i < nodeRects.length; i += 1) {
    for (let j = i + 1; j < nodeRects.length; j += 1) {
      const a = nodeRects[i]
      const b = nodeRects[j]
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
      const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
      expect(overlapX * overlapY, `${a.html}\n${b.html}`).toBe(0)
    }
  }
}

describe('next renderer suite', () => {
  it('renders Structurizr DSL architecture model to SVG and exported HTML', async () => {
    expect(validateStructurizrSource(STRUCTURIZR_DSL).ok).toBe(true)

    const result = renderStructurizrToSvg(STRUCTURIZR_DSL)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('MD Viewer')
      expect(result.svg).toContain('RendererPlugin')
    }

    const html = await processStructurizrInHtml(`<pre class="language-structurizr"><code>${STRUCTURIZR_DSL}</code></pre>`)
    expect(html).toContain('structurizr-container')
    expect(html).toContain('<svg')
    expect(html).not.toContain('language-structurizr')
  })

  it('renders dense Structurizr grouped models without clipping visible nodes', () => {
    const result = renderStructurizrToSvg(STRUCTURIZR_DATA_LAKE_DSL)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.svg).toContain('Data Lake Governance')
    expect(result.svg).toContain('Gold Mart')
    expect(result.svg).toContain('Notebook Gateway')
    assertSvgRectAndTextInsideViewBox(result.svg)
    assertNodeRectsDoNotOverlap(result.svg)
  })

  it('renders Plotly JSON with bar and 3D traces to SVG', async () => {
    expect(validatePlotlySource(PLOTLY_SPEC).ok).toBe(true)

    const result = await renderPlotlyToSvg(PLOTLY_SPEC)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('RendererPlugin 复杂图表')
      expect(result.svg).toContain('三维质量评分')
    }

    const html = await processPlotlyInHtml(`<pre class="language-plotly"><code>${PLOTLY_SPEC}</code></pre>`)
    expect(html).toContain('plotly-container')
    expect(html).toContain('<svg')
  })

  it('renders DBML tables and references as ERD SVG', async () => {
    expect(validateDbmlSource(DBML_SOURCE).ok).toBe(true)

    const result = renderDbmlToSvg(DBML_SOURCE)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('users')
      expect(result.svg).toContain('orgs')
      expect(result.svg).toContain('org_id')
    }

    const html = await processDbmlInHtml(`<pre class="language-dbml"><code>${DBML_SOURCE}</code></pre>`)
    expect(html).toContain('dbml-container')
    expect(html).toContain('<svg')
  })

  it('renders DBML table fields below table names without overlapping text', () => {
    const result = renderDbmlToSvg(DBML_SOURCE)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const usersTitleY = extractTextY(result.svg, 'users')
    const usersIdFieldY = extractTextY(result.svg, 'id <tspan')
    const orgIdFieldY = extractTextY(result.svg, 'org_id <tspan')

    expect(usersIdFieldY, 'first field should leave enough vertical room below table name').toBeGreaterThan(usersTitleY + 22)
    expect(orgIdFieldY, 'second field should be below first field').toBeGreaterThan(usersIdFieldY + 18)
  })

  it('renders compact one-line DBML table definitions with all fields', () => {
    const result = renderDbmlToSvg('Table users { id int [pk] org_id int [ref: > orgs.id] name varchar }\nTable orgs { id int [pk] name varchar }')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.svg).toContain('org_id')
    expect(result.svg).toContain('name <tspan')
    expect(result.svg).toContain('org_id -&gt; id')
  })

  it('deduplicates DBML references and keeps foreign key field labels compact', () => {
    const result = renderDbmlToSvg(DBML_SOURCE)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.svg.match(/org_id -&gt; id/g)).toHaveLength(1)
    expect(result.svg).toContain('org_id <tspan')
    expect(result.svg).toContain('fk</tspan>')
    expect(result.svg).not.toContain('ref: &gt; orgs.id')
  })

  it('routes DBML relationship edges from table borders and paints a label background', () => {
    const result = renderDbmlToSvg(DBML_SOURCE)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const doc = new DOMParser().parseFromString(result.svg, 'image/svg+xml')
    const edge = doc.documentElement.querySelector('path[marker-end="url(#arrow)"]')
    expect(edge?.getAttribute('d')).toMatch(/^M2[7-9]\d,/)
    expect(result.svg).toContain('simple-edge-label-bg')
  })

  it('renders AntV G6 graph data as topology SVG', async () => {
    expect(validateAntvG6Source(G6_SOURCE).ok).toBe(true)

    const result = renderAntvG6ToSvg(G6_SOURCE)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('API Gateway')
      expect(result.svg).toContain('Renderer Service')
    }

    const html = await processAntvG6InHtml(`<pre class="language-antv-g6"><code>${G6_SOURCE}</code></pre>`)
    expect(html).toContain('antv-g6-container')
    expect(html).toContain('<svg')
  })

  it('routes Kroki aliases to explicit formats and sanitizes returned SVG', async () => {
    expect(resolveKrokiFormat('nomnoml')).toBe('nomnoml')
    expect(resolveKrokiFormat('kroki-pikchr')).toBe('pikchr')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>Kroki OK</text></svg>',
      { status: 200, headers: { 'content-type': 'image/svg+xml' } },
    ))

    const result = await renderKrokiToSvg('[A]->[B]', { language: 'nomnoml' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('Kroki OK')
      expect(result.svg).not.toContain('<script')
    }
    expect(fetchMock).toHaveBeenCalledWith('https://kroki.io/nomnoml/svg', expect.objectContaining({ method: 'POST' }))

    const html = await processKrokiInHtml('<pre class="language-kroki" data-renderer-language="nomnoml"><code>[A]-&gt;[B]</code></pre>')
    expect(html).toContain('kroki-container')
    expect(html).toContain('<svg')

    fetchMock.mockRestore()
  })

  it('uses the Electron Kroki bridge before browser fetch so preview is not blocked by CORS', async () => {
    const originalApi = window.api
    const renderKrokiSvg = vi.fn(async () => ({
      ok: true,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>Bridge Kroki OK</text></svg>',
    }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ...originalApi, renderKrokiSvg },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await renderKrokiToSvg('[A]->[B]', { language: 'nomnoml' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('Bridge Kroki OK')
      expect(result.svg).not.toContain('<script')
    }
    expect(renderKrokiSvg).toHaveBeenCalledWith({ format: 'nomnoml', source: '[A]->[B]' })
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockRestore()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi,
    })
  })
})
