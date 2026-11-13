import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type MarkdownIt from 'markdown-it'
import { useMarkdownRender } from '../../src/hooks/useMarkdownRender'
import { prepareMarkdownRender, sanitizeHtml } from '../../src/utils/markdownRenderer'

vi.mock('../../src/utils/markdownRenderer', () => ({
  prepareMarkdownRender: vi.fn((_md, source) => ({ html: source, proofs: new Map() })),
  sanitizeHtml: vi.fn(html => 'safe:' + html),
}))

describe('staged Markdown rendering', () => {
  const md = {} as MarkdownIt
  let yields: Array<() => void>
  beforeEach(() => {
    vi.clearAllMocks()
    yields = []
    vi.stubGlobal('scheduler', { yield: () => new Promise<void>(resolve => yields.push(resolve)) })
  })
  afterEach(() => vi.unstubAllGlobals())
  const next = async () => { await act(async () => { yields.shift()?.() }) }

  it('keeps small documents synchronous and passes block proofs to the existing sanitizer', () => {
    const { result } = renderHook(() => useMarkdownRender(md, '# Small'))
    expect(result.current?.html).toBe('safe:# Small')
    expect(yields).toHaveLength(0)
    expect(sanitizeHtml).toHaveBeenCalledWith('# Small', expect.any(Map))
  })

  it('yields before parsing, before sanitizing and before publishing the complete result', async () => {
    const source = '# Large\n' + 'x'.repeat(100_000)
    const { result } = renderHook(() => useMarkdownRender(md, source))
    expect(result.current).toBeNull()
    expect(prepareMarkdownRender).not.toHaveBeenCalled()
    await next()
    expect(prepareMarkdownRender).toHaveBeenCalledWith(md, source)
    expect(sanitizeHtml).not.toHaveBeenCalled()
    await next()
    expect(sanitizeHtml).toHaveBeenCalledWith(source, expect.any(Map))
    expect(result.current).toBeNull()
    await next()
    expect(result.current?.html).toBe('safe:' + source)
  })

  it('does not sanitize or publish a stale document after switching sources', async () => {
    const a = 'a'.repeat(100_000), b = 'b'.repeat(100_000)
    const { result, rerender } = renderHook(({ source }) => useMarkdownRender(md, source), { initialProps: { source: a } })
    await next()
    rerender({ source: b })
    await next()
    expect(sanitizeHtml).not.toHaveBeenCalled()
    await next(); await next(); await next()
    expect(result.current?.html).toBe('safe:' + b)
    expect(sanitizeHtml).toHaveBeenCalledTimes(1)
  })

  it('cancels remaining work on unmount and cannot overwrite a small document', async () => {
    const { result, rerender, unmount } = renderHook(({ source }) => useMarkdownRender(md, source), { initialProps: { source: 'a'.repeat(100_000) } })
    await next()
    rerender({ source: '# Small' })
    await next()
    expect(result.current?.html).toBe('safe:# Small')
    unmount()
    expect(sanitizeHtml).toHaveBeenCalledTimes(1)
  })
})
