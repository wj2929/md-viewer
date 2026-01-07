import MarkdownIt from 'markdown-it'
import Prism from 'prismjs'
import katex from 'katex'
import { slugify } from './slugify'

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
    html: false,  // 🔒 安全修复: 禁用 HTML 以防止 XSS 攻击
    linkify: true,
    typographer: true,
    breaks: true,
    highlight: (str: string, lang: string) => {
      // Mermaid 特殊处理：保留原始代码，标记为 mermaid（用于 HTML 导出时转换为 SVG）
      if (lang === 'mermaid') {
        return `<pre class="language-mermaid"><code class="language-mermaid">${md.utils.escapeHtml(str)}</code></pre>`
      }

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
      // 跳过开头的 $$ 和 firstLine 内容，取到结尾 $$ 之前的内容
      const startOffset = 2 + firstLine.length  // "$$" 占 2 个字符
      const latex = content.slice(startOffset, content.lastIndexOf('$$')).trim()
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

  // ✅ 自定义标题渲染，为标题添加 id 属性支持目录跳转
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const nextToken = tokens[idx + 1]

    // 每次 render 调用时在 env 中初始化 usedIds
    if (!env._usedIds) {
      env._usedIds = new Set<string>()
    }

    // 获取标题文本
    let titleText = ''
    if (nextToken && nextToken.type === 'inline' && nextToken.children) {
      titleText = nextToken.children
        .filter(t => t.type === 'text' || t.type === 'code_inline')
        .map(t => t.content)
        .join('')
    }

    // 生成唯一 id
    let slug = slugify(titleText)
    let uniqueSlug = slug
    let counter = 1
    while (env._usedIds.has(uniqueSlug)) {
      uniqueSlug = `${slug}-${counter}`
      counter++
    }
    env._usedIds.add(uniqueSlug)

    // 添加 id 属性
    token.attrSet('id', uniqueSlug)

    return self.renderToken(tokens, idx, options)
  }

  return md
}
