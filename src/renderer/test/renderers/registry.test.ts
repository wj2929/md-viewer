import { describe, expect, it } from 'vitest'
import { builtinRendererDefinitions } from '../../src/renderers/builtin'
import { createRendererRegistry } from '../../src/renderers/registry'

describe('renderer registry', () => {
  it('normalizes aliases to canonical renderer types', () => {
    const registry = createRendererRegistry(builtinRendererDefinitions)

    expect(registry.resolveLanguage('dot')?.type).toBe('graphviz')
    expect(registry.resolveLanguage('puml')?.type).toBe('plantuml')
    expect(registry.resolveLanguage('dio')?.type).toBe('drawio')
    expect(registry.resolveLanguage('excalidraw-json')?.type).toBe('excalidraw')
    expect(registry.resolveLanguage('vegalite')?.type).toBe('vega-lite')
    expect(registry.resolveLanguage('c4')?.type).toBe('c4plantuml')
  })

  it('resolves canonical renderer languages', () => {
    const registry = createRendererRegistry(builtinRendererDefinitions)

    expect(registry.resolveLanguage('mermaid')?.type).toBe('mermaid')
    expect(registry.resolveLanguage('echarts')?.type).toBe('echarts')
    expect(registry.resolveLanguage('markmap')?.type).toBe('markmap')
    expect(registry.resolveLanguage('infographic')?.type).toBe('infographic')
    expect(registry.resolveLanguage('vega-lite')?.type).toBe('vega-lite')
    expect(registry.resolveLanguage('d2')?.type).toBe('d2')
    expect(registry.resolveLanguage('bpmn')?.type).toBe('bpmn')
    expect(registry.resolveLanguage('wavedrom')?.type).toBe('wavedrom')
    expect(registry.resolveLanguage('c4plantuml')?.type).toBe('c4plantuml')
    expect(registry.resolveLanguage('structurizr')?.type).toBe('structurizr')
    expect(registry.resolveLanguage('structurizr-dsl')?.type).toBe('structurizr')
    expect(registry.resolveLanguage('plotly')?.type).toBe('plotly')
    expect(registry.resolveLanguage('dbml')?.type).toBe('dbml')
    expect(registry.resolveLanguage('antv-g6')?.type).toBe('antv-g6')
    expect(registry.resolveLanguage('g6')?.type).toBe('antv-g6')
    expect(registry.resolveLanguage('kroki')?.type).toBe('kroki')
    expect(registry.resolveLanguage('nomnoml')?.type).toBe('kroki')
    expect(registry.resolveLanguage('pikchr')?.type).toBe('kroki')
    expect(registry.resolveLanguage('svgbob')?.type).toBe('kroki')
    expect(registry.resolveLanguage('bytefield')?.type).toBe('kroki')
    expect(registry.resolveLanguage('tikz')?.type).toBe('kroki')
  })

  it('keeps builtin target capabilities independent', () => {
    const mermaid = builtinRendererDefinitions.find(renderer => renderer.type === 'mermaid')!
    const echarts = builtinRendererDefinitions.find(renderer => renderer.type === 'echarts')!

    expect(mermaid.capabilities.preview).not.toBe(mermaid.capabilities.html)
    expect(mermaid.capabilities.preview).not.toBe(echarts.capabilities.preview)
  })

  it('fails fast on duplicate language aliases', () => {
    expect(() => createRendererRegistry([
      builtinRendererDefinitions[0],
      { ...builtinRendererDefinitions[0], type: 'graphviz', displayName: 'Graphviz Duplicate' },
    ])).toThrow(/duplicate renderer language/i)
  })
})
