import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { builtinRendererDefinitions } from '../../src/renderers/builtin'
import { buildRendererManifest } from '../../src/renderers/manifest'

describe('renderer manifest', () => {
  it('serializes renderer metadata without runtime functions', () => {
    const manifest = buildRendererManifest({
      version: '2.2.0',
      renderers: builtinRendererDefinitions,
    })

    expect(manifest.schemaVersion).toBe('2.0')
    expect(manifest.name).toBe('@md-viewer/server-renderer')
    expect(manifest.entryHtml).toBe('server-render.html')
    expect(manifest.assetsDir).toBe('assets')
    expect(manifest.supportedCharts).toContain('mermaid')
    expect(manifest.renderers.find(item => item.type === 'mermaid')).toMatchObject({
      type: 'mermaid',
      replacement: { strategy: 'blockId' },
    })
    expect(JSON.stringify(manifest)).not.toContain('renderToSvg')
    expect(JSON.stringify(manifest)).not.toContain('validate')
  })

  it('keeps supportedCharts aligned with renderer entries', () => {
    const manifest = buildRendererManifest({
      version: '2.2.0',
      renderers: builtinRendererDefinitions,
    })

    const manifestTypes = manifest.renderers.map(item => item.type)
    expect(manifest.supportedCharts).toEqual(manifestTypes)
  })

  it('keeps public renderer artifact manifest aligned with builtin registry', () => {
    const manifestPath = resolve(process.cwd(), 'src/renderer/public/manifest.json')
    const publicManifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ReturnType<typeof buildRendererManifest>
    const expected = buildRendererManifest({
      version: publicManifest.version,
      renderers: builtinRendererDefinitions,
      minDocxServiceVersion: publicManifest.minDocxServiceVersion,
    })

    expect(publicManifest.schemaVersion).toBe('2.0')
    expect(publicManifest.supportedCharts).toEqual(expected.supportedCharts)
    expect(publicManifest.renderers.map(renderer => renderer.type)).toEqual(expected.renderers.map(renderer => renderer.type))
  })
})
