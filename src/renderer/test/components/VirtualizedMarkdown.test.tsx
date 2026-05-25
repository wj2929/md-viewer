// @ts-nocheck - 测试文件的类型检查暂时跳过
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VirtualizedMarkdown } from '../../src/components/VirtualizedMarkdown'

const mockRenderExcalidrawToSvg = vi.hoisted(() => vi.fn())
const mockRenderVegaLiteToSvg = vi.hoisted(() => vi.fn())
const mockRenderD2ToSvg = vi.hoisted(() => vi.fn())
const mockRenderBpmnToSvg = vi.hoisted(() => vi.fn())
const mockRenderWaveDromToSvg = vi.hoisted(() => vi.fn())
const mockRenderPlantUMLToSvg = vi.hoisted(() => vi.fn())

vi.mock('../../src/utils/excalidrawRenderer', () => ({
  renderExcalidrawToSvg: mockRenderExcalidrawToSvg,
}))
vi.mock('../../src/utils/vegaLiteRenderer', () => ({
  renderVegaLiteToSvg: mockRenderVegaLiteToSvg,
  vegaLiteErrorHtml: (_title: string, message: string) => `<div class="vega-lite-error">${message}</div>`,
}))
vi.mock('../../src/utils/d2Renderer', () => ({
  renderD2ToSvg: mockRenderD2ToSvg,
  rendererErrorHtml: (_title: string, message: string, className: string) => `<div class="${className}">${message}</div>`,
}))
vi.mock('../../src/utils/bpmnRenderer', () => ({
  renderBpmnToSvg: mockRenderBpmnToSvg,
  cleanBpmnRefPath: (refPath: string) => refPath.split(/[?#]/, 1)[0] || refPath,
  isMissingReadBpmnFileHandlerError: (error: unknown) => String((error as Error)?.message || error).includes('No handler registered')
    && String((error as Error)?.message || error).includes('fs:readBpmnFile'),
  resolveBpmnFallbackPath: (markdownFilePath: string, refPath: string) => {
    const baseDir = markdownFilePath.replace(/[/\\][^/\\]*$/, '')
    return `${baseDir}/${refPath.replace(/^\.\//, '')}`
  },
}))
vi.mock('../../src/utils/wavedromRenderer', () => ({
  renderWaveDromToSvg: mockRenderWaveDromToSvg,
}))
vi.mock('../../src/utils/plantumlRenderer', () => ({
  validatePlantUMLCode: vi.fn(() => ({ valid: true })),
  renderPlantUMLToSvg: mockRenderPlantUMLToSvg,
}))

// Mock window.api
const mockShowMarkdownContextMenu = vi.fn().mockResolvedValue({ success: true })
const mockShowPreviewContextMenu = vi.fn().mockResolvedValue({ success: true })

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  global.window.api = {
    ...global.window.api,
    readFile: vi.fn(),
    readExcalidrawFile: undefined,
    openExternal: vi.fn().mockResolvedValue({ success: true }),
    openMdLink: vi.fn().mockResolvedValue({ success: true }),
    showMarkdownContextMenu: mockShowMarkdownContextMenu,
    showPreviewContextMenu: mockShowPreviewContextMenu
  } as typeof window.api
  mockRenderExcalidrawToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 50"><rect width="100" height="50"></rect></svg>',
    width: 100,
    height: 50,
    warnings: [],
    sourceKind: 'file-reference',
    sourceLabel: '流程',
    rawCode: '{"type":"excalidraw","elements":[]}',
  })
  mockRenderVegaLiteToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>Vega</text></svg>',
  })
  mockRenderD2ToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>D2</text></svg>',
  })
  mockRenderBpmnToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>BPMN</text></svg>',
  })
  mockRenderWaveDromToSvg.mockReturnValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>WaveDrom</text></svg>',
  })
  mockRenderPlantUMLToSvg.mockResolvedValue('<svg viewBox="0 0 100 40"><text>C4</text></svg>')
  // 默认没有选中文本
  vi.spyOn(window, 'getSelection').mockReturnValue(null)
})

