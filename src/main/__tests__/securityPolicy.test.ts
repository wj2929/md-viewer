import { describe, expect, it } from 'vitest'
import { createContentSecurityPolicy } from '../securityPolicy'

describe('content security policy', () => {
  it('allows inline data fonts used by Mermaid and renderer SVG libraries', () => {
    expect(createContentSecurityPolicy(false)).toContain('font-src')
    expect(createContentSecurityPolicy(false)).toContain('data:')
    expect(createContentSecurityPolicy(true)).toContain('data:')
  })

  it('allows AntV infographic built-in font styles without broadening all external styles', () => {
    const policy = createContentSecurityPolicy(false)

    expect(policy).toContain('style-src')
    expect(policy).toContain('https://assets.antv.antgroup.com')
    expect(policy).not.toContain('style-src *')
  })

  it('allows AntV infographic font CSS fetches without broadening all connections', () => {
    const policy = createContentSecurityPolicy(false)
    const connectDirective = policy.split(';').find(part => part.trim().startsWith('connect-src')) || ''

    expect(connectDirective).toContain('https://assets.antv.antgroup.com')
    expect(connectDirective).not.toContain('connect-src *')
  })
})
