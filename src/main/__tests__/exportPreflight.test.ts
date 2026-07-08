import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../cli/markdownAnalysis', () => ({ analyzeMarkdown: vi.fn() }))
vi.mock('../remoteDocxExporter', () => ({ testConnection: vi.fn() }))

import { runExportPreflight } from '../exportPreflight'
import { analyzeMarkdown } from '../cli/markdownAnalysis'
import { testConnection } from '../remoteDocxExporter'

const mockAnalyze = analyzeMarkdown as unknown as ReturnType<typeof vi.fn>
const mockPing = testConnection as unknown as ReturnType<typeof vi.fn>

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    input: 'x.md',
    summary: {},
    headings: [],
    images: [],
    links: [],
    codeBlocks: [],
    chartBlocks: [],
    ...overrides,
  }
}

describe('runExportPreflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnalyze.mockResolvedValue(analysis())
  })

  it('无风险文档 → status ok、零告警', async () => {
    const r = await runExportPreflight('# hi', 'x.md', ['html'])
    expect(r.status).toBe('ok')
    expect(r.warnings).toHaveLength(0)
    expect(r.blockedFormats).toHaveLength(0)
  })

  it('本地图片缺失 → filesystem 告警', async () => {
    mockAnalyze.mockResolvedValue(analysis({ images: [{ kind: 'local', exists: false, target: 'a.png', lineStart: 3 }] }))
    const r = await runExportPreflight('x', 'x.md', ['html'])
    expect(r.status).toBe('warning')
    expect(r.warnings[0].category).toBe('filesystem')
    expect(r.warnings[0].message).toContain('a.png')
  })

  it('链接目标缺失 → 告警', async () => {
    mockAnalyze.mockResolvedValue(analysis({ links: [{ kind: 'markdown', exists: false, target: 'b.md', lineStart: 5 }] }))
    const r = await runExportPreflight('x', 'x.md', ['html'])
    expect(r.warnings.some(w => w.message.includes('b.md'))).toBe(true)
  })

  it('标题锚点失效 → 告警', async () => {
    mockAnalyze.mockResolvedValue(analysis({ links: [{ kind: 'anchor', anchor: 'sec', anchorExists: false, target: '#sec', lineStart: 2 }] }))
    const r = await runExportPreflight('x', 'x.md', ['html'])
    expect(r.warnings.some(w => w.message.includes('sec'))).toBe(true)
  })

  it('外部服务型图表(plantuml/kroki) → chart-render 告警', async () => {
    mockAnalyze.mockResolvedValue(analysis({
      chartBlocks: [
        { type: 'plantuml', language: 'plantuml', lineStart: 1, lineEnd: 3 },
        { type: 'kroki', language: 'kroki', lineStart: 5, lineEnd: 7 },
      ],
    }))
    const r = await runExportPreflight('x', 'x.md', ['html'])
    const chartW = r.warnings.find(w => w.category === 'chart-render')
    expect(chartW).toBeTruthy()
    expect(chartW!.message).toContain('2')
  })

  it('本地渲染图表(mermaid)不触发外部依赖告警', async () => {
    mockAnalyze.mockResolvedValue(analysis({ chartBlocks: [{ type: 'mermaid', language: 'mermaid', lineStart: 1, lineEnd: 3 }] }))
    const r = await runExportPreflight('x', 'x.md', ['html'])
    expect(r.warnings.some(w => w.category === 'chart-render')).toBe(false)
  })

  it('DOCX 服务不可用(目标含 docx) → action-required + 拦 docx', async () => {
    mockPing.mockResolvedValue({ ok: false })
    const r = await runExportPreflight('x', 'x.md', ['docx'], { docxServiceUrl: 'http://127.0.0.1:3179' })
    expect(r.status).toBe('action-required')
    expect(r.blockedFormats).toContain('docx')
    expect(r.warnings.some(w => w.category === 'service-unavailable')).toBe(true)
  })

  it('DOCX 服务正常 → 不拦 docx', async () => {
    mockPing.mockResolvedValue({ ok: true })
    const r = await runExportPreflight('x', 'x.md', ['docx'], { docxServiceUrl: 'http://127.0.0.1:3179' })
    expect(r.blockedFormats).not.toContain('docx')
  })

  it('目标不含 docx → 根本不探测服务', async () => {
    await runExportPreflight('x', 'x.md', ['html'], { docxServiceUrl: 'http://127.0.0.1:3179' })
    expect(mockPing).not.toHaveBeenCalled()
  })
})
