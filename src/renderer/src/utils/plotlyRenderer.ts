import { rendererErrorHtml, serializeTemplate } from './d2Renderer'
import { asNumber, asString, clamp, escapeSvgText, finishSvg, parseJsonObject, simpleError, type SimpleRenderResult } from './simpleSvgRenderer'
import { cleanUserFacingError } from './userFacingErrors'

type PlotlyValidationResult =
  | { ok: true; spec: Record<string, unknown> }
  | { ok: false; code: 'PLOTLY_INVALID_JSON' | 'PLOTLY_INVALID_SPEC' | 'PLOTLY_EXTERNAL_DATA_BLOCKED'; message: string }

interface PlotlyTrace {
  type: string
  name: string
  x: unknown[]
  y: unknown[]
  z: unknown[]
  labels: unknown[]
  values: unknown[]
}

const MAX_PLOTLY_SOURCE_LENGTH = 256_000

function hasExternalUrl(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasExternalUrl)
  const record = value as Record<string, unknown>
  if (typeof record.url === 'string' && /^https?:\/\//i.test(record.url)) return true
  if (typeof record.src === 'string' && /^https?:\/\//i.test(record.src)) return true
  return Object.values(record).some(hasExternalUrl)
}

export function validatePlotlySource(source: string): PlotlyValidationResult {
  if (source.length > MAX_PLOTLY_SOURCE_LENGTH) {
    return { ok: false, code: 'PLOTLY_INVALID_SPEC', message: 'Plotly JSON 超过 256KB，已阻止渲染' }
  }
  let spec: Record<string, unknown>
  try {
    spec = parseJsonObject(source)
  } catch (error) {
    return { ok: false, code: 'PLOTLY_INVALID_JSON', message: cleanUserFacingError(error) }
  }
  if (hasExternalUrl(spec)) {
    return { ok: false, code: 'PLOTLY_EXTERNAL_DATA_BLOCKED', message: '已阻止 Plotly 外部 URL 数据，请使用内联 data' }
  }
  if (!Array.isArray(spec.data) || spec.data.length === 0) {
    return { ok: false, code: 'PLOTLY_INVALID_SPEC', message: 'Plotly JSON 必须包含 data 数组' }
  }
  return { ok: true, spec }
}

function readTraces(spec: Record<string, unknown>): PlotlyTrace[] {
  return (Array.isArray(spec.data) ? spec.data : []).flatMap((trace): PlotlyTrace[] => {
    if (!trace || typeof trace !== 'object') return []
    const record = trace as Record<string, unknown>
    return [{
      type: asString(record.type, 'scatter').toLowerCase(),
      name: asString(record.name, asString(record.type, 'trace')),
      x: Array.isArray(record.x) ? record.x : [],
      y: Array.isArray(record.y) ? record.y : [],
      z: Array.isArray(record.z) ? record.z : [],
      labels: Array.isArray(record.labels) ? record.labels : [],
      values: Array.isArray(record.values) ? record.values : [],
    }]
  })
}

function numeric(values: unknown[], fallbackLength = 0): number[] {
  if (values.length === 0) return Array.from({ length: fallbackLength }, (_item, index) => index + 1)
  return values.map((value, index) => typeof value === 'number' && Number.isFinite(value) ? value : index + 1)
}

function labels(values: unknown[], count: number): string[] {
  return Array.from({ length: count }, (_item, index) => asString(values[index], String(index + 1)))
}

function scale(value: number, min: number, max: number, start: number, end: number): number {
  if (max === min) return (start + end) / 2
  return start + ((value - min) / (max - min)) * (end - start)
}

function renderBarTrace(trace: PlotlyTrace, x: number, y: number, width: number, height: number, color: string): string {
  const values = numeric(trace.y)
  const names = labels(trace.x, values.length)
  const max = Math.max(1, ...values)
  const barWidth = Math.max(12, (width - 50) / Math.max(1, values.length) * 0.62)
  return [
    `<text x="${x}" y="${y - 14}" font-size="14" font-weight="700" fill="#223044">${escapeSvgText(trace.name)}</text>`,
    `<line x1="${x + 36}" y1="${y + height}" x2="${x + width}" y2="${y + height}" stroke="#d0d7e2"/>`,
    `<line x1="${x + 36}" y1="${y}" x2="${x + 36}" y2="${y + height}" stroke="#d0d7e2"/>`,
    values.map((value, index) => {
      const barHeight = (value / max) * (height - 24)
      const bx = x + 52 + index * ((width - 62) / Math.max(1, values.length))
      const by = y + height - barHeight
      return [
        `<rect x="${bx}" y="${by}" width="${barWidth}" height="${barHeight}" rx="4" fill="${color}" opacity="0.82"/>`,
        `<text x="${bx + barWidth / 2}" y="${y + height + 18}" text-anchor="middle" font-size="11" fill="#667085">${escapeSvgText(names[index]).slice(0, 10)}</text>`,
      ].join('')
    }).join(''),
  ].join('')
}

function renderScatterTrace(trace: PlotlyTrace, x: number, y: number, width: number, height: number, color: string): string {
  const xs = numeric(trace.x, trace.y.length)
  const ys = numeric(trace.y, xs.length)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const points = xs.map((value, index) => ({
    x: scale(value, minX, maxX, x + 36, x + width - 18),
    y: scale(ys[index], minY, maxY, y + height - 20, y + 10),
  }))
  return [
    `<text x="${x}" y="${y - 14}" font-size="14" font-weight="700" fill="#223044">${escapeSvgText(trace.name)}</text>`,
    `<line x1="${x + 36}" y1="${y + height}" x2="${x + width}" y2="${y + height}" stroke="#d0d7e2"/>`,
    `<line x1="${x + 36}" y1="${y}" x2="${x + 36}" y2="${y + height}" stroke="#d0d7e2"/>`,
    `<polyline points="${points.map(point => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`,
    points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`).join(''),
  ].join('')
}

function renderPieTrace(trace: PlotlyTrace, x: number, y: number, width: number, height: number): string {
  const values = numeric(trace.values.length ? trace.values : trace.y)
  const names = labels(trace.labels.length ? trace.labels : trace.x, values.length)
  const total = Math.max(1, values.reduce((sum, value) => sum + value, 0))
  const cx = x + width / 2
  const cy = y + height / 2 + 8
  const radius = Math.min(width, height) * 0.32
  let start = -Math.PI / 2
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#9a60b4']
  const slices = values.map((value, index) => {
    const angle = (value / total) * Math.PI * 2
    const end = start + angle
    const large = angle > Math.PI ? 1 : 0
    const x1 = cx + Math.cos(start) * radius
    const y1 = cy + Math.sin(start) * radius
    const x2 = cx + Math.cos(end) * radius
    const y2 = cy + Math.sin(end) * radius
    start = end
    return `<path d="M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large},1 ${x2},${y2} Z" fill="${colors[index % colors.length]}" opacity="0.86"/>`
  }).join('')
  const legend = names.slice(0, 6).map((name, index) =>
    `<text x="${x + 12}" y="${y + 28 + index * 18}" font-size="11" fill="#475467"><tspan fill="${colors[index % colors.length]}">■</tspan> ${escapeSvgText(name).slice(0, 18)}</text>`
  ).join('')
  return `<text x="${x}" y="${y - 14}" font-size="14" font-weight="700" fill="#223044">${escapeSvgText(trace.name)}</text>${slices}${legend}`
}

function renderScatter3dTrace(trace: PlotlyTrace, x: number, y: number, width: number, height: number, color: string): string {
  const xs = numeric(trace.x, trace.z.length || trace.y.length)
  const ys = numeric(trace.y, xs.length)
  const zs = numeric(trace.z, xs.length)
  const min = Math.min(...xs, ...ys, ...zs)
  const max = Math.max(...xs, ...ys, ...zs)
  const project = (px: number, py: number, pz: number): { x: number; y: number } => {
    const nx = scale(px, min, max, -1, 1)
    const ny = scale(py, min, max, -1, 1)
    const nz = scale(pz, min, max, -1, 1)
    return {
      x: x + width / 2 + (nx - ny) * width * 0.23,
      y: y + height / 2 + (nx + ny) * height * 0.12 - nz * height * 0.28,
    }
  }
  const origin = project(min, min, min)
  const axisX = project(max, min, min)
  const axisY = project(min, max, min)
  const axisZ = project(min, min, max)
  const points = xs.map((value, index) => project(value, ys[index], zs[index]))
  return [
    `<text x="${x}" y="${y - 14}" font-size="14" font-weight="700" fill="#223044">${escapeSvgText(trace.name || '3D')}</text>`,
    `<line x1="${origin.x}" y1="${origin.y}" x2="${axisX.x}" y2="${axisX.y}" stroke="#98a2b3"/><text x="${axisX.x + 4}" y="${axisX.y}" font-size="11" fill="#667085">x</text>`,
    `<line x1="${origin.x}" y1="${origin.y}" x2="${axisY.x}" y2="${axisY.y}" stroke="#98a2b3"/><text x="${axisY.x + 4}" y="${axisY.y}" font-size="11" fill="#667085">y</text>`,
    `<line x1="${origin.x}" y1="${origin.y}" x2="${axisZ.x}" y2="${axisZ.y}" stroke="#98a2b3"/><text x="${axisZ.x + 4}" y="${axisZ.y}" font-size="11" fill="#667085">z</text>`,
    `<polyline points="${points.map(point => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`,
    points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="${5 + index % 3}" fill="${color}" opacity="0.82" stroke="#fff" stroke-width="1.5"/>`).join(''),
  ].join('')
}

function renderHeatmapTrace(trace: PlotlyTrace, x: number, y: number, width: number, height: number): string {
  const rows = Array.isArray(trace.z[0]) ? trace.z as unknown[][] : [trace.z]
  const rowCount = Math.max(1, rows.length)
  const colCount = Math.max(1, Math.max(...rows.map(row => row.length)))
  const flat = rows.flat().map(value => typeof value === 'number' ? value : 0)
  const min = Math.min(...flat)
  const max = Math.max(...flat)
  const cellW = width / colCount
  const cellH = height / rowCount
  return [
    `<text x="${x}" y="${y - 14}" font-size="14" font-weight="700" fill="#223044">${escapeSvgText(trace.name || 'heatmap')}</text>`,
    rows.map((row, rowIndex) => row.map((value, colIndex) => {
      const numberValue = typeof value === 'number' ? value : 0
      const ratio = max === min ? 0.5 : (numberValue - min) / (max - min)
      const blue = Math.round(210 - ratio * 120)
      return `<rect x="${x + colIndex * cellW}" y="${y + rowIndex * cellH}" width="${cellW}" height="${cellH}" fill="rgb(84,112,${blue})" stroke="#fff"/>`
    }).join('')).join(''),
  ].join('')
}

export async function renderPlotlyToSvg(source: string): Promise<SimpleRenderResult> {
  const validation = validatePlotlySource(source)
  if (!validation.ok) return validation

  try {
    const spec = validation.spec
    const layout = (spec.layout && typeof spec.layout === 'object' && !Array.isArray(spec.layout)) ? spec.layout as Record<string, unknown> : {}
    const width = clamp(asNumber(layout.width, 980), 520, 1800)
    const height = clamp(asNumber(layout.height, 520), 360, 1200)
    const title = asString(typeof layout.title === 'object' && layout.title ? (layout.title as Record<string, unknown>).text : layout.title, 'Plotly Chart')
    const traces = readTraces(spec).slice(0, 8)
    if (traces.length === 0) return simpleError('PLOTLY_INVALID_SPEC', '未找到可渲染 Plotly trace')

    const cols = traces.length === 1 ? 1 : 2
    const rows = Math.ceil(traces.length / cols)
    const panelW = (width - 80 - (cols - 1) * 28) / cols
    const panelH = (height - 104 - (rows - 1) * 36) / rows
    const colors = ['#5470c6', '#91cc75', '#ee6666', '#fac858', '#73c0de', '#9a60b4', '#ea7ccc']
    const panels = traces.map((trace, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = 40 + col * (panelW + 28)
      const y = 88 + row * (panelH + 36)
      const color = colors[index % colors.length]
      const frame = `<rect x="${x}" y="${y}" width="${panelW}" height="${panelH}" rx="10" fill="#fbfcfe" stroke="#e4e7ec"/>`
      if (trace.type === 'bar') return frame + renderBarTrace(trace, x + 18, y + 40, panelW - 36, panelH - 72, color)
      if (trace.type === 'pie') return frame + renderPieTrace(trace, x + 18, y + 40, panelW - 36, panelH - 72)
      if (trace.type === 'heatmap') return frame + renderHeatmapTrace(trace, x + 28, y + 48, panelW - 56, panelH - 76)
      if (trace.type === 'scatter3d') return frame + renderScatter3dTrace(trace, x + 18, y + 44, panelW - 36, panelH - 74, color)
      return frame + renderScatterTrace(trace, x + 18, y + 40, panelW - 36, panelH - 72, color)
    }).join('')

    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvgText(title)}">`,
      '<rect width="100%" height="100%" fill="#ffffff"/>',
      `<text x="40" y="46" font-size="24" font-weight="700" fill="#101828">${escapeSvgText(title)}</text>`,
      panels,
      '</svg>',
    ].join('')

    return { ok: true, svg: finishSvg(svg, 1800) }
  } catch (error) {
    return simpleError('PLOTLY_RENDER_FAILED', cleanUserFacingError(error))
  }
}

export async function processPlotlyInHtml(html: string): Promise<string> {
  if (!/\blanguage-plotly\b/i.test(html)) return html

  const template = document.createElement('template')
  template.innerHTML = html
  const blocks = Array.from(template.content.querySelectorAll('pre.language-plotly'))

  for (const block of blocks) {
    const source = block.textContent || ''
    const result = await renderPlotlyToSvg(source)
    const wrapper = document.createElement('div')
    wrapper.className = result.ok ? 'plotly-wrapper' : 'plotly-error'
    wrapper.setAttribute('role', result.ok ? 'group' : 'alert')
    wrapper.innerHTML = result.ok
      ? `<div class="plotly-container">${result.svg}</div>`
      : rendererErrorHtml('Plotly 渲染失败', result.message, 'plotly-error')
    block.replaceWith(wrapper)
  }

  return serializeTemplate(template)
}
