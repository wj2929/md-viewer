import { describe, it, expect, beforeEach } from 'vitest'
import { collectSpeechSegments, findViewportStartIndex, splitSentences } from '../../src/tts/segmenter'

function makeContainer(html: string): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = `<div class="markdown-body">${html}</div>`
  document.body.appendChild(container)
  return container
}

describe('collectSpeechSegments', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('收集 h/p/blockquote/li 的纯文本(无句末标点则整块一句)', () => {
    const c = makeContainer(`
      <h1 data-source-line="1">标题</h1>
      <p data-source-line="2">第一段正文</p>
      <blockquote data-source-line="3">引用文字</blockquote>
    `)
    const segs = collectSpeechSegments(c)
    expect(segs.map(s => s.text)).toEqual(['标题', '第一段正文', '引用文字'])
    expect(segs[1].sourceLine).toBe(2)
  })

  it('把多句段落按中文标点切成句子级单元,并带元素内字符偏移', () => {
    const c = makeContainer(`<p data-source-line="4">第一句。第二句!第三句?</p>`)
    const segs = collectSpeechSegments(c)
    expect(segs.map(s => s.text)).toEqual(['第一句。', '第二句!', '第三句?'])
    // 同一宿主元素
    expect(new Set(segs.map(s => s.element)).size).toBe(1)
    // 字符偏移连续覆盖
    expect(segs[0].charStart).toBe(0)
    expect(segs[0].charEnd).toBe(4)
    expect(segs[1].charStart).toBe(4)
    // 都记录源码行
    expect(segs.every(s => s.sourceLine === 4)).toBe(true)
  })

  it('跳过 pre(代码/图表源码)与其内部文本', () => {
    const c = makeContainer(`
      <p>正常段落</p>
      <pre data-preview-read-only-reason="chart-code"><code>graph TD; A--&gt;B</code></pre>
    `)
    const segs = collectSpeechSegments(c)
    expect(segs.map(s => s.text)).toEqual(['正常段落'])
  })

  it('li 内的 p 不重复朗读(只读 li)', () => {
    const c = makeContainer(`
      <ul><li data-source-line="5"><p>列表项文本</p></li></ul>
    `)
    const segs = collectSpeechSegments(c)
    expect(segs.map(s => s.text)).toEqual(['列表项文本'])
  })

  it('跳过空文本块', () => {
    const c = makeContainer(`<p>  </p><p>有内容</p>`)
    const segs = collectSpeechSegments(c)
    expect(segs.map(s => s.text)).toEqual(['有内容'])
  })

  it('容器为 null 返回空', () => {
    expect(collectSpeechSegments(null)).toEqual([])
  })

  it('句内多余空白压缩(念得干净);换行作句界切分', () => {
    const c = makeContainer(`<p>多个    空格\n换行</p>`)
    const segs = collectSpeechSegments(c)
    // \n 作句界 → 两句;句内连续空格压缩为单空格
    expect(segs.map(s => s.text)).toEqual(['多个 空格', '换行'])
  })
})

describe('splitSentences', () => {
  it('按中文句末标点切句,标点归入前句', () => {
    const r = splitSentences('你好世界。今天天气不错!要出门吗?')
    expect(r.map(x => x.text)).toEqual(['你好世界。', '今天天气不错!', '要出门吗?'])
  })

  it('偏移可还原原文子串', () => {
    const text = '第一句。第二句。'
    const r = splitSentences(text)
    for (const s of r) {
      expect(text.slice(s.start, s.end)).toBe(s.text)
    }
  })

  it('无句末标点整体作一句', () => {
    const r = splitSentences('没有标点的一段话')
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('没有标点的一段话')
  })

  it('空串返回空', () => {
    expect(splitSentences('   ')).toEqual([])
  })

  it('分号/省略号也切句', () => {
    const r = splitSentences('前项;后项……结束')
    expect(r.map(x => x.text)).toEqual(['前项;', '后项……', '结束'])
  })

  // 回归:段末闭引号落单成句(真实小说文本:…坐得住。” 末尾的 ” 单独成句,
  // edge 对纯标点返回空音频 → 误触发 fallback 到系统声 + 读出"引号")
  it('段末落单的闭引号并入前句,不单独成句', () => {
    const r = splitSentences('“旁人都抢红了眼，师弟倒还坐得住。”')
    // 不得出现只含标点的句子
    expect(r.every(x => /[\p{L}\p{N}]/u.test(x.text))).toBe(true)
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('“旁人都抢红了眼，师弟倒还坐得住。”')
  })

  it('纯标点/引号句被丢弃或并入,绝不单独成句', () => {
    const r = splitSentences('正文。”')
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('正文。”')
  })

  it('段首落单标点(无前句可并)直接丢弃', () => {
    const r = splitSentences('”。正文内容。')
    expect(r.map(x => x.text)).toEqual(['正文内容。'])
  })

  // 回归:句号在闭引号前,闭引号被切到下句开头 → 应黏回前句句尾(否则高亮/朗读引号错位)
  it('句号后的闭引号黏回前一句,不留在下句开头', () => {
    const r = splitSentences('“哼，一个废物，不值当我出手。”场面话撂完。')
    expect(r.map(x => x.text)).toEqual([
      '“哼，一个废物，不值当我出手。”',
      '场面话撂完。',
    ])
    // 偏移可还原原文(高亮精确)
    const text = '“哼，一个废物，不值当我出手。”场面话撂完。'
    for (const s of r) expect(text.slice(s.start, s.end)).toBe(s.text)
  })

  it('多种后置闭合标点(引号/括号/书名号)都黏回前句', () => {
    expect(splitSentences('看《书》。）后文。').map(x => x.text)).toEqual(['看《书》。）', '后文。'])
  })
})

describe('findViewportStartIndex', () => {
  it('空队列或无容器返回 0', () => {
    expect(findViewportStartIndex([], null)).toBe(0)
    expect(findViewportStartIndex([], document.createElement('div'))).toBe(0)
  })

  it('jsdom 下 getBoundingClientRect 均为 0,首个 top>=containerTop 命中索引 0', () => {
    const c = makeContainer(`<p>a</p><p>b</p>`)
    const segs = collectSpeechSegments(c)
    // jsdom 中所有 rect 为 0,containerTop=0,首段 top(0)>=0-tolerance 命中
    expect(findViewportStartIndex(segs, c)).toBe(0)
  })
})
