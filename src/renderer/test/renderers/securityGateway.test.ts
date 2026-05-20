import { describe, expect, it } from 'vitest'
import { builtinRendererDefinitions } from '../../src/renderers/builtin'
import { checkRendererPolicy } from '../../src/renderers/securityGateway'
import type { RenderSourceLocator } from '../../src/renderers/sourceIdentity'

const locator: RenderSourceLocator = {
  blockId: 'mdv-plantuml-12345678',
  sourceKind: 'fence',
  rendererType: 'plantuml',
  canonicalLanguage: 'plantuml',
  sourceIndex: 0,
  startOffset: 0,
  endOffset: 20,
  sourceHash: '12345678',
}

describe('renderer security gateway', () => {
  it('allows supported offline renderers', () => {
    const mermaid = builtinRendererDefinitions.find(renderer => renderer.type === 'mermaid')!

    expect(checkRendererPolicy(mermaid, locator, { target: 'preview' })).toEqual({ ok: true })
  })

  it('blocks explicit remote renderers unless remote rendering is allowed', () => {
    const plantuml = builtinRendererDefinitions.find(renderer => renderer.type === 'plantuml')!
    const result = checkRendererPolicy(plantuml, locator, { target: 'preview' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.state).toBe('blockedBySecurityPolicy')
      expect(result.warning.rendererType).toBe('plantuml')
      expect(result.warning.fallback).toBe('blocked')
    }
  })
})
