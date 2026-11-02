import { format, tokenize } from '@sqltools/formatter'

export type SqlFormatResult = { content: string; reason?: 'unsupported' | 'budget' | 'unavailable' }

const MAX_INPUT_BYTES = 128 * 1024
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_TOKENS = 10_000
const MAX_DEPTH = 64
const unsupportedWords = /^(?:BEGIN|PROCEDURE|FUNCTION|TRIGGER|DECLARE|DELIMITER|GO|DO|EXEC|EXECUTE|COPY)$/i
const standardOperator = /^(?:[(),.;+*/%=<>-]|!=|<>|<=|>=|\|\|)$/
const completeString = /^(?:N?'(?:[^'\\]|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\])$/u

type Token = ReturnType<typeof tokenize>[number]
const significant = (tokens: Token[]) => tokens.filter(token => token.type !== 'whitespace')
const tokenValue = (token: Token): string => {
  if (token.type.startsWith('reserved')) return token.value.replace(/\s+/g, ' ')
  if (token.type === 'line-comment') return token.value.replace(/(?:\r\n|\r|\n)$/, '')
  if (token.type === 'block-comment') return token.value.replace(/\n[ \t]*/g, '\n')
  return token.value
}

// 使用库的公开词法接口保守筛选，不实现SQL解析器，也不作跨方言语义保证。
export function formatAttachmentSql(source: string): SqlFormatResult {
  const fallback = (reason: SqlFormatResult['reason']): SqlFormatResult => ({ content: source, reason })
  const encoder = new TextEncoder()
  if (source.length > MAX_INPUT_BYTES || encoder.encode(source).length > MAX_INPUT_BYTES) return fallback('budget')
  try {
    const tokens = tokenize(source)
    if (tokens.length > MAX_TOKENS) return fallback('budget')
    if (tokens.some((token, index) => token.type === 'string' && index > 0 &&
      /^(?:word|reserved.*)$/.test(tokens[index - 1].type))) return fallback('unsupported')
    const before = significant(tokens)
    if (before.some((token, index) => token.type === 'operator' && token.value === '-' && before[index + 1]?.value === '-')) return fallback('unsupported')
    const stack: string[] = []
    let previousString = false
    for (const token of before) {
      const { type, value } = token
      if (type === 'word' && (/^[0-9]/.test(value) || unsupportedWords.test(value)) ||
        type.startsWith('reserved') && unsupportedWords.test(value)) return fallback('unsupported')
      if (type === 'string') {
        if (!completeString.test(value) || previousString) return fallback('unsupported')
        previousString = true
      } else if (type !== 'line-comment' && type !== 'block-comment') previousString = false
      if (type === 'line-comment' && (!value.startsWith('--') || /[\r\n]/.test(tokenValue(token)))) return fallback('unsupported')
      if (type === 'block-comment' && (!value.endsWith('*/') || value.slice(2).includes('/*'))) return fallback('unsupported')
      if (type === 'placeholder' && !/^(?:\?|\$[0-9]+|[@:%][\p{L}_][\p{L}\p{N}_]*)$/u.test(value)) return fallback('unsupported')
      if (type === 'no-space-operator' || type === 'servervariable' || type === 'operator' && !standardOperator.test(value)) return fallback('unsupported')
      if (type === 'open-paren') {
        stack.push(value.toUpperCase())
        if (stack.length > MAX_DEPTH) return fallback('budget')
      } else if (type === 'close-paren' && stack.pop() !== (value === ')' ? '(' : 'CASE')) return fallback('unsupported')
    }
    if (stack.length) return fallback('unsupported')
    const output = format(source, { language: 'sql', indent: '  ' })
    if (encoder.encode(output).length > MAX_OUTPUT_BYTES) return fallback('budget')
    const formattedTokens = tokenize(output)
    const after = significant(formattedTokens)
    if (before.length !== after.length || before.some((token, index) =>
      token.type !== after[index].type || tokenValue(token) !== tokenValue(after[index]))) return fallback('unsupported')
    // 库会重排块注释缩进；核对其余内容后恢复原始注释，不改注释内部空白。
    const comments = before.filter(token => token.type === 'block-comment')
    let comment = 0
    const content = formattedTokens.map(token => token.type === 'block-comment' ? comments[comment++].value : token.value).join('')
    return encoder.encode(content).length > MAX_OUTPUT_BYTES ? fallback('budget') : { content }
  } catch {
    return fallback('unsupported')
  }
}
