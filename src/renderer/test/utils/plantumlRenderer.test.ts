import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validatePlantUMLCode, encodePlantUML, processPlantUMLInHtml, clearSvgCache } from '../../src/utils/plantumlRenderer'

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
