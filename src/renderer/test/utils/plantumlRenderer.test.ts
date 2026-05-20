import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validatePlantUMLCode, encodePlantUML, processPlantUMLInHtml, clearSvgCache, normalizePlantUMLCode } from '../../src/utils/plantumlRenderer'

// Mock plantuml-encoder
vi.mock('plantuml-encoder', () => ({
  default: {
    encode: vi.fn().mockReturnValue('SoWkIImgAStDuNBAJrBGjLDmpCbCJbMmKiX8pSd9vt98pKi1IW80')
  }
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('plantumlRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    clearSvgCache()
  })

  describe('validatePlantUMLCode', () => {
    it('应该拒绝空内容', () => {
      expect(validatePlantUMLCode('')).toEqual({ valid: false, error: '内容为空' })
      expect(validatePlantUMLCode('   ')).toEqual({ valid: false, error: '内容为空' })
    })

    it('应该拒绝过大的内容', () => {
      const largeCode = '@startuml\n' + 'A -> B: msg\n'.repeat(5000) + '@enduml'
      const result = validatePlantUMLCode(largeCode)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('内容过大')
    })

    it('应该接受有效的 PlantUML 代码', () => {
      expect(validatePlantUMLCode('@startuml\nA -> B: hello\n@enduml')).toEqual({ valid: true })
    })

    it('应该接受不含 @startuml 的代码（服务器会处理）', () => {
      expect(validatePlantUMLCode('A -> B: hello')).toEqual({ valid: true })
    })

    it('应该接受类图', () => {
      const code = `@startuml
class User {
  +name: String
  +login(): void
}
@enduml`
      expect(validatePlantUMLCode(code)).toEqual({ valid: true })
    })
  })

  describe('normalizePlantUMLCode', () => {
    it('应该为 C4-PlantUML 自动补充 C4 标准库 include', () => {
      const code = '@startuml\nPerson(user, "用户")\nSystem(app, "系统")\nRel(user, app, "使用")\n@enduml'

      const result = normalizePlantUMLCode(code, 'c4plantuml')

      expect(result).toContain('!include <C4/C4_Context>')
      expect(result).toContain('Person(user, "用户")')
    })

    it('应该根据 C4 容器宏自动补充 C4_Container include', () => {
      const code = [
        '@startuml',
        'Person(user, "用户")',
        'System_Boundary(app, "MD Viewer") {',
        '  Container(renderer, "RendererPlugin", "TypeScript", "渲染图表")',
        '}',
        'Rel(user, renderer, "预览")',
        '@enduml',
      ].join('\n')

      const result = normalizePlantUMLCode(code, 'c4plantuml')

      expect(result).toContain('!include <C4/C4_Container>')
      expect(result).not.toContain('!include <C4/C4_Context>')
    })

    it('应该根据 C4 组件宏自动补充 C4_Component include', () => {
      const code = [
        '@startuml',
        'Container_Boundary(exporter, "Export Pipeline") {',
        '  Component(html, "HTML Export", "TS", "生成 HTML")',
        '}',
        '@enduml',
      ].join('\n')

      const result = normalizePlantUMLCode(code, 'c4plantuml')

      expect(result).toContain('!include <C4/C4_Component>')
      expect(result).not.toContain('!include <C4/C4_Context>')
      expect(result).not.toContain('!include <C4/C4_Container>')
    })

    it('已有 C4 include 时不重复补充', () => {
      const code = '@startuml\n!include <C4/C4_Context>\nPerson(user, "用户")\n@enduml'

      const result = normalizePlantUMLCode(code, 'c4plantuml')

      expect(result.match(/!include <C4\/C4_Context>/g)).toHaveLength(1)
    })
  })

  describe('encodePlantUML', () => {
    it('应该调用 plantuml-encoder 编码', () => {
      const result = encodePlantUML('@startuml\nA -> B\n@enduml')
      expect(result).toBe('SoWkIImgAStDuNBAJrBGjLDmpCbCJbMmKiX8pSd9vt98pKi1IW80')
    })
  })

  describe('processPlantUMLInHtml', () => {
    it('应该返回不含 plantuml 代码块的 HTML 原样', async () => {
      const html = '<p>Hello World</p>'
      const result = await processPlantUMLInHtml(html)
      expect(result).toBe(html)
    })

    it('应该处理 plantuml 代码块', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<svg><text>PlantUML Chart</text></svg>')
      })

      const html = '<pre class="language-plantuml"><code class="language-plantuml">@startuml\nA -&gt; B: hello\n@enduml</code></pre>'
      const result = await processPlantUMLInHtml(html)
      expect(result).toContain('plantuml-container')
      expect(result).not.toContain('language-plantuml')
    })

    it('应该把 c4plantuml 代码块复用 PlantUML 导出路径', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<svg><text>C4 Chart</text></svg>')
      })

      const html = '<pre class="language-c4plantuml"><code class="language-c4plantuml">@startuml\nPerson(user, "用户")\n@enduml</code></pre>'
      const result = await processPlantUMLInHtml(html)
      expect(result).toContain('plantuml-container')
      expect(result).not.toContain('language-c4plantuml')
    })

    it('应该处理多个 plantuml 代码块', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<svg><text>Chart</text></svg>')
      })

      const html = `
        <pre class="language-plantuml"><code class="language-plantuml">@startuml\nA -&gt; B\n@enduml</code></pre>
        <p>中间内容</p>
        <pre class="language-plantuml"><code class="language-plantuml">@startuml\nC -&gt; D\n@enduml</code></pre>
      `
      const result = await processPlantUMLInHtml(html)
      expect(result).toContain('中间内容')
      expect(result).not.toContain('language-plantuml')
    })

    it('应该处理 fetch 失败', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const html = '<pre class="language-plantuml"><code class="language-plantuml">@startuml\nA -&gt; B\n@enduml</code></pre>'
      const result = await processPlantUMLInHtml(html)
      expect(result).toContain('plantuml-error')
      expect(result).toContain('渲染失败')
    })

    it('应该处理服务器返回非 200 状态', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })

      const html = '<pre class="language-plantuml"><code class="language-plantuml">@startuml\nA -&gt; B\n@enduml</code></pre>'
      const result = await processPlantUMLInHtml(html)
      expect(result).toContain('plantuml-error')
    })

    it('应该正确解码 HTML 实体', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<svg><text>Chart</text></svg>')
      })

      const html = '<pre class="language-plantuml"><code class="language-plantuml">A -&gt; B: &lt;hello&gt; &amp; &quot;world&quot;</code></pre>'
      const result = await processPlantUMLInHtml(html)
      expect(result).toContain('plantuml-container')
    })
  })
})
