import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { attachmentLanguage, loadAttachmentHighlight, withinAttachmentHighlightBudget } from '../../src/utils/localAttachmentHighlight'

describe('附件高亮语言与预算', () => {
  it.each([
    ['.json', 'json'], ['.JSON', 'json'], ['.jsonl', 'json'], ['.ndjson', 'json'],
    ['.sql', 'sql'], ['.yaml', 'yaml'], ['.yml', 'yaml'],
    ['.xml', 'xml'], ['.html', 'xml'], ['.htm', 'xml'], ['.svg', 'xml'],
  ])('%s 映射到 %s', (extension, language) => {
    expect(attachmentLanguage(extension)).toBe(language)
  })
  it.each(['.txt', '.log', '.csv', '.tsv', '.js', '.unknown', '', '__proto__', 'constructor'])(
    '%s 不猜测语言', extension => expect(attachmentLanguage(extension)).toBeUndefined(),
  )
  it('限制UTF-8总字节、实际行数和单行长度，接受边界及CRLF', () => {
    expect(withinAttachmentHighlightBudget('')).toBe(true)
    expect(withinAttachmentHighlightBudget(('x'.repeat(1023) + '\n').repeat(1024))).toBe(true)
    expect(withinAttachmentHighlightBudget(('x'.repeat(1023) + '\n').repeat(1024) + 'x')).toBe(false)
    expect(withinAttachmentHighlightBudget('中\n'.repeat(20_000 - 1))).toBe(true)
    expect(withinAttachmentHighlightBudget('中\n'.repeat(20_000))).toBe(false)
    expect(withinAttachmentHighlightBudget('x\r\n'.repeat(20_000 - 1))).toBe(true)
    expect(withinAttachmentHighlightBudget('x\r'.repeat(20_000))).toBe(false)
    expect(withinAttachmentHighlightBudget('x'.repeat(16 * 1024))).toBe(true)
    expect(withinAttachmentHighlightBudget('x'.repeat(16 * 1024 + 1))).toBe(false)
    expect(withinAttachmentHighlightBudget(('中'.repeat(1000) + '\n').repeat(400))).toBe(false)
  })
})

describe('真实词法模式', () => {
  it.each([
    ['json', '{"id":9007199254740993123,"enabled":true}', '9007199254740993123'],
    ['json', '{"id":1}\n{"id":2,"enabled":true}\n', '2'],
    ['sql', "-- 注释\nSELECT '中文' AS name, 42 AS total FROM records;", 'SELECT'],
    ['yaml', 'name: "中文"\ncount: 42\n# 注释\n', '42'],
    ['xml', '<root name="中文"><item>value</item></root>', 'root'],
  ] as const)('%s 只提供着色，不改写文档', async (language, doc, token) => {
    const extension = await loadAttachmentHighlight(language)
    const state = EditorState.create({ doc, extensions: [extension] })
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)
    expect(tree).not.toBeNull()
    const highlights: string[] = []
    highlightTree(tree!, classHighlighter, (from, to) => highlights.push(state.doc.sliceString(from, to)))
    expect(highlights).toContain(token)
    expect(state.doc.toString()).toBe(doc)
    expect(await loadAttachmentHighlight(language)).toBe(extension)
  })
})
