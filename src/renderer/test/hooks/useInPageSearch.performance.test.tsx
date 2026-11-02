import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInPageSearch } from '../../src/hooks/useInPageSearch'

describe('文档搜索的遍历与高亮生命周期', () => {
  let container: HTMLDivElement
  let preview: HTMLDivElement
  let clippingRegion: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = vi.fn()
    container = document.createElement('div')
    preview = document.createElement('div')
    preview.className = 'preview'
    preview.append(container)
    clippingRegion = document.createElement('div')
    clippingRegion.append(preview)
    document.body.append(clippingRegion)
  })
  afterEach(() => {
    cleanup()
    clippingRegion.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  const settle = async () => act(async () => { await vi.advanceTimersByTimeAsync(650) })

  it('可见的相邻匹配只换高亮，不居中也不调用滚动祖先', async () => {
    container.innerHTML = '<p>needle needle</p>'
    const { result } = renderHook(() => useInPageSearch({ current: container }, 100))
    act(() => result.current.setQuery('needle'))
    await settle()
    Object.defineProperty(preview, 'clientHeight', { value: 400 })
    preview.getBoundingClientRect = () => new DOMRect(100, 100, 600, 400)
    preview.scrollTo = vi.fn()
    const marks = container.querySelectorAll('mark')
    marks[0].getBoundingClientRect = () => new DOMRect(150, 200, 50, 20)
    marks[1].getBoundingClientRect = () => new DOMRect(150, 250, 50, 20)
    act(() => result.current.goNext())
    expect(result.current.currentIndex).toBe(1)
    act(() => result.current.goPrev())
    expect(result.current.currentIndex).toBe(0)
    expect(preview.scrollTo).not.toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it.each([{ y: 560, expectedTop: 272 }, { y: 145, expectedTop: 153 }])('只滚所属预览并避开搜索框：目标 y=$y', async ({ y, expectedTop }) => {
    container.innerHTML = '<p>needle needle</p>'
    const box = document.createElement('div')
    box.className = 'in-page-search-box'
    box.getBoundingClientRect = () => new DOMRect(200, 100, 300, 60)
    preview.prepend(box)
    const { result } = renderHook(() => useInPageSearch({ current: container }, 30000))
    act(() => result.current.setQuery('needle'))
    await settle()
    Object.defineProperty(preview, 'clientHeight', { value: 400 })
    preview.getBoundingClientRect = () => new DOMRect(100, 100, 600, 400)
    preview.scrollTop = 180
    preview.scrollTo = vi.fn()
    container.querySelectorAll('mark')[1].getBoundingClientRect = () => new DOMRect(150, y, 50, 20)
    act(() => result.current.goNext())
    expect(preview.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: expectedTop, behavior: 'auto' })
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('预览容器超出窗口的部分不能算作可见区域', async () => {
    container.innerHTML = '<p>needle needle</p>'
    const { result } = renderHook(() => useInPageSearch({ current: container }, 30000))
    act(() => result.current.setQuery('needle'))
    await settle()
    vi.stubGlobal('innerHeight', 450)
    Object.defineProperty(preview, 'clientHeight', { value: 400 })
    preview.getBoundingClientRect = () => new DOMRect(100, 100, 600, 400)
    preview.scrollTop = 180
    preview.scrollTo = vi.fn()
    container.querySelectorAll('mark')[1].getBoundingClientRect = () => new DOMRect(150, 450, 50, 20)
    act(() => result.current.goNext())
    expect(preview.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 212, behavior: 'auto' })
  })

  it.each([{ top: 80, y: 385, expectedTop: 217 }, { top: 210, y: 200, expectedTop: 158 }])('按父级实际裁切区域显示命中：父级 top=$top', async ({ top, y, expectedTop }) => {
    container.innerHTML = '<p>needle needle</p>'
    const { result } = renderHook(() => useInPageSearch({ current: container }, 30000))
    act(() => result.current.setQuery('needle'))
    await settle()
    Object.defineProperty(preview, 'clientHeight', { value: 400 })
    preview.getBoundingClientRect = () => new DOMRect(100, 100, 600, 400)
    clippingRegion.style.overflowY = 'hidden'
    Object.defineProperty(clippingRegion, 'clientHeight', { value: 300 })
    clippingRegion.getBoundingClientRect = () => new DOMRect(80, top, 640, 300)
    preview.scrollTop = 180
    preview.scrollTo = vi.fn()
    container.querySelectorAll('mark')[1].getBoundingClientRect = () => new DOMRect(150, y, 50, 20)
    act(() => result.current.goNext())
    expect(preview.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: expectedTop, behavior: 'auto' })
  })

  it('横向溢出的表格只滚自己的横向容器，不推动整页或预览垂直位置', async () => {
    container.innerHTML = '<div id="wide" style="overflow-x:auto"><p>needle needle</p></div>'
    const { result } = renderHook(() => useInPageSearch({ current: container }, 30000))
    act(() => result.current.setQuery('needle'))
    await settle()
    Object.defineProperty(preview, 'clientHeight', { value: 400 })
    preview.getBoundingClientRect = () => new DOMRect(100, 100, 600, 400)
    preview.scrollTo = vi.fn()
    const wide = container.querySelector<HTMLElement>('#wide')!
    Object.defineProperties(wide, { clientWidth: { value: 200 }, scrollWidth: { value: 800 } })
    wide.getBoundingClientRect = () => new DOMRect(200, 150, 200, 100)
    wide.scrollLeft = 100
    wide.scrollTo = vi.fn()
    container.querySelectorAll('mark')[1].getBoundingClientRect = () => new DOMRect(700, 200, 50, 20)
    act(() => result.current.goNext())
    expect(wide.scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 450, behavior: 'auto' })
    expect(preview.scrollTo).not.toHaveBeenCalled()
  })

  it('不逐个排除选择器重复调用原生matches，同时保留跨元素、大小写及重音匹配', async () => {
    container.innerHTML = '<p>caf<strong>é</strong> API</p>'.repeat(30) + '<div class="katex"><span>cafe API</span></div>'
    const matches = vi.spyOn(Element.prototype, 'matches')
    const { result } = renderHook(() => useInPageSearch({ current: container }, 30000))
    act(() => result.current.setQuery('cafe api'))
    await settle()
    expect(result.current.totalCount).toBe(90)
    expect(container.querySelector('.katex mark')).toBeNull()
    expect(Array.from(container.querySelector('.katex')!.attributes).some(attribute => attribute.name.startsWith('data-page-search-excluded-'))).toBe(false)
    expect(matches.mock.calls.filter(([selector]) => selector === '.katex' || selector === '.katex *')).toHaveLength(0)
    act(() => result.current.toggleCaseSensitive())
    await settle()
    expect(result.current.totalCount).toBe(0)
    act(() => result.current.setQuery('cafe API'))
    await settle()
    expect(result.current.totalCount).toBe(90)
  })

  it('实际 Hook 保留500个高亮上限且全部排除区间不残留临时属性', async () => {
    const classes = ['katex', 'mermaid-container', 'echarts-container', 'infographic-container',
      'markmap-container', 'graphviz-container', 'drawio-container', 'plantuml-container']
    container.innerHTML = '<p>needle</p>'.repeat(520)
      + classes.map(name => `<div class="${name}"><span>needle</span></div>`).join('')
    const { result } = renderHook(() => useInPageSearch({ current: container }, 30000))
    act(() => result.current.setQuery('needle'))
    await settle()
    expect(result.current.totalCount).toBe(500)
    expect(container.querySelectorAll('mark.search-highlight')).toHaveLength(500)
    for (const name of classes) expect(container.querySelector(`.${name} mark`)).toBeNull()
    expect(Array.from(container.querySelectorAll('*')).some(element =>
      Array.from(element.attributes).some(attribute => attribute.name.startsWith('data-page-search-excluded-')),
    )).toBe(false)
  })

  it('关闭只移除本次搜索高亮，不遍历全部元素或移除其他功能的标记', async () => {
    container.innerHTML = '<p>needle</p>'.repeat(40) + '<p><mark data-markjs="true" class="search-temp-highlight">other</mark></p>'
    const { result } = renderHook(() => useInPageSearch({ current: container }, 30000))
    act(() => result.current.setQuery('needle'))
    await settle()
    expect(result.current.totalCount).toBe(40)
    const matches = vi.spyOn(Element.prototype, 'matches')
    act(() => result.current.clear())
    expect(container.querySelectorAll('mark.search-highlight')).toHaveLength(0)
    expect(container.querySelector('.search-temp-highlight')?.textContent).toBe('other')
    expect(matches.mock.calls.length).toBe(0)
    expect(container.textContent).toBe('needle'.repeat(40) + 'other')
  })

  it('清除后立即重新输入相同搜索词仍能恢复高亮，不等待旧防抖值清空', async () => {
    container.innerHTML = '<p>needle needle</p>'
    const { result } = renderHook(() => useInPageSearch({ current: container }, 30000))
    act(() => result.current.setQuery('needle'))
    await settle()
    act(() => result.current.clear())
    act(() => result.current.setQuery('needle'))
    await settle()
    expect(result.current.totalCount).toBe(2)
    expect(container.querySelectorAll('mark.search-highlight')).toHaveLength(2)
  })

  it('内容更换后旧标记不能计入新文档，并按保留的搜索词重新匹配', async () => {
    container.innerHTML = '<p>needle needle</p>'
    const { result, rerender } = renderHook(({ content }) => useInPageSearch({ current: container }, content.length, content), { initialProps: { content: 'needle needle' } })
    act(() => result.current.setQuery('needle'))
    await settle()
    expect(result.current.totalCount).toBe(2)
    container.innerHTML = '<p>needle absent</p>'
    rerender({ content: 'needle absent' })
    await settle()
    expect(result.current.totalCount).toBe(1)
    act(() => result.current.goNext())
    expect(container.querySelectorAll('.search-highlight-current')).toHaveLength(1)
  })
})
