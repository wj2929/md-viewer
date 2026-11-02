import { describe, expect, it } from 'vitest'
import { analyzeMarkdownSource } from '../../shared/markdown/analyze'
import { readFrontmatterAliases, createWikiDocumentMetadata } from '../indexing/wikiMetadata'

describe('Wiki frontmatter metadata', () => {
  it.each(['\n', '\r\n', '\r'])('保留 %j 换行和 BOM 原始范围', newline => {
    const header = '\uFEFF---' + newline + 'aliases:' + newline + '  - 运维指南' + newline + '  - "版本 1.0"' + newline + '...' + newline
    expect(readFrontmatterAliases(header + '# 正文')).toEqual({
      complete: true, aliases: ['运维指南', '版本 1.0'], frontmatterEnd: header.length,
    })
  })

  it('只读显式 aliases，支持标量、去空及区分大小写', () => {
    expect(readFrontmatterAliases('---\naliases: Guide\n---\n').aliases).toEqual(['Guide'])
    expect(readFrontmatterAliases('---\naliases: [Guide, guide, " Guide ", "", "../escape", "a#b"]\n---').aliases).toEqual(['Guide', 'guide'])
    expect(readFrontmatterAliases('# 普通文档')).toEqual({ complete: true, aliases: [], frontmatterEnd: 0 })
  })

  it.each(['42', '{ x: y }', '[Guide, 3]', '*a', '!custom Guide'])('不强转或展开 %s', value => {
    const source = `---\nother: &a [Guide]\naliases: ${value}\n---\n`
    expect(readFrontmatterAliases(source)).toMatchObject({ complete: true, aliases: [], issue: 'unsupported' })
  })

  it('不求值无关标签或循环引用，也不继承 merge 内的 aliases', () => {
    expect(readFrontmatterAliases('---\nother: !custom x\ncycle: &a [*a]\naliases: Guide\n---').aliases).toEqual(['Guide'])
    expect(readFrontmatterAliases('---\nbase: &b {aliases: Guide}\n<<: *b\n---').aliases).toEqual([])
  })

  it.each(['aliases: A\naliases: B', 'aliases: [A', '"aliases": A\naliases: B'])('结构不可信时不能假装完整', body => {
    expect(readFrontmatterAliases(`---\n${body}\n---`)).toMatchObject({ complete: false, aliases: [], issue: 'invalid' })
  })

  it('无 closing、字节、数量、长度超限均不返回部分 aliases', () => {
    expect(readFrontmatterAliases('---\naliases: A')).toMatchObject({ complete: false, aliases: [] })
    for (const body of [
      'aliases: [' + Array.from({ length: 129 }, (_, index) => 'A' + index).join(',') + ']',
      'aliases: ' + 'x'.repeat(257),
      'other: ' + '中'.repeat(24_000) + '\naliases: A',
    ]) expect(readFrontmatterAliases(`---\n${body}\n---`)).toMatchObject({ complete: false, aliases: [], issue: 'budget' })
  })

  it('runtime 视图区分普通/嵌入 Wiki、排除元数据伪链接，不改持久分析', () => {
    const source = '---\ntitle: "[[Phantom]]"\naliases: [Guide]\n---\n\n[[版本 1.0#^part]]\n![[版本 1.0#^part]]\n'
    const analysis = analyzeMarkdownSource(source)
    const before = JSON.stringify(analysis)
    const metadata = createWikiDocumentMetadata(source, 'revision', analysis.links)
    expect(metadata.revisionToken).toBe('revision')
    expect(metadata.links).toHaveLength(2)
    expect(metadata.links[0]).toMatchObject({ kind: 'markdown', wikiEmbed: false })
    expect(metadata.links[1]).toMatchObject({ kind: 'unsupported', wikiEmbed: true })
    expect(JSON.stringify(analysis)).toBe(before)
    expect(analysis.links.some(link => link.rawTarget === 'Phantom')).toBe(true)
  })
})
