import { rendererErrorHtml, serializeTemplate } from './d2Renderer'
import { renderGraphSvg, simpleError, type SimpleEdge, type SimpleNode, type SimpleRenderResult } from './simpleSvgRenderer'
import { cleanUserFacingError } from './userFacingErrors'

type StructurizrValidationResult =
  | { ok: true; source: string }
  | { ok: false; code: 'STRUCTURIZR_EMPTY_SOURCE' | 'STRUCTURIZR_SOURCE_TOO_LARGE' | 'STRUCTURIZR_NO_MODEL'; message: string }

const MAX_STRUCTURIZR_SOURCE_LENGTH = 128_000

export function validateStructurizrSource(source: string): StructurizrValidationResult {
  const trimmed = source.trim()
  if (!trimmed) return { ok: false, code: 'STRUCTURIZR_EMPTY_SOURCE', message: 'Structurizr DSL 内容为空' }
  if (source.length > MAX_STRUCTURIZR_SOURCE_LENGTH) {
    return { ok: false, code: 'STRUCTURIZR_SOURCE_TOO_LARGE', message: 'Structurizr DSL 内容超过 128KB，已阻止渲染' }
  }
  if (!/\bworkspace\b/i.test(source) && !/\b(person|softwareSystem|container|component)\b/i.test(source)) {
    return { ok: false, code: 'STRUCTURIZR_NO_MODEL', message: '未找到 Structurizr workspace/model 元素' }
  }
  return { ok: true, source: trimmed }
}

function extractWorkspaceTitle(source: string): string {
  return source.match(/\bworkspace\s+"([^"]+)"/i)?.[1] || 'Structurizr Architecture'
}

function normalizeKind(kind: string): string {
  const map: Record<string, string> = {
    person: 'Person',
    softwaresystem: 'Software System',
    container: 'Container',
    component: 'Component',
    deploymentnode: 'Deployment Node',
    database: 'Database',
    queue: 'Queue',
  }
  return map[kind.toLowerCase()] || kind
}

function parseStructurizr(source: string): { title: string; nodes: SimpleNode[]; edges: SimpleEdge[] } {
  const title = extractWorkspaceTitle(source)
  const nodes = new Map<string, SimpleNode>()
  const edges: SimpleEdge[] = []
  const lines = source.split('\n')
  const containerStack: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.replace(/\/\/.*$/, '').trim()
    if (!line) continue

    const closes = (line.match(/}/g) || []).length
    for (let i = 0; i < closes; i += 1) containerStack.pop()

    const assignment = line.match(/^([A-Za-z_][\w.-]*)\s*=\s*(person|softwareSystem|container|component|deploymentNode|database|queue)\s+"([^"]+)"(?:\s+"([^"]+)")?/i)
    const inline = line.match(/^(person|softwareSystem|container|component|deploymentNode|database|queue)\s+([A-Za-z_][\w.-]*)?\s*"([^"]+)"(?:\s+"([^"]+)")?/i)
    const match = assignment || inline
    if (match) {
      const id = assignment ? match[1] : (match[2] || match[3].toLowerCase().replace(/[^\w]+/g, '-'))
      const kind = assignment ? match[2] : match[1]
      const label = assignment ? match[3] : match[3]
      const description = assignment ? match[4] : match[4]
      const group = containerStack[containerStack.length - 1]
      nodes.set(id, {
        id,
        label,
        kind: normalizeKind(kind),
        group: group && group !== id ? nodes.get(group)?.label || group : undefined,
        description,
      })
      if (line.includes('{')) containerStack.push(id)
      continue
    }

    const rel = line.match(/^([A-Za-z_][\w.-]*)\s*->\s*([A-Za-z_][\w.-]*)\s*"([^"]*)"?/i)
    if (rel) {
      edges.push({ source: rel[1], target: rel[2], label: rel[3] || undefined })
    }
  }

  return { title, nodes: Array.from(nodes.values()), edges }
}

export function renderStructurizrToSvg(source: string): SimpleRenderResult {
  const validation = validateStructurizrSource(source)
  if (!validation.ok) return validation

  try {
    const parsed = parseStructurizr(validation.source)
    if (parsed.nodes.length === 0) {
      return simpleError('STRUCTURIZR_NO_MODEL', '未解析到 person/softwareSystem/container/component 元素')
    }
    const width = Math.min(1800, Math.max(1180, parsed.nodes.length * 120))
    return {
      ok: true,
      svg: renderGraphSvg({
        title: parsed.title,
        nodes: parsed.nodes,
        edges: parsed.edges,
        width,
        nodeWidth: 210,
        nodeHeight: 82,
      }),
    }
  } catch (error) {
    return simpleError('STRUCTURIZR_RENDER_FAILED', cleanUserFacingError(error))
  }
}

export async function processStructurizrInHtml(html: string): Promise<string> {
  if (!/\blanguage-structurizr\b/i.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const blocks = Array.from(template.content.querySelectorAll('pre.language-structurizr'))

  for (const block of blocks) {
    const source = block.textContent || ''
    const result = renderStructurizrToSvg(source)
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'structurizr-wrapper' : 'structurizr-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.innerHTML = result.ok
      ? `<div class="structurizr-container">${result.svg}</div>`
      : rendererErrorHtml('Structurizr 渲染失败', result.message, 'structurizr-error')
    block.replaceWith(wrapper)
  }

  return serializeTemplate(template)
}
