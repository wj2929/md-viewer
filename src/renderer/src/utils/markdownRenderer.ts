import MarkdownIt from 'markdown-it'
import Prism from 'prismjs'
import katex from 'katex'

// 导入 Prism 语言支持
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-css'

/**
 * 创建配置完整的 markdown-it 实例（包含 KaTeX 和 Prism 支持）
 */
export function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true,
    highlight: (str: string, lang: string) => {
      if (lang && Prism.languages[lang]) {
        try {
          return `<pre class="language-${lang}"><code class="language-${lang}">${Prism.highlight(str, Prism.languages[lang], lang)}</code></pre>`
        } catch (e) {
          console.error('Prism highlight error:', e)
        }
      }
      return `<pre class="language-plaintext"><code>${md.utils.escapeHtml(str)}</code></pre>`
    }
  })

  // 行内数学公式 $...$
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
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
      try {
        const html = katex.renderToString(latex, { throwOnError: false })
        const token = state.push('html_inline', '', 0)
        token.content = html
      } catch (e) {
        const token = state.push('html_inline', '', 0)
        token.content = `<span class="katex-error">${latex}</span>`
      }
    }

    state.pos = end + 1
    return true
  })

  // 块级数学公式 $$...$$
  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
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
        try {
          const html = katex.renderToString(latex, { throwOnError: false, displayMode: true })
          const token = state.push('html_block', '', 0)
          token.content = html + '\n'
        } catch (e) {
          const token = state.push('html_block', '', 0)
          token.content = `<div class="katex-error">${latex}</div>\n`
        }
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
      const latex = content.slice(firstLine.length, content.lastIndexOf('$$')).trim()
      try {
        const html = katex.renderToString(latex, { throwOnError: false, displayMode: true })
        const token = state.push('html_block', '', 0)
        token.content = html + '\n'
      } catch (e) {
        const token = state.push('html_block', '', 0)
        token.content = `<div class="katex-error">${latex}</div>\n`
      }
    }

    state.line = lastLine + 1
    return true
  })

  return md
}
