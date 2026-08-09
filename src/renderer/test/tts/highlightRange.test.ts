import { describe, it, expect, beforeEach } from 'vitest'
import { collectSpeechSegments } from '../../src/tts/segmenter'
import { buildSentenceRange } from '../../src/hooks/useSpeech'

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
})
