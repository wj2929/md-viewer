import { describe, it, expect, beforeAll } from 'vitest'
import { createMarkdownRenderer, sanitizeHtml, setupDOMPurifyHooks } from '../../src/utils/markdownRenderer'

describe('XSS Prevention - v1.4.6', () => {
  const md = createMarkdownRenderer()

  beforeAll(() => {
    setupDOMPurifyHooks()
  })

  describe('阻止 script 注入', () => {
    it('应阻止 <script> 标签', () => {
      const input = '<script>alert("xss")</script>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('<script')
      expect(html).not.toContain('alert')
    })

    it('应阻止 Markdown 中嵌入的 <script>', () => {
      const input = '# Hello\n\n<script>alert(1)</script>\n\nWorld'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('<script')
    })

    it('应阻止多行 <script> 标签', () => {
      const input = `
<script>
  alert('xss');
  console.log('evil');
</script>
`
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('<script')
      expect(html).not.toContain('alert')
    })
  })

  describe('阻止事件处理器', () => {
    it('应阻止 onerror 属性', () => {
      const input = '<img src="x" onerror="alert(1)">'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('onerror')
    })

    it('应阻止 onclick 属性', () => {
      const input = '<a href="#" onclick="alert(1)">click</a>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('onclick')
    })

    it('应阻止 onload 属性', () => {
      const input = '<body onload="alert(1)">test</body>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('onload')
      expect(html).not.toContain('<body')
    })

    it('应阻止 onmouseover 属性', () => {
      const input = '<div onmouseover="alert(1)">hover me</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('onmouseover')
    })
  })

  describe('阻止危险 URL 协议', () => {
    it('应阻止 javascript: 协议', () => {
      const input = '<a href="javascript:alert(1)">evil</a>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('javascript:')
    })

    it('应阻止 data: 协议', () => {
      const input = '<img src="data:text/html,<script>alert(1)</script>">'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('data:text/html')
    })

    it('应允许安全的 https: 协议', () => {
      const input = '<a href="https://example.com">safe link</a>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('https://example.com')
    })

    it('应允许安全的 mailto: 协议', () => {
      const input = '<a href="mailto:test@example.com">email</a>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('mailto:test@example.com')
    })
  })

  describe('阻止 CSS 注入', () => {
    it('应阻止 position: fixed 覆盖攻击', () => {
      const input = '<div style="position:fixed;top:0;left:0;z-index:9999">overlay</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('position')
      expect(html).not.toContain('z-index')
    })

    it('应允许安全的 CSS 属性（width, height）', () => {
      const input = '<div style="width:100px;height:50px">safe</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('width')
      expect(html).toContain('height')
    })

    it('应允许安全的 text-align', () => {
      const input = '<div style="text-align:center">centered</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('text-align')
    })
  })

  describe('防止 DOM Clobbering', () => {
    it('应阻止危险的 id 值 (document)', () => {
      const input = '<div id="document">evil</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('id="document"')
    })

    it('应阻止危险的 id 值 (window)', () => {
      const input = '<div id="window">evil</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('id="window"')
    })

    it('应阻止危险的 id 值 (location)', () => {
      const input = '<div id="location">evil</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('id="location"')
    })

    it('应允许安全前缀的 id (md-)', () => {
      const input = '<div id="md-heading-1">safe</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('id="md-heading-1"')
    })

    it('应允许安全前缀的 id (katex-)', () => {
      const input = '<div id="katex-element">safe</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('id="katex-element"')
    })
  })

  describe('class 白名单验证', () => {
    it('应允许白名单中的 class (table)', () => {
      const input = '<div class="table">safe</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('class="table"')
    })

    it('应允许白名单中的 class (markdown-body)', () => {
      const input = '<div class="markdown-body">safe</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('class="markdown-body"')
    })

    it('应移除不在白名单中的 class', () => {
      const input = '<div class="evil-class">test</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('evil-class')
    })

    it('应保留白名单 class，移除非白名单 class', () => {
      const input = '<div class="table evil-class markdown-body">test</div>'
      const html = sanitizeHtml(md.render(input))
      expect(html).toContain('table')
      expect(html).toContain('markdown-body')
      expect(html).not.toContain('evil-class')
    })

    it('应允许代码高亮 class (language-javascript)', () => {
      const markdown = '```javascript\nconst a = 1\n```'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('language-javascript')
    })
  })

  describe('阻止危险标签', () => {
    it('应阻止 iframe 标签', () => {
      const input = '<iframe src="https://evil.com"></iframe>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('<iframe')
    })

    it('应阻止 object 标签', () => {
      const input = '<object data="evil.swf"></object>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('<object')
    })

    it('应阻止 embed 标签', () => {
      const input = '<embed src="evil.swf">'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('<embed')
    })

    it('应阻止 form 标签', () => {
      const input = '<form action="https://evil.com"><input type="text"></form>'
      const html = sanitizeHtml(md.render(input))
      expect(html).not.toContain('<form')
      expect(html).not.toContain('<input')
    })
  })

  describe('允许合法的 Markdown 元素', () => {
    it('应允许表格内的 <br> 标签', () => {
      const markdown = '| A<br>B | C |\n|---|---|\n| D | E |'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<br>')
      expect(html).not.toContain('&lt;br&gt;')
    })

    it('应允许原生 HTML table', () => {
      const markdown = '<table><tr><td width="50%">test</td></tr></table>'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<table>')
      expect(html).toContain('<tr>')
      expect(html).toContain('<td')
      expect(html).toContain('width="50%"')
    })

    it('应允许 colspan 和 rowspan 属性', () => {
      const markdown = '<table><tr><td colspan="2">merged</td></tr></table>'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('colspan="2"')
    })

    it('应允许图片标签', () => {
      const markdown = '![alt text](https://example.com/image.jpg)'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<img')
      expect(html).toContain('alt="alt text"')
      expect(html).toContain('src="https://example.com/image.jpg"')
    })

    it('应允许链接标签', () => {
      const markdown = '[link text](https://example.com)'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<a')
      expect(html).toContain('href="https://example.com"')
    })
  })
})
