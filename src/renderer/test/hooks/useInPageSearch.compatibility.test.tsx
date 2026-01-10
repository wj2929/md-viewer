/**
 * mark.js 兼容性测试
 * 验证 mark.js 与现有渲染管道（Prism、KaTeX、Mermaid）的兼容性
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Mark from 'mark.js'

describe('mark.js 兼容性测试', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  describe('exclude 配置测试', () => {
    it('应该排除代码块 <pre> 中的内容', () => {
      container.innerHTML = `
        <p>这里有 API 关键词</p>
        <pre class="language-javascript"><code>const API = "test"</code></pre>
        <p>另一个 API 出现</p>
      `

      const instance = new Mark(container)
      let highlightCount = 0

      instance.mark('API', {
        className: 'search-highlight',
        exclude: ['pre', 'code'],
        each: () => {
          highlightCount++
        }
      })

      // 应该只高亮 <p> 中的两个 API，不高亮 <pre><code> 中的
      expect(highlightCount).toBe(2)

      // 验证代码块内容未被修改
      const codeBlock = container.querySelector('pre code')
      expect(codeBlock?.innerHTML).toBe('const API = "test"')
    })

    it('应该排除 KaTeX 公式 .katex 中的内容', () => {
      container.innerHTML = `
        <p>文本中的 x 变量</p>
        <span class="katex"><span class="katex-mathml">x = 1</span></span>
        <p>另一个 x 变量</p>
      `

      const instance = new Mark(container)
      let highlightCount = 0

      instance.mark('x', {
        className: 'search-highlight',
        exclude: ['.katex', '.katex *'],
        each: () => {
          highlightCount++
        }
      })

      // 应该只高亮 <p> 中的两个 x，不高亮 .katex 中的
      expect(highlightCount).toBe(2)

      // 验证 KaTeX 内容未被修改
      const katexBlock = container.querySelector('.katex')
      expect(katexBlock?.innerHTML).toContain('x = 1')
      expect(katexBlock?.innerHTML).not.toContain('search-highlight')
    })

    it('应该排除 Mermaid 图表 .mermaid-container 中的内容', () => {
      container.innerHTML = `
        <p>流程图描述：用户登录</p>
        <div class="mermaid-container">
          <svg>
            <text>用户登录</text>
          </svg>
        </div>
        <p>登录后的操作</p>
      `

      const instance = new Mark(container)
      let highlightCount = 0

      instance.mark('登录', {
        className: 'search-highlight',
        exclude: ['.mermaid-container', '.mermaid-container *'],
        each: () => {
          highlightCount++
        }
      })

      // 应该只高亮 <p> 中的两个"登录"，不高亮 mermaid 中的
      expect(highlightCount).toBe(2)

      // 验证 Mermaid 内容未被修改
      const mermaidBlock = container.querySelector('.mermaid-container')
      expect(mermaidBlock?.innerHTML).not.toContain('search-highlight')
    })

    it('应该同时排除多种元素（综合测试）', () => {
      container.innerHTML = `
        <p>这是一个包含 API 的段落</p>
        <pre class="language-javascript"><code>const API = "test"</code></pre>
        <p>另一个 API 关键词</p>
        <span class="katex"><span class="katex-mathml">API formula</span></span>
        <p>第三个 API</p>
        <div class="mermaid-container"><text>API diagram</text></div>
        <p>最后一个 API</p>
      `

      const instance = new Mark(container)
      let highlightCount = 0

      instance.mark('API', {
        className: 'search-highlight',
        exclude: [
          'pre',
          'code',
          '.katex',
          '.katex *',
          '.mermaid-container',
          '.mermaid-container *'
        ],
        each: () => {
          highlightCount++
        }
      })

      // 应该只高亮 <p> 中的 4 个 API
      expect(highlightCount).toBe(4)
    })
  })

  describe('filter 回调测试（限制高亮数量）', () => {
    it('应该使用 filter 回调限制高亮数量', () => {
      // 创建包含 10 个匹配的内容
      container.innerHTML = Array.from({ length: 10 }, (_, i) =>
        `<p>第 ${i + 1} 个 API</p>`
      ).join('')

      const instance = new Mark(container)
      let highlightCount = 0
      const MAX_HIGHLIGHTS = 5

      instance.mark('API', {
        className: 'search-highlight',
        filter: () => {
          if (highlightCount >= MAX_HIGHLIGHTS) {
            return false
          }
          highlightCount++
          return true
        }
      })

      // 应该只高亮前 5 个
      const marks = container.querySelectorAll('.search-highlight')
      expect(marks.length).toBe(5)
    })

    it('应该在 done 回调中报告实际高亮数', async () => {
      // 创建包含 100 个匹配的内容
      container.innerHTML = Array.from({ length: 100 }, (_, i) =>
        `<p>第 ${i + 1} 个 API</p>`
      ).join('')

      const instance = new Mark(container)
      let highlightCount = 0
      const MAX_HIGHLIGHTS = 50

      await new Promise<void>((resolve) => {
        instance.mark('API', {
          className: 'search-highlight',
          filter: () => {
            if (highlightCount >= MAX_HIGHLIGHTS) {
              return false
            }
            highlightCount++
            return true
          },
          done: (totalMatches) => {
            // done 回调报告的是实际高亮的数量
            expect(totalMatches).toBe(50)
            resolve()
          }
        })
      })
    })
  })

  describe('特殊字符搜索测试', () => {
    // mark.js 默认使用字符串匹配（非正则），所以特殊字符不需要转义
    // 它会自动将搜索词作为字面量处理

    it('应该正确搜索方括号 [TODO]', () => {
      container.innerHTML = '<p>请完成 [TODO] 任务</p>'

      const instance = new Mark(container)
      const searchQuery = '[TODO]'

      // mark.js 默认模式下，特殊字符作为字面量处理
      instance.mark(searchQuery, {
        className: 'search-highlight'
      })

      const marks = container.querySelectorAll('.search-highlight')
      expect(marks.length).toBe(1)
      expect(marks[0].textContent).toBe('[TODO]')
    })

    it('应该正确搜索圆括号 (API)', () => {
      container.innerHTML = '<p>调用 (API) 接口</p>'

      const instance = new Mark(container)
      const searchQuery = '(API)'

      instance.mark(searchQuery, {
        className: 'search-highlight'
      })

      const marks = container.querySelectorAll('.search-highlight')
      expect(marks.length).toBe(1)
      expect(marks[0].textContent).toBe('(API)')
    })

    it('应该正确搜索星号和问号 .*', () => {
      container.innerHTML = '<p>正则表达式 .* 和 .? 通配符</p>'

      const instance = new Mark(container)
      const searchQuery = '.*'

      instance.mark(searchQuery, {
        className: 'search-highlight'
      })

      const marks = container.querySelectorAll('.search-highlight')
      expect(marks.length).toBe(1)
      expect(marks[0].textContent).toBe('.*')
    })

    it('应该正确搜索反斜杠 \\n', () => {
      container.innerHTML = '<p>换行符是 \\n 表示</p>'

      const instance = new Mark(container)
      const searchQuery = '\\n'

      instance.mark(searchQuery, {
        className: 'search-highlight'
      })

      const marks = container.querySelectorAll('.search-highlight')
      expect(marks.length).toBe(1)
      expect(marks[0].textContent).toBe('\\n')
    })
  })

  describe('unmark 清除测试', () => {
    it('应该完全清除所有高亮', () => {
      container.innerHTML = '<p>API 测试 API 测试</p>'

      const instance = new Mark(container)

      // 先标记
      instance.mark('API', { className: 'search-highlight' })
      expect(container.querySelectorAll('.search-highlight').length).toBe(2)

      // 清除
      instance.unmark()
      expect(container.querySelectorAll('.search-highlight').length).toBe(0)

      // 验证原始文本恢复
      expect(container.textContent).toBe('API 测试 API 测试')
    })

    it('应该在切换搜索词时正确清除并重新标记', () => {
      container.innerHTML = '<p>API 和 URL 都是常见缩写</p>'

      const instance = new Mark(container)

      // 搜索 API
      instance.mark('API', { className: 'search-highlight' })
      expect(container.querySelectorAll('.search-highlight').length).toBe(1)
      expect(container.querySelector('.search-highlight')?.textContent).toBe('API')

      // 清除并搜索 URL
      instance.unmark()
      instance.mark('URL', { className: 'search-highlight' })
      expect(container.querySelectorAll('.search-highlight').length).toBe(1)
      expect(container.querySelector('.search-highlight')?.textContent).toBe('URL')
    })
  })

  describe('大文件性能测试', () => {
    it('应该在 1000 个段落中快速搜索', () => {
      // 创建大量内容
      container.innerHTML = Array.from({ length: 1000 }, (_, i) =>
        `<p>这是第 ${i + 1} 个段落，包含 API 关键词</p>`
      ).join('')

      const instance = new Mark(container)
      const startTime = performance.now()
      let highlightCount = 0
      const MAX_HIGHLIGHTS = 500

      instance.mark('API', {
        className: 'search-highlight',
        filter: () => {
          if (highlightCount >= MAX_HIGHLIGHTS) {
            return false
          }
          highlightCount++
          return true
        }
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      // 应该在 500ms 内完成
      expect(duration).toBeLessThan(500)

      // 应该只高亮 500 个
      expect(container.querySelectorAll('.search-highlight').length).toBe(500)
    })
  })

  describe('中文和特殊字符测试', () => {
    it('应该正确高亮中文', () => {
      container.innerHTML = '<p>这是一个中文测试，包含接口和接口两个词</p>'

      const instance = new Mark(container)
      instance.mark('接口', { className: 'search-highlight' })

      const marks = container.querySelectorAll('.search-highlight')
      expect(marks.length).toBe(2)
    })

    it('应该正确高亮 emoji', () => {
      container.innerHTML = '<p>这是一个 🚀 火箭，还有一个 🚀 火箭</p>'

      const instance = new Mark(container)
      instance.mark('🚀', { className: 'search-highlight' })

      const marks = container.querySelectorAll('.search-highlight')
      expect(marks.length).toBe(2)
    })

    it('应该正确高亮日文', () => {
      container.innerHTML = '<p>これはテストです。テストは成功しました。</p>'

      const instance = new Mark(container)
      instance.mark('テスト', { className: 'search-highlight' })

      const marks = container.querySelectorAll('.search-highlight')
      expect(marks.length).toBe(2)
    })
  })
})
