import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderHook } from '@testing-library/react'
import { useReadPosition } from '../../src/hooks/useReadPosition'

let box: HTMLDivElement, container: HTMLDivElement, root: HTMLDivElement
let resizeCallbacks: Array<() => void>, disconnects: Array<ReturnType<typeof vi.fn>>
beforeEach(() => {
  vi.useFakeTimers()
  box = document.createElement('div'); container = document.createElement('div'); root = document.createElement('div')
  container.className = 'preview'; container.append(root); box.append(container); document.body.append(box)
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1100 })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 })
  container.scrollTo = vi.fn(options => {
    container.scrollTop = (options as ScrollToOptions).top ?? 0
    fireEvent.scroll(container)
  })
  resizeCallbacks = []; disconnects = []
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn()
    observe = vi.fn()
    constructor(callback: () => void) { resizeCallbacks.push(callback); disconnects.push(this.disconnect) }
  })
})
afterEach(() => { box.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
function setup(initialScrollRatio: number | undefined, isActive = true) {
  const onChange = vi.fn()
  const rootRef = { current: root }
  const hook = renderHook((props: { filePath: string; initialScrollRatio?: number }) => useReadPosition({
    rootRef, isActive, renderVersion: 1, onChange, ...props,
  }), { initialProps: { filePath: '/fixture/a.md', initialScrollRatio } })
  return { ...hook, onChange }
}

describe('初始阅读位置与滚动上报', () => {
  it('恢复实际视口，但不把恢复产生的scroll保存为新阅读记录', () => {
    const { onChange } = setup(0.6)
    vi.advanceTimersByTime(1000)
    expect(container.scrollTop).toBe(600)
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each(['wheel', 'pointerdown'])('%s先发生时取消迟到恢复，之后正常保存用户位置', type => {
    const { onChange } = setup(0.6)
    vi.advanceTimersByTime(100)
    fireEvent(container, new Event(type, { bubbles: true }))
    container.scrollTop = 120; fireEvent.scroll(container)
    vi.advanceTimersByTime(1000)
    expect(container.scrollTo).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith({ scrollRatio: 0.12 })
  })

  it.each([true, false])('body键盘输入只取消活动视口的恢复（active=%s）', isActive => {
    setup(0.6, isActive)
    fireEvent.keyDown(document.body, { key: 'PageDown' })
    vi.advanceTimersByTime(500)
    expect(vi.mocked(container.scrollTo).mock.calls.length).toBe(isActive ? 0 : 1)
  })

  it('文档改变时旧恢复定时器不能作用于新文档', () => {
    const { rerender, onChange } = setup(0.6)
    vi.advanceTimersByTime(100)
    rerender({ filePath: '/fixture/b.md', initialScrollRatio: 0.2 })
    vi.advanceTimersByTime(1000)
    expect(container.scrollTop).toBe(200)
    expect(container.scrollTo).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('显式定位取消初始恢复，清除显式请求后也不重放旧位置', () => {
    const { rerender, onChange } = setup(0.6)
    vi.advanceTimersByTime(100)
    rerender({ filePath: '/fixture/a.md', initialScrollRatio: undefined })
    container.scrollTop = 800; fireEvent.scroll(container)
    vi.advanceTimersByTime(700)
    rerender({ filePath: '/fixture/a.md', initialScrollRatio: 0.6 })
    vi.advanceTimersByTime(700)
    expect(container.scrollTo).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith({ scrollRatio: 0.8 })
  })

  it('无初始恢复时保留既有500ms滚动上报', () => {
    const { onChange } = setup(undefined)
    container.scrollTop = 300; fireEvent.scroll(container)
    vi.advanceTimersByTime(499)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledWith({ scrollRatio: 0.3 })
  })

  it('初始图表重排保持比例且不写入；交互后停止跟随', () => {
    const { onChange } = setup(0.6)
    vi.advanceTimersByTime(500)
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 2100 })
    resizeCallbacks[0]()
    expect(container.scrollTop).toBe(1200)
    vi.advanceTimersByTime(1000)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.wheel(container)
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 3100 })
    resizeCallbacks[0]()
    expect(container.scrollTop).toBe(1200)
    expect(disconnects[0]).toHaveBeenCalled()
  })

  it('卸载后已排队的重排回调也不能移动旧视口', () => {
    const { unmount } = setup(0.6)
    vi.advanceTimersByTime(500)
    const oldResize = resizeCallbacks[0]
    unmount()
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 2100 })
    oldResize()
    expect(container.scrollTop).toBe(600)
  })

  it('卸载取消尚未完成的滚动保存', () => {
    const { unmount, onChange } = setup(undefined)
    container.scrollTop = 300
    fireEvent.scroll(container)
    unmount()
    vi.advanceTimersByTime(1000)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('同一文档父组件更新回调不能取消已排队保存，使用最新回调', () => {
    const first = vi.fn(), latest = vi.fn()
    const rootRef = { current: root }
    const { rerender } = renderHook(({ onChange }) => useReadPosition({
      rootRef, filePath: '/fixture/a.md', isActive: true, renderVersion: 1, onChange,
    }), { initialProps: { onChange: first } })
    container.scrollTop = 300; fireEvent.scroll(container)
    vi.advanceTimersByTime(200)
    rerender({ onChange: latest })
    vi.advanceTimersByTime(300)
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledWith({ scrollRatio: 0.3 })
  })

  it('布局开始时取消500ms内的旧回调，恢复后不能重放旧位置', () => {
    const { onChange } = setup(undefined)
    container.scrollTop = 300; fireEvent.scroll(container)
    vi.advanceTimersByTime(100)
    box.setAttribute('data-browser-layout-paused', '')
    box.dispatchEvent(new Event('browser-layout-start', { bubbles: true }))
    box.removeAttribute('data-browser-layout-paused')
    vi.advanceTimersByTime(1000)
    expect(onChange).not.toHaveBeenCalled()
    container.scrollTop = 400; fireEvent.scroll(container); vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledWith({ scrollRatio: 0.4 })
  })

  it.each(['hidden', 'inert', 'data-browser-layout-paused'])('回调执行时重新检查 %s，隐藏或过渡位置不保存', attribute => {
    const { onChange } = setup(undefined)
    container.scrollTop = 300; fireEvent.scroll(container)
    box.setAttribute(attribute, '')
    vi.advanceTimersByTime(1000)
    expect(onChange).not.toHaveBeenCalled()
    box.removeAttribute(attribute)
    container.scrollTop = 450; fireEvent.scroll(container); vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledWith({ scrollRatio: 0.45 })
  })

  it.each([true, false])('尺寸不可测量时不保存；可见面板正常保存（active=%s）', active => {
    const { onChange } = setup(undefined, active)
    container.scrollTop = 300; fireEvent.scroll(container)
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 0 })
    vi.advanceTimersByTime(1000)
    expect(onChange).not.toHaveBeenCalled()
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 })
    fireEvent.scroll(container); vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledWith({ scrollRatio: 0.3 })
  })

  it('卸载取消定时器及观察器，不写迟到记录', () => {
    const { unmount, onChange } = setup(0.6)
    unmount(); vi.advanceTimersByTime(1000)
    expect(container.scrollTo).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(disconnects[0]).toHaveBeenCalled()
  })
})
