import { useEffect, useRef, useMemo, memo } from 'react'
import MarkdownIt from 'markdown-it'
import Prism from 'prismjs'
import katex from 'katex'
import mermaid from 'mermaid'

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

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  // 初始化 Mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
      securityLevel: 'loose'
    })
  }, [])

  // 创建 markdown-it 实例
  const md = useMemo(() => {
    const mdInstance = new MarkdownIt({
      html: false,  // 🔒 安全修复: 禁用 HTML 以防止 XSS 攻击
      linkify: true,
      typographer: true,
      breaks: true,
      highlight: (str: string, lang: string) => {
        // Mermaid 图表特殊处理 - 保留原始代码供后续渲染
        if (lang === 'mermaid') {
          return `<pre class="language-mermaid"><code class="language-mermaid">${mdInstance.utils.escapeHtml(str)}</code></pre>`
        }
        // 代码高亮
        if (lang && Prism.languages[lang]) {
          try {
            return `<pre class="language-${lang}"><code class="language-${lang}">${Prism.highlight(str, Prism.languages[lang], lang)}</code></pre>`
          } catch (e) {
            console.error('Prism highlight error:', e)
          }
        }
        return `<pre class="language-plaintext"><code>${mdInstance.utils.escapeHtml(str)}</code></pre>`
      }
    })

    // 自定义渲染规则：行内数学公式 $...$
    mdInstance.inline.ruler.before('escape', 'math_inline', (state, silent) => {
      if (state.src[state.pos] !== '$') return false
      // 避免匹配 $$ 块级公式
      if (state.src[state.pos + 1] === '$') return false

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
      // 确保不是空内容
      if (end === start + 1) return false

      if (!silent) {
        const latex = state.src.slice(start + 1, end)
        try {
          const html = katex.renderToString(latex, { throwOnError: false })
          const token = state.push('html_inline', '', 0)
          token.content = html
        } catch (e) {
          const token = state.push('html_inline', '', 0)
          token.content = `<span class="katex-error">${mdInstance.utils.escapeHtml(latex)}</span>`
        }
      }

      state.pos = end + 1
      return true
    })

    // 自定义渲染规则：块级数学公式 $$...$$
    mdInstance.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
      let pos = state.bMarks[startLine] + state.tShift[startLine]
      let max = state.eMarks[startLine]

      if (pos + 2 > max) return false
      if (state.src.slice(pos, pos + 2) !== '$$') return false

      pos += 2
      let firstLine = state.src.slice(pos, max)

      if (firstLine.trim().endsWith('$$')) {
        // 单行 $$...$$
        firstLine = firstLine.trim().slice(0, -2)
        const latex = firstLine
        if (!silent) {
          try {
            const html = katex.renderToString(latex, { throwOnError: false, displayMode: true })
            const token = state.push('html_block', '', 0)
            token.content = html + '\n'
          } catch (e) {
            const token = state.push('html_block', '', 0)
            token.content = `<div class="katex-error">${mdInstance.utils.escapeHtml(latex)}</div>\n`
          }
        }
        state.line = startLine + 1
        return true
      }

      // 多行 $$...$$
      let nextLine = startLine
      let lastLine = ''
      let found = false

      while (nextLine < endLine) {
        nextLine++
        pos = state.bMarks[nextLine] + state.tShift[nextLine]
        max = state.eMarks[nextLine]

        if (pos < max && state.sCount[nextLine] < state.blkIndent) {
          break
        }

        if (state.src.slice(pos, max).trim().endsWith('$$')) {
          lastLine = state.src.slice(pos, max).trim().slice(0, -2)
          found = true
          break
        }
      }

      if (!found) return false

      const lines = []
      lines.push(firstLine)
      for (let i = startLine + 1; i < nextLine; i++) {
        lines.push(state.src.slice(state.bMarks[i], state.eMarks[i]))
      }
      lines.push(lastLine)

      const latex = lines.join('\n')

      if (!silent) {
        try {
          const html = katex.renderToString(latex, { throwOnError: false, displayMode: true })
          const token = state.push('html_block', '', 0)
          token.content = html + '\n'
        } catch (e) {
          const token = state.push('html_block', '', 0)
          token.content = `<div class="katex-error">${mdInstance.utils.escapeHtml(latex)}</div>\n`
        }
      }

      state.line = nextLine + 1
      return true
    })

    return mdInstance
  }, [])

  // 渲染 Markdown
  const html = useMemo(() => {
    try {
      // 检查内容是否为空
      if (!content || content.trim().length === 0) {
        return '<p class="placeholder">文件内容为空</p>'
      }

      // 检查内容大小（字符数限制 500KB）
      if (content.length > 500000) {
        return `
          <div class="content-warning">
            <p><strong>文件过大，无法渲染</strong></p>
            <p>文件大小: ${(content.length / 1024).toFixed(2)} KB，最大支持: 500 KB</p>
          </div>
        `
      }

      // 检查行数（超过 10000 行截断）
      const lines = content.split('\n')
      if (lines.length > 10000) {
        const truncated = lines.slice(0, 10000).join('\n')
        const renderedHtml = md.render(truncated)
        return `
          ${renderedHtml}
          <div class="content-warning">
            <p><strong>内容过长，已截断显示</strong></p>
            <p>完整内容共 ${lines.length} 行，当前仅显示前 10000 行。</p>
          </div>
        `
      }

      // 正常渲染
      return md.render(content)
    } catch (error) {
      console.error('[MarkdownRenderer] Render error:', error)
      return `<pre style="color: red;">渲染错误: ${error}</pre>`
    }
  }, [md, content])

  // Mermaid 图表渲染
  useEffect(() => {
    if (!containerRef.current) return

    // 查找 Mermaid 代码块并渲染
    const mermaidBlocks = containerRef.current.querySelectorAll('pre.language-mermaid')
    if (mermaidBlocks.length === 0) return

    mermaidBlocks.forEach(async (block, index) => {
      const code = block.textContent || ''
      const id = `mermaid-${Date.now()}-${index}`

      try {
        const { svg } = await mermaid.render(id, code)
        const wrapper = document.createElement('div')
        wrapper.className = 'mermaid-diagram'
        wrapper.innerHTML = svg
        block.replaceWith(wrapper)
      } catch (error) {
        console.error('Mermaid render error:', error)
        // 渲染失败时保留原始代码
      }
    })
  }, [html])

  return (
    <div
      ref={containerRef}
      className={`markdown-body ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// 🚨 使用 React.memo 防止不必要的重新渲染
export default memo(MarkdownRenderer)
