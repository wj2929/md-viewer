import { describe, it, expect, beforeEach, vi } from 'vitest'
import { collectSpeechSegments } from '../../src/tts/segmenter'
import { buildSentenceRange, scrollSentenceIntoView } from '../../src/hooks/useSpeech'

function makeContainer(html: string): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = `<div class="markdown-body">${html}</div>`
  document.body.appendChild(container)
  return container
}

describe('buildSentenceRange 高亮偏移映射', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('每句 Range 框住的文字应等于该句(去空白后)', () => {
    const c = makeContainer(`<p data-source-line="1">第一句。第二句!第三句?</p>`)
    const segs = collectSpeechSegments(c)
    for (const seg of segs) {
      const range = buildSentenceRange(seg.element, seg.charStart, seg.charEnd)
      expect(range?.toString().replace(/\s+/g, ' ')).toBe(seg.text)
    }
  })

  // 核心回归:真实小说对话段(引号内句号 + 段末落单闭引号并入前句)
  it('对话段:高亮框住的字与朗读句子一致,不多框不少框', () => {
    const c = makeContainer(
      `<p data-source-line="7">“旁人都抢红了眼，师弟倒还坐得住。”林渊睁开眼，没起身。</p>`
    )
    const segs = collectSpeechSegments(c)
    // 逐句:高亮实框 == 朗读文本
    for (const seg of segs) {
      const range = buildSentenceRange(seg.element, seg.charStart, seg.charEnd)
      expect(range?.toString().replace(/\s+/g, ' ')).toBe(seg.text)
    }
  })

  it('段末闭引号并入前句后,Range 仍精确框住(含闭引号)', () => {
    const c = makeContainer(`<p>正文内容。”下一句。</p>`)
    const segs = collectSpeechSegments(c)
    const first = segs[0]
    const range = buildSentenceRange(first.element, first.charStart, first.charEnd)
    expect(range?.toString()).toBe(first.text)
  })

  it('当前句子部分可见时不滚动，完全离开可视区域后才平滑滚动', () => {
    const c = makeContainer(`<p>第一句。第二句。</p>`)
    const segment = collectSpeechSegments(c)[0]
    const scrollTo = vi.fn()
    Object.defineProperty(c, 'scrollTop', { configurable: true, value: 100, writable: true })
    Object.defineProperty(c, 'scrollTo', { configurable: true, value: scrollTo })
    vi.spyOn(c, 'getBoundingClientRect').mockReturnValue(rect(0, 300))

    const rangeSpy = vi.spyOn(Range.prototype, 'getBoundingClientRect')
    rangeSpy.mockReturnValueOnce(rect(280, 320))
    scrollSentenceIntoView(c, segment)
    expect(scrollTo).not.toHaveBeenCalled()

    rangeSpy.mockReturnValueOnce(rect(340, 370))
    scrollSentenceIntoView(c, segment)
    expect(scrollTo).toHaveBeenCalledWith({ top: 260, behavior: 'smooth' })
  })

  it('当前句子完全在可视区域上方时平滑向上回到视口', () => {
    const c = makeContainer(`<p>第一句。</p>`)
    const segment = collectSpeechSegments(c)[0]
    const scrollTo = vi.fn()
    Object.defineProperty(c, 'scrollTop', { configurable: true, value: 200, writable: true })
    Object.defineProperty(c, 'scrollTo', { configurable: true, value: scrollTo })
    vi.spyOn(c, 'getBoundingClientRect').mockReturnValue(rect(100, 400))
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rect(40, 80))

    scrollSentenceIntoView(c, segment)
    expect(scrollTo).toHaveBeenCalledWith({ top: 35, behavior: 'smooth' })
  })

  it('展开播放条遮挡的句子不算可见，滚动后落在播放条上方', () => {
    const wrapper = document.createElement('div')
    const c = document.createElement('div')
    c.innerHTML = `<div class="markdown-body"><p>第一句。</p></div>`
    const bar = document.createElement('div')
    bar.className = 'read-aloud-bar'
    wrapper.append(c, bar)
    document.body.appendChild(wrapper)
    const segment = collectSpeechSegments(c)[0]
    const scrollTo = vi.fn()
    Object.defineProperty(c, 'scrollTop', { configurable: true, value: 100, writable: true })
    Object.defineProperty(c, 'scrollTo', { configurable: true, value: scrollTo })
    vi.spyOn(c, 'getBoundingClientRect').mockReturnValue(rect(0, 400))
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(300, 360))
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rect(310, 340))

    scrollSentenceIntoView(c, segment)
    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: 'smooth' })
  })
})

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}
