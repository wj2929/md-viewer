import { rendererErrorHtml, serializeTemplate } from './d2Renderer'
import { asString, parseJsonObject, renderGraphSvg, simpleError, type SimpleEdge, type SimpleNode, type SimpleRenderResult } from './simpleSvgRenderer'
import { cleanUserFacingError } from './userFacingErrors'

type AntvG6ValidationResult =
  | { ok: true; graph: Record<string, unknown> }
  | { ok: false; code: 'ANTV_G6_INVALID_JSON' | 'ANTV_G6_INVALID_GRAPH' | 'ANTV_G6_EXTERNAL_DATA_BLOCKED'; message: string }

const MAX_G6_SOURCE_LENGTH = 192_000

function hasExternalUrl(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasExternalUrl)
  const record = value as Record<string, unknown>
  if (typeof record.url === 'string' && /^https?:\/\//i.test(record.url)) return true
  return Object.values(record).some(hasExternalUrl)
}

export function validateAntvG6Source(source: string): AntvG6ValidationResult {
  if (source.length > MAX_G6_SOURCE_LENGTH) {
    return { ok: false, code: 'ANTV_G6_INVALID_GRAPH', message: 'AntV G6 图数据超过 192KB，已阻止渲染' }
  }
  let graph: Record<string, unknown>
  try {
    graph = parseJsonObject(source)
  } catch (error) {
    return { ok: false, code: 'ANTV_G6_INVALID_JSON', message: cleanUserFacingError(error) }
  }
  if (hasExternalUrl(graph)) {
    return { ok: false, code: 'ANTV_G6_EXTERNAL_DATA_BLOCKED', message: '已阻止 AntV G6 外部 URL 数据，请使用内联 nodes/edges' }
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return { ok: false, code: 'ANTV_G6_INVALID_GRAPH', message: 'AntV G6 JSON 必须包含 nodes 数组' }
  }
  return { ok: true, graph }
}

function graphToSimpleGraph(graph: Record<string, unknown>): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
  const combos = new Map<string, string>()
  for (const combo of Array.isArray(graph.combos) ? graph.combos : []) {
    if (!combo || typeof combo !== 'object') continue
    const record = combo as Record<string, unknown>
    const id = asString(record.id)
    if (id) combos.set(id, asString(record.label, id))
  }

  const nodes: SimpleNode[] = (Array.isArray(graph.nodes) ? graph.nodes : []).flatMap((node): SimpleNode[] => {
    if (!node || typeof node !== 'object') return []
    const record = node as Record<string, unknown>
    const id = asString(record.id)
    if (!id) return []
    const label = asString(record.label, id)
    const comboId = asString(record.comboId)
    return [{
      id,
      label,
      kind: asString(record.type, 'Node'),
      group: comboId ? combos.get(comboId) || comboId : undefined,
      description: asString(record.description),
    }]
  })

  const edges: SimpleEdge[] = (Array.isArray(graph.edges) ? graph.edges : []).flatMap((edge): SimpleEdge[] => {
    if (!edge || typeof edge !== 'object') return []
    const record = edge as Record<string, unknown>
    const source = asString(record.source)
    const target = asString(record.target)
    if (!source || !target) return []
    return [{ source, target, label: asString(record.label) || undefined }]
  })

  return { nodes, edges }
}

export function renderAntvG6ToSvg(source: string): SimpleRenderResult {
  const validation = validateAntvG6Source(source)
  if (!validation.ok) return validation

  try {
    const graph = graphToSimpleGraph(validation.graph)
    if (graph.nodes.length === 0) return simpleError('ANTV_G6_INVALID_GRAPH', '未解析到 AntV G6 nodes')
    return {
      ok: true,
      svg: renderGraphSvg({
        title: asString(validation.graph.title, 'AntV G6 Topology'),
        nodes: graph.nodes,
        edges: graph.edges,
        width: 1220,
        nodeWidth: 190,
        nodeHeight: 76,
        mode: graph.nodes.length > 8 ? 'radial' : 'grid',
      }),
    }
  } catch (error) {
    return simpleError('ANTV_G6_RENDER_FAILED', cleanUserFacingError(error))
  }
}

export async function processAntvG6InHtml(html: string): Promise<string> {
  if (!/\blanguage-antv-g6\b/i.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const blocks = Array.from(template.content.querySelectorAll('pre.language-antv-g6'))

  for (const block of blocks) {
    const source = block.textContent || ''
    const result = renderAntvG6ToSvg(source)
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'antv-g6-wrapper' : 'antv-g6-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.innerHTML = result.ok
      ? `<div class="antv-g6-container">${result.svg}</div>`
      : rendererErrorHtml('AntV G6 渲染失败', result.message, 'antv-g6-error')
    block.replaceWith(wrapper)
  }

  return serializeTemplate(template)
}
