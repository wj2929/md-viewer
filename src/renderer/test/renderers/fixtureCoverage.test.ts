import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePlantUMLCode } from '../../src/utils/plantumlRenderer'
import { renderRestrictedSvgToSvg } from '../../src/utils/restrictedSvgRenderer'

interface FixtureExpectation {
  path: string
  fences: Record<string, number>
  bpmnRefs?: number
}

const FIXTURES: FixtureExpectation[] = [
  { path: 'e2e/fixtures/test-vega-lite.md', fences: { 'vega-lite': 50 } },
  { path: 'e2e/fixtures/test-d2.md', fences: { d2: 50 } },
  { path: 'e2e/fixtures/test-bpmn.md', fences: { bpmn: 36 }, bpmnRefs: 8 },
  { path: 'e2e/fixtures/test-wavedrom.md', fences: { wavedrom: 46 } },
  { path: 'e2e/fixtures/test-c4plantuml.md', fences: { c4: 26, c4plantuml: 24 } },
  { path: 'e2e/fixtures/test-structurizr.md', fences: { structurizr: 24 } },
  { path: 'e2e/fixtures/test-plotly.md', fences: { plotly: 24 } },
  { path: 'e2e/fixtures/test-dbml.md', fences: { dbml: 24 } },
  { path: 'e2e/fixtures/test-antv-g6.md', fences: { 'antv-g6': 24 } },
  { path: 'e2e/fixtures/test-kroki.md', fences: { nomnoml: 6, pikchr: 5, svgbob: 5, bytefield: 4, tikz: 4 } },
  {
    path: 'e2e/fixtures/test-diagram-design.md',
    fences: { d2: 16, graphviz: 21, mermaid: 17, structurizr: 9, dbml: 10, 'antv-g6': 5, drawio: 25, svg: 22, markmap: 4 },
  },
]

const REQUIRED_CASE_IDS = [
  'md-case-d2-export-task-state',
  'md-case-structurizr-data-lake-governance',
  'md-case-mermaid-gantt-export-width',
  'md-case-kroki-pikchr-timeline',
  'md-case-kroki-tikz-release-flow',
  'md-case-d2-architecture-zoned-flow',
  'md-case-graphviz-dependency-ranks-cycle',
  'md-case-mermaid-sequence-alt-refresh',
  'md-case-dbml-db-schema-row-fk',
  'md-case-svg-editorial-platform-architecture',
  'md-case-svg-architecture-tradeoff-decision-canvas',
  'md-case-svg-incident-recovery-multi-plane-storyboard',
  'md-case-svg-event-storming-domain-flow',
  'md-case-svg-service-blueprint-export-journey',
  'md-case-svg-migration-portfolio-wave-map',
  'md-case-svg-team-topology-interaction-map',
  'md-case-svg-capacity-budget-saturation-corridor',
  'md-case-svg-failure-propagation-blast-radius-overlay',
  'md-case-svg-state-data-migration-visibility-overlay',
  'md-case-svg-task-queue-worker-capacity',
  'md-case-drawio-upload-quarantine-processing',
  'md-case-graphviz-plugin-required-optional-failure',
  'md-case-graphviz-task-cancel-dependency-cleanup',
  'md-case-graphviz-search-index-publication-gates',
  'md-case-drawio-file-import-field-provenance',
  'md-case-drawio-notification-preferences-delivery',
  'md-case-drawio-rolling-upgrade-connection-drain',
  'md-case-drawio-backup-restore-validation',
  'md-case-drawio-artifact-approved-blocked-paths',
  'md-case-svg-api-allow-deny-policy-traces',
  'md-case-svg-file-service-residual-risk',
  'md-case-svg-file-sharing-permission-matrix',
  'md-case-svg-request-latency-stage-breakdown',
  'md-case-svg-service-monthly-cost-bridge',
  'md-case-svg-upload-incident-cause-evidence',
]

function readFixture(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8')
}

function countFences(markdown: string, language: string): number {
  const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...markdown.matchAll(new RegExp(`^\\s*\`\`\`${escaped}\\b`, 'gim'))].length
}

function extractCodeFences(markdown: string, language: string): string[] {
  const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^\\s*\`\`\`${escaped}\\b[^\\n]*\\n([\\s\\S]*?)^\\s*\`\`\`\\s*$`, 'gim')
  return [...markdown.matchAll(pattern)].map(match => match[1].trim())
}

function extractCaseMarkers(markdown: string): string[] {
  return [...markdown.matchAll(/<div\s+id="(md-case-[^"]+)"\s*><\/div>/gi)].map(match => match[1])
}

