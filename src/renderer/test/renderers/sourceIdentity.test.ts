import { describe, expect, it } from 'vitest'
import { builtinRendererDefinitions } from '../../src/renderers/builtin'
import { createRendererRegistry } from '../../src/renderers/registry'
import { collectFencedRenderSourceLocators, createRenderSourceLocator } from '../../src/renderers/sourceIdentity'

describe('render source identity', () => {
  it('creates deterministic block ids for the same normalized source range', () => {
    const first = createRenderSourceLocator({
      rendererType: 'mermaid',
      sourceKind: 'fence',
      canonicalLanguage: 'mermaid',
      sourceIndex: 0,
      startOffset: 12,
      endOffset: 42,
      source: 'graph TD\nA-->B',
    })
    const second = createRenderSourceLocator({
      rendererType: 'mermaid',
      sourceKind: 'fence',
      canonicalLanguage: 'mermaid',
      sourceIndex: 3,
      startOffset: 12,
      endOffset: 42,
      source: 'graph TD\nA-->B',
    })

    expect(first.blockId).toBe(second.blockId)
    expect(first.sourceHash).toBe(second.sourceHash)
    expect(first.sourceIndex).toBe(0)
    expect(second.sourceIndex).toBe(3)
  })

  it('includes resolved file paths for file resources', () => {
    const locator = createRenderSourceLocator({
      rendererType: 'excalidraw',
      sourceKind: 'fileResource',
      canonicalLanguage: 'excalidraw',
      sourceIndex: 1,
      startOffset: 8,
      endOffset: 32,
      source: './diagrams/a.excalidraw',
      resolvedPath: 'diagrams/a.excalidraw',
    })

    expect(locator.blockId).toContain('excalidraw')
    expect(locator.resolvedPath).toBe('diagrams/a.excalidraw')
  })

  it('collects fenced render source locators with per-renderer source indexes', () => {
    const registry = createRendererRegistry(builtinRendererDefinitions)
    const markdown = [
      '```mermaid',
      'graph TD',
      'A-->B',
      '```',
      '',
      '```dot',
      'digraph G { A -> B }',
      '```',
      '',
      '```mermaid',
      'graph TD',
      'C-->D',
      '```',
    ].join('\n')

    const locators = collectFencedRenderSourceLocators(markdown, registry)

    expect(locators.map(locator => locator.rendererType)).toEqual(['mermaid', 'graphviz', 'mermaid'])
    expect(locators.map(locator => locator.sourceIndex)).toEqual([0, 0, 1])
    expect(locators[1].canonicalLanguage).toBe('graphviz')
    expect(locators[0].blockId).not.toBe(locators[2].blockId)
  })

  it('collects file reference locators in document order', () => {
    const registry = createRendererRegistry(builtinRendererDefinitions)
    const markdown = [
      '![流程](./process.bpmn)',
      '',
      '```bpmn',
      '<bpmn:definitions />',
      '```',
      '',
      '![画布](./diagram.excalidraw?raw=1#v)',
    ].join('\n')

    const locators = collectFencedRenderSourceLocators(markdown, registry)

    expect(locators.map(locator => [locator.rendererType, locator.sourceKind, locator.sourceIndex])).toEqual([
      ['bpmn', 'imageRef', 0],
      ['bpmn', 'fence', 1],
      ['excalidraw', 'imageRef', 0],
    ])
    expect(locators[0].blockId).toMatch(/^mdv-bpmn-/)
    expect(locators[0].resolvedPath).toBe('./process.bpmn')
    expect(locators[2].resolvedPath).toBe('./diagram.excalidraw')
  })
})
