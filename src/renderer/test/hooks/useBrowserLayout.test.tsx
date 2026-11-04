import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserContentMinimum, useBrowserLayout } from '../../src/hooks/useBrowserLayout'

let workspace: HTMLDivElement, content: HTMLDivElement, root: HTMLDivElement, scroller: HTMLDivElement
let anchor: HTMLDivElement, anchorBase: number, available: number, resize: () => void
let observed: Element[]
const rect = (top: number, width = 100) => ({ top, bottom: top + 40, left: 0, right: width, width, height: 40, x: 0, y: top, toJSON: () => ({}) })
beforeEach(() => {
  vi.useFakeTimers()
  workspace = document.createElement('div'); workspace.className = 'workspace'
  content = document.createElement('div'); content.className = 'content-area'
  root = document.createElement('div'); scroller = document.createElement('div'); scroller.className = 'preview'
  anchor = document.createElement('div'); anchor.dataset.sourceLine = '100'
  scroller.append(anchor); root.append(scroller); content.append(root); workspace.append(content); document.body.append(workspace)
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 })
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
  scroller.scrollTop = 200; anchorBase = 250; available = 1000
  scroller.getBoundingClientRect = () => rect(0)
  anchor.getBoundingClientRect = () => rect(anchorBase - scroller.scrollTop)
  content.getBoundingClientRect = () => rect(0, available)
  observed = []
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe(node: Element) { observed.push(node) } disconnect() {} })
})
afterEach(() => { workspace.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
function setup() {
  const workbench = { current: root }
  const hook = renderHook((props: { open: boolean; hidden: boolean; key: string }) => useBrowserLayout(workbench, props.open, props.hidden, props.key, 360), {
    initialProps: { open: false, hidden: false, key: 'document-A' },
  })
  act(() => vi.advanceTimersByTime(100))
  return hook
}

describe('文件浏览布局边界保护', () => {
  it('开关时捕获一次，布局稳定后以同一源码块及局部偏移校正一次', () => {
    const { result, rerender } = setup()
    const query = vi.spyOn(root, 'querySelectorAll')
    act(() => result.current.prepare())
    expect(root).toHaveAttribute('data-browser-layout-paused')
    anchorBase += 100
    rerender({ open: true, hidden: false, key: 'document-A' })
    act(() => vi.advanceTimersByTime(100))
    expect(scroller.scrollTop).toBe(300)
    expect(anchor.getBoundingClientRect().top).toBe(50)
    expect(root).not.toHaveAttribute('data-browser-layout-paused')
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('用户滚动优先，取消等待中的旧校正而不拉回', () => {
    const { result, rerender } = setup()
    act(() => result.current.prepare())
    anchorBase += 100
    rerender({ open: true, hidden: false, key: 'document-A' })
    scroller.scrollTop = 450
    fireEvent.wheel(scroller)
    act(() => vi.advanceTimersByTime(100))
    expect(scroller.scrollTop).toBe(450)
    expect(root).not.toHaveAttribute('data-browser-layout-paused')
  })
  it('导航改变后不把旧文档校正应用到新文档', () => {
    const { result, rerender } = setup()
    act(() => result.current.prepare())
    anchorBase += 100
    rerender({ open: true, hidden: false, key: 'document-B' })
    act(() => vi.advanceTimersByTime(100))
    expect(scroller.scrollTop).toBe(200)
  })
  it('正文隐藏期间不测量或恢复，返回时使用隐藏前的快照', () => {
    const { result, rerender } = setup()
    act(() => result.current.prepare())
    root.hidden = true
    rerender({ open: true, hidden: true, key: 'document-A' })
    act(() => vi.advanceTimersByTime(100))
    expect(scroller.scrollTop).toBe(200)
    anchorBase += 100; root.hidden = false
    rerender({ open: true, hidden: false, key: 'document-A' })
    act(() => vi.advanceTimersByTime(100))
    expect(scroller.scrollTop).toBe(300)
  })
  it('拖宽只在开始捕获，连续移动不扫描/恢复，释放后最多校正一次', () => {
    const { result } = setup()
    const query = vi.spyOn(root, 'querySelectorAll')
    act(() => result.current.startResize({ preventDefault: vi.fn(), clientX: 100 } as any))
    for (const clientX of [120, 140, 160]) {
      fireEvent.mouseMove(document, { clientX })
      act(() => vi.advanceTimersByTime(32))
    }
    expect(result.current.width).toBe(340)
    expect(query).toHaveBeenCalledTimes(1)
    expect(scroller.scrollTop).toBe(200)
    anchorBase += 100
    fireEvent.mouseUp(document)
    act(() => vi.advanceTimersByTime(100))
    expect(scroller.scrollTop).toBe(300)
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('正文容器被侧栏挤窄时也降级抽屉，宽度恢复后保留原请求宽度', () => {
    const { result } = setup()
    expect(observed).toContain(content)
    available = 500
    act(() => resize())
    expect(result.current.drawer).toBe(true)
    act(() => vi.advanceTimersByTime(100))
    expect(root).not.toHaveAttribute('data-browser-layout-paused')
    available = 1000
    act(() => resize())
    expect(result.current.drawer).toBe(false)
    expect(result.current.width).toBe(280)
  })
  it('分屏按实际横向叶子累计最小空间，不只使用窗口总宽', () => {
    const leaf = { type: 'leaf', id: 'a', tabId: 'a' } as const
    expect(browserContentMinimum({ type: 'split', id: 's', direction: 'horizontal', ratio: 0.5, first: leaf, second: leaf })).toBe(720)
    expect(browserContentMinimum({ type: 'split', id: 's', direction: 'vertical', ratio: 0.5, first: leaf, second: leaf })).toBe(360)
  })
})
