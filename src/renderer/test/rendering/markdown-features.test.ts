import { describe, it, expect, beforeAll } from 'vitest'
import { createMarkdownRenderer, sanitizeHtml, setupDOMPurifyHooks } from '../../src/utils/markdownRenderer'
import { decodeLocalMediaMarker } from '../../src/utils/localMediaMarkup'
import { LOCAL_MEDIA_MARKER_ATTRIBUTE } from '../../../shared/localMedia'

describe('Markdown Rendering - v1.4.6 修复', () => {
  const md = createMarkdownRenderer()

  beforeAll(() => {
    setupDOMPurifyHooks()
  })

  describe('Obsidian 本地资源语法', () => {
    it('将 Wiki 链接、图片和媒体转换为受控 marker', () => {
      const html = sanitizeHtml(md.render([
        '[[Guide#Install|安装说明]]',
        '![[images/arch.png|640x360]]',
        '![[videos/demo.mp4#t=2,4|640x360]]',
      ].join('\n\n')))

      expect(html).toContain('class="wiki-link"')
      expect(html).toContain('data-mdv-wiki-link=')
      expect(html).toContain('data-mdv-local-image=')
      expect(html).toContain('data-mdv-local-media=')
      expect(html).not.toContain('src="images/arch.png"')
      expect(html).not.toContain('src="videos/demo.mp4')

      const fragment = document.createElement('template')
      fragment.innerHTML = html
      const encoded = fragment.content.querySelector(`[${LOCAL_MEDIA_MARKER_ATTRIBUTE}]`)
        ?.getAttribute(LOCAL_MEDIA_MARKER_ATTRIBUTE)
      const mediaMarker = encoded ? decodeLocalMediaMarker(encoded) : null
      expect(mediaMarker?.dimensions).toEqual({ width: 640, height: 360 })
      expect(mediaMarker?.fullWidth).toBe(false)
    })

    it('将文档和附件降级为安全资源卡，并复用特殊图表 renderer', () => {
      const html = sanitizeHtml(md.render([
        '![[docs/spec.pdf#page=3]]',
        '![[diagrams/flow.bpmn]]',
        '![[diagrams/board.excalidraw|设计草图]]',
        '![[notes/Guide#Overview]]',
      ].join('\n\n')))

      expect(html.match(/class="wiki-embed-card"/g)).toHaveLength(2)
      expect(html).toContain('本地附件')
      expect(html).toContain('嵌入文档')
      expect(html).toContain('class="bpmn-file-placeholder"')
      expect(html).toContain('data-bpmn-resolution-kind="workspace-wiki"')
      expect(html).toContain('class="excalidraw-file-placeholder"')
      expect(html).toContain('data-excalidraw-resolution-kind="workspace-wiki"')
      expect(html).not.toContain('data-mdv-local-image')
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('<object')
    })

    it('不会解析代码或转义后的 Wiki 语法', () => {
      const html = sanitizeHtml(md.render('`![[a.mp4]]`\n\n\\![[b.mp4]]'))
      expect(html).not.toContain('data-mdv-local-media')
      expect(html).toContain('![[a.mp4]]')
      expect(html).toContain('![[b.mp4]]')
    })

    it('将原生媒体规范化为不含真实路径的 inert marker', () => {
      const html = sanitizeHtml(md.render(`
<video src="videos/a.mp4#t=1,3" controls autoplay poster="images/p.png" style="width: 100%; position: fixed">
  <source src="videos/a.webm" type="text/html">
  <track src="captions/zh.vtt" kind="subtitles" srclang="zh-CN" label="中文" default>
</video>
<audio src="audio/a.mp3" controls preload="auto"></audio>
`))
      expect(html.match(/data-mdv-local-media=/g)).toHaveLength(2)
      expect(html).not.toContain('videos/a.mp4')
      expect(html).not.toContain('audio/a.mp3')
      expect(html).not.toContain('autoplay')
      expect(html).not.toContain('position: fixed')
    })

    it('每个媒体元素最多保留四个 source 和四个 WebVTT track', () => {
      const sources = Array.from({ length: 6 }, (_, index) => (
        `<source src="videos/source-${index}.mp4" type="video/mp4">`
      )).join('\n')
      const tracks = Array.from({ length: 6 }, (_, index) => (
        `<track src="captions/track-${index}.vtt" kind="subtitles" srclang="zh-CN">`
      )).join('\n')
      const html = sanitizeHtml(md.render(`<video controls>\n${sources}\n${tracks}\n</video>`))
      const template = document.createElement('template')
      template.innerHTML = html
      const encoded = template.content.querySelector(`[${LOCAL_MEDIA_MARKER_ATTRIBUTE}]`)
        ?.getAttribute(LOCAL_MEDIA_MARKER_ATTRIBUTE)
      const marker = encoded ? decodeLocalMediaMarker(encoded) : null

      expect(marker?.sources).toHaveLength(4)
      expect(marker?.tracks).toHaveLength(4)
      expect(html).not.toContain('source-4.mp4')
      expect(html).not.toContain('track-4.vtt')
    })
  })

  describe('表格内 <br> 标签', () => {
    it('应正确渲染表格内的 <br> 标签', () => {
      const markdown = `
| 列1 | 列2 |
|-----|-----|
| A<br>B | C<br>D |
`
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<br>')
      expect(html).not.toContain('&lt;br&gt;')
      // 不检查纯文本 "<br>"，因为 HTML 中会有正确的 <br> 标签
    })

    it('应正确渲染复杂表格', () => {
      const markdown = `
| 阶段 | 时间 | 里程碑 |
|------|------|--------|
| **Q1<br>架构升级** | 1-3月 | • 任务1<br>• 任务2 |
`
      const html = sanitizeHtml(md.render(markdown))
      const brCount = (html.match(/<br>/g) || []).length
      expect(brCount).toBeGreaterThanOrEqual(2)
    })

    it('应正确渲染多个 <br> 标签', () => {
      const markdown = `
| 内容 |
|------|
| Line1<br>Line2<br>Line3 |
`
      const html = sanitizeHtml(md.render(markdown))
      const brCount = (html.match(/<br>/g) || []).length
      expect(brCount).toBe(2)
    })

    it('表格内的 <br> 不应被转义', () => {
      const markdown = '| A<br>B |'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<br>')
      expect(html).not.toContain('&lt;br&gt;')
      expect(html).not.toContain('&amp;lt;br&amp;gt;')
    })
  })

  describe('原生 HTML <table> 标签', () => {
    it('应正确渲染原生 HTML table', () => {
      const markdown = `
<table>
<tr>
<td width="50%">内容1</td>
<td width="50%">内容2</td>
</tr>
</table>
`
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<table>')
      expect(html).toContain('<tr>')
      expect(html).toContain('<td')
      expect(html).toContain('width="50%"')
      expect(html).not.toContain('&lt;table&gt;')
    })

    it('应支持 colspan 和 rowspan 属性', () => {
      const markdown = `
<table>
<tr>
<td colspan="2">合并列</td>
</tr>
<tr>
<td rowspan="2">合并行</td>
<td>单元格</td>
</tr>
<tr>
<td>单元格2</td>
</tr>
</table>
`
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('colspan="2"')
      expect(html).toContain('rowspan="2"')
    })

    it('应支持表格的 thead, tbody, tfoot', () => {
      const markdown = `
<table>
<thead>
<tr><th>Header</th></tr>
</thead>
<tbody>
<tr><td>Body</td></tr>
</tbody>
<tfoot>
<tr><td>Footer</td></tr>
</tfoot>
</table>
`
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<thead>')
      expect(html).toContain('<tbody>')
      expect(html).toContain('<tfoot>')
      expect(html).toContain('<th>')
    })

    it('应支持表格对齐属性', () => {
      const markdown = '<table><tr><td align="center" valign="top">centered</td></tr></table>'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('align="center"')
      expect(html).toContain('valign="top"')
    })
  })

  describe('Mermaid Sankey 图表', () => {
    it('应保留 Sankey 图表代码', () => {
      const markdown = `
\`\`\`mermaid
%%{init: {'theme':'base'}}%%
sankey-beta

A,B,10
B,C,5
\`\`\`
`
      const html = md.render(markdown)
      expect(html).toContain('language-mermaid')
      expect(html).toContain('sankey-beta')
    })

    it('应保留 Mermaid 代码块的原始内容', () => {
      const markdown = `
\`\`\`mermaid
graph TD
    A-->B
\`\`\`
`
      const html = md.render(markdown)
      expect(html).toContain('language-mermaid')
      expect(html).toContain('A--&gt;B')  // 会被转义
    })
  })

  describe('Markdown 标准功能回归', () => {
    it('应正确渲染标题', () => {
      const markdown = '# H1\n## H2\n### H3'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<h1')
      expect(html).toContain('<h2')
      expect(html).toContain('<h3')
    })

    it('应正确渲染代码块', () => {
      const markdown = '```javascript\nconst a = 1\n```'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('language-javascript')
      expect(html).toContain('<code')
      expect(html).toContain('<pre')
    })

    it('应正确渲染行内代码', () => {
      const markdown = 'This is `inline code`'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<code>')
      expect(html).toContain('inline code')
    })

    it('应正确渲染列表', () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<ul>')
      expect(html).toContain('<li>')
    })

    it('应正确渲染有序列表', () => {
      const markdown = '1. First\n2. Second\n3. Third'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<ol>')
      expect(html).toContain('<li>')
    })

    it('应正确渲染引用块', () => {
      const markdown = '> This is a quote'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<blockquote>')
    })

    it('应正确渲染粗体', () => {
      const markdown = '**bold text**'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<strong>')
    })

    it('应正确渲染斜体', () => {
      const markdown = '*italic text*'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<em>')
    })

    it('应正确渲染删除线', () => {
      const markdown = '~~strikethrough~~'
      const html = sanitizeHtml(md.render(markdown))
      // markdown-it 默认使用 <s> 标签而不是 <del>
      expect(html).toContain('<s>')
    })

    it('应正确渲染链接', () => {
      const markdown = '[Link](https://example.com)'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<a')
      expect(html).toContain('href="https://example.com"')
    })

    it('应正确渲染图片', () => {
      const markdown = '![Alt](https://example.com/img.jpg)'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<img')
      expect(html).toContain('alt="Alt"')
      expect(html).toContain('src="https://example.com/img.jpg"')
    })

    it('应正确渲染分隔线', () => {
      const markdown = '---'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<hr>')
    })

    it('应正确渲染 Markdown 表格', () => {
      const markdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<table>')
      expect(html).toContain('<th>')
      expect(html).toContain('<td>')
    })
  })

  describe('KaTeX 数学公式回归', () => {
    it('应保留行内数学公式渲染（由 markdown-it 插件处理）', () => {
      const markdown = 'This is $E = mc^2$ inline math'
      const html = md.render(markdown)
      // KaTeX 会生成 <span class="katex">
      expect(html).toContain('katex')
    })

    it('应保留块级数学公式渲染（由 markdown-it 插件处理）', () => {
      const markdown = '$$\nE = mc^2\n$$'
      const html = md.render(markdown)
      // KaTeX 会生成 displayMode 的 HTML
      expect(html).toContain('katex')
    })
  })

  describe('边界情况', () => {
    it('应处理空内容', () => {
      const markdown = ''
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toBe('')
    })

    it('应处理纯文本', () => {
      const markdown = 'Plain text'
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('Plain text')
      expect(html).toContain('<p>')
    })

    it('应处理混合内容', () => {
      const markdown = `
# Heading
Plain text
<table><tr><td>HTML table</td></tr></table>
| Markdown | Table |
|----------|-------|
| Cell 1<br>Line2 | Cell 2 |
`
      const html = sanitizeHtml(md.render(markdown))
      expect(html).toContain('<h1')
      expect(html).toContain('Plain text')
      expect(html).toContain('<table>')
      expect(html).toContain('<br>')
    })
  })
})
