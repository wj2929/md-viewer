import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { PanelNode } from '../utils/splitTree'

export function browserContentMinimum(node: PanelNode | null): number {
  if (!node || node.type === 'leaf') return 360
  const first = browserContentMinimum(node.first), second = browserContentMinimum(node.second)
  return node.direction === 'horizontal' ? first + second : Math.max(first, second)
}

type ViewSnapshot = { scroller: HTMLElement; anchor?: HTMLElement; offset: number; ratio: number; left: number }

export function useBrowserLayout(workbench: RefObject<HTMLDivElement | null>, open: boolean, hidden: boolean,
  viewKey: string, minimum: number) {
  const [requestedWidth, setRequestedWidth] = useState(280)
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY)
  const snapshots = useRef<{ key: string; views: ViewSnapshot[] } | undefined>(undefined)
  const resizing = useRef(false)
  const frame = useRef(0)
  const generation = useRef(0)
  const keyRef = useRef(viewKey)
  keyRef.current = viewKey
  const drawer = available < minimum + 224
  const width = drawer ? Math.max(220, Math.min(420, requestedWidth))
    : Math.max(220, Math.min(420, requestedWidth, available - minimum - 4))
  const prepare = useCallback(() => {
    const root = workbench.current
    if (!root) return
    generation.current++
    cancelAnimationFrame(frame.current)
    if (!root.hidden && !root.hasAttribute('data-browser-layout-paused')) {
      const views = Array.from(root.querySelectorAll<HTMLElement>('.preview, .cm-scroller')).filter(node => node.clientHeight > 0).map(scroller => {
        const top = scroller.getBoundingClientRect().top
        const nodes = Array.from(scroller.querySelectorAll<HTMLElement>('[data-source-line], h1, h2, h3, h4, h5, h6'))
        const anchor = nodes.find(node => node.getBoundingClientRect().bottom > top) ?? nodes.at(-1)
        return { scroller, anchor, offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
          ratio: scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight), left: scroller.scrollLeft }
      })
      snapshots.current = { key: keyRef.current, views }
    }
    root.setAttribute('data-browser-layout-paused', '')
    root.dispatchEvent(new Event('browser-layout-start', { bubbles: true }))
  }, [workbench])
  const settle = useCallback(() => {
    const version = ++generation.current
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => { frame.current = requestAnimationFrame(() => {
      const root = workbench.current
      if (!root || generation.current !== version || root.hidden) return
      const snapshot = snapshots.current
      if (snapshot?.key === keyRef.current) for (const view of snapshot.views) {
        if (!view.scroller.isConnected || view.scroller.clientHeight <= 0) continue
        if (view.anchor?.isConnected && view.scroller.contains(view.anchor)) {
          view.scroller.scrollTop += view.anchor.getBoundingClientRect().top - view.scroller.getBoundingClientRect().top - view.offset
        } else view.scroller.scrollTop = view.ratio * Math.max(0, view.scroller.scrollHeight - view.scroller.clientHeight)
        view.scroller.scrollLeft = view.left
      }
      snapshots.current = undefined
      // Let restoration scroll events drain before allowing position writes again.
      frame.current = requestAnimationFrame(() => { if (generation.current === version) root.removeAttribute('data-browser-layout-paused') })
    }) })
  }, [workbench])
  useLayoutEffect(() => { if (!resizing.current) settle() }, [open, hidden, drawer, width, viewKey, available, settle])
  useEffect(() => {
    const workspace = workbench.current?.closest('.workspace')
    if (!workspace || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const content = workspace.querySelector('.content-area')?.getBoundingClientRect().width ?? 0
      const panel = workspace.querySelector('.file-browser-panel:not([hidden]):not(.browser-drawer)')?.getBoundingClientRect().width ?? 0
      const next = content + panel + (panel ? 4 : 0)
      if (next > 0 && next !== available) { prepare(); setAvailable(next) }
    })
    observer.observe(workspace)
    const content = workspace.querySelector('.content-area')
    if (content) observer.observe(content)
    return () => observer.disconnect()
  }, [workbench, prepare, open, drawer, width, available])
  useEffect(() => {
    const cancel = (event: Event) => {
      if (!(event.target instanceof Node) || !workbench.current?.contains(event.target)) return
      generation.current++; snapshots.current = undefined; cancelAnimationFrame(frame.current)
      if (!workbench.current.hidden) workbench.current.removeAttribute('data-browser-layout-paused')
    }
    document.addEventListener('wheel', cancel, true)
    document.addEventListener('pointerdown', cancel, true)
    document.addEventListener('keydown', cancel, true)
    return () => {
      cancelAnimationFrame(frame.current)
      document.removeEventListener('wheel', cancel, true)
      document.removeEventListener('pointerdown', cancel, true)
      document.removeEventListener('keydown', cancel, true)
    }
  }, [workbench])
  const dragCleanup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => dragCleanup.current?.(), [])
  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault(); prepare(); resizing.current = true
    const start = event.clientX, original = width
    const move = (next: MouseEvent) => setRequestedWidth(Math.max(220, Math.min(420, available - minimum - 4, original + next.clientX - start)))
    const cleanup = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', end) }
    const end = () => { cleanup(); dragCleanup.current = undefined; resizing.current = false; settle() }
    dragCleanup.current?.(); dragCleanup.current = cleanup
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', end)
  }, [available, minimum, prepare, settle, width])
  return { width, drawer, prepare, settle, startResize }
}
