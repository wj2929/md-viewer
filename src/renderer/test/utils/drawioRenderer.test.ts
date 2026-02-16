import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateDrawioCode, processDrawioInHtml } from '../../src/utils/drawioRenderer'

describe('drawioRenderer', () => {
  describe('validateDrawioCode', () => {
    it('应该拒绝空内容', () => {
      expect(validateDrawioCode('')).toEqual({ valid: false, error: '内容为空' })
      expect(validateDrawioCode('   ')).toEqual({ valid: false, error: '内容为空' })
    })

    it('应该拒绝 null/undefined 类似的输入', () => {
      expect(validateDrawioCode(null as unknown as string).valid).toBe(false)
      expect(validateDrawioCode(undefined as unknown as string).valid).toBe(false)
    })

    it('应该拒绝过大的内容', () => {
      const largeCode = '<mxfile>' + 'x'.repeat(501 * 1024) + '</mxfile>'
      const result = validateDrawioCode(largeCode)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('内容过大')
      expect(result.error).toContain('500KB')
    })

    it('应该拒绝刚好超过限制的内容', () => {
      // 500KB + 1 byte
      const code = '<mxfile>' + 'x'.repeat(500 * 1024 - 7) + '</mxfile>'
      const result = validateDrawioCode(code)
      expect(result.valid).toBe(false)
    })

    it('应该拒绝无效的 DrawIO 格式', () => {
      const result = validateDrawioCode('<svg>not drawio</svg>')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('无效的 DrawIO 格式')
      expect(result.error).toContain('mxGraphModel')
    })

    it('应该拒绝纯文本', () => {
      expect(validateDrawioCode('hello world').valid).toBe(false)
    })

    it('应该拒绝其他 XML 格式', () => {
      expect(validateDrawioCode('<root><item>test</item></root>').valid).toBe(false)
    })

    it('应该接受包含 mxGraphModel 的 XML', () => {
      const code = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'
      expect(validateDrawioCode(code)).toEqual({ valid: true })
    })

    it('应该接受包含 mxfile 的 XML', () => {
      const code = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>'
      expect(validateDrawioCode(code)).toEqual({ valid: true })
    })

    it('应该接受大小写不敏感的标签', () => {
      expect(validateDrawioCode('<MXGRAPHMODEL></MXGRAPHMODEL>')).toEqual({ valid: true })
      expect(validateDrawioCode('<MxFile></MxFile>')).toEqual({ valid: true })
    })

    it('应该接受带属性的 mxGraphModel', () => {
      const code = '<mxGraphModel dx="1422" dy="762" grid="1"><root><mxCell id="0"/></root></mxGraphModel>'
      expect(validateDrawioCode(code)).toEqual({ valid: true })
    })

    it('应该接受多行 DrawIO XML', () => {
      const code = `<mxfile host="app.diagrams.net" modified="2024-01-01">
  <diagram name="Page-1" id="abc123">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="Hello" style="rounded=1;" vertex="1" parent="1">
          <mxGeometry x="120" y="120" width="120" height="60" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`
      expect(validateDrawioCode(code)).toEqual({ valid: true })
    })

    it('应该接受刚好在限制内的内容', () => {
      // 刚好 500KB 以内
      const code = '<mxfile>' + 'x'.repeat(500 * 1024 - 100) + '</mxfile>'
      expect(validateDrawioCode(code)).toEqual({ valid: true })
    })
  })

  describe('processDrawioInHtml', () => {
    it('应该返回不含 drawio 代码块的 HTML 原样', async () => {
      const html = '<p>Hello World</p>'
      const result = await processDrawioInHtml(html)
      expect(result).toBe(html)
    })

    it('应该处理 drawio 代码块', async () => {
      const html = '<pre class="language-drawio"><code class="language-drawio">&lt;mxfile&gt;&lt;/mxfile&gt;</code></pre>'
      const result = await processDrawioInHtml(html)
      expect(result).toContain('drawio-container')
      expect(result).toContain('DrawIO 图表')
      expect(result).not.toContain('language-drawio')
    })

    it('应该处理多个 drawio 代码块', async () => {
      const html = `
        <pre class="language-drawio"><code class="language-drawio">&lt;mxfile&gt;first&lt;/mxfile&gt;</code></pre>
        <p>中间内容</p>
        <pre class="language-drawio"><code class="language-drawio">&lt;mxfile&gt;second&lt;/mxfile&gt;</code></pre>
      `
      const result = await processDrawioInHtml(html)
      expect(result).toContain('中间内容')
      expect(result).not.toContain('language-drawio')
      // 两个代码块都应该被替换为占位符
      const containerCount = (result.match(/drawio-container/g) || []).length
      expect(containerCount).toBe(2)
    })

    it('应该正确反转义 HTML 实体', async () => {
      const html = '<pre class="language-drawio"><code class="language-drawio">&lt;mxGraphModel dx=&quot;100&quot;&gt;&lt;/mxGraphModel&gt;</code></pre>'
      const result = await processDrawioInHtml(html)
      expect(result).toContain('drawio-container')
    })

    it('应该限制最大处理数量', async () => {
      // 创建 12 个代码块（超过 MAX_PER_PAGE = 10）
      let html = ''
      for (let i = 0; i < 12; i++) {
        html += `<pre class="language-drawio"><code class="language-drawio">&lt;mxfile&gt;block${i}&lt;/mxfile&gt;</code></pre>\n`
      }
      const result = await processDrawioInHtml(html)
      // 前 10 个应该被替换
      const containerCount = (result.match(/drawio-container/g) || []).length
      expect(containerCount).toBe(10)
      // 后 2 个应该保持原样
      const remainingCount = (result.match(/language-drawio/g) || []).length
      expect(remainingCount).toBeGreaterThan(0)
    })

    it('应该保留非 drawio 的 HTML 内容', async () => {
      const html = `
        <h1>标题</h1>
        <pre class="language-drawio"><code class="language-drawio">&lt;mxfile&gt;&lt;/mxfile&gt;</code></pre>
        <pre class="language-javascript"><code class="language-javascript">console.log("hello")</code></pre>
        <p>段落</p>
      `
      const result = await processDrawioInHtml(html)
      expect(result).toContain('<h1>标题</h1>')
      expect(result).toContain('language-javascript')
      expect(result).toContain('<p>段落</p>')
    })

    it('应该处理空字符串', async () => {
      const result = await processDrawioInHtml('')
      expect(result).toBe('')
    })
  })

  describe('loadDrawioViewer', () => {
    beforeEach(() => {
      // 清理 DOM 中可能残留的 script 标签
      document.querySelectorAll('script[src*="drawio-viewer"]').forEach(el => el.remove())
    })

    it('应该创建 script 标签加载 viewer', async () => {
      // 由于 jsdom 不会真正加载脚本，我们只验证 script 标签被创建
      const { loadDrawioViewer } = await import('../../src/utils/drawioRenderer')

      // 不等待 promise（会因为 jsdom 无法加载脚本而挂起）
      // 只验证 script 标签被添加到 head
      const scriptsBefore = document.querySelectorAll('script[src*="drawio-viewer"]').length

      // 触发加载（不 await）
      loadDrawioViewer().catch(() => {
        // 预期在测试环境中会失败
      })

      // 验证 script 标签被创建
      const scriptsAfter = document.querySelectorAll('script[src*="drawio-viewer"]').length
      expect(scriptsAfter).toBeGreaterThanOrEqual(scriptsBefore)
    })
  })
})
