import { makeRendererSvgResponsive, sanitizeRendererSvg } from './rendererSvgSanitizer'

export type SimpleRenderResult =
  | { ok: true; svg: string }
  | { ok: false; code: string; message: string }

export interface SimpleNode {
  id: string
  label: string
  kind?: string
  group?: string
  description?: string
  fields?: Array<{ name: string; type?: string; flags?: string[] }>
}

export interface SimpleEdge {
  source: string
  target: string
  label?: string
}

export function escapeSvgText(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
}

export function parseJsonObject(source: string): Record<string, unknown> {
  const parsed = JSON.parse(source)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配置必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function truncateSvgText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(1, maxChars - 3))}...`
}

function estimateSvgTextWidth(value: string, fontSize: number): number {
  let width = 0
  for (const char of value) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? fontSize : fontSize * 0.56
  }
  return width
}

function rectBoundaryPoint(
  box: { x: number; y: number; w: number; h: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = target.x - cx
  const dy = target.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }

  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : (box.w / 2) / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : (box.h / 2) / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  }
}

export function finishSvg(svg: string, maxWidth = 1800): string {
  return makeRendererSvgResponsive(sanitizeRendererSvg(svg), { maxWidth })
}

export function simpleError(code: string, message: string): SimpleRenderResult {
  return { ok: false, code, message }
}

export function renderGraphSvg(input: {
  title: string
  nodes: SimpleNode[]
  edges: SimpleEdge[]
  width?: number
  nodeWidth?: number
  nodeHeight?: number
  mode?: 'grid' | 'radial' | 'erd'
}): string {
  const width = input.width ?? 1120
  const nodeWidth = input.nodeWidth ?? 180
  const baseNodeHeight = input.nodeHeight ?? 72
  const nodes = input.nodes
  const edges = input.edges
  const mode = input.mode ?? (nodes.length > 9 ? 'radial' : 'grid')
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>()

  if (mode === 'radial') {
    const centerX = width / 2
    const maxRadius = Math.max(220, width / 2 - nodeWidth / 2 - 80)
    const radius = Math.max(220, Math.min(maxRadius, nodes.length * 42))
    const centerY = 104 + radius + baseNodeHeight / 2
    nodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, nodes.length)) * Math.PI * 2
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius - nodeWidth / 2,
        y: centerY + Math.sin(angle) * radius - baseNodeHeight / 2,
        w: nodeWidth,
        h: baseNodeHeight,
      })
    })
  } else {
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(nodes.length))))
    nodes.forEach((node, index) => {
      const fieldsHeight = node.fields?.length ? Math.min(260, node.fields.length * 24 + 82) : 0
      const h = Math.max(baseNodeHeight, fieldsHeight || baseNodeHeight)
      const row = Math.floor(index / cols)
      const col = index % cols
      positions.set(node.id, {
        x: 60 + col * ((width - 120) / cols),
        y: 104 + row * 164,
        w: mode === 'erd' ? 220 : nodeWidth,
        h,
      })
    })
  }

  const maxY = Math.max(280, ...Array.from(positions.values()).map(box => box.y + box.h + 72))
  const defs = [
    '<defs>',
    '<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">',
    '<path d="M0,0 L0,6 L9,3 z" fill="#53606f"/>',
    '</marker>',
    '</defs>',
  ].join('')

  const edgeSvg = edges.map((edge) => {
    const from = positions.get(edge.source)
    const to = positions.get(edge.target)
    if (!from || !to) return ''
    const fromCenter = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
    const toCenter = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
    const start = rectBoundaryPoint(from, toCenter)
    const end = rectBoundaryPoint(to, fromCenter)
    const x1 = start.x
    const y1 = start.y
    const x2 = end.x
    const y2 = end.y
    const midX = (x1 + x2) / 2
    const midY = (y1 + y2) / 2
    const label = edge.label ? truncateSvgText(edge.label, 34) : ''
    const labelWidth = label ? estimateSvgTextWidth(label, 12) + 14 : 0
    return [
      `<path d="M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}" fill="none" stroke="#53606f" stroke-width="2" marker-end="url(#arrow)"/>`,
      label ? `<rect class="simple-edge-label-bg" x="${midX - labelWidth / 2}" y="${midY - 20}" width="${labelWidth}" height="18" rx="9" fill="#ffffff" opacity="0.9"/>` : '',
      label ? `<text x="${midX}" y="${midY - 7}" text-anchor="middle" font-size="12" fill="#3f4b5b">${escapeSvgText(label)}</text>` : '',
    ].join('')
  }).join('')

  const groups = new Map<string, Array<{ x: number; y: number; w: number; h: number }>>()
  for (const node of nodes) {
    if (!node.group) continue
    const box = positions.get(node.id)
    if (!box) continue
    groups.set(node.group, [...(groups.get(node.group) || []), box])
  }
  const groupSvg = Array.from(groups.entries()).map(([group, boxes], index) => {
    const minX = Math.min(...boxes.map(box => box.x)) - 24
    const minY = Math.min(...boxes.map(box => box.y)) - 34
    const maxX = Math.max(...boxes.map(box => box.x + box.w)) + 24
    const maxYGroup = Math.max(...boxes.map(box => box.y + box.h)) + 24
    const colors = ['#e8f2ff', '#eaf7ef', '#fff4de', '#f5edff']
    return [
      `<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxYGroup - minY}" rx="16" fill="${colors[index % colors.length]}" stroke="#ccd7e2" stroke-dasharray="6 4"/>`,
      `<text x="${minX + 14}" y="${minY + 22}" font-size="13" font-weight="700" fill="#445064">${escapeSvgText(group)}</text>`,
    ].join('')
  }).join('')

  const nodeSvg = nodes.map((node) => {
    const box = positions.get(node.id)
    if (!box) return ''
    const kind = node.kind ? `<text x="${box.x + 14}" y="${box.y + 22}" font-size="11" fill="#667085">${escapeSvgText(node.kind)}</text>` : ''
    const titleY = node.kind ? box.y + 46 : box.y + 30
    const description = node.description
      ? `<text x="${box.x + 14}" y="${titleY + 22}" font-size="12" fill="#667085">${escapeSvgText(truncateSvgText(node.description, Math.floor((box.w - 28) / 7)))}</text>`
      : ''
    const fieldStartY = node.fields?.length ? box.y + (node.kind ? 78 : 58) : 0
    const fieldSvg = node.fields?.map((field, fieldIndex) => {
      const y = fieldStartY + fieldIndex * 24
      const flags = field.flags?.length ? ` ${field.flags.join(' ')}` : ''
      const fieldText = truncateSvgText(`${field.name} ${field.type || ''}${flags}`.trim(), Math.floor((box.w - 28) / 7))
      const [fieldName, ...rest] = fieldText.split(/\s+/)
      return `<text x="${box.x + 14}" y="${y}" font-size="12" fill="#2f3947">${escapeSvgText(fieldName || '')} <tspan fill="#667085">${escapeSvgText(rest.join(' '))}</tspan></text>`
    }).join('') || ''
    const divider = node.fields?.length ? `<line x1="${box.x}" y1="${box.y + 58}" x2="${box.x + box.w}" y2="${box.y + 58}" stroke="#d9e1ea"/>` : ''
    return [
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="12" fill="#ffffff" stroke="#9fb1c3" stroke-width="1.5"/>`,
      kind,
      `<text x="${box.x + 14}" y="${titleY}" font-size="15" font-weight="700" fill="#172033">${escapeSvgText(truncateSvgText(node.label, Math.floor((box.w - 28) / 8)))}</text>`,
      description,
      divider,
      fieldSvg,
    ].join('')
  }).join('')

  const title = escapeSvgText(input.title)
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${maxY}" viewBox="0 0 ${width} ${maxY}" role="img" aria-label="${title}">`,
    defs,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<text x="40" y="48" font-size="24" font-weight="700" fill="#101828">${title}</text>`,
    groupSvg,
    edgeSvg,
    nodeSvg,
    '</svg>',
  ].join('')

  return finishSvg(svg)
}
