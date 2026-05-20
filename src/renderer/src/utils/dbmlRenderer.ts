import { rendererErrorHtml, serializeTemplate } from './d2Renderer'
import { renderGraphSvg, simpleError, type SimpleEdge, type SimpleNode, type SimpleRenderResult } from './simpleSvgRenderer'
import { cleanUserFacingError } from './userFacingErrors'

type DbmlValidationResult =
  | { ok: true; source: string }
  | { ok: false; code: 'DBML_EMPTY_SOURCE' | 'DBML_SOURCE_TOO_LARGE' | 'DBML_NO_TABLE'; message: string }

const MAX_DBML_SOURCE_LENGTH = 128_000

export function validateDbmlSource(source: string): DbmlValidationResult {
  const trimmed = source.trim()
  if (!trimmed) return { ok: false, code: 'DBML_EMPTY_SOURCE', message: 'DBML 内容为空' }
  if (source.length > MAX_DBML_SOURCE_LENGTH) return { ok: false, code: 'DBML_SOURCE_TOO_LARGE', message: 'DBML 内容超过 128KB，已阻止渲染' }
  if (!/\bTable\s+/i.test(source)) return { ok: false, code: 'DBML_NO_TABLE', message: '未找到 DBML Table 定义' }
  return { ok: true, source: trimmed }
}

function cleanIdentifier(value: string): string {
  return value.trim().replace(/^"|"$/g, '').replace(/`/g, '')
}

function parseDbml(source: string): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
  const nodes: SimpleNode[] = []
  const edges: SimpleEdge[] = []
  const seenEdges = new Set<string>()
  const addEdge = (edge: SimpleEdge): void => {
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.label || ''}`
    if (seenEdges.has(key)) return
    seenEdges.add(key)
    edges.push(edge)
  }
  const tableRe = /\bTable\s+("[^"]+"|`[^`]+`|[\w.]+)(?:\s+as\s+\w+)?\s*\{([\s\S]*?)\n?\s*}/gim
  let tableMatch: RegExpExecArray | null

  while ((tableMatch = tableRe.exec(source)) !== null) {
    const tableName = cleanIdentifier(tableMatch[1])
    const body = tableMatch[2]
    const fields: SimpleNode['fields'] = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//') || /^(indexes|note:)/i.test(line) || line === '{' || line === '}') continue
      const fieldPattern = /("[^"]+"|`[^`]+`|[\w.]+)\s+([A-Za-z][\w()<>.,]*)?(?:\s+\[([^\]]+)])?/g
      let fieldMatch: RegExpExecArray | null
      while ((fieldMatch = fieldPattern.exec(line)) !== null) {
        const name = cleanIdentifier(fieldMatch[1])
        const type = fieldMatch[2] || ''
        const attrs = fieldMatch[3] || ''
        if (!name || /^(table|ref|indexes|note)$/i.test(name)) continue
        const flags = attrs.split(',')
          .map(item => item.trim())
          .flatMap((item) => {
            if (/^pk$/i.test(item)) return ['pk']
            if (/^unique$/i.test(item)) return ['unique']
            if (/^not null$/i.test(item)) return ['not null']
            if (/^ref:/i.test(item)) return ['fk']
            return []
          })
        fields.push({ name, type, flags })
        const inlineRef = attrs.match(/ref:\s*[<>-]+\s*([\w.]+)\.([\w.]+)/i)
        if (inlineRef) addEdge({ source: tableName, target: inlineRef[1], label: `${name} -> ${inlineRef[2]}` })
      }
    }
    nodes.push({ id: tableName, label: tableName, kind: 'Table', fields })
  }

  const refRe = /\bRef\s*:\s*([\w.]+)\.([\w.]+)\s*[<>-]+\s*([\w.]+)\.([\w.]+)/gi
  let refMatch: RegExpExecArray | null
  while ((refMatch = refRe.exec(source)) !== null) {
    addEdge({ source: refMatch[1], target: refMatch[3], label: `${refMatch[2]} -> ${refMatch[4]}` })
  }

  return { nodes, edges }
}

export function renderDbmlToSvg(source: string): SimpleRenderResult {
  const validation = validateDbmlSource(source)
  if (!validation.ok) return validation

  try {
    const parsed = parseDbml(validation.source)
    if (parsed.nodes.length === 0) return simpleError('DBML_NO_TABLE', '未解析到 DBML Table 定义')
    return {
      ok: true,
      svg: renderGraphSvg({
        title: 'Database ERD',
        nodes: parsed.nodes,
        edges: parsed.edges,
        width: 1180,
        nodeWidth: 230,
        nodeHeight: 118,
        mode: 'erd',
      }),
    }
  } catch (error) {
    return simpleError('DBML_RENDER_FAILED', cleanUserFacingError(error))
  }
}

export async function processDbmlInHtml(html: string): Promise<string> {
  if (!/\blanguage-dbml\b/i.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const blocks = Array.from(template.content.querySelectorAll('pre.language-dbml'))

  for (const block of blocks) {
    const source = block.textContent || ''
    const result = renderDbmlToSvg(source)
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'dbml-wrapper' : 'dbml-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.innerHTML = result.ok
      ? `<div class="dbml-container">${result.svg}</div>`
      : rendererErrorHtml('DBML 渲染失败', result.message, 'dbml-error')
    block.replaceWith(wrapper)
  }

  return serializeTemplate(template)
}
