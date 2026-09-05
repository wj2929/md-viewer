import { describe, expect, it } from 'vitest'
import { analyzeMarkdownSource, tokenizeSearchText } from '../analyze'

describe('analyzeMarkdownSource', () => {
  it('统一输出 headings、links、source ranges 和 terms', () => {
    const source = '# Foo\n# Foo\n# Foo-1\n\n参见 [设计](./docs/design.md#安全边界)。'
    const analysis = analyzeMarkdownSource(source)

    expect(analysis.headings.map(heading => heading.id)).toEqual(['foo', 'foo-1', 'foo-1-1'])
    expect(analysis.links[0]).toMatchObject({
      syntax: 'inline',
      rawTarget: './docs/design.md#安全边界',
      decodedTarget: './docs/design.md#安全边界',
      kind: 'markdown',
      anchor: '安全边界',
      lineStart: 5,
    })
    const range = analysis.links[0].destinationRange!
    expect(source.slice(range.startOffset, range.endOffset)).toBe('./docs/design.md#安全边界')
    expect(analysis.terms).toMatchObject({ foo: 3, 参见: 2, 设计: 2 })
  })

  it('中文搜索同时保留词、单字和二元片段', () => {
    expect(tokenizeSearchText('安全边界')).toEqual(expect.arrayContaining([
      '安全边界', '安', '全', '边', '界', '安全', '全边', '边界',
    ]))
  })
})