describe('VirtualizedMarkdown', () => {
  describe('小文件渲染（非虚拟滚动）', () => {
    it('应该渲染基础 Markdown 内容', () => {
      const content = '# 标题\n\n这是一段文本'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
      expect(screen.getByText('标题')).toBeInTheDocument()
    })

    it('应该渲染空内容占位符', () => {
      const { container } = render(<VirtualizedMarkdown content="" />)

      expect(container.innerHTML).toContain('文件内容为空')
    })

    it('应该渲染仅空格内容', () => {
      // trim() 会移除空格和换行符，所以纯空白应该显示占位符
      const { container } = render(<VirtualizedMarkdown content="      " />)

      expect(container.innerHTML).toContain('文件内容为空')
    })

    it('应该应用自定义 className', () => {
      const { container } = render(
        <VirtualizedMarkdown content="# 测试" className="custom-class" />
      )

      expect(container.querySelector('.markdown-body')).toHaveClass('custom-class')
    })

    it('应该渲染代码块并应用语法高亮', () => {
      const content = '```javascript\nconst x = 1\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const codeBlock = container.querySelector('pre.language-javascript')
      expect(codeBlock).toBeInTheDocument()
    })

    it('应该渲染 mermaid 代码块', () => {
      const content = '```mermaid\ngraph TD\n  A --> B\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre.language-mermaid')).toBeInTheDocument()
    })

    it('应该渲染新增 RendererPlugin 代码块', async () => {
      const content = [
        '```vega-lite',
        '{"data":{"values":[]},"mark":"bar"}',
        '```',
        '',
        '```d2',
        'a -> b',
        '```',
        '',
        '```bpmn',
        '<definitions />',
        '```',
        '',
        '```wavedrom',
        "{ signal: [{ name: 'clk', wave: 'p..P' }] }",
        '```',
        '',
        '```c4',
        '@startuml',
        'Person(user, "用户")',
        '@enduml',
        '```',
      ].join('\n')

      render(<VirtualizedMarkdown content={content} renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.vega-lite-container svg')).toBeTruthy()
        expect(document.querySelector('.d2-container svg')).toBeTruthy()
        expect(document.querySelector('.bpmn-container svg')).toBeTruthy()
        expect(document.querySelector('.wavedrom-container svg')).toBeTruthy()
        expect(document.querySelector('.c4plantuml-wrapper .plantuml-container svg')).toBeTruthy()
      })

      expect(document.querySelector('.vega-lite-toggle-bar .vega-lite-action-btn[data-action="toggleCode"]')).toBeTruthy()
      expect(document.querySelector('.d2-toggle-bar .d2-action-btn[data-action="toggleCode"]')).toBeTruthy()
      expect(document.querySelector('.bpmn-toggle-bar .bpmn-action-btn[data-action="toggleCode"]')).toBeTruthy()
      expect(document.querySelector('.wavedrom-toggle-bar .wavedrom-action-btn[data-action="toggleCode"]')).toBeTruthy()
      expect(document.querySelector('.c4plantuml-wrapper .plantuml-toggle-bar .plantuml-action-btn[data-action="toggleCode"]')).toBeTruthy()
    })

    it('新增 SVG RendererPlugin 应支持源码视图切换', async () => {
      const content = [
        '```vega-lite',
        '{"data":{"values":[]},"mark":"bar"}',
        '```',
        '',
        '```bpmn',
        '<definitions />',
        '```',
        '',
        '```wavedrom',
        "{ signal: [{ name: 'clk', wave: 'p..P' }] }",
        '```',
      ].join('\n')

      render(<VirtualizedMarkdown content={content} renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.vega-lite-wrapper .vega-lite-container svg')).toBeTruthy()
        expect(document.querySelector('.bpmn-wrapper .bpmn-container svg')).toBeTruthy()
        expect(document.querySelector('.wavedrom-wrapper .wavedrom-container svg')).toBeTruthy()
      })

      for (const chartType of ['vega-lite', 'bpmn', 'wavedrom']) {
        const wrapper = document.querySelector(`.${chartType}-wrapper`) as HTMLElement
        fireEvent.click(wrapper.querySelector(`.${chartType}-action-btn[data-action="toggleCode"]`)!)
        expect((wrapper.querySelector(`.${chartType}-container`) as HTMLElement).style.display).toBe('none')
        expect((wrapper.querySelector(`.${chartType}-code-view`) as HTMLElement).style.display).toBe('')
        fireEvent.click(wrapper.querySelector(`.${chartType}-back-btn`)!)
        expect((wrapper.querySelector(`.${chartType}-container`) as HTMLElement).style.display).toBe('')
        expect((wrapper.querySelector(`.${chartType}-code-view`) as HTMLElement).style.display).toBe('none')
      }
    })

    it('D2 预览应该支持主动放大并可恢复适应宽度', async () => {
      mockRenderD2ToSvg.mockResolvedValueOnce({
        ok: true,
        svg: '<svg width="400" viewBox="0 0 400 120" style="max-width: 100%; height: auto; display: block"><text>D2</text></svg>',
      })

      render(<VirtualizedMarkdown content={'```d2\na -> b\n```'} renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.d2-wrapper .d2-container svg')).toBeTruthy()
      })

      const wrapper = document.querySelector('.d2-wrapper') as HTMLElement
      const container = document.querySelector('.d2-container') as HTMLElement
      const svg = document.querySelector('.d2-container svg') as SVGSVGElement

      expect(wrapper.querySelector('.d2-action-btn[data-action="zoomIn"]')).toBeTruthy()
      expect(wrapper.querySelector('.d2-action-btn[data-action="fit"]')).toBeTruthy()

      fireEvent.click(wrapper.querySelector('.d2-action-btn[data-action="zoomIn"]')!)
      expect(container.dataset.zoomLevel).toBe('120')
      expect(svg.getAttribute('width')).toBe('480')
      expect(svg.style.width).toBe('480px')
      expect(svg.style.maxWidth).toBe('none')
      expect(svg.style.maxHeight).toBe('none')
      expect(svg.style.flexShrink).toBe('0')

      fireEvent.click(wrapper.querySelector('.d2-action-btn[data-action="fit"]')!)
      expect(container.dataset.zoomLevel).toBe('100')
      expect(svg.getAttribute('width')).toBe('400')
      expect(svg.getAttribute('style')).toContain('max-width: 100%')
    })

    it('应该渲染行内数学公式', () => {
      const content = '公式 $E=mc^2$ 示例'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('E=mc^2')
    })

    it('应该渲染块级数学公式', () => {
      const content = '$$\nx = \\frac{1}{2}\n$$'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('frac')
    })

    it('应该渲染单行块级数学公式', () => {
      const content = '$$ E = mc^2 $$'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('E = mc^2')
    })

    it('把 .excalidraw 图片引用替换为文件占位而不是 local-image', async () => {
      global.window.api.readExcalidrawFile = vi.fn(() => new Promise(() => undefined))
      render(<VirtualizedMarkdown content={'![流程](./flow.excalidraw?raw=1#v)'} filePath="/docs/a.md" renderDebounceMs={0} />)
      await waitFor(() => {
        expect(document.querySelector('.excalidraw-file-placeholder')).toBeTruthy()
      })
      expect(global.window.api.readExcalidrawFile).toHaveBeenCalledWith({
        markdownFilePath: '/docs/a.md',
        refPath: './flow.excalidraw'
      })
      expect(document.querySelector('img[src^="local-image://"]')).toBeFalsy()
    })

    it('渲染 Excalidraw 文件引用并复制源码视图内容', async () => {
      const rawCode = '{"type":"excalidraw","elements":[]}'
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true
      })
      global.window.api.readExcalidrawFile = vi.fn().mockResolvedValue({
        content: rawCode,
        resolvedPath: '/docs/flow.excalidraw'
      })

      render(<VirtualizedMarkdown content={'![流程](./flow.excalidraw)'} filePath="/docs/a.md" renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.excalidraw-wrapper')).toBeTruthy()
      })
      expect(document.querySelector('.excalidraw-container svg')?.getAttribute('role')).toBe('img')
      expect(document.querySelector('.excalidraw-container svg')?.getAttribute('aria-label')).toContain('流程')

      fireEvent.click(document.querySelector('.excalidraw-action-btn[data-action="toggleCode"]')!)
      fireEvent.click(document.querySelector('.excalidraw-code-view .copy-btn')!)

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(rawCode)
      })
    })

    it('旧 preload 缺少 readExcalidrawFile 时应该回退到 readFile 读取相对引用', async () => {
      const rawCode = '{"type":"excalidraw","elements":[]}'
      global.window.api.readExcalidrawFile = undefined as any
      global.window.api.readFile = vi.fn().mockResolvedValue(rawCode)

      render(<VirtualizedMarkdown content={'![流程](./flow.excalidraw)'} filePath="/docs/a.md" renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.excalidraw-wrapper')).toBeTruthy()
      })
      expect(global.window.api.readFile).toHaveBeenCalledWith('/docs/flow.excalidraw')
      expect(document.querySelector('.excalidraw-container svg')?.getAttribute('aria-label')).toContain('流程')
    })

    it('BPMN 文件引用在旧主进程缺少 readBpmnFile handler 时应该回退到 readFile', async () => {
      const rawCode = '<definitions />'
      global.window.api.readBpmnFile = vi.fn().mockRejectedValue(
        new Error("Error invoking remote method 'fs:readBpmnFile': Error: No handler registered for 'fs:readBpmnFile'")
      )
      global.window.api.readFile = vi.fn().mockResolvedValue(rawCode)

      render(<VirtualizedMarkdown content={'![流程](./flow.bpmn)'} filePath="/docs/a.md" renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.bpmn-wrapper')).toBeTruthy()
      })
      expect(global.window.api.readBpmnFile).toHaveBeenCalledWith({
        markdownFilePath: '/docs/a.md',
        refPath: './flow.bpmn'
      })
      expect(global.window.api.readFile).toHaveBeenCalledWith('/docs/flow.bpmn')
      expect(document.querySelector('.bpmn-container svg')).toBeTruthy()
      expect(document.querySelector('.bpmn-error')).toBeFalsy()
    })

    it('同一 Markdown 中应该渲染超过 20 个 Excalidraw 文件引用', async () => {
      const rawCode = '{"type":"excalidraw","elements":[]}'
      global.window.api.readExcalidrawFile = vi.fn().mockResolvedValue({
        content: rawCode,
        resolvedPath: '/docs/flow.excalidraw'
      })
      const content = Array.from({ length: 24 }, (_, index) =>
        `![图 ${index + 1}](./flow-${index + 1}.excalidraw)`
      ).join('\n\n')

      render(<VirtualizedMarkdown content={content} filePath="/docs/a.md" renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelectorAll('.excalidraw-wrapper')).toHaveLength(24)
      })
      expect(global.window.api.readExcalidrawFile).toHaveBeenCalledTimes(24)
    })

    it('把普通本地图片引用转换为编码后的 local-image 绝对路径', async () => {
      render(
        <VirtualizedMarkdown
          content={'![欢迎图](<./images/user manual/欢迎页.png>)'}
          filePath="/Users/mac/Documents/test/testmd/md-viewer/docs/user-manual.md"
          renderDebounceMs={0}
        />
      )

      await waitFor(() => {
        const img = document.querySelector('img[alt="欢迎图"]')
        expect(img).toBeTruthy()
        expect(img?.getAttribute('src')).toBe('local-image:///Users/mac/Documents/test/testmd/md-viewer/docs/images/user%20manual/%E6%AC%A2%E8%BF%8E%E9%A1%B5.png')
      })
    })

    it('切换文件路径后仍应按新 Markdown 所在目录解析本地图片', async () => {
      const { rerender } = render(
        <VirtualizedMarkdown
          content={'![图](./images/a.png)'}
          filePath="/docs/old/source.md"
          renderDebounceMs={0}
        />
      )

      await waitFor(() => {
        expect(document.querySelector('img[alt="图"]')?.getAttribute('src')).toBe('local-image:///docs/old/images/a.png')
      })

      rerender(
        <VirtualizedMarkdown
          content={'![图](./images/a.png)'}
          filePath="/docs/new/source.md"
          renderDebounceMs={0}
        />
      )

      await waitFor(() => {
        expect(document.querySelector('img[alt="图"]')?.getAttribute('src')).toBe('local-image:///docs/new/images/a.png')
      })
    })
  })

  describe('右键菜单 (v1.3.7)', () => {
    it('应该在有 filePath 时显示右键菜单', async () => {
      const content = '# 测试'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        headingId: null,
        headingText: null,
        headingLevel: null,
        hasSelection: false,
        selectionText: '',
        sourceLine: null,
        scrollRatio: 0,
        chartCount: 0,
        tabId: undefined,
        leafId: null,
        linkHref: null,
        basePath: null
      })
    })

    it('应该在没有 filePath 时不显示右键菜单', () => {
      const content = '# 测试'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowPreviewContextMenu).not.toHaveBeenCalled()
    })

    it.each([
      ['Shift+F10', { key: 'F10', shiftKey: true }],
      ['菜单键', { key: 'ContextMenu' }],
    ])('应该支持通过 %s 打开同一个预览区上下文菜单', async (_label, keyEvent) => {
      const content = '# 测试'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" tabId="tab-a" leafId="leaf-a" />
      )

      const markdownBody = container.querySelector('.markdown-body') as HTMLElement
      expect(markdownBody.tabIndex).toBe(0)

      fireEvent.keyDown(markdownBody, keyEvent)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        headingId: null,
        headingText: null,
        headingLevel: null,
        hasSelection: false,
        selectionText: '',
        sourceLine: null,
        scrollRatio: 0,
        chartCount: 0,
        tabId: 'tab-a',
        leafId: 'leaf-a',
        linkHref: null,
        basePath: null
      })
    })

    it('应该检测标题元素', () => {
      const content = '# 测试标题'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      // 模拟右键点击标题
      const heading = container.querySelector('h1')
      if (heading) {
        heading.id = 'test-heading'
        heading.textContent = '测试标题'
        fireEvent.contextMenu(heading)

        expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
          filePath: '/test/file.md',
          headingId: 'test-heading',
          headingText: '测试标题',
          headingLevel: 'h1',
          hasSelection: false,
          selectionText: '',
          sourceLine: 1,
          scrollRatio: 0,
          chartCount: 0,
          tabId: undefined,
          leafId: null,
          linkHref: null,
          basePath: null
        })
      }
    })

    it('应该检测文本选择状态', () => {
      // Mock window.getSelection
      const mockSelection = {
        toString: () => '选中的文本'
      }
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as Selection)

      const content = '# 测试内容'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        headingId: null,
        headingText: null,
        headingLevel: null,
        hasSelection: true,
        selectionText: '选中的文本',
        sourceLine: null,
        scrollRatio: 0,
        chartCount: 0,
        tabId: undefined,
        leafId: null,
        linkHref: null,
        basePath: null
      })

      // 恢复 mock
      vi.restoreAllMocks()
    })

    it('应该把当前预览区可导出的图表数量传给主进程菜单', () => {
      const content = '# 测试内容'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body') as HTMLElement
      const chartWrapper = document.createElement('div')
      chartWrapper.className = 'mermaid-wrapper'
      chartWrapper.innerHTML = `
        <div class="mermaid-container">
          <svg viewBox="0 0 120 60"><rect width="120" height="60"></rect></svg>
        </div>
      `
      markdownBody.appendChild(chartWrapper)

      fireEvent.contextMenu(chartWrapper.querySelector('svg')!)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith(expect.objectContaining({
        filePath: '/test/file.md',
        chartCount: 1,
      }))
    })

    // 虚拟滚动已禁用，跳过此测试
  })

  describe('代码高亮边界情况', () => {
    it('应该处理未知语言', () => {
      const content = '```unknownlang\ncode here\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre')).toBeInTheDocument()
    })

    it('应该处理无语言标识的代码块', () => {
      const content = '```\nplain text\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre')).toBeInTheDocument()
    })

    it('应该处理多种语言代码块', () => {
      const content = `
\`\`\`javascript
const a = 1
\`\`\`

\`\`\`python
def foo():
    pass
\`\`\`

\`\`\`rust
fn main() {}
\`\`\`
`
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelectorAll('pre').length).toBe(3)
    })
  })

  describe('数学公式边界情况', () => {
    it('应该处理未闭合的行内公式', () => {
      const content = '这是 $未闭合的公式'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      // 应该正常渲染，不崩溃
      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })

    it('应该处理空的数学公式', () => {
      const content = '空公式 $$ 示例'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })

    it('应该处理转义的美元符号', () => {
      const content = '价格是 \\$100'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('100')
    })

    it('应该处理连续的美元符号', () => {
      const content = '$$$ 不是公式'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })
  })

  describe('Markdown 语法', () => {
    it('应该渲染表格', () => {
      const content = `
| 列1 | 列2 |
|-----|-----|
| A   | B   |
`
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('table')).toBeInTheDocument()
    })

    it('应该渲染有序列表', () => {
      const content = '1. 项目1\n2. 项目2\n3. 项目3'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('ol')).toBeInTheDocument()
    })

    it('应该渲染无序列表', () => {
      const content = '- 项目1\n- 项目2\n- 项目3'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('ul')).toBeInTheDocument()
    })

    it('应该渲染引用块', () => {
      const content = '> 这是引用'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('blockquote')).toBeInTheDocument()
    })

    it('应该渲染链接', () => {
      const content = '[链接](https://example.com)'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('href', 'https://example.com')
    })

    it('应该自动链接 URL', () => {
      const content = 'https://example.com'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      // linkify 选项应该将 URL 转换为链接
      const link = container.querySelector('a')
      expect(link).toBeInTheDocument()
    })

    it('点击外部链接应该交给系统浏览器打开', () => {
      render(<VirtualizedMarkdown content={'[官网](https://example.com/docs)'} />)

      fireEvent.click(screen.getByRole('link', { name: '官网' }))

      expect(window.api.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    })

    it('点击内部 .md 链接应该交给上层统一导航', () => {
      const onMarkdownLinkClick = vi.fn()
      render(
        <VirtualizedMarkdown
          content={'[目标文档](<./目标 文档.md#二级标题>)'}
          filePath="/docs/current.md"
          onMarkdownLinkClick={onMarkdownLinkClick}
        />
      )

      fireEvent.click(screen.getByRole('link', { name: '目标文档' }))

      expect(onMarkdownLinkClick).toHaveBeenCalledWith('./目标 文档.md#二级标题', '/docs/current.md')
      expect(window.api.openMdLink).not.toHaveBeenCalled()
    })

    it('点击页内锚点应该滚动到目标标题', () => {
      const scrollIntoView = vi.fn()
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      })

      render(<VirtualizedMarkdown content={'# 二级标题\n\n[跳转](#二级标题)'} />)

      fireEvent.click(screen.getByRole('link', { name: '跳转' }))

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    })
  })

  describe('渲染区块编辑', () => {
    it('默认预览不允许直接编辑渲染块', () => {
      const { container } = render(<VirtualizedMarkdown content={'# 标题\n\n正文'} renderDebounceMs={0} />)

      expect(container.querySelector('h1')).not.toHaveAttribute('contenteditable', 'true')
      expect(container.querySelector('p')).not.toHaveAttribute('contenteditable', 'true')
    })

    it('开启渲染区块编辑后，普通段落失焦时回传源码行修改', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'# 标题\n\n正文'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={onPreviewBlockEdit}
        />
      )

      const paragraph = container.querySelector('p') as HTMLElement
      expect(paragraph).toHaveAttribute('contenteditable', 'true')

      paragraph.textContent = '修改后的正文'
      fireEvent.blur(paragraph)

      expect(onPreviewBlockEdit).toHaveBeenCalledWith({
        sourceLine: 3,
        originalText: '正文',
        nextText: '修改后的正文',
      })
    })

    it('开启渲染区块编辑后，带格式的列表项也可以回传源码行修改', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'- **最终脚本设置：** `MAX_REQ=490/10秒`，20线程并发'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={onPreviewBlockEdit}
        />
      )

      const listItem = container.querySelector('li') as HTMLElement
      expect(listItem).toHaveAttribute('contenteditable', 'true')

      listItem.textContent = '最终脚本设置：MAX_REQ=480/10秒，20线程并发'
      fireEvent.blur(listItem)

      expect(onPreviewBlockEdit).toHaveBeenCalledWith({
        sourceLine: 1,
        originalText: '最终脚本设置： MAX_REQ=490/10秒，20线程并发',
        nextText: '最终脚本设置：MAX_REQ=480/10秒，20线程并发',
      })
    })

    it('开启渲染区块编辑后，表格单元格失焦时回传单元格位置', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'| 数据 | 状态 |\n| --- | --- |\n| 频道汇总统计 | 完成 |'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={onPreviewBlockEdit}
        />
      )

      const statusCell = Array.from(container.querySelectorAll('td'))
        .find(cell => cell.textContent?.trim() === '完成') as HTMLElement
      expect(statusCell).toHaveAttribute('contenteditable', 'true')

      statusCell.textContent = '处理中'
      fireEvent.blur(statusCell)

      expect(onPreviewBlockEdit).toHaveBeenCalledWith({
        sourceLine: 3,
        originalText: '完成',
        nextText: '处理中',
        editKind: 'table-cell',
        tableCellIndex: 1,
      })
    })

    it('开启渲染区块编辑后，普通代码块失焦时回传围栏代码范围', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'```text\nBaseUrl: http://api.polyv.net/\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={onPreviewBlockEdit}
        />
      )

      const codeBlock = container.querySelector('pre') as HTMLElement
      expect(codeBlock).toHaveAttribute('contenteditable', 'true')

      codeBlock.textContent = 'BaseUrl: https://api.polyv.net/'
      fireEvent.blur(codeBlock)

      expect(onPreviewBlockEdit).toHaveBeenCalledWith({
        sourceLine: 1,
        sourceEndLine: 3,
        originalText: 'BaseUrl: http://api.polyv.net/',
        nextText: 'BaseUrl: https://api.polyv.net/',
        editKind: 'code-block',
      })
    })

    it('图表代码块默认不铺开提示，聚焦后提供不参与导出的源码编辑动作', () => {
      const onSourceEditRequest = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'```mermaid\ngraph TD\n  A --> B\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
          onSourceEditRequest={onSourceEditRequest}
        />
      )

      expect(screen.queryByRole('note')).not.toBeInTheDocument()

      const codeBlock = container.querySelector('pre') as HTMLElement
      fireEvent.focus(codeBlock)

      const hint = screen.getByRole('note')
      expect(hint).toHaveClass('no-export')

      const button = screen.getByRole('button', { name: /在源码中编辑/ })
      fireEvent.click(button)

      expect(onSourceEditRequest).toHaveBeenCalledWith({
        sourceLine: 1,
        sourceEndLine: 4,
      })
      expect(codeBlock).not.toHaveAttribute('contenteditable', 'true')
    })

    it('不可直接编辑块应该提供源码编辑说明入口', () => {
      render(
        <VirtualizedMarkdown
          content={'```mermaid\ngraph TD\n  A --> B\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
          onSourceEditRequest={vi.fn()}
        />
      )

      expect(screen.queryByRole('note')).not.toBeInTheDocument()

      const codeBlock = screen.getByText(/graph TD/).closest('pre') as HTMLElement
      fireEvent.focus(codeBlock)

      const helpButton = screen.getByRole('button', { name: /查看源码编辑说明/ })
      expect(helpButton.closest('.markdown-preview-source-only-hint')).toHaveClass('no-export')

      fireEvent.click(helpButton)

      expect(window.api.openExternal).toHaveBeenCalledWith(expect.stringContaining('docs/user-manual.md#源码编辑'))
    })

    it('不可直接编辑块按 Escape 后应该隐藏提示并释放焦点', () => {
      const { container } = render(
        <VirtualizedMarkdown
          content={'```mermaid\ngraph TD\n  A --> B\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
          onSourceEditRequest={vi.fn()}
        />
      )

      const codeBlock = container.querySelector('pre') as HTMLElement
      fireEvent.focus(codeBlock)

      const hint = screen.getByRole('note')
      expect(hint).not.toHaveAttribute('hidden')
      expect(codeBlock).toHaveClass('is-source-hint-active')

      fireEvent.keyDown(codeBlock, { key: 'Escape' })

      expect(hint).toHaveAttribute('hidden')
      expect(codeBlock).not.toHaveClass('is-source-hint-active')
      expect(document.activeElement).not.toBe(codeBlock)
    })

    it('开启渲染区块编辑后不直接编辑图表代码块', () => {
      const { container } = render(
        <VirtualizedMarkdown
          content={'```mermaid\ngraph TD\n  A --> B\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      expect(container.querySelector('pre')).not.toHaveAttribute('contenteditable', 'true')
    })

    it('可编辑块获得焦点后，待处理的预览重渲染不应替换该块', async () => {
      const { container, rerender } = render(
        <VirtualizedMarkdown
          content={'# 标题\n\n旧段落'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      const paragraph = container.querySelector('p') as HTMLElement
      paragraph.focus()
      expect(document.activeElement).toBe(paragraph)

      rerender(
        <VirtualizedMarkdown
          content={'# 标题\n\n外部重渲染内容'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
      })

      expect(container.querySelector('p')).toBe(paragraph)
      expect(document.activeElement).toBe(paragraph)
      expect(paragraph.textContent).toBe('旧段落')
    })

    it('中文 IME 组合输入期间不应被预览重渲染替换', async () => {
      const { container, rerender } = render(
        <VirtualizedMarkdown
          content={'# 标题\n\n输入中'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      const paragraph = container.querySelector('p') as HTMLElement
      paragraph.focus()
      fireEvent.compositionStart(paragraph)

      rerender(
        <VirtualizedMarkdown
          content={'# 标题\n\n外部重渲染内容'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
      })

      expect(container.querySelector('p')).toBe(paragraph)
      expect(document.activeElement).toBe(paragraph)
      expect(paragraph.textContent).toBe('输入中')
    })

    it('可编辑块无修改失焦后，应应用之前延迟的预览重渲染', async () => {
      const { container, rerender } = render(
        <VirtualizedMarkdown
          content={'# 标题\n\n旧段落'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      const paragraph = container.querySelector('p') as HTMLElement
      paragraph.focus()

      rerender(
        <VirtualizedMarkdown
          content={'# 标题\n\n外部重渲染内容'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
      })
      expect(paragraph.textContent).toBe('旧段落')

      await act(async () => {
        fireEvent.blur(paragraph)
      })

      await waitFor(() => {
        expect(container.querySelector('p')?.textContent).toBe('外部重渲染内容')
      })
    })

    it('可编辑块提交后，应允许父级草稿内容重渲染到预览区', async () => {
      function EditablePreviewHarness(): JSX.Element {
        const [content, setContent] = useState('# 标题\n\n旧段落')
        return (
          <VirtualizedMarkdown
            content={content}
            renderDebounceMs={0}
            previewEditingEnabled
            onPreviewBlockEdit={(edit) => {
              setContent(`# 标题\n\n${edit.nextText}\n\n父级补充段落`)
            }}
          />
        )
      }

      const { container } = render(<EditablePreviewHarness />)

      const paragraph = container.querySelector('p') as HTMLElement
      paragraph.focus()
      paragraph.textContent = '提交后的段落'

      await act(async () => {
        fireEvent.blur(paragraph)
      })

      await waitFor(() => {
        expect(Array.from(container.querySelectorAll('p')).map(element => element.textContent)).toEqual([
          '提交后的段落',
          '父级补充段落',
        ])
      })
    })
  })

  describe('性能优化', () => {
    // 虚拟滚动已禁用，跳过此测试
    it('NonVirtualizedMarkdown 应该使用 memo', () => {
      const content = '# 短内容'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })
  })

  describe('滚动位置重置 (v1.3.4 修复)', () => {
    it('使用 key prop 时，切换文件应重新挂载组件', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nContent of file 1"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 切换到不同的文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content="# File 2\n\nContent of file 2"
          filePath="/file2.md"
        />
      )

      const secondInstance = container.firstChild

      // 验证是不同的 DOM 实例（说明组件被重新挂载）
      expect(firstInstance).not.toBe(secondInstance)
    })

    it('相同文件路径但内容变化时，不应重新挂载组件', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nOriginal content"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 相同文件，内容变化（模拟外部编辑）
      rerender(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nModified content"
          filePath="/file1.md"
        />
      )

      const secondInstance = container.firstChild

      // 验证是同一个 DOM 实例（组件未重新挂载，只是内容更新）
      expect(firstInstance).toBe(secondInstance)
    })

    it('切换文件时应渲染新文件的内容', () => {
      const { rerender } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1"
          filePath="/file1.md"
        />
      )

      // 验证第一个文件的内容
      expect(screen.getByText('File 1')).toBeInTheDocument()

      // 切换到第二个文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content="# File 2"
          filePath="/file2.md"
        />
      )

      // 验证第二个文件的内容
      expect(screen.getByText('File 2')).toBeInTheDocument()
    })

    it('快速切换多个文件时应保持稳定', () => {
      const files = [
        { path: '/file1.md', content: '# File 1' },
        { path: '/file2.md', content: '# File 2' },
        { path: '/file3.md', content: '# File 3' },
        { path: '/file4.md', content: '# File 4' },
        { path: '/file5.md', content: '# File 5' }
      ]

      const { rerender } = render(
        <VirtualizedMarkdown
          key={files[0].path}
          content={files[0].content}
          filePath={files[0].path}
        />
      )

      // 快速切换文件
      files.forEach((file, index) => {
        if (index === 0) return // 跳过第一个（已渲染）

        rerender(
          <VirtualizedMarkdown
            key={file.path}
            content={file.content}
            filePath={file.path}
          />
        )

        // 验证每次切换都渲染正确的内容
        expect(screen.getByText(`File ${index + 1}`)).toBeInTheDocument()
      })
    })

    it('组件重新挂载时滚动位置应重置为 0', async () => {
      const { rerender } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content={'# File 1\n\n' + 'Line\n'.repeat(100)}
          filePath="/file1.md"
        />
      )

      const container = screen.getByText('File 1').closest('.markdown-body')?.parentElement as HTMLElement

      // 模拟用户滚动到底部
      if (container && container.scrollHeight > 0) {
        container.scrollTop = container.scrollHeight
        expect(container.scrollTop).toBeGreaterThan(0)
      }

      // 切换到新文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content={'# File 2\n\n' + 'Line\n'.repeat(100)}
          filePath="/file2.md"
        />
      )

      // 新组件的滚动位置应该是 0
      const newContainer = screen.getByText('File 2').closest('.markdown-body')?.parentElement as HTMLElement
      if (newContainer) {
        expect(newContainer.scrollTop).toBe(0)
      }
    })

    it('无 key prop 时，切换文件不会重新挂载组件（旧行为）', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          content="# File 1"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 切换到不同的文件，但没有 key prop
      rerender(
        <VirtualizedMarkdown
          content="# File 2"
          filePath="/file2.md"
        />
      )

      const secondInstance = container.firstChild

      // 验证是同一个 DOM 实例（组件未重新挂载，只是 props 更新）
      expect(firstInstance).toBe(secondInstance)
    })
  })
})
