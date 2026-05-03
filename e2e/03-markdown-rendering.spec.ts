import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { test, expect } from './fixtures/electron'
import type { Page } from '@playwright/test'

const EXCALIDRAW_VISUAL_DIR = join(__dirname, '..', 'test-results', 'excalidraw-visual')

/**
 * E2E 测试 3: Markdown 渲染功能
 * 验证基础 Markdown、代码高亮、数学公式、Mermaid 图表渲染
 */
async function openMarkdownFile(page: Page, filePath: string): Promise<void> {
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), filePath)
}

test.describe('Markdown 渲染测试', () => {
  test('应该正确渲染基础 Markdown 语法', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'test2.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证标题渲染
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 2')

    // 验证粗体和斜体
    await expect(page.locator('.markdown-body strong')).toHaveText('Bold')
    await expect(page.locator('.markdown-body em')).toHaveText('italic')

    // 验证列表
    const listItems = page.locator('.markdown-body ul li')
    await expect(listItems).toHaveCount(2)
  })

  test('应该正确渲染代码块并高亮', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'code.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证代码块存在
    const codeBlock = page.locator('pre code')
    await expect(codeBlock).toBeVisible()

    // 验证代码高亮（Prism.js 应该添加了语言类）
    const preElement = page.locator('pre.language-javascript, pre:has(code.language-javascript)')
    await expect(preElement).toBeVisible()
  })

  test('应该正确渲染 KaTeX 数学公式', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'math.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 等待 KaTeX 渲染
    await page.waitForTimeout(1000)

    // 验证 KaTeX 渲染（行内公式）
    const inlineFormula = page.locator('.katex')
    await expect(inlineFormula.first()).toBeVisible()

    // 验证块级公式
    const blockFormula = page.locator('.katex-display')
    await expect(blockFormula).toBeVisible()
  })

  test('应该正确渲染 Mermaid 图表', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'mermaid.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 等待 Mermaid 渲染完成（可能需要更长时间）
    await page.waitForTimeout(3000)

    // 验证 Mermaid 容器或 SVG 存在
    const mermaidContainer = page.locator('.mermaid-container, .mermaid, svg[id^="mermaid"]')
    await expect(mermaidContainer.first()).toBeVisible()
  })

  test('Excalidraw fixture 应覆盖代码块、文件引用、警告和错误渲染', async ({ page, electronApp, testDir }) => {
    test.setTimeout(120000)
    const fixturePath = join(__dirname, 'fixtures/test-excalidraw.md')
    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    await expect(page.locator('.excalidraw-wrapper')).toHaveCount(69, { timeout: 90000 })
    await expect(page.locator('.excalidraw-container svg')).toHaveCount(64, { timeout: 90000 })
    await expect(page.locator('.excalidraw-error')).toHaveCount(5)
    await expect(page.locator('.excalidraw-warning')).toHaveCount(3)
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-kind="code-block"] .excalidraw-container svg').first()).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="基础流程"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="带查询参数"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="网关扇出"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="电商平台架构"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="较大但均衡"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="绑定文本容器"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="Frame 元素"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="箭头头部集合"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="Sequence 生命线"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="Class Diagram"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="ER Diagram"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="小元素网格"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="PlantUML 高级序列图"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="PlantUML Salt 线框"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="PlantUML 链接类图"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="PlantUML 复杂导出序列"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-warning')).toContainText([
      '图片资源缺失',
      '空画布',
      '兼容模式',
    ])
    const basicFlowBox = await page.locator('.excalidraw-wrapper[data-excalidraw-source-label="基础流程"] .excalidraw-container svg').boundingBox()
    expect(basicFlowBox?.width ?? 0).toBeLessThan(900)
    mkdirSync(EXCALIDRAW_VISUAL_DIR, { recursive: true })
    const visualTargets = [
      { label: '基础流程', file: 'basic-flow.png' },
      { label: 'Unicode 与长文本', file: 'text-unicode.png' },
      { label: '较大但均衡', file: 'large-balanced-graph.png' },
      { label: '箭头头部集合', file: 'arrowhead-gallery.png' },
      { label: '纵向长流程', file: 'tall-flow.png' },
      { label: '横向宽画布', file: 'wide-canvas.png' },
      { label: 'PlantUML 高级序列图', file: 'plantuml-sequence-advanced.png' },
      { label: 'PlantUML Salt 线框', file: 'plantuml-salt-wireframe.png' },
      { label: 'PlantUML 复杂导出序列', file: 'plantuml-export-sequence.png' },
    ]
    for (const target of visualTargets) {
      const wrapper = page.locator(`.excalidraw-wrapper[data-excalidraw-source-label="${target.label}"]`).first()
      const box = await wrapper.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThan(160)
      expect(box?.height ?? 0).toBeGreaterThan(60)
      const screenshot = await wrapper.screenshot({
        path: join(EXCALIDRAW_VISUAL_DIR, target.file),
      })
      expect(screenshot.byteLength).toBeGreaterThan(2000)
    }
    await expect(page.locator('.excalidraw-action-btn[data-action="toggleCode"]').first()).toBeVisible()
    await expect(page.locator('.markdown-body')).not.toContainText('缺少 Markdown 文件路径')
    await expect(page.locator('.markdown-body')).not.toContainText('当前环境不支持读取 Excalidraw 文件')
  })

  test('重复打开同一路径时应该从磁盘刷新 Markdown 内容', async ({ page, electronApp, testDir }) => {
    const markdownPath = join(testDir, 'cache-refresh.md')
    writeFileSync(markdownPath, '# 旧内容\n\n第一次打开', 'utf8')

    await openMarkdownFile(page, markdownPath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })
    await expect(page.locator('.markdown-body h1')).toHaveText('旧内容')

    writeFileSync(markdownPath, '# 新内容\n\n第二次打开', 'utf8')
    await openMarkdownFile(page, markdownPath)

    await expect(page.locator('.markdown-body h1')).toHaveText('新内容', { timeout: 10000 })
    await expect(page.locator('.markdown-body')).toContainText('第二次打开')
  })

  test('DrawIO 应渲染基础图和 dio 别名，并拦截破损 XML', async ({ page, electronApp, testDir }) => {
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    const fixturePath = join(__dirname, 'fixtures/test-drawio-smoke.md')
    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    await expect(page.locator('.drawio-wrapper')).toHaveCount(2, { timeout: 15000 })
    await expect(page.locator('.drawio-error')).toHaveCount(1)
    await expect(page.locator('.drawio-error')).toContainText('XML 格式错误')
    await page.waitForFunction(() =>
      document.querySelectorAll('.drawio-container[data-drawio-ready="true"]').length === 2
    )
    const renderedSvgs = page.locator('.drawio-container svg')
    await expect(renderedSvgs.first()).toBeVisible()
    const firstBox = await renderedSvgs.nth(0).boundingBox()
    const secondBox = await renderedSvgs.nth(1).boundingBox()
    expect(firstBox?.width ?? 0).toBeGreaterThan(100)
    expect(firstBox?.height ?? 0).toBeGreaterThan(50)
    expect(secondBox?.width ?? 0).toBeGreaterThan(80)
    expect(secondBox?.height ?? 0).toBeGreaterThan(40)

    expect(consoleErrors.filter(message =>
      message.includes('createViewerForElement') || message.includes('Not a diagram file')
    )).toEqual([])
  })

  test('标签栏应该显示打开的文件', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'test1.md'))
    await page.waitForSelector('.tab', { timeout: 5000 })

    // 验证标签存在
    const tab = page.locator('.tab:has-text("test1.md")')
    await expect(tab).toBeVisible()

    await openMarkdownFile(page, join(testDir, 'test2.md'))
    await page.waitForTimeout(500)

    // 验证两个标签
    await expect(page.locator('.tab')).toHaveCount(2)
  })

  test('点击标签应该切换预览', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'test1.md'))
    await page.waitForSelector('.markdown-body', { timeout: 5000 })

    await openMarkdownFile(page, join(testDir, 'test2.md'))
    await page.waitForTimeout(500)

    // 验证当前显示 test2
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 2')

    // 点击 test1 标签
    await page.click('.tab:has-text("test1.md")')
    await page.waitForTimeout(300)

    // 验证切换到 test1
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  })

  test('关闭标签按钮应该关闭标签', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'test1.md'))
    await page.waitForSelector('.tab', { timeout: 5000 })

    // 找到关闭按钮并点击
    const closeBtn = page.locator('.tab:has-text("test1.md") .tab-close, .tab:has-text("test1.md") .close-btn')
    if (await closeBtn.isVisible()) {
      await closeBtn.click()

      // 等待关闭
      await page.waitForTimeout(300)

      // 验证标签已关闭
      await expect(page.locator('.tab:has-text("test1.md")')).not.toBeVisible()
    }
  })
})
