import { describe, expect, it } from 'vitest'
import { findExcludedCodeRanges, scanMarkdownLinkDestinations } from '../sourceLinks'

describe('scanMarkdownLinkDestinations', () => {
  it('大量行内代码与Wiki链接交替时保留精确排除和UTF-16范围', () => {
    const source = Array.from({ length: 1200 }, (_, index) =>
      `\`[[hidden-${index}]]\` [[visible-${index}|😀]]\r\n`,
    ).join('')
    const links = scanMarkdownLinkDestinations(source)
    expect(links.map(link => link.rawTarget)).toEqual(Array.from({ length: 1200 }, (_, index) => `visible-${index}`))
    for (const link of links) {
      const range = link.destinationRange!
      expect(source.slice(range.startOffset, range.endOffset)).toBe(link.rawTarget)
    }
  })

  it('围栏、缩进和跨行行内代码的排除并集有序且不重叠', () => {
    const source = '[before](before.md)\r\n\r\n`open\r\n```md\r\n[[hidden]]\r\n```\r\nclose`\r\n\r\n    [[indented]]\r\n\r\n[after](after.md)'
    const ranges = findExcludedCodeRanges(source)
    for (let index = 1; index < ranges.length; index++) expect(ranges[index - 1][1]).toBeLessThan(ranges[index][0])
    expect(scanMarkdownLinkDestinations(source).map(link => link.rawTarget)).toEqual(['before.md', 'after.md'])
    for (const marker of ['[[hidden]]', '[[indented]]']) {
      const offset = source.indexOf(marker)
      expect(ranges.some(([start, end]) => offset >= start && offset < end)).toBe(true)
    }
  })

  it('半开排除区间结束后的第一个链接不会被漏掉', () => {
    const source = '`[[hidden]]`[[first]]\n\n~~~md\n[[fenced]]\n~~~\n[[second]]'
    expect(scanMarkdownLinkDestinations(source).map(link => link.rawTarget)).toEqual(['first', 'second'])
  })

  it('返回 UTF-16 半开 destination ranges', () => {
    const source = 'A [x](docs/😀.md#h) Z'
    const [link] = scanMarkdownLinkDestinations(source)

    expect(link.rawTarget).toBe('docs/😀.md#h')
    expect(link.destinationRange).toBeDefined()
    const destinationRange = link.destinationRange!
    expect(source.slice(destinationRange.startOffset, destinationRange.endOffset)).toBe(link.rawTarget)
    expect(destinationRange).toMatchObject({
      startOffset: 6,
      endOffset: 18,
      startLine: 1,
      startColumn: 7,
      endLine: 1,
      endColumn: 19,
    })
  })

  it('保留尖括号和 title，只选中原始 destination lexeme', () => {
    const source = '[x](<a b.md#c> "title") and ![img](a(b)c.png \'caption\')'
    const links = scanMarkdownLinkDestinations(source)

    expect(links.map(link => ({ syntax: link.syntax, isImage: link.isImage, target: link.rawTarget }))).toEqual([
      { syntax: 'inline', isImage: false, target: 'a b.md#c' },
      { syntax: 'inline', isImage: true, target: 'a(b)c.png' },
    ])
    for (const link of links) {
      expect(link.destinationRange).toBeDefined()
      const destinationRange = link.destinationRange!
      expect(source.slice(destinationRange.startOffset, destinationRange.endOffset)).toBe(link.rawTarget)
    }
  })

  it('支持 escaped parenthesis、CRLF 和 reference definition', () => {
    const source = [
      '[inline](a\\)b.md)',
      '',
      '[usage][Ref Label]',
      '',
      '[Ref Label]: <docs/目标😀.md> "标题"',
    ].join('\r\n')
    const links = scanMarkdownLinkDestinations(source)

    expect(links.map(link => link.rawTarget)).toEqual(['a\\)b.md', 'docs/目标😀.md'])
    expect(links[1]).toMatchObject({
      syntax: 'reference-definition',
      referenceLabel: 'ref label',
      destinationRange: { startLine: 5 },
    })
  })

  it('忽略 fenced、缩进、inline code、escaped 和 malformed links', () => {
    const source = [
      '`[code](skip.md)`',
      '\\[escaped](skip.md)',
      '[broken](skip.md',
      '```md',
      '[fenced](skip.md)',
      '```',
      '    [[indented/skip]]',
      '\t![[indented-image.png]]',
      '[real](keep.md)',
    ].join('\n')

    expect(scanMarkdownLinkDestinations(source).map(link => link.rawTarget)).toEqual(['keep.md'])
  })

  it('确认 autolink 语义，并把 HTML target 仅报告为不可改写', () => {
    const source = '<https://example.com/a> <a href="docs/a.md">A</a> <img src="img/a.png">'
    const links = scanMarkdownLinkDestinations(source)

    expect(links.map(link => ({ syntax: link.syntax, rawTarget: link.rawTarget, editable: Boolean(link.destinationRange) }))).toEqual([
      { syntax: 'autolink', rawTarget: 'https://example.com/a', editable: true },
      { syntax: 'html', rawTarget: 'docs/a.md', editable: false },
      { syntax: 'html', rawTarget: 'img/a.png', editable: false },
    ])
  })

  it('Wiki destination range 只覆盖路径并保留 fragment 与 alias', () => {
    const source = '参见 [[docs/Target#标题|显示名]] 和 ![[video.mp4#t=1,2|320x180]]。'
    const links = scanMarkdownLinkDestinations(source)

    expect(links).toHaveLength(2)
    expect(links[0]).toMatchObject({ syntax: 'wiki', rawTarget: 'docs/Target#标题' })
    expect(source.slice(
      links[0].destinationRange!.startOffset,
      links[0].destinationRange!.endOffset,
    )).toBe('docs/Target')
    expect(links[1]).toMatchObject({ syntax: 'wiki', rawTarget: 'video.mp4#t=1,2' })
    expect(source.slice(
      links[1].destinationRange!.startOffset,
      links[1].destinationRange!.endOffset,
    )).toBe('video.mp4')
  })

  it('Wiki destination range 排除目标前后的空白', () => {
    const source = '[[  docs/Target  #标题|显示名]]'
    const [link] = scanMarkdownLinkDestinations(source)

    expect(link.rawTarget).toBe('docs/Target  #标题')
    expect(source.slice(
      link.destinationRange!.startOffset,
      link.destinationRange!.endOffset,
    )).toBe('docs/Target')
  })

  it('同一 reference definition 只产生一个可编辑 range', () => {
    const source = '[one][ref] [two][ref]\n\n[ref]: target.md#heading'
    const links = scanMarkdownLinkDestinations(source)

    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      syntax: 'reference-definition',
      rawTarget: 'target.md#heading',
      referenceLabel: 'ref',
    })
  })
})
