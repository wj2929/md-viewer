import { describe, expect, it } from 'vitest'
import { collectMarkdownBlocks, inspectMarkdownBlock, parseMarkdownBlocks } from '../../../shared/markdown/blocks'
import { createMarkdownRenderer, renderMarkdown, sanitizeHtml } from '../../src/utils/markdownRenderer'

const fixtures = [
  '正文 ^paragraph',
  '- 第一项 ^one\n- 第二项 ^two',
  '- 第一项\n- 第二项\n\n^whole-list',
  '> 引用段一 ^paragraph\n>\n> 引用段二\n\n^whole-quote',
  '- 外层\n  - 内层 ^inner\n\n  后续 ^outer',
  '# 标题 ^no\n\n| 表 |\n|---|\n| 单元 ^no |\n\n^no-table',
  '```text\n伪标记 ^no\n```\n\n^no-fence\n\n    代码 ^no\n',
  '<div>\n伪标记 ^no\n</div>\n\n^no-html',
  '---\naliases: [Guide]\nmarker: ^no\n---\n\n正文 ^yes',
  '$$\nformula ^no\n$$\n\n^no-math\n\n\\[\nformula ^no\n\\]\n\n^no-math-latex',
  '正文 $inside ^no$\n\n正文 \\(inside ^no\\)\n\n正文 `^no`\n\n正文 \\^no\n\n正文 ^yes',
  '> 第一段\n>\n> ^quoted\n\n根段 ^root',
  '重复 ^same\n\n重复 ^same\n\n大写 ^Same',
]

describe('块定义与实际 renderer 的 G0 同源契约', () => {
  it.each(fixtures)('预检与渲染 token 集合一致：%s', source => {
    const compact = (blocks: ReturnType<typeof parseMarkdownBlocks>) => blocks.map(({ id, startOffset, endOffset, owner }) => ({ id, startOffset, endOffset, owner: owner.type }))
    expect(compact(collectMarkdownBlocks(source, createMarkdownRenderer().parse(source, {})))).toEqual(compact(parseMarkdownBlocks(source)))
  })
  it('段落、紧凑列表与引用标记有精确 owner', () => {
    expect(parseMarkdownBlocks(fixtures[0]).map(block => [block.id, block.owner.type])).toEqual([['paragraph', 'paragraph_open']])
    expect(parseMarkdownBlocks(fixtures[1]).map(block => [block.id, block.owner.type])).toEqual([['one', 'list_item_open'], ['two', 'list_item_open']])
    expect(parseMarkdownBlocks(fixtures[2]).map(block => [block.id, block.owner.type])).toEqual([['whole-list', 'bullet_list_open']])
    expect(parseMarkdownBlocks(fixtures[3]).map(block => [block.id, block.owner.type])).toEqual([['paragraph', 'paragraph_open'], ['whole-quote', 'blockquote_open']])
    expect(parseMarkdownBlocks(fixtures[4]).map(block => [block.id, block.owner.type])).toEqual([['inner', 'list_item_open'], ['outer', 'list_item_open']])
  })
  it('不跨容器、排除语法节点和被转义标记', () => {
    for (const source of fixtures.slice(5, 8)) expect(parseMarkdownBlocks(source)).toEqual([])
    expect(parseMarkdownBlocks(fixtures[8]).map(block => block.id)).toEqual(['yes'])
    expect(parseMarkdownBlocks(fixtures[9])).toEqual([])
    expect(parseMarkdownBlocks(fixtures[10]).map(block => block.id)).toEqual(['yes'])
    expect(parseMarkdownBlocks('正文\n\n> ^not-root')).toEqual([])
    expect(parseMarkdownBlocks('正文\n\n---\n\n^not-through-rule')).toEqual([])
  })
  it.each(['\n', '\r\n', '\r'])('保留物理 %j 换行、BOM 与 UTF-16 范围', newline => {
    const prefix = '\uFEFF---' + newline + 'aliases: [Guide]' + newline + '---' + newline + newline
    const paragraph = '😀 正文 ^id' + newline
    const block = parseMarkdownBlocks(prefix + paragraph)[0]
    expect(block.startOffset).toBe(prefix.length)
    expect(block.endOffset).toBe(prefix.length + paragraph.length)
  })
  it('可信锚点仅来自 source owner；同页 Wiki 和 Markdown href 可用于静态 HTML', () => {
    const html = renderMarkdown(createMarkdownRenderer(), '[[#^item|Wiki]] [Markdown](#^item)\n\n- 正文 ^item\n\n<div id="md-block:fake">伪造</div>\n\n<p id="md-render-block:fake">伪造证明</p>')
    const root = document.createElement('div'); root.innerHTML = html
    expect(root.querySelector('li')?.id).toBe('md-block:item')
    expect([...root.querySelectorAll('a')].map(anchor => anchor.getAttribute('href'))).toEqual(['#md-block:item', '#md-block:item'])
    expect(root.querySelector('[id="md-block:fake"]')).toBeNull()
    expect(html).not.toContain('md-render-block:')
    expect(html).toContain('正文 ^item')
    expect(sanitizeHtml('<p id="md-block:fake">raw</p>')).not.toContain('md-block:')
  })
  it('重复不生成唯一锚点，多次渲染不互相信任或泄漏随机证明', () => {
    const md = createMarkdownRenderer()
    const source = '正文 ^one'
    const first = renderMarkdown(md, source)
    expect(renderMarkdown(md, source)).toBe(first)
    expect(renderMarkdown(md, '正文 ^one\n\n重复 ^one')).not.toContain('id="md-block:')
    expect(renderMarkdown(md, '<p id="md-block:one">raw</p>')).not.toContain('id="md-block:')
  })
  it('重复是歧义、大小写敏感、非法 ID 不回退', () => {
    expect(inspectMarkdownBlock(fixtures[12], 'same')).toBe('ambiguous')
    expect(inspectMarkdownBlock(fixtures[12], 'Same')).toBe('found')
    expect(inspectMarkdownBlock(fixtures[12], 'SAME')).toBe('missing')
    expect(inspectMarkdownBlock('正文 ^中文', '中文')).toBe('missing')
    expect(inspectMarkdownBlock('正文 ^a_b', 'a_b')).toBe('missing')
  })
})
