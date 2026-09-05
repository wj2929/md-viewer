import { describe, expect, it } from 'vitest'
import {
  classifyMarkdownTarget,
  createHeadingIdAllocator,
  markdownAnchorMatches,
  safeDecodeURIComponent,
  slugifyHeading,
  splitMarkdownTarget,
} from '../semantics'

describe('Markdown shared semantics', () => {
  it('生成稳定的 Unicode 标题 slug', () => {
    expect(slugifyHeading(' Hello 世界! ')).toBe('hello-世界')
    expect(slugifyHeading('!@#$')).toBe('heading')
  })

  it('避免重复标题与自然数字后缀碰撞', () => {
    const allocate = createHeadingIdAllocator()
    expect(['Foo', 'Foo', 'Foo-1', '!!!'].map(allocate)).toEqual([
      'foo',
      'foo-1',
      'foo-1-1',
      'heading',
    ])
  })

  it('按原始分隔符拆分 path、query 和 fragment', () => {
    expect(splitMarkdownTarget('./doc%23name.md?view=1#Section%202')).toEqual({
      rawPath: './doc%23name.md',
      decodedPath: './doc#name.md',
      rawQuery: 'view=1',
      query: 'view=1',
      rawAnchor: 'Section%202',
      anchor: 'Section 2',
    })
    expect(splitMarkdownTarget('<./目标%20文档.md#二级标题>')).toMatchObject({
      decodedPath: './目标 文档.md',
      anchor: '二级标题',
    })
  })

  it('对错误 URL 编码安全降级', () => {
    expect(safeDecodeURIComponent('%E0%A4%A')).toBe('%E0%A4%A')
  })

  it('统一分类 Markdown、锚点、外部和不安全目标', () => {
    expect(classifyMarkdownTarget('#intro')).toBe('anchor')
    expect(classifyMarkdownTarget('./doc.MARKDOWN?raw=1#intro')).toBe('markdown')
    expect(classifyMarkdownTarget('https://example.com/a.md')).toBe('external')
    expect(classifyMarkdownTarget('data:text/plain,test')).toBe('data')
    expect(classifyMarkdownTarget('javascript:alert(1)')).toBe('unsupported')
    expect(classifyMarkdownTarget('./asset.png')).toBe('local-resource')
  })

  it('锚点先精确比较，再兼容大小写与横线差异', () => {
    expect(markdownAnchorMatches('my-heading', 'my_heading')).toBe(true)
    expect(markdownAnchorMatches('二级标题', '%E4%BA%8C%E7%BA%A7%E6%A0%87%E9%A2%98')).toBe(true)
    expect(markdownAnchorMatches('first', 'second')).toBe(false)
  })
})