function extractBoundCaseMarkers(markdown: string): Array<{ id: string; language: string }> {
  return [...markdown.matchAll(/<div\s+id="(md-case-[^"]+)"\s*><\/div>[ \t]*\r?\n[ \t]*\r?\n```([a-z0-9-]+)\b/gi)]
    .map(match => ({ id: match[1], language: match[2].toLowerCase() }))
}

function extractBoundCodeFences(markdown: string, language: string): Array<{ id: string; source: string }> {
  const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    '<div\\s+id="md-case-([a-z0-9-]+)"\\s*><\\/div>\\s*^\\s*```' + escaped + '\\b[^\\n]*\\n([\\s\\S]*?)^\\s*```\\s*$',
    'gim',
  )
  return [...markdown.matchAll(pattern)].map(match => ({ id: match[1], source: match[2].trim() }))
}

function extractBpmnReferences(markdown: string): string[] {
  return [...markdown.matchAll(/!\[[^\]]*]\(([^)\n]+\.bpmn)(?:[?#][^)\n]*)?\)/gi)].map(match => match[1])
}

function assertValidXml(source: string): void {
  const doc = new DOMParser().parseFromString(source, 'application/xml')
  expect(doc.querySelector('parsererror')?.textContent ?? '').toBe('')
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

function assertBytefieldRowsFit(source: string): void {
  const boxesPerRow = Number(source.match(/^\s*\(def\s+boxes-per-row\s+(\d+)\)/m)?.[1] ?? 16)
  let usedColumns = 0

  for (const line of source.split(/\r?\n/)) {
    if (/^\s*\(next-row\b/.test(line) || /^\s*\(draw-gap\b/.test(line)) {
      usedColumns = 0
      continue
    }

    const boxMatch = line.match(/^\s*\(draw-box\b/)
    if (!boxMatch) continue

    const span = Number(line.match(/:span\s+(\d+)/)?.[1] ?? 1)
    expect(
      usedColumns + span,
      `bytefield row overflows boxes-per-row=${boxesPerRow}: ${line.trim()}`,
    ).toBeLessThanOrEqual(boxesPerRow)
    usedColumns = (usedColumns + span) % boxesPerRow
  }
}

function parseJsonFixtureBlock(source: string): Record<string, unknown> {
  return JSON.parse(source) as Record<string, unknown>
}

describe('RendererPlugin fixture coverage', () => {
  it('fixture case markers are unique, stable and bound to code fences', () => {
    const paths = [...new Set([...FIXTURES.map(fixture => fixture.path), 'e2e/fixtures/test-all-charts.md'])]
    const seen = new Map<string, string>()
    const diagramReference = readFixture('e2e/fixtures/test-diagram-design.md')

    expect(extractCaseMarkers(diagramReference), 'AI diagram reference case count').toHaveLength(129)

    for (const path of paths) {
      const markdown = readFixture(path)
      const markers = extractCaseMarkers(markdown)
      const bound = extractBoundCaseMarkers(markdown)
      expect(bound.map(item => item.id), `${path} markers must be followed by a fence`).toEqual(markers)

      for (const { id, language } of bound) {
        expect(id, `${path} case id`).toMatch(/^md-case-[a-z0-9]+(?:-[a-z0-9]+)*$/)
        expect(seen.has(id), `${id} already declared in ${seen.get(id)}`).toBe(false)
        expect(countFences(markdown, language), `${id} language ${language}`).toBeGreaterThan(0)
        seen.set(id, path)
      }
    }

    for (const id of REQUIRED_CASE_IDS) {
      expect(seen.has(id), `${id} must exist`).toBe(true)
    }
  })

  it('AI diagram reference keeps DrawIO examples as valid, explicitly laid out XML', () => {
    const blocks = extractCodeFences(readFixture('e2e/fixtures/test-diagram-design.md'), 'drawio')

    expect(blocks).toHaveLength(25)
    for (const block of blocks) {
      assertValidXml(block)
      expect(block).toContain('<mxGraphModel')
      expect(block).toContain('<mxGeometry')
      expect(block).toContain('swimlane')
      expect(block).toContain('edgeStyle=orthogonalEdgeStyle')
    }
  })

  it('AI diagram reference keeps every SVG example inside the supported static profile', () => {
    const fixture = readFixture('e2e/fixtures/test-diagram-design.md')
    const cases = extractBoundCodeFences(fixture, 'svg')
    const rendered = new Map(cases.map(({ id, source }) => [id, renderRestrictedSvgToSvg(source, id)]))

    expect(cases).toHaveLength(22)
    expect(new Set(cases.map(item => item.id)).size).toBe(cases.length)
    for (const [id, result] of rendered) {
      expect(result.ok, `${id} should render`).toBe(true)
      if (result.ok) {
        expect(result.svg).not.toContain('<style')
        expect(result.svg).not.toContain('class=')
      }
    }

    const expectations: Record<string, string[]> = {
      'svg-editorial-platform-architecture': ['svg-arrow', '<feDropShadow'],
      'svg-architecture-tradeoff-decision-canvas': ['svg-adr-ok', '<polygon', '<tspan'],
      'svg-incident-recovery-multi-plane-storyboard': ['svg-recovery-gate', '<polyline', '<ellipse'],
      'svg-event-storming-domain-flow': ['svg-es-arrow', '订单已接受', '支付最终失败', '预留已释放', '订单已取消', '<polygon'],
      'svg-service-blueprint-export-journey': ['svg-sb-handoff', '用户可见线', '<tspan'],
      'svg-migration-portfolio-wave-map': ['svg-mw-arrow', 'W0 · 先隔离', 'transform="rotate(-90 62 548)"'],
      'svg-team-topology-interaction-map': ['svg-tt-arrow', 'STREAM-ALIGNED TEAM', 'Facilitating · 有退出日期'],
      'svg-capacity-budget-saturation-corridor': ['svg-cap-warning', '900 = 800 + 100', 'ρDB = 0.80', 'EffectiveBudget = validated capacity × 80%', '100 / 110 / 120% 为本算例策略阈值', '队列是有界缓冲，不是额外吞吐'],
      'svg-failure-propagation-blast-radius-overlay': ['svg-blast-topology-clip', '共同原因分叉', 'Affected AZ failure domain', '观测映射 · 非传播边', 'Cache fallback', 'BLOCK', '51 req/s / 500 req/s', '纯重试 = 30 req/s'],
      'svg-state-data-migration-visibility-overlay': ['svg-mig-rollback', '旧 epoch 写入拒绝', 'source_cursor_applied ≥ Hc', 'source_shadow.target_cursor_applied ≥ Hr[tgt]', 'C_final gate', 'rollback exit approved', 'Reverse CDC still active', 'C_final → stop reverse CDC'],
    }
    for (const [id, tokens] of Object.entries(expectations)) {
      const result = rendered.get(id)
      expect(result, `${id} must exist`).toBeDefined()
      if (!result?.ok) continue
      for (const token of tokens) expect(result.svg, `${id} should preserve ${token}`).toContain(token)
    }
  })

  it('通用案例保留异常门禁、判定状态及明暗可读背景', () => {
    const fixture = readFixture('e2e/fixtures/test-diagram-design.md')
    const svg = new Map(extractBoundCodeFences(fixture, 'svg').map(item => [item.id, item.source]))
    expect(svg.get('svg-task-queue-worker-capacity')).toContain('等待队列 4 / 4')
    expect(svg.get('svg-task-queue-worker-capacity')).toContain('有效速率 6 任务/s')
    expect(svg.get('svg-api-allow-deny-policy-traces')).toContain('首次分歧')
    expect(svg.get('svg-api-allow-deny-policy-traces')).toContain('— 未执行')
    expect(svg.get('svg-file-sharing-permission-matrix')).toContain('? 未定义')
    expect(svg.get('svg-upload-incident-cause-evidence')).toContain('线程 · 待证')
    for (const { id, source } of extractBoundCodeFences(fixture, 'graphviz').filter(item => REQUIRED_CASE_IDS.slice(-16).includes(`md-case-${item.id}`))) {
      expect(source, id).toContain('bgcolor="#ffffff"')
    }
    const drawio = new Map(extractBoundCodeFences(fixture, 'drawio').map(item => [item.id, new DOMParser().parseFromString(item.source, 'application/xml')]))
    const blocked = drawio.get('drawio-artifact-approved-blocked-paths')!
    expect(blocked.querySelector('mxCell[source="bypass"]')?.getAttribute('target')).toBe('stop')
    expect(blocked.querySelector('mxCell[source="stop"]')).toBeNull()
    const upload = drawio.get('drawio-upload-quarantine-processing')!
    expect(upload.querySelector('mxCell[target="artifact-reject"]')).not.toBeNull()
    const restore = drawio.get('drawio-backup-restore-validation')!
    expect(restore.querySelectorAll('mxCell[target="blocked"]')).toHaveLength(2)
    expect(restore.querySelector('mxCell[source="blocked"]')).toBeNull()
    const upgrade = drawio.get('drawio-rolling-upgrade-connection-drain')!
    expect(Array.from(upgrade.querySelectorAll('mxCell[target="gate"]')).map(cell => cell.getAttribute('source')).sort()).toEqual(['empty', 'stable'])
    expect(upgrade.querySelector('mxCell[source="gate"]')?.getAttribute('target')).toBe('stop')
    expect(upgrade.querySelector('mxCell[source="empty"][target="stop"]')).toBeNull()
    const provenance = drawio.get('drawio-file-import-field-provenance')!
    expect(provenance.querySelector('mxCell[source="source-title"]')?.getAttribute('target')).toBe('fields')
    expect(provenance.querySelector('mxCell[source="source-author"]')?.getAttribute('target')).toBe('author-field')
    expect(provenance.querySelector('mxCell[source="missing"]')?.getAttribute('target')).toBe('unknown')
    expect(provenance.querySelector('mxCell[source="unknown"]')?.getAttribute('target')).toBe('draft')
    const index = extractBoundCodeFences(fixture, 'graphviz').find(item => item.id === 'graphviz-search-index-publication-gates')!.source
    expect(index).toContain('gate -> discard')
    expect(index).not.toContain('discard -> publish')
    expect(index).toContain('保持可用 g11')
  })

  it('通用架构主图保留组件连接、状态归属和独立辅助视图', () => {
    const fixture = readFixture('e2e/fixtures/test-diagram-design.md')
    const sources = new Map(['graphviz', 'drawio', 'svg'].flatMap(language =>
      extractBoundCodeFences(fixture, language).map(item => [item.id, item.source] as const),
    ))
    const mainIds = [
      'graphviz-plugin-required-optional-failure', 'graphviz-task-cancel-dependency-cleanup',
      'graphviz-search-index-publication-gates', 'drawio-upload-quarantine-processing',
      'drawio-notification-preferences-delivery', 'drawio-rolling-upgrade-connection-drain',
      'drawio-backup-restore-validation', 'drawio-artifact-approved-blocked-paths',
      'svg-task-queue-worker-capacity', 'svg-file-service-residual-risk',
    ]
    for (const id of mainIds) expect(sources.get(id), id).toContain('架构主视图')
    const auxiliary = {
      'drawio-file-import-field-provenance': '数据来源',
      'svg-api-allow-deny-policy-traces': '请求判定',
      'svg-file-sharing-permission-matrix': '授权矩阵',
      'svg-request-latency-stage-breakdown': '性能',
      'svg-service-monthly-cost-bridge': '成本',
      'svg-upload-incident-cause-evidence': '复盘',
    }
    for (const [id, role] of Object.entries(auxiliary)) expect(sources.get(id), id).toContain(`辅助·${role}`)

    const connections = {
      'drawio-upload-quarantine-processing': [['entry', 'quarantine'], ['entry', 'queue'], ['queue', 'worker'], ['worker', 'artifact'], ['worker', 'metadata'], ['metadata', 'download'], ['artifact', 'download']],
      'drawio-notification-preferences-delivery': [['preferences', 'preference-filter'], ['preference-filter', 'dispatch'], ['dispatch', 'inapp'], ['dispatch', 'sms'], ['sms', 'ledger'], ['sms', 'retry'], ['retry', 'sms']],
      'drawio-rolling-upgrade-connection-drain': [['load', 'old-1'], ['load', 'new-1'], ['policy', 'load'], ['stop', 'old-2']],
      'drawio-backup-restore-validation': [['snapshot', 'restore'], ['restore', 'database'], ['database', 'check'], ['database', 'readonly'], ['controller', 'open'], ['open', 'database']],
      'drawio-artifact-approved-blocked-paths': [['build', 'artifact'], ['artifact', 'gate'], ['gate', 'publisher'], ['publisher', 'agent'], ['agent', 'artifact'], ['agent', 'run'], ['agent', 'run-b'], ['publisher', 'audit']],
    }
    for (const [id, pairs] of Object.entries(connections)) {
      const document = new DOMParser().parseFromString(sources.get(id)!, 'application/xml')
      for (const [source, target] of pairs) {
        expect(document.querySelector(`mxCell[source="${source}"][target="${target}"]`), `${id}: ${source} → ${target}`).not.toBeNull()
      }
      // mxCodec uses an Array as its object cache; inherited names decode as functions, not cells.
      for (const cell of document.querySelectorAll('mxCell[id]')) expect(cell.getAttribute('id')! in [], `${id}: reserved codec ID`).toBe(false)
    }
    const upload = new DOMParser().parseFromString(sources.get('drawio-upload-quarantine-processing')!, 'application/xml')
    expect(upload.querySelector('mxCell[source="quarantine"][target="download"]')).toBeNull()
    const notifications = new DOMParser().parseFromString(sources.get('drawio-notification-preferences-delivery')!, 'application/xml')
    expect(notifications.querySelector('mxCell[source="dispatch"][target="email"]')).toBeNull()

    const graphConnections = {
      'graphviz-plugin-required-optional-failure': [['manager', 'preview'], ['manager', 'search'], ['core', 'preview'], ['core', 'search'], ['dictionary', 'search'], ['pdf', 'pdfPlugin']],
      'graphviz-task-cancel-dependency-cleanup': [['request', 'coordinator'], ['coordinator', 'running'], ['coordinator', 'queued'], ['resources', 'cleanup'], ['running', 'cleanup'], ['running', 'gate'], ['cleanup', 'gate'], ['gate', 'done']],
      'graphviz-search-index-publication-gates': [['content', 'build'], ['watcher', 'build'], ['build', 'candidate'], ['candidate', 'gate'], ['publish', 'current'], ['publish', 'keep'], ['query', 'current'], ['query', 'keep']],
    }
    for (const [id, pairs] of Object.entries(graphConnections)) {
      for (const [source, target] of pairs) expect(sources.get(id), `${id}: ${source} → ${target}`).toMatch(new RegExp(`\\b${source}\\s*->\\s*${target}\\b`))
    }
    const queue = new DOMParser().parseFromString(sources.get('svg-task-queue-worker-capacity')!, 'application/xml')
    for (const id of ['buffer', 'dispatcher', 'state', 'dispatch-w1', 'dispatch-w2', 'result-w1', 'result-w2', 'capacity-feedback', 'rejected']) {
      expect(queue.getElementById(`r6-queue-${id}`), id).not.toBeNull()
    }
    const risk = new DOMParser().parseFromString(sources.get('svg-file-service-residual-risk')!, 'application/xml')
    for (const id of ['isolated', 'worker', 'storage', 'detection', 'response', 'monitor-worker', 'monitor-store', 'response-control']) {
      expect(risk.getElementById(`r6-risk-${id}`), id).not.toBeNull()
    }
  })

  it('时间区间与成本累计源表和 SVG 几何使用同一比例尺', () => {
    const fixture = readFixture('e2e/fixtures/test-diagram-design.md')
    const cases = new Map(extractBoundCodeFences(fixture, 'svg').map(item => [item.id, item.source]))
    const latency = new DOMParser().parseFromString(cases.get('svg-request-latency-stage-breakdown')!, 'application/xml')
    const intervals = [...fixture.matchAll(/^\| (?:授权|读取|等待|计算|输出) \| (\d+) \| (\d+) \| (\d+) \| (?:执行|等待) \|$/gm)]
    expect(intervals).toHaveLength(5)
    let end = 0
    intervals.forEach((row, index) => {
      const [start, finish, duration] = row.slice(1).map(Number)
      expect(start).toBe(end)
      expect(finish - start).toBe(duration)
      const rect = latency.querySelector(`#r6-latency-stage-${index}`)!
      expect(Number(rect.getAttribute('x'))).toBeCloseTo(60 + start * 1.7, 3)
      expect(Number(rect.getAttribute('width'))).toBeCloseTo(duration * 1.7, 3)
      end = finish
    })
    expect(end).toBe(400)
    const cost = new DOMParser().parseFromString(cases.get('svg-service-monthly-cost-bridge')!, 'application/xml')
    const rows = [...fixture.matchAll(/^\| (?:现状|计算扩容|冷数据分层|新增工作池|规格优化|目标) \| (总量|增量) \| ([+-]?\d+) \| (\d+) \|$/gm)]
    expect(rows).toHaveLength(6)
    let accumulated = 0
    rows.forEach((row, index) => {
      const value = Number(row[2]), before = accumulated
      accumulated = row[1] === '总量' ? value : accumulated + value
      expect(accumulated).toBe(Number(row[3]))
      const rect = cost.querySelector(`#r6-cost-bar-${index}`)!
      expect(Number(rect.getAttribute('height'))).toBeCloseTo(Math.abs(value) * 400 / 30000, 2)
      expect(Number(rect.getAttribute('y'))).toBeCloseTo(560 - Math.max(row[1] === '总量' ? 0 : before, accumulated) * 400 / 30000, 2)
      if (index < 5) {
        expect(Number(cost.querySelector(`#r6-cost-carry-${index}`)!.getAttribute('y1'))).toBeCloseTo(560 - accumulated * 400 / 30000, 3)
      }
    })
    expect(accumulated).toBe(26000)
  })

  for (const fixture of FIXTURES) {
    it(`${fixture.path} includes enough independent examples`, () => {
      const markdown = readFixture(fixture.path)

      for (const [language, minimum] of Object.entries(fixture.fences)) {
        expect(countFences(markdown, language), `${fixture.path} ${language} fence count`).toBeGreaterThanOrEqual(minimum)
      }
      if (fixture.bpmnRefs) {
        const refs = extractBpmnReferences(markdown)
        expect(refs.length, `${fixture.path} .bpmn file reference count`).toBeGreaterThanOrEqual(fixture.bpmnRefs)
        for (const ref of refs) {
          const source = readFixture(`e2e/fixtures/${ref}`)
          assertValidXml(source)
        }
      }
    })
  }

  it('test-vega-lite.md keeps every example as valid Vega-Lite JSON', () => {
    const blocks = extractCodeFences(readFixture('e2e/fixtures/test-vega-lite.md'), 'vega-lite')

    expect(blocks).toHaveLength(50)
    for (const block of blocks) {
      const spec = JSON.parse(block) as {
        data?: unknown
        mark?: unknown
        encoding?: unknown
        layer?: unknown
        spec?: unknown
        hconcat?: unknown
        vconcat?: unknown
        concat?: unknown
        repeat?: unknown
      }
      expect(spec.data || spec.layer || spec.spec || spec.hconcat || spec.vconcat || spec.concat || spec.repeat, block).toBeTruthy()
      expect(spec.mark || spec.layer || spec.spec || spec.hconcat || spec.vconcat || spec.concat || spec.repeat, block).toBeTruthy()
    }
  })

  it('test-bpmn.md keeps every inline BPMN example as valid XML', () => {
    const blocks = extractCodeFences(readFixture('e2e/fixtures/test-bpmn.md'), 'bpmn')

    expect(blocks).toHaveLength(36)
    for (const block of blocks) {
      assertValidXml(block)
      const doc = new DOMParser().parseFromString(block, 'application/xml')
      expect(doc.querySelector('definitions, bpmn\\:definitions')).toBeTruthy()
      expect(doc.querySelector('process, bpmn\\:process')).toBeTruthy()
      expect(doc.querySelector('BPMNDiagram, bpmndi\\:BPMNDiagram')).toBeTruthy()
    }
  })

  it('RendererPlugin fixtures include graphviz-style complex scenarios, not only small smoke examples', () => {
    const vegaBlocks = extractCodeFences(readFixture('e2e/fixtures/test-vega-lite.md'), 'vega-lite')
    const d2Blocks = extractCodeFences(readFixture('e2e/fixtures/test-d2.md'), 'd2')
    const bpmnBlocks = extractCodeFences(readFixture('e2e/fixtures/test-bpmn.md'), 'bpmn')
    const waveBlocks = extractCodeFences(readFixture('e2e/fixtures/test-wavedrom.md'), 'wavedrom')
    const c4Blocks = [
      ...extractCodeFences(readFixture('e2e/fixtures/test-c4plantuml.md'), 'c4'),
      ...extractCodeFences(readFixture('e2e/fixtures/test-c4plantuml.md'), 'c4plantuml'),
    ]

    expect(vegaBlocks.filter(block => block.length >= 1200).length, 'Vega-Lite large specs').toBeGreaterThanOrEqual(8)
    expect(vegaBlocks.filter(block => /"transform"|"layer"|"hconcat"|"vconcat"|"repeat"|"facet"/.test(block)).length, 'Vega-Lite advanced specs').toBeGreaterThanOrEqual(30)

    expect(d2Blocks.filter(block => block.length >= 900).length, 'D2 large diagrams').toBeGreaterThanOrEqual(8)
    expect(d2Blocks.filter(block => countMatches(block, /->/g) >= 12).length, 'D2 dense edge diagrams').toBeGreaterThanOrEqual(6)
    expect(d2Blocks.filter(block => countMatches(block, /\{/g) >= 3).length, 'D2 nested container diagrams').toBeGreaterThanOrEqual(10)

    expect(bpmnBlocks.filter(block => countMatches(block, /bpmn:(?:task|userTask|serviceTask|manualTask|scriptTask|businessRuleTask|sendTask|receiveTask|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway)/g) >= 4).length, 'BPMN multi-step flows').toBeGreaterThanOrEqual(18)

    expect(waveBlocks.filter(block => countMatches(block, /name:/g) >= 7).length, 'WaveDrom dense signal diagrams').toBeGreaterThanOrEqual(12)
    expect(waveBlocks.filter(block => /wave:\s*['"][^'"]{18,}/.test(block)).length, 'WaveDrom wide timing diagrams').toBeGreaterThanOrEqual(8)
    expect(waveBlocks.filter(block => /reg:\s*\[/.test(block)).length, 'WaveDrom register diagrams').toBeGreaterThanOrEqual(8)

    expect(c4Blocks.filter(block => countMatches(block, /Rel\(/g) >= 6).length, 'C4 dense relationship diagrams').toBeGreaterThanOrEqual(16)
    expect(c4Blocks.filter(block => /Boundary|Container_Boundary|System_Boundary/.test(block)).length, 'C4 boundary diagrams').toBeGreaterThanOrEqual(25)
  })

  it('new architecture and analysis fixtures cover complex real-world scenarios', () => {
    const structurizrBlocks = extractCodeFences(readFixture('e2e/fixtures/test-structurizr.md'), 'structurizr')
    const plotlyBlocks = extractCodeFences(readFixture('e2e/fixtures/test-plotly.md'), 'plotly')
    const dbmlBlocks = extractCodeFences(readFixture('e2e/fixtures/test-dbml.md'), 'dbml')
    const g6Blocks = extractCodeFences(readFixture('e2e/fixtures/test-antv-g6.md'), 'antv-g6')
    const krokiFixture = readFixture('e2e/fixtures/test-kroki.md')
    const krokiBlocks = ['nomnoml', 'pikchr', 'svgbob', 'bytefield', 'tikz']
      .flatMap(language => extractCodeFences(krokiFixture, language))

    expect(structurizrBlocks.filter(block => countMatches(block, /container\s+"/gi) >= 4).length, 'Structurizr container-rich models').toBeGreaterThanOrEqual(8)
    expect(structurizrBlocks.filter(block => countMatches(block, /->/g) >= 6).length, 'Structurizr dense relationship models').toBeGreaterThanOrEqual(8)

    expect(plotlyBlocks.filter(block => /"scatter3d"|"heatmap"|"pie"/.test(block)).length, 'Plotly advanced chart types').toBeGreaterThanOrEqual(10)
    expect(plotlyBlocks.filter(block => countMatches(block, /"type"/g) >= 3).length, 'Plotly multi-trace dashboards').toBeGreaterThanOrEqual(6)

    expect(dbmlBlocks.filter(block => countMatches(block, /\bTable\s+/gi) >= 4).length, 'DBML multi-table schemas').toBeGreaterThanOrEqual(8)
    expect(dbmlBlocks.filter(block => countMatches(block, /\bRef\s*:/gi) + countMatches(block, /\[ref:/gi) >= 4).length, 'DBML relationship-heavy schemas').toBeGreaterThanOrEqual(8)

    expect(g6Blocks.filter(block => countMatches(block, /"comboId"/g) >= 4).length, 'AntV G6 grouped topology graphs').toBeGreaterThanOrEqual(8)
    expect(g6Blocks.filter(block => countMatches(block, /"source"/g) >= 8).length, 'AntV G6 dense edge graphs').toBeGreaterThanOrEqual(8)

    expect(krokiBlocks.filter(block => block.length >= 220).length, 'Kroki non-trivial long-tail diagrams').toBeGreaterThanOrEqual(12)
    expect(krokiBlocks.filter(block => /class|packet|box|struct|message|stack|database|queue|gateway/i.test(block)).length, 'Kroki architecture-oriented diagrams').toBeGreaterThanOrEqual(12)
  })

  it('test-antv-g6.md covers varied graph shapes instead of repeated small networks', () => {
    const g6Blocks = extractCodeFences(readFixture('e2e/fixtures/test-antv-g6.md'), 'antv-g6')
    const graphs = g6Blocks.map(parseJsonFixtureBlock)

    expect(g6Blocks).toHaveLength(24)
    expect(
      graphs.filter(graph => Array.isArray(graph.nodes) && graph.nodes.length >= 14).length,
      'AntV G6 large node-count scenarios',
    ).toBeGreaterThanOrEqual(8)
    expect(
      graphs.filter(graph => Array.isArray(graph.edges) && graph.edges.length >= 16).length,
      'AntV G6 dense relationship scenarios',
    ).toBeGreaterThanOrEqual(8)
    expect(
      g6Blocks.filter(block => countMatches(block, /"type"/g) >= 6).length,
      'AntV G6 examples with explicit node types',
    ).toBeGreaterThanOrEqual(8)
    expect(
      g6Blocks.filter(block => countMatches(block, /"description"/g) >= 6).length,
      'AntV G6 examples with node descriptions',
    ).toBeGreaterThanOrEqual(8)
    expect(
      graphs.filter(graph => Array.isArray(graph.combos) && graph.combos.length >= 4).length,
      'AntV G6 multi-group scenarios',
    ).toBeGreaterThanOrEqual(8)
  })

  it('test-kroki.md keeps bytefield and tikz examples valid for the Kroki service', () => {
    const krokiFixture = readFixture('e2e/fixtures/test-kroki.md')
    const bytefieldBlocks = extractCodeFences(krokiFixture, 'bytefield')
    const tikzBlocks = extractCodeFences(krokiFixture, 'tikz')

    expect(bytefieldBlocks).toHaveLength(4)
    for (const block of bytefieldBlocks) {
      assertBytefieldRowsFit(block)
    }

    expect(tikzBlocks).toHaveLength(4)
    for (const block of tikzBlocks) {
      expect(block, 'TikZ examples must include a complete LaTeX document for Kroki').toMatch(/\\documentclass\{/)
      expect(block, 'TikZ examples must include a complete LaTeX document for Kroki').toMatch(/\\begin\{document\}/)
      expect(block, 'TikZ examples must include a complete LaTeX document for Kroki').toMatch(/\\end\{document\}/)
    }
  })

  it('test-kroki.md keeps compact visual examples padded for readable layout', () => {
    const krokiFixture = readFixture('e2e/fixtures/test-kroki.md')
    const pikchrBlocks = extractCodeFences(krokiFixture, 'pikchr')
    const svgbobBlocks = extractCodeFences(krokiFixture, 'svgbob')
    const tikzBlocks = extractCodeFences(krokiFixture, 'tikz')

    expect(pikchrBlocks).toHaveLength(5)
    expect(
      pikchrBlocks.filter(block => /\b(?:wid|rad)\s+[0-9.]+/.test(block)).length,
      'Pikchr examples should set explicit widths/radii instead of relying on tight defaults',
    ).toBeGreaterThanOrEqual(3)

    expect(svgbobBlocks).toHaveLength(5)
    expect(
      svgbobBlocks.filter(block => /^\s*\+[+-]+\+/m.test(block)).length,
      'SvgBob examples should prefer square ASCII boxes that render as clean rects',
    ).toBe(5)
    expect(
      svgbobBlocks.filter(block => /^\s*[.'][.-]+[.']/m.test(block)).length,
      'SvgBob examples should avoid rounded ASCII boxes because Kroki renders detached caps',
    ).toBe(0)

    expect(tikzBlocks).toHaveLength(4)
    for (const block of tikzBlocks) {
      expect(block, 'TikZ nodes should leave horizontal text padding').toMatch(/inner xsep=\d+pt/)
      expect(block, 'TikZ nodes should leave vertical text padding').toMatch(/inner ysep=\d+pt/)
      expect(block, 'TikZ nodes should reserve enough box width').toMatch(/minimum width=[0-9.]+cm/)
      expect(block, 'TikZ nodes should reserve enough box height').toMatch(/minimum height=[0-9.]+cm/)
    }
  })

  it('test-c4plantuml.md c4 alias examples infer a C4 library that matches their macro level', () => {
    const c4Blocks = extractCodeFences(readFixture('e2e/fixtures/test-c4plantuml.md'), 'c4')

    expect(c4Blocks).toHaveLength(26)
    for (const block of c4Blocks) {
      const normalized = normalizePlantUMLCode(block, 'c4plantuml')

      if (/\b(?:Component|ComponentDb|ComponentQueue|Component_Ext|Component_Boundary)\s*\(/i.test(block)) {
        expect(normalized, block).toContain('!include <C4/C4_Component>')
      } else if (/\b(?:Container|ContainerDb|ContainerQueue|Container_Ext|Container_Boundary)\s*\(/i.test(block)) {
        expect(normalized, block).toContain('!include <C4/C4_Container>')
      } else {
        expect(normalized, block).toContain('!include <C4/C4_Context>')
      }
    }
  })
})
