import type { RendererDefinition } from './types'

export interface RendererManifest {
  schemaVersion: '2.0'
  name: '@md-viewer/server-renderer'
  version: string
  entryHtml: 'server-render.html'
  assetsDir: 'assets'
  supportedCharts: string[]
  minDocxServiceVersion: string
  renderers: RendererDefinition[]
}

export interface BuildRendererManifestOptions {
  version: string
  renderers: RendererDefinition[]
  minDocxServiceVersion?: string
}

export function buildRendererManifest(options: BuildRendererManifestOptions): RendererManifest {
  const renderers = options.renderers.map(renderer => ({
    ...renderer,
    aliases: [...renderer.aliases],
    languages: [...renderer.languages],
    sourceKinds: [...renderer.sourceKinds],
    capabilities: { ...renderer.capabilities },
    sanitizePolicy: {
      classes: [...renderer.sanitizePolicy.classes],
      attributes: [...renderer.sanitizePolicy.attributes],
      ...(renderer.sanitizePolicy.tags ? { tags: [...renderer.sanitizePolicy.tags] } : {}),
    },
    replacement: {
      ...renderer.replacement,
      ...(renderer.replacement.fileExtensions ? { fileExtensions: [...renderer.replacement.fileExtensions] } : {}),
    },
    selectors: { ...renderer.selectors },
  }))

  return {
    schemaVersion: '2.0',
    name: '@md-viewer/server-renderer',
    version: options.version,
    entryHtml: 'server-render.html',
    assetsDir: 'assets',
    supportedCharts: renderers.map(renderer => renderer.type),
    minDocxServiceVersion: options.minDocxServiceVersion ?? '0.2.0',
    renderers,
  }
}
