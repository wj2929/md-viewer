import { useEffect, useRef, useMemo, memo, useCallback } from 'react'
import MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import Prism from 'prismjs'
import katex from 'katex'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'

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
 * DOMPurify 配置（防御 XSS 攻击）
 */
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li',
    'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr',
    'th', 'td', 'img', 'strong', 'em', 'del', 's', 'br', 'hr', 'input',
    'div', 'span', 'sup', 'sub'
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'type', 'checked', 'disabled'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
  ALLOW_DATA_ATTR: false
}

/**
 * 安全的 HTML 消毒函数
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG)
}

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
    const mdInstance: MarkdownIt = new MarkdownIt({
      html: false,  // 🔒 安全修复: 禁用 HTML 以防止 XSS 攻击
      linkify: true,
      typographer: true,
      breaks: true,
      highlight: (str: string, lang: string): string => {
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
    mdInstance.inline.ruler.before('escape', 'math_inline', (state: StateInline, silent: boolean): boolean => {
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
    mdInstance.block.ruler.before('fence', 'math_block', (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
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
        const rawHtml = md.render(truncated)
        const sanitizedHtml = sanitizeHtml(rawHtml)  // ✅ XSS 防护
        return `
          ${sanitizedHtml}
          <div class="content-warning">
            <p><strong>内容过长，已截断显示</strong></p>
            <p>完整内容共 ${lines.length} 行，当前仅显示前 10000 行。</p>
          </div>
        `
      }

      // 正常渲染
      const rawHtml = md.render(content)
      return sanitizeHtml(rawHtml)  // ✅ XSS 防护
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
        wrapper.className = 'mermaid-container'
        wrapper.innerHTML = svg
        block.replaceWith(wrapper)
      } catch (error) {
        console.error('Mermaid render error:', error)
        // 渲染失败时保留原始代码
      }
    })
  }, [html])

  // ✅ 为标题添加 id 属性，支持目录锚点跳转
  useEffect(() => {
    console.log('[Anchor] useEffect 触发, containerRef:', containerRef.current)

    if (!containerRef.current) {
      console.log('[Anchor] containerRef.current 为空，退出')
      return
    }

    // 查找所有标题元素
    const headings = containerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
    console.log('[Anchor] 找到标题数量:', headings.length)

    const usedIds = new Set<string>()

    headings.forEach((heading, index) => {
      // 如果已经有 id，跳过
      if (heading.id) {
        console.log(`[Anchor] 标题 ${index} 已有 id:`, heading.id)
        return
      }

      const text = heading.textContent || ''
      console.log(`[Anchor] 处理标题 ${index}:`, text)

      // 生成 slug：转小写，移除标点，空格变连字符
      let slug = text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')  // 保留字母、数字、空格、连字符
        .replace(/\s+/g, '-')  // 空格变连字符
        .replace(/-+/g, '-')   // 多个连字符合并
        .replace(/^-|-$/g, '') // 移除首尾连字符

      console.log(`[Anchor] 生成 slug:`, slug)

      // 确保 id 唯一
      let uniqueSlug = slug
      let counter = 1
      while (usedIds.has(uniqueSlug)) {
        uniqueSlug = `${slug}-${counter}`
        counter++
      }
      usedIds.add(uniqueSlug)

      // 设置 id
      heading.id = uniqueSlug
      console.log(`[Anchor] 设置 id 完成:`, heading.id, '元素:', heading)
    })

    console.log('[Anchor] 处理完成，共处理', headings.length, '个标题')
  }, [html])

  // ✅ 处理锚点链接点击，实现页内跳转
  const handleClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a')

    if (!anchor) return

    const href = anchor.getAttribute('href')
    if (!href || !href.startsWith('#')) return

    // 阻止默认行为（防止 Electron 尝试导航）
    e.preventDefault()

    // 获取目标 id（解码 URL 编码）
    const targetId = decodeURIComponent(href.slice(1))

    // 使用 getElementById 而不是 querySelector，因为 CSS.escape 对中文处理有问题
    const targetElement = document.getElementById(targetId)

    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      console.warn('[MarkdownRenderer] 未找到锚点目标:', targetId)
    }
  }, [])

  // 绑定点击事件
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [handleClick])

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
