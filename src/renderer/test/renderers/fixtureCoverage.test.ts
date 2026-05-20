import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePlantUMLCode } from '../../src/utils/plantumlRenderer'

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
