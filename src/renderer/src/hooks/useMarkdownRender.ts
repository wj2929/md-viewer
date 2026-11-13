import { useEffect, useMemo, useState } from 'react'
import type MarkdownIt from 'markdown-it'
import { prepareMarkdownRender, sanitizeHtml } from '../utils/markdownRenderer'

export const LARGE_MARKDOWN_RENDER_THRESHOLD = 100_000

type RenderResult = { source: string; html: string; markdownRenderMs: number; sanitizeMs: number; error?: unknown }

export function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler
  return scheduler ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0))
}

export function useMarkdownRender(md: MarkdownIt, source: string): RenderResult | null {
  const large = source.length >= LARGE_MARKDOWN_RENDER_THRESHOLD
  const [prepared, setPrepared] = useState<RenderResult | null>(null)
  const small = useMemo<RenderResult | null>(() => {
    if (large) return null
    if (!source.trim()) return { source, html: '<p class="placeholder">文件内容为空</p>', markdownRenderMs: 0, sanitizeMs: 0 }
    const started = performance.now()
    const rendered = prepareMarkdownRender(md, source)
    const markdownRenderMs = performance.now() - started
    const sanitizeStarted = performance.now()
    return { source, html: sanitizeHtml(rendered.html, rendered.proofs), markdownRenderMs, sanitizeMs: performance.now() - sanitizeStarted }
  }, [md, source, large])

  useEffect(() => {
    if (!large) return
    let cancelled = false
    void (async () => {
      try {
        await yieldToMainThread()
        if (cancelled) return
        const started = performance.now()
        const rendered = prepareMarkdownRender(md, source)
        const markdownRenderMs = performance.now() - started
        await yieldToMainThread()
        if (cancelled) return
        const sanitizeStarted = performance.now()
        const html = sanitizeHtml(rendered.html, rendered.proofs)
        const sanitizeMs = performance.now() - sanitizeStarted
        await yieldToMainThread()
        if (!cancelled) setPrepared({ source, html, markdownRenderMs, sanitizeMs })
      } catch (error) {
        if (!cancelled) setPrepared({ source, html: '', markdownRenderMs: 0, sanitizeMs: 0, error })
      }
    })()
    return () => { cancelled = true }
  }, [md, source, large])

  const result = large ? prepared : small
  if (result?.error) throw result.error
  return result
}
