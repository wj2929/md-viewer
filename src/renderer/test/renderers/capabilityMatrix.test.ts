import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { builtinRendererDefinitions } from '../../src/renderers/builtin'
import { buildRendererManifest } from '../../src/renderers/manifest'
import type { RendererDefinition, RendererTarget } from '../../src/renderers/types'

const TARGETS: RendererTarget[] = ['preview', 'html', 'pdf', 'docxClient', 'serverRender', 'docxService']

interface CapabilityMatrixRow {
  type: string
  displayName: string
  languages: string[]
  aliases: string[]
  sourceKinds: string[]
  networkPolicy: string
  fallbackPolicy: string
  states: Record<RendererTarget, string>
  exportSupport: {
    preview: string
    html: string
    pdf: string
    docxClient: string
    serverRender: string
    docxService: string
  }
}

function createRow(renderer: RendererDefinition): CapabilityMatrixRow {
  const states = Object.fromEntries(
    TARGETS.map(target => [target, renderer.capabilities[target]?.state ?? 'missing'])
  ) as Record<RendererTarget, string>

  return {
    type: renderer.type,
    displayName: renderer.displayName,
    languages: renderer.languages,
    aliases: renderer.aliases,
    sourceKinds: renderer.sourceKinds,
    networkPolicy: renderer.networkPolicy,
    fallbackPolicy: renderer.fallbackPolicy,
    states,
    exportSupport: {
      preview: states.preview,
      html: states.html,
      pdf: states.pdf,
      docxClient: states.docxClient,
      serverRender: states.serverRender,
      docxService: states.docxService,
    },
  }
}

describe('renderer capability matrix', () => {
  it('writes a human-auditable matrix and keeps capabilities complete', () => {
    const manifest = buildRendererManifest({
      version: '2.3.0',
      renderers: builtinRendererDefinitions,
    })
    const matrix = builtinRendererDefinitions.map(createRow)
    const outputDir = resolve(
      process.env.MD_VIEWER_TEST_RESULTS_DIR ?? tmpdir(),
      'md-viewer-renderer-capability-matrix',
    )
    const outputPath = resolve(outputDir, 'summary.json')

    mkdirSync(outputDir, { recursive: true })
    writeFileSync(outputPath, JSON.stringify({
      generatedBy: 'src/renderer/test/renderers/capabilityMatrix.test.ts',
      targets: TARGETS,
      rendererCount: matrix.length,
      renderers: matrix,
    }, null, 2))

    expect(matrix).toHaveLength(manifest.renderers.length)
    expect(matrix.map(row => row.type)).toEqual(manifest.supportedCharts)

    for (const row of matrix) {
      expect(row.displayName, `${row.type} displayName`).toBeTruthy()
      expect(row.sourceKinds.length, `${row.type} sourceKinds`).toBeGreaterThan(0)
      expect(Object.keys(row.states).sort(), `${row.type} targets`).toEqual([...TARGETS].sort())
      expect(Object.values(row.states), `${row.type} capability states`).not.toContain('missing')
    }
  })
})
