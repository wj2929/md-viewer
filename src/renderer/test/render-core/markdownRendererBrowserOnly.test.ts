import { describe, expect, it } from 'vitest'
import { createMarkdownRenderer, sanitizeHtml, setupDOMPurifyHooks } from '../../src/utils/markdownRenderer'

describe('markdown renderer browser-only compatibility', () => {
  it('renders basic markdown without Electron globals', () => {
    delete (window as unknown as { api?: unknown }).api
    delete (window as unknown as { electronAPI?: unknown }).electronAPI

    setupDOMPurifyHooks()
    const md = createMarkdownRenderer()
    const html = sanitizeHtml(md.render('# 标题\n\n正文'))

    expect(html).toContain('<h1')
    expect(html).toContain('标题')
    expect(html).toContain('正文')
  })

  it('keeps Mermaid code blocks available for browser rendering', () => {
    delete (window as unknown as { api?: unknown }).api
    delete (window as unknown as { electronAPI?: unknown }).electronAPI

    setupDOMPurifyHooks()
    const md = createMarkdownRenderer()
    const html = sanitizeHtml(md.render('```mermaid\ngraph TD\nA --> B\n```'))

    expect(html).toContain('language-mermaid')
    expect(html).toContain('graph TD')
  })
})
