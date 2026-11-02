import type MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'

const inlineStatesWithoutLatexClose = new WeakSet<StateInline>()

function isEscapedDelimiter(source: string, index: number): boolean {
  let precedingBackslashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) {
    precedingBackslashes++
  }
  return precedingBackslashes % 2 === 1
}


export function installMathRules(md: MarkdownIt): void {
  // 行内数学公式 $...$
  md.inline.ruler.before('escape', 'math_inline', (state: StateInline, silent: boolean): boolean => {
    if (state.src[state.pos] !== '$') return false

    const start = state.pos
    let found = false
    let end = start + 1

    while (end < state.src.length) {
      if (state.src[end] === '$' && state.src[end - 1] !== '\\') {
        found = true
        break
      }
      end++
    }

    if (!found) return false

    if (!silent) {
      const latex = state.src.slice(start + 1, end)
      const token = state.push('math_inline', '', 0)
      token.content = latex
    }

    state.pos = end + 1
    return true
  })

  // 兼容 LaTeX 行内公式 \(...\)，在 markdown-it 转义规则前提取
  md.inline.ruler.before('escape', 'math_inline_latex', (state: StateInline, silent: boolean): boolean => {
    const start = state.pos
    if (state.src.slice(start, start + 2) !== '\\(') return false
    if (inlineStatesWithoutLatexClose.has(state)) return false

    let end = start + 2
    while (end < state.src.length) {
      if (state.src.slice(end, end + 2) === '\\)' && !isEscapedDelimiter(state.src, end)) break
      end++
    }
    if (end >= state.src.length) {
      inlineStatesWithoutLatexClose.add(state)
      return false
    }

    if (!silent) {
      const latex = state.src.slice(start + 2, end)
      const token = state.push('math_inline', '', 0)
      token.content = latex
    }

    state.pos = end + 2
    return true
  })

  // 块级数学公式 $$...$$
  md.block.ruler.before('fence', 'math_block', (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
    let pos = state.bMarks[startLine] + state.tShift[startLine]
    let max = state.eMarks[startLine]

    if (pos + 2 > max) return false
    if (state.src.slice(pos, pos + 2) !== '$$') return false

    pos += 2
    let firstLine = state.src.slice(pos, max)

    if (firstLine.trim().endsWith('$$')) {
      firstLine = firstLine.trim().slice(0, -2)
      const latex = firstLine
      if (!silent) {
        const token = state.push('math_block', '', 0)
        token.content = latex
        token.map = [startLine, startLine + 1]
      }
      state.line = startLine + 1
      return true
    }

    let nextLine = startLine
    let lastLine = startLine
    let lastPos = pos

    while (nextLine < endLine) {
      nextLine++
      if (nextLine >= endLine) break

      pos = state.bMarks[nextLine] + state.tShift[nextLine]
      max = state.eMarks[nextLine]

      if (pos < max && state.src.slice(pos, max).trim().endsWith('$$')) {
        lastPos = state.src.slice(pos, max).lastIndexOf('$$')
        lastLine = nextLine
        break
      }
    }

    if (lastLine === startLine) return false

    if (!silent) {
      const content = state.getLines(startLine, lastLine + 1, 0, false)
      // 跳过开头的 $$ 和 firstLine 内容，取到结尾 $$ 之前的内容
      const startOffset = 2 + firstLine.length  // "$$" 占 2 个字符
      const latex = content.slice(startOffset, content.lastIndexOf('$$')).trim()
      const token = state.push('math_block', '', 0)
      token.content = latex
      token.map = [startLine, lastLine + 1]
    }

    state.line = lastLine + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  // 兼容 LaTeX 块级公式 \[...\]，避免定界符先被 markdown-it 当作转义字符
  md.block.ruler.before('fence', 'math_block_latex', (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
    let pos = state.bMarks[startLine] + state.tShift[startLine]
    let max = state.eMarks[startLine]
    const openingLine = state.src.slice(pos, max).trim()
    if (openingLine !== '\\[') return false

    const firstLine = ''

    let lastLine = startLine
    const latexLines = [firstLine]
    for (let nextLine = startLine + 1; nextLine < endLine; nextLine++) {
      pos = state.bMarks[nextLine] + state.tShift[nextLine]
      max = state.eMarks[nextLine]
      const line = state.src.slice(pos, max)
      const trimmedLine = line.trim()
      if (trimmedLine === '\\]') {
        latexLines.push(line.slice(0, line.lastIndexOf('\\]')))
        lastLine = nextLine
        break
      }
      if (
        state.isEmpty(nextLine)
        || trimmedLine === '\\['
        || /^(?:>\s*|[-+*]\s+|\d+[.)]\s+)\\\[$/.test(trimmedLine)
      ) return false
      latexLines.push(line)
    }
    if (lastLine === startLine) return false
    if (!silent) {
      const latex = latexLines.join('\n').trim()
      const token = state.push('math_block', '', 0)
      token.content = latex
      token.map = [startLine, lastLine + 1]
    }
    state.line = lastLine + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}
