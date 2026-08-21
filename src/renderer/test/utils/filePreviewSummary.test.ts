import { describe, expect, it } from 'vitest'
import { extractFilePreview } from '../../src/utils/filePreviewSummary'

describe('extractFilePreview', () => {
  it('移除开头的 frontmatter、代码块和 Markdown 装饰', () => {
    const source = [
      '---',
      'title: 内部标题',
      'tags: [preview]',
      '---',
      '# 正文标题',
      '',
      '**重点内容**与[参考链接](https://example.com)。',
      '',
      '```ts',
      'const secret = true',
      '```',
      '',
      '- 第一项',
    ].join('\n')

    expect(extractFilePreview(source)).toBe([
      '正文标题',
      '',
      '重点内容与参考链接。',
      '',
      '• 第一项',
    ].join('\n'))
  })

  it('未闭合的 frontmatter 不会误删正文', () => {
    expect(extractFilePreview('---\ntitle: 示例\n# 正文')).toContain('title: 示例')
  })

  it('优先在自然句末截断并明确显示省略号', () => {
    const firstSentence = '这是应该完整保留的第一句话。'
    const source = `${firstSentence}${'这是用于填充摘要空间的后续句子。'.repeat(40)}`
    const preview = extractFilePreview(source)

    expect(preview).toMatch(/。…$/)
    expect(preview).toContain(firstSentence)
    expect(Array.from(preview).length).toBeLessThanOrEqual(500)
    expect(preview.length).toBeLessThan(source.length)
  })

  it('短内容不追加省略号', () => {
    expect(extractFilePreview('# 标题\n\n简短正文。')).toBe('标题\n\n简短正文。')
  })

  it('只有代码块时返回稳定空状态', () => {
    expect(extractFilePreview('```js\nconsole.log(1)\n```')).toBe('（未找到可预览的正文）')
  })
})
