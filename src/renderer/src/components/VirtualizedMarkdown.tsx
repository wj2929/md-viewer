import { useEffect, useRef, useMemo, memo, useCallback } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import MarkdownIt from 'markdown-it'
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
 * 需要允许 KaTeX 使用的 MathML 和 SVG 标签
 */
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    // 基础 HTML 标签
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li',
    'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr',
    'th', 'td', 'img', 'strong', 'em', 'del', 's', 'br', 'hr', 'input',
    'div', 'span', 'sup', 'sub',
    // KaTeX MathML 标签
    'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub',
    'msubsup', 'mfrac', 'mroot', 'msqrt', 'mtext', 'mspace', 'mtable',
    'mtr', 'mtd', 'mover', 'munder', 'munderover', 'annotation',
    // SVG 标签 (KaTeX 根号等需要)
    'svg', 'path', 'line', 'rect', 'circle', 'g', 'use', 'defs',
    'clipPath', 'mask', 'pattern', 'symbol'
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'class', 'id', 'type', 'checked', 'disabled',
    // KaTeX 需要的属性
    'style', 'aria-hidden', 'xmlns', 'encoding', 'display',
    // SVG 属性
    'd', 'viewBox', 'preserveAspectRatio', 'fill', 'stroke', 'stroke-width',
    'width', 'height', 'x', 'y', 'transform', 'clip-path', 'xlink:href'
  ],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
  ALLOW_DATA_ATTR: false,
  ADD_URI_SAFE_ATTR: ['xlink:href']
}

/**
 * 安全的 HTML 消毒函数
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG)
}

/**
 * 分段信息
 */
interface Section {
  id: string
  content: string
  html: string
  hasMermaid: boolean
}

/**
 * 虚拟滚动已禁用
 * 原因：分段渲染存在问题，且对于 Markdown 预览场景收益有限
 * 保留代码但设置不可能达到的阈值
 */
const VIRTUALIZATION_THRESHOLD = {
  /** 禁用：设置为不可能达到的值 */
  MIN_LINES: Infinity,
  MIN_CHARS: Infinity,
  MAX_SECTION_LINES: 200
}

interface VirtualizedMarkdownProps {
  content: string
  className?: string
  filePath?: string  // v1.3 阶段 2：用于右键菜单
}

/**
 * 创建 markdown-it 实例
 */
function createMarkdownInstance(): MarkdownIt {
  const mdInstance = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
    highlight: (str: string, lang: string) => {
      if (lang === 'mermaid') {
        return `<pre class="language-mermaid"><code class="language-mermaid">${mdInstance.utils.escapeHtml(str)}</code></pre>`
      }
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

  // 行内数学公式 $...$
  mdInstance.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$') return false
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

    if (!found || end === start + 1) return false

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

  // 块级数学公式 $$...$$
  mdInstance.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
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
          token.content = `<div class="katex-error">${mdInstance.utils.escapeHtml(latex)}</div>\n`
        }
      }
      state.line = startLine + 1
      return true
    }

    let nextLine = startLine
    let lastLine = ''
    let found = false

    while (nextLine < endLine) {
      nextLine++
      pos = state.bMarks[nextLine] + state.tShift[nextLine]
      max = state.eMarks[nextLine]

      if (pos < max && state.sCount[nextLine] < state.blkIndent) break

      if (state.src.slice(pos, max).trim().endsWith('$$')) {
        lastLine = state.src.slice(pos, max).trim().slice(0, -2)
        found = true
        break
      }
    }

    if (!found) return false

    const lines = [firstLine]
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
}

/**
 * 将 Markdown 内容按标题分段
 * 分段策略：
 * 1. 按 H1/H2 标题分割
 * 2. 每段最大 100 行
 * 3. 保持代码块完整
 */
function splitBySections(content: string, md: MarkdownIt): Section[] {
  const lines = content.split('\n')
  const sections: Section[] = []
  let currentLines: string[] = []
  let sectionIndex = 0

  const pushSection = () => {
    if (currentLines.length === 0) return

    const sectionContent = currentLines.join('\n')
    const rawHtml = md.render(sectionContent)
    const html = sanitizeHtml(rawHtml)  // ✅ XSS 防护

    sections.push({
      id: `section-${sectionIndex++}`,
      content: sectionContent,
      html,
      hasMermaid: sectionContent.includes('```mermaid')
    })
    currentLines = []
  }

  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 检测代码块开始/结束
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
    }

    // 在代码块内不分割
    if (!inCodeBlock) {
      // 检测 H1/H2 标题作为分割点
      const isH1 = /^#\s+/.test(line)
      const isH2 = /^##\s+/.test(line)

      if ((isH1 || isH2) && currentLines.length > 0) {
        pushSection()
      }

      // 检查行数限制
      if (currentLines.length >= VIRTUALIZATION_THRESHOLD.MAX_SECTION_LINES) {
        pushSection()
      }
    }

    currentLines.push(line)
  }

  // 推送最后一段
  pushSection()

  return sections
}

/**
 * 单个分段渲染组件
 */
const SectionRenderer = memo(function SectionRenderer({
  section,
  onMermaidRender
}: {
  section: Section
  onMermaidRender: (container: HTMLDivElement) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (section.hasMermaid && containerRef.current) {
      onMermaidRender(containerRef.current)
    }
  }, [section.hasMermaid, onMermaidRender])

  return (
    <div
      ref={containerRef}
      className="virtualized-section"
      dangerouslySetInnerHTML={{ __html: section.html }}
    />
  )
})

