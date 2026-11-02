import { describe, expect, it } from 'vitest'
import { formatAttachmentJson, formatAttachmentJsonLines } from '../../src/utils/localAttachmentText'

const lexemes = (source: string) => source.match(/"(?:[^"\\]|\\[\s\S])*"|[^\s]/g)

describe('JSONL/NDJSON逐条保真排版', () => {
  it('逐条展开，以空行分隔，不合并成数组或丢失记录', () => {
    const first = '{"shard":"db1","indexes":{"PRIMARY":{"unique":true,"columns":[{"column":"id"}]}}}'
    const second = '{"shard":"db2","table":"orders","rows":42}'
    const source = first + '\n' + second + '\n'
    const result = formatAttachmentJsonLines(source)
    expect(result).toEqual({ content: formatAttachmentJson(first).content + '\n\n' + formatAttachmentJson(second).content })
    expect(lexemes(result.content)).toEqual(lexemes(source))
  })

  it('保留大整数、重复键、负零、指数及含换行/HTML的转义字符串', () => {
    const source = String.raw`{"id":9007199254740993123,"id":-0,"n":1.00e+400,"s":" a  b\n\"<script>test</script>"}` + '\n' + '{"id":2}'
    const result = formatAttachmentJsonLines(source)
    expect(result.reason).toBeUndefined()
    expect(lexemes(result.content)).toEqual(lexemes(source))
    for (const literal of ['9007199254740993123', '"id": -0', '1.00e+400', String.raw`\n\"<script>`]) expect(result.content).toContain(literal)
  })

  it('支持文件开头BOM、CRLF、空行、尾部换行以及数组/标量记录', () => {
    const source = '﻿\r\n {"x":1}\r\n \t\r\n[true,null]\r\n"text"\r\n-0\r\n'
    const result = formatAttachmentJsonLines(source)
    expect(result.reason).toBeUndefined()
    expect(result.content).toBe(['{"x":1}', '[true,null]', '"text"', '-0'].map(line => formatAttachmentJson(line).content).join('\n\n'))
  })

  it.each(['', '\n\r\n \t\n'])('空输入不报错或伪造记录：%s', source => {
    expect(formatAttachmentJsonLines(source)).toEqual({ content: source })
  })

  it.each([
    ['{"ok":1}\n{bad}\n{"ok":2}', 2], ['\n{"ok":1}\n{"a":}', 3],
    ['{"a":1}\n﻿{"b":2}', 2], ['{\n"x":1\n}', 1],
  ] as const)('任一非法记录完整回退并报告原始行号：%s', (source, invalidLine) => {
    expect(formatAttachmentJsonLines(source)).toEqual({ content: source, reason: 'invalid', invalidLine })
  })

  it('输入UTF-8字节、记录数和单条深度均受预算保护', () => {
    for (const source of [JSON.stringify('中'.repeat(350_000)), '0\n'.repeat(10_001), '{"ok":1}\n' + '['.repeat(65) + '0' + ']'.repeat(65)]) {
      expect(formatAttachmentJsonLines(source)).toEqual({ content: source, reason: 'budget' })
    }
    expect(formatAttachmentJsonLines('0\n'.repeat(10_000)).reason).toBeUndefined()
  })

  it('总输出限制为2MiB，而不是允许每条各占2MiB；失败不返回已格式化前缀', () => {
    const record = '['.repeat(32) + Array(1000).fill('0').join(',') + ']'.repeat(32)
    expect(formatAttachmentJson(record).reason).toBeUndefined()
    const source = Array(40).fill(record).join('\n')
    expect(formatAttachmentJsonLines(source)).toEqual({ content: source, reason: 'budget' })
  })
})
