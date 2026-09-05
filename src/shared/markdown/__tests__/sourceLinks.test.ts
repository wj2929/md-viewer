import { describe, expect, it } from 'vitest'
import { scanMarkdownLinkDestinations } from '../sourceLinks'

describe('scanMarkdownLinkDestinations', () => {
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

  it('忽略 fenced code、inline code、escaped 和 malformed links', () => {
    const source = [
      '`[code](skip.md)`',
      '\\[escaped](skip.md)',
      '[broken](skip.md',
      '```md',
      '[fenced](skip.md)',
      '```',
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