/**
 * 虚拟滚动 Markdown 渲染器
 */
export function VirtualizedMarkdown({ content, className = '', filePath }: VirtualizedMarkdownProps): JSX.Element {
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  // v1.3 阶段 2：右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (!filePath) return

    const selection = window.getSelection()
    const hasSelection = selection !== null && selection.toString().trim().length > 0

    window.api.showMarkdownContextMenu({
      filePath,
      hasSelection
    }).catch(error => {
      console.error('[VirtualizedMarkdown] Failed to show context menu:', error)
    })
  }, [filePath])

  // 初始化 Mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
      securityLevel: 'loose'
    })
  }, [])

  // 创建 markdown-it 实例
  const md = useMemo(() => createMarkdownInstance(), [])

  // 判断是否需要虚拟滚动
  const shouldVirtualize = useMemo(() => {
    const lineCount = content.split('\n').length
    const charCount = content.length
    return lineCount >= VIRTUALIZATION_THRESHOLD.MIN_LINES ||
           charCount >= VIRTUALIZATION_THRESHOLD.MIN_CHARS
  }, [content])

  // 分段
  const sections = useMemo(() => {
    if (!shouldVirtualize) return []
    return splitBySections(content, md)
  }, [content, md, shouldVirtualize])

  // Mermaid 渲染回调
  const handleMermaidRender = useCallback(async (container: HTMLDivElement) => {
    const mermaidBlocks = container.querySelectorAll('pre.language-mermaid')
    if (mermaidBlocks.length === 0) return

    mermaidBlocks.forEach(async (block, index) => {
      const code = block.textContent || ''
      const id = `mermaid-v-${Date.now()}-${index}`

      try {
        const { svg } = await mermaid.render(id, code)
        const wrapper = document.createElement('div')
        wrapper.className = 'mermaid-container'
        wrapper.innerHTML = svg
        block.replaceWith(wrapper)
      } catch (error) {
        console.error('Mermaid render error:', error)
      }
    })
  }, [])

  // 小文件直接渲染（不使用虚拟滚动）
  if (!shouldVirtualize) {
    return (
      <NonVirtualizedMarkdown
        content={content}
        md={md}
        className={className}
        onContextMenu={handleContextMenu}
      />
    )
  }

  // 大文件使用虚拟滚动
  return (
    <div
      className={`markdown-body virtualized ${className}`}
      onContextMenu={handleContextMenu}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div className="virtualized-info">
        <span>📄 大文件模式：{sections.length} 个分段，共 {content.split('\n').length} 行</span>
      </div>
      <Virtuoso
        ref={virtuosoRef}
        style={{ flex: 1, minHeight: 0 }}
        data={sections}
        itemContent={(index, section) => (
          <SectionRenderer
            key={section.id}
            section={section}
            onMermaidRender={handleMermaidRender}
          />
        )}
        increaseViewportBy={{ top: 200, bottom: 600 }}
        overscan={3}
      />
    </div>
  )
}

/**
 * 非虚拟滚动渲染（小文件）
 */
const NonVirtualizedMarkdown = memo(function NonVirtualizedMarkdown({
  content,
  md,
  className,
  onContextMenu
}: {
  content: string
  md: MarkdownIt
  className: string
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    if (!content || content.trim().length === 0) {
      return '<p class="placeholder">文件内容为空</p>'
    }

    if (content.length > 500000) {
      return `
        <div class="content-warning">
          <p><strong>文件过大，无法渲染</strong></p>
          <p>文件大小: ${(content.length / 1024).toFixed(2)} KB，最大支持: 500 KB</p>
        </div>
      `
    }

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

    const rawHtml = md.render(content)
    return sanitizeHtml(rawHtml)  // ✅ XSS 防护
  }, [md, content])

  // Mermaid 图表渲染
  useEffect(() => {
    if (!containerRef.current) return

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
      }
    })
  }, [html])

  // ✅ 为标题添加 id 属性，支持目录锚点跳转
  useEffect(() => {
    if (!containerRef.current) return

    const headings = containerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
    const usedIds = new Set<string>()

    headings.forEach((heading) => {
      if (heading.id) return  // 已有 id，跳过

      const text = heading.textContent || ''
      let slug = text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')  // 保留字母、数字、空格、连字符
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      // 确保 id 唯一
      let uniqueSlug = slug
      let counter = 1
      while (usedIds.has(uniqueSlug)) {
        uniqueSlug = `${slug}-${counter}`
        counter++
      }
      usedIds.add(uniqueSlug)
      heading.id = uniqueSlug
    })
  }, [html])

  // ✅ 处理锚点链接点击
  useEffect(() => {
    if (!containerRef.current) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || !href.startsWith('#')) return

      e.preventDefault()
      const targetId = decodeURIComponent(href.slice(1))
      const targetElement = document.getElementById(targetId)

      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }

    containerRef.current.addEventListener('click', handleClick)
    return () => containerRef.current?.removeEventListener('click', handleClick)
  }, [html])

  return (
    <div
      ref={containerRef}
      className={`markdown-body ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onContextMenu={onContextMenu}
    />
  )
})

export default memo(VirtualizedMarkdown)
