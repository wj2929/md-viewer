import MarkdownIt, { type Options as MdOptions } from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import type Renderer from 'markdown-it/lib/renderer.mjs'
import Prism from 'prismjs'
import katex from 'katex'
import DOMPurify from 'dompurify'
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
 *
 * v1.4.6 架构变更:
 * - markdown-it: html: true (允许 HTML，提供灵活性)
 * - DOMPurify: 严格白名单 (核心安全层，防止 XSS)
 */
export function createMarkdownRenderer(): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: true,  // ✅ v1.4.6: 允许内联 HTML（安全由 DOMPurify 保证）
    linkify: true,
    typographer: true,
    breaks: true,
    highlight: (str: string, lang: string): string => {
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
  md.renderer.rules.heading_open = (tokens: Token[], idx: number, options: MdOptions, env: { _usedIds?: Set<string> }, self: Renderer): string => {
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
        .filter((t: Token) => t.type === 'text' || t.type === 'code_inline')
        .map((t: Token) => t.content)
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

/**
 * DOMPurify 安全配置
 *
 * 架构: 分层防御 - markdown-it (html: true) + DOMPurify 严格白名单
 *
 * 安全原则:
 * 1. 使用 ALLOWED_TAGS (白名单) 而非 ADD_TAGS
 * 2. 明确禁止危险标签和属性
 * 3. 严格限制 style 属性的 CSS 内容
 * 4. 通过 hooks 运行时验证 class/id
 *
 * @version v1.4.6
 */
export const DOMPURIFY_CONFIG: DOMPurify.Config = {
  // ========== 标签白名单 ==========
  ALLOWED_TAGS: [
    // Markdown 核心标签
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'ul', 'ol', 'li', 'blockquote',
    'code', 'pre', 'strong', 'em', 'del', 's', 'u',
    'hr', 'br', 'img',

    // 表格标签
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'col', 'colgroup',

    // 布局容器（最小必要）
    'div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',

    // KaTeX 数学公式标签
    'math', 'semantics', 'mrow', 'mi', 'mn', 'mo',
    'msup', 'msub', 'mfrac', 'mroot', 'msqrt',
    'mtext', 'mspace', 'annotation', 'annotation-xml',
    'mtable', 'mtr', 'mtd', 'munderover', 'munder', 'mover',

    // Mermaid/SVG 标签
    'svg', 'path', 'rect', 'circle', 'ellipse', 'line',
    'polyline', 'polygon', 'g', 'defs', 'use', 'text',
    'tspan', 'marker', 'clipPath', 'foreignObject',

    // 其他合法标签
    'sup', 'sub', 'abbr', 'cite', 'q', 'kbd', 'var', 'samp', 'mark',
    'ins', 'small', 'time', 'wbr', 'details', 'summary', 'figure', 'figcaption',
    'dl', 'dt', 'dd'
  ],

  // ========== 属性白名单 ==========
  ALLOWED_ATTR: [
    // 链接和图片
    'href', 'src', 'alt', 'title', 'target', 'rel',

    // 表格属性
    'width', 'height', 'colspan', 'rowspan', 'align', 'valign',

    // 样式和标识（将通过 hooks 进一步验证）
    'class', 'id', 'style',

    // SVG/数学公式属性
    'xmlns', 'viewBox', 'd', 'fill', 'stroke', 'stroke-width',
    'x', 'y', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'cx', 'cy', 'r',
    'transform', 'aria-hidden', 'role', 'preserveAspectRatio',

    // Mermaid 属性
    'data-mermaid-code',

    // 通用属性
    'lang', 'dir', 'start', 'type', 'reversed', 'open'
  ],

  // ========== CSS 样式白名单（严格限制）==========
  ALLOWED_STYLES: {
    '*': {
      // 尺寸（限制范围：1-999，单位：px/em/rem/%）
      'width': [/^([1-9]\d{0,2})(px|em|rem|%)$/],
      'height': [/^([1-9]\d{0,2})(px|em|rem|%)$/],
      'max-width': [/^([1-9]\d{0,2}|100)(px|em|rem|%)$/],
      'max-height': [/^([1-9]\d{0,2}|100)(px|em|rem|%)$/],
      'min-width': [/^([1-9]\d{0,2})(px|em|rem)$/],
      'min-height': [/^([1-9]\d{0,2})(px|em|rem)$/],

      // 对齐
      'text-align': [/^(left|center|right|justify)$/],
      'vertical-align': [/^(top|middle|bottom|baseline|sub|super|text-top|text-bottom)$/],

      // 表格相关
      'border-collapse': [/^(collapse|separate)$/],
      'border-spacing': [/^\d{1,2}px$/],

      // 内外边距（限制：0-99）
      'margin': [/^(\d{1,2}(px|em|rem)(\s+\d{1,2}(px|em|rem))*)$/],
      'padding': [/^(\d{1,2}(px|em|rem)(\s+\d{1,2}(px|em|rem))*)$/],
      'margin-top': [/^\d{1,2}(px|em|rem)$/],
      'margin-bottom': [/^\d{1,2}(px|em|rem)$/],
      'margin-left': [/^\d{1,2}(px|em|rem)$/],
      'margin-right': [/^\d{1,2}(px|em|rem)$/],
      'padding-top': [/^\d{1,2}(px|em|rem)$/],
      'padding-bottom': [/^\d{1,2}(px|em|rem)$/],
      'padding-left': [/^\d{1,2}(px|em|rem)$/],
      'padding-right': [/^\d{1,2}(px|em|rem)$/],

      // 显示（仅允许安全值）- 排除 position
      'display': [/^(block|inline|inline-block|none|flex|grid|table|table-row|table-cell)$/],

      // 颜色（安全的颜色值）
      'color': [/^(#[0-9a-fA-F]{3,6}|rgb\([\d,\s]+\)|rgba\([\d,.\s]+\))$/],
      'background-color': [/^(#[0-9a-fA-F]{3,6}|rgb\([\d,\s]+\)|rgba\([\d,.\s]+\))$/]
    }
  },

  // ========== 明确禁止的标签 ==========
  FORBID_TAGS: [
    'script', 'style', 'link', 'meta', 'base',
    'object', 'embed', 'applet',
    'iframe',  // iframe 有特殊处理，暂时全部禁止
    'form', 'input', 'button', 'textarea', 'select',
    'video', 'audio', 'track', 'source',
    'frame', 'frameset', 'noframes'
  ],

  // ========== 明确禁止的属性 ==========
  FORBID_ATTR: [
    // 事件处理器
    'onerror', 'onclick', 'onload', 'onmouseover', 'onfocus',
    'onblur', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup',
    'onmousedown', 'onmouseup', 'onmousemove', 'onmouseenter',
    'onmouseleave', 'ondblclick', 'oncontextmenu', 'oninput',
    'onscroll', 'onwheel', 'oncopy', 'oncut', 'onpaste',

    // 表单相关
    'formaction', 'form', 'action',

    // 其他危险属性
    'srcdoc'  // iframe 的 srcdoc 可以注入内容
  ],

  // ========== URL 协议白名单 ==========
  // 只允许 https, http, mailto, tel 协议，禁止 javascript:, data:, file: 等危险协议
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_URI_REGEXP: /^(?:javascript|data|file|vbscript):/i,  // 明确禁止危险协议

  // ========== 安全选项 ==========
  KEEP_CONTENT: true,         // 移除危险标签但保留内容（Markdown 渲染需要）
  RETURN_DOM: false,          // 返回字符串而非 DOM
  RETURN_DOM_FRAGMENT: false,
  RETURN_TRUSTED_TYPE: false,
  SANITIZE_DOM: true,         // 启用 DOM 消毒
  WHOLE_DOCUMENT: false,      // 不处理整个文档
  ALLOW_DATA_ATTR: true       // 允许 data 属性（mermaid-code 需要）
}

/**
 * 设置 DOMPurify 安全 hooks
 *
 * 功能:
 * 1. class 属性白名单验证
 * 2. id 属性安全前缀检查（防止 DOM Clobbering）
 *
 * @version v1.4.6
 */
export function setupDOMPurifyHooks(): void {
  // 清除之前的 hooks（防止重复添加）
  DOMPurify.removeAllHooks()

  // class 白名单（仅允许项目中使用的 class）
  const ALLOWED_CLASSES = new Set([
    // Markdown 渲染相关
    'markdown-body', 'highlight', 'code-block',

    // 表格样式
    'table', 'table-bordered', 'table-striped',

    // 对齐
    'text-left', 'text-center', 'text-right',

    // 代码高亮语言 class
    'language-javascript', 'language-typescript', 'language-jsx', 'language-tsx',
    'language-python', 'language-java', 'language-go', 'language-rust',
    'language-bash', 'language-json', 'language-yaml', 'language-markdown',
    'language-css', 'language-html', 'language-sql', 'language-plaintext',
    'language-c', 'language-cpp', 'language-csharp', 'language-php',
    'language-ruby', 'language-swift', 'language-kotlin', 'language-scala',

    // Prism 相关
    'token', 'keyword', 'string', 'number', 'boolean', 'comment',
    'operator', 'punctuation', 'function', 'class-name', 'tag',
    'attr-name', 'attr-value', 'namespace', 'regex', 'important',
    'bold', 'italic', 'entity', 'url', 'variable', 'constant',
    'property', 'parameter', 'builtin', 'char', 'symbol',

    // Mermaid 相关
    'mermaid', 'language-mermaid',

    // KaTeX 相关
    'katex', 'katex-html', 'katex-mathml', 'katex-display', 'katex-error',
    'base', 'strut', 'mord', 'mbin', 'mopen', 'mclose', 'mrel', 'mpunct',
    'mspace', 'vlist', 'vlist-t', 'vlist-r', 'vlist-s', 'sizing', 'reset-size1',
    'frac-line', 'mfrac', 'mtable', 'col-align-c', 'col-align-l', 'col-align-r'
  ])

  // 危险的 id 值（防止 DOM Clobbering）
  const DANGEROUS_IDS = new Set([
    'document', 'window', 'location', 'top', 'parent', 'self',
    'frames', 'cookie', 'getElementById', 'getElementsByName',
    'getElementsByClassName', 'querySelector', 'querySelectorAll',
    'localStorage', 'sessionStorage', 'history', 'navigator',
    'screen', 'innerHeight', 'innerWidth', 'outerHeight', 'outerWidth',
    'documentElement', 'body', 'head'
  ])

  // 危险的 URL 协议
  const DANGEROUS_PROTOCOLS = /^(?:javascript|data|file|vbscript):/i
  const DANGEROUS_STYLE_PROPS = /^(?:position|z-index|top|left|right|bottom|float)/i

  // 添加属性验证 hook
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    // 验证 class 属性
    if (data.attrName === 'class') {
      const classes = data.attrValue.split(/\s+/).filter(Boolean)
      const safeClasses = classes.filter(c => {
        // 允许白名单中的 class
        if (ALLOWED_CLASSES.has(c)) return true
        // 允许 reset-size* 格式的 KaTeX class
        if (/^reset-size\d+$/.test(c)) return true
        // 允许 size* 格式的 KaTeX class
        if (/^size\d+$/.test(c)) return true
        return false
      })

      if (safeClasses.length === 0) {
        // 如果没有安全的 class，移除整个属性
        data.keepAttr = false
      } else {
        // 只保留安全的 class
        data.attrValue = safeClasses.join(' ')
      }
    }

    // 验证 id 属性
    if (data.attrName === 'id') {
      const id = data.attrValue.toLowerCase()

      // 检查是否是危险的 id
      if (DANGEROUS_IDS.has(id)) {
        data.keepAttr = false
        return
      }

      // 只允许特定前缀的 id（用于锚点跳转）
      // 或 KaTeX/Mermaid 生成的 id
      const safePatterns = [
        /^md-/,           // Markdown 锚点
        /^katex-/,        // KaTeX 生成的 id
        /^mermaid-/,      // Mermaid 生成的 id
        /^user-content-/, // GitHub 风格的锚点
        /^heading-/       // 标题锚点
      ]

      const isSafe = safePatterns.some(pattern => pattern.test(data.attrValue))
      if (!isSafe) {
        data.keepAttr = false
      }
    }

    // 验证 href 和 src 属性（阻止危险协议）
    if (data.attrName === 'href' || data.attrName === 'src') {
      if (DANGEROUS_PROTOCOLS.test(data.attrValue)) {
        data.keepAttr = false
      }
    }

    // 验证 style 属性（阻止危险的 CSS 属性）
    if (data.attrName === 'style') {
      const styles = data.attrValue.split(';').map(s => s.trim()).filter(Boolean)
      const safeStyles = styles.filter(style => {
        const prop = style.split(':')[0].trim().toLowerCase()
        return !DANGEROUS_STYLE_PROPS.test(prop)
      })

      if (safeStyles.length === 0) {
        data.keepAttr = false
      } else {
        data.attrValue = safeStyles.join('; ')
      }
    }
  })
}

/**
 * 导出统一的 HTML 消毒函数
 *
 * @param html - 原始 HTML 字符串
 * @returns 消毒后的安全 HTML
 * @version v1.4.6
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG)
}

