import { describe, expect, it } from 'vitest'
import { formatAttachmentJson } from '../../src/utils/localAttachmentText'

describe('附件 JSON 保真格式化', () => {
  it('保留大整数、重复键、顺序、指数、负零及字符串转义字面量', () => {
    const input = String.raw`{"id":9007199254740993123,"id":-0,"n":1.00e+400,"x":"\\\"<script>https://a</script>"}`
    const result = formatAttachmentJson(input)
    expect(result.reason).toBeUndefined()
    const lexemes = (text: string) => text.match(/"(?:[^"\\]|\\[\s\S])*"|[^\s]/g)
    expect(lexemes(result.content)).toEqual(lexemes(input))
    expect(result.content).toContain('9007199254740993123')
    expect(result.content).toContain('1.00e+400')
    expect(result.content).toContain('"id": -0')
  })
  it.each(['{}', '[]', 'null', 'true', '5.000', '{"x":[],"y":{}}', String.raw`{"中 文":"\" 空 格 \""}`])(
    '格式化有效JSON不变更内容语义 %s', input => {
      const result = formatAttachmentJson(input)
      expect(result.reason).toBeUndefined()
      expect(JSON.parse(result.content)).toEqual(JSON.parse(input))
    },
  )
  it.each(['', '{"bad":}', '{"x":1,}', 'not json', '{"x":"bad\nnewline"}'])(
    '无效JSON返回完整原文 %s', content => {
      expect(formatAttachmentJson(content)).toEqual({ content, reason: 'invalid' })
    },
  )
  it('输入按UTF-8字节预算，深度和输出超限保留原文而不截断', () => {
    const large = JSON.stringify('中'.repeat(350000))
    expect(formatAttachmentJson(large)).toEqual({ content: large, reason: 'budget' })
    const deep = '['.repeat(65) + '0' + ']'.repeat(65)
    expect(formatAttachmentJson(deep)).toEqual({ content: deep, reason: 'budget' })
    const wideDeep = '['.repeat(64) + Array(20000).fill('0').join(',') + ']'.repeat(64)
    expect(formatAttachmentJson(wideDeep)).toEqual({ content: wideDeep, reason: 'budget' })
  })
  it('接受BOM与CRLF，字符串内的空白及转义不被修改', () => {
    const input = '\uFEFF{\r\n"s":" a  b ","t":"\\t"\r\n}'
    const result = formatAttachmentJson(input)
    expect(result.reason).toBeUndefined()
    expect(result.content).toContain('" a  b "')
    expect(result.content).toContain('"\\t"')
  })
})
