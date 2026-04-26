import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useQuickEditScrollSync } from '../../src/hooks/useQuickEditScrollSync'

function setScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight })
}

function setLayout(element: HTMLElement, offsetTop: number, height = 20): void {
  Object.defineProperty(element, 'offsetTop', { configurable: true, value: offsetTop })
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: height })
}

function createPreview(): HTMLElement {
  const preview = document.createElement('div')
  setScrollMetrics(preview, 500, 100)
  const first = document.createElement('h1')
  first.dataset.sourceLine = '1'
  setLayout(first, 0)
  const middle = document.createElement('p')
  middle.dataset.sourceLine = '5'
  setLayout(middle, 250)
  const last = document.createElement('p')
  last.dataset.sourceLine = '10'
  setLayout(last, 500)
  preview.append(first, middle, last)
  return preview
}

function createTextarea(value: string): HTMLTextAreaElement {
  const textarea = document.createElement('textarea')
  textarea.value = value
  setScrollMetrics(textarea, 1000, 100)
  return textarea
}

function renderSyncHook({
  enabled = true,
  previewElement = createPreview(),
  textarea = createTextarea(Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')),
}: {
  enabled?: boolean
  previewElement?: HTMLElement | null
  textarea?: HTMLTextAreaElement
} = {}) {
  return renderHook(() => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(textarea)
    return useQuickEditScrollSync({
      enabled,
      placementKey: 'single',
      canonicalPath: '/real/docs/a.md',
      drawerInstanceId: 'drawer-a',
      previewElement,
      textareaRef,
      content: textarea.value,
    })
  })
}

describe('useQuickEditScrollSync', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('does not bind synchronization when disabled', () => {
    const preview = createPreview()
    const textarea = createTextarea('a\nb\nc\nd\ne\nf\ng\nh\ni\nj')

    renderSyncHook({ enabled: false, previewElement: preview, textarea })

    act(() => {
      textarea.scrollTop = 500
      textarea.dispatchEvent(new Event('scroll'))
    })

    expect(preview.scrollTop).toBe(0)
  })

  it('scrolls the current preview from editor scrolling using scrollMap', async () => {
    const preview = createPreview()
    const textarea = createTextarea('a\nb\nc\nd\ne\nf\ng\nh\ni\nj')
    renderSyncHook({ previewElement: preview, textarea })

    act(() => {
      textarea.scrollTop = 450
      textarea.dispatchEvent(new Event('scroll'))
    })

    await waitFor(() => {
      expect(preview.scrollTop).toBeGreaterThan(0)
    })
  })

  it('scrolls the editor from preview scrolling using the viewport middle line', async () => {
    const preview = createPreview()
    const textarea = createTextarea('a\nb\nc\nd\ne\nf\ng\nh\ni\nj')
    renderSyncHook({ previewElement: preview, textarea })

    act(() => {
      preview.scrollTop = 225
      preview.dispatchEvent(new Event('scroll'))
    })

    await waitFor(() => {
      expect(textarea.scrollTop).toBeGreaterThan(0)
    })
  })

  it('does not pull the editor while IME composition is active', async () => {
    const preview = createPreview()
    const textarea = createTextarea('a\nb\nc\nd\ne\nf\ng\nh\ni\nj')
    renderSyncHook({ previewElement: preview, textarea })

    act(() => {
      textarea.dispatchEvent(new CompositionEvent('compositionstart'))
      preview.scrollTop = 225
      preview.dispatchEvent(new Event('scroll'))
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(textarea.scrollTop).toBe(0)
  })

  it('unbinds old preview listeners when the preview element changes', async () => {
    const firstPreview = createPreview()
    const secondPreview = createPreview()
    const textarea = createTextarea('a\nb\nc\nd\ne\nf\ng\nh\ni\nj')

    const { rerender } = renderHook(({ previewElement }) => {
      const textareaRef = useRef<HTMLTextAreaElement | null>(textarea)
      return useQuickEditScrollSync({
        enabled: true,
        placementKey: 'single',
        canonicalPath: '/real/docs/a.md',
        drawerInstanceId: 'drawer-a',
        previewElement,
        textareaRef,
        content: textarea.value,
      })
    }, { initialProps: { previewElement: firstPreview } })

    rerender({ previewElement: secondPreview })

    act(() => {
      firstPreview.scrollTop = 225
      firstPreview.dispatchEvent(new Event('scroll'))
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(textarea.scrollTop).toBe(0)
  })
})
