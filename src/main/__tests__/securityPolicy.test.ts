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

  it('allows TTS audio playback via media-src (blob/data) without broadening connect-src to third-party TTS', () => {
    const policy = createContentSecurityPolicy(false)
    const mediaDirective = policy.split(';').find(part => part.trim().startsWith('media-src')) || ''

    expect(mediaDirective).toContain('blob:')
    expect(mediaDirective).toContain('data:')
    // 第三方 TTS 请求走主进程,connect-src 不应含 openai/azure 等外部端点
    const connectDirective = policy.split(';').find(part => part.trim().startsWith('connect-src')) || ''
    expect(connectDirective).not.toContain('openai')
    expect(connectDirective).not.toContain('azure')
  })
})
