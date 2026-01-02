import { useEffect, useRef, useMemo, useState } from 'react'
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

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  // 创建 markdown-it 实例
  const md = useMemo(() => {
    const mdInstance = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: true,
      highlight: (str: string, lang: string) => {
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
            token.content = `<div class="katex-error">${latex}</div>\n`
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
          token.content = `<div class="katex-error">${latex}</div>\n`
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
      setRenderError(null)

      // 检查内容大小 (超过 10000 行截断)
      const lines = content.split('\n')
      if (lines.length > 10000) {
        const truncated = lines.slice(0, 10000).join('\n')
        const renderedHtml = md.render(truncated)
        return `
          ${renderedHtml}
          <div class="content-warning">
            <p><strong>⚠️ 内容过长，已截断显示</strong></p>
            <p>完整内容共 ${lines.length} 行，当前仅显示前 10000 行。</p>
          </div>
        `
      }

      return md.render(content)
    } catch (error) {
      console.error('Markdown render error:', error)
      setRenderError(error instanceof Error ? error.message : '渲染失败')
      return `<pre>${content}</pre>`  // 降级显示原始内容
    }
  }, [md, content])

  // 显示错误信息
  if (renderError) {
    return (
      <div className={`markdown-body ${className}`}>
        <div className="render-error">
          <h3>⚠️ Markdown 渲染失败</h3>
          <p>{renderError}</p>
          <p className="error-hint">已切换为纯文本模式显示</p>
        </div>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }

  // 高亮代码块
  useEffect(() => {
    if (containerRef.current) {
      // Prism 已经在 highlight 函数中处理了
      // 这里只是确保容器内的代码被正确渲染
      const codeBlocks = containerRef.current.querySelectorAll('pre code')
      codeBlocks.forEach((block) => {
        // 已经被 highlight 处理过了，无需再次高亮
      })
    }
  }, [html])

  return (
    <div
      ref={containerRef}
      className={`markdown-body ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
