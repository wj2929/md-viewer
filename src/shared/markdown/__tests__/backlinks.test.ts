import { describe, expect, it } from 'vitest'
import { analyzeMarkdownSource } from '../analyze'
import { buildBacklinkPresentations } from '../backlinks'

function presentations(source: string) {
  const analysis = analyzeMarkdownSource(source)
  return analysis.links.map(link => ({
    target: link.rawTarget,
    ...buildBacklinkPresentations(source, analysis.links).get(link.sourceRange.startOffset),
  }))
}

describe('buildBacklinkPresentations', () => {
  it('区分正文提及、独立链接和真实表格并保留可见文字', () => {
    const source = [
      '参见 [设计说明](./target.md)，再阅读 [首页](./home.md)。',
      '',
      '- [目标](./target.md) · [首页](./home.md)',
      '',
      '| 文档 | 说明 |',
      '| --- | --- |',
      '| [目标](./target.md) | 安全边界 |',
      '',
      '普通 A | B 文本参见 [目标](./target.md)。',
    ].join('\n')

    expect(presentations(source).filter(item => item.target === './target.md')).toEqual([
      expect.objectContaining({ placement: 'prose', context: '参见 设计说明，再阅读 首页。' }),
      expect.objectContaining({ placement: 'standalone-link', context: '目标 · 首页' }),
      expect.objectContaining({ placement: 'table', context: '目标 · 安全边界' }),
      expect.objectContaining({ placement: 'prose', context: '普通 A | B 文本参见 目标。' }),
    ])
  })

  it('不把块标记和 reference definition 当作正文', () => {
    const source = [
      '# [标题](./target.md)',
      '> [引用](./target.md)',
      '1. [序号](./target.md)',
      '- [ ] [任务](./target.md)',
      '[ref]: ./target.md',
    ].join('\n')

    expect(presentations(source).filter(item => item.target === './target.md').map(item => item.placement))
      .toEqual([
        'standalone-link',
        'standalone-link',
        'standalone-link',
        'standalone-link',
      ])
  })
})
