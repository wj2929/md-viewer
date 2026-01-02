import { test, expect } from './fixtures/electron'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * E2E 测试 3: Markdown 渲染功能
 * 验证基础 Markdown、代码高亮、数学公式、Mermaid 图表渲染
 */

let testDir: string

test.beforeEach(() => {
  testDir = join(tmpdir(), `md-viewer-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
})

test.afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test.describe('Markdown 渲染测试', () => {
  test('应该正确渲染基础 Markdown 语法', async ({ page }) => {
    // 创建包含基础语法的 Markdown 文件
    const markdown = `# Heading 1
## Heading 2

**Bold** and *italic* text

- List item 1
- List item 2

\`inline code\`
`
    writeFileSync(join(testDir, 'basic.md'), markdown)

    // 打开文件并验证渲染
    // （需要先实现文件选择逻辑）

    // 验证标题渲染
    await expect(page.locator('.markdown-body h1')).toHaveText('Heading 1')
    await expect(page.locator('.markdown-body h2')).toHaveText('Heading 2')

    // 验证粗体和斜体
    await expect(page.locator('.markdown-body strong')).toHaveText('Bold')
    await expect(page.locator('.markdown-body em')).toHaveText('italic')

    // 验证列表
    const listItems = page.locator('.markdown-body ul li')
    await expect(listItems).toHaveCount(2)
  })

  test('应该正确渲染代码块并高亮', async ({ page }) => {
    const markdown = `\`\`\`javascript
function hello() {
  console.log("Hello World");
}
\`\`\`
`
    writeFileSync(join(testDir, 'code.md'), markdown)

    // 打开文件后验证
    // 验证代码块存在
    const codeBlock = page.locator('pre.language-javascript')
    await expect(codeBlock).toBeVisible()

    // 验证代码高亮（Prism.js 应该添加了 token 类）
    const tokens = page.locator('.language-javascript .token')
    expect(await tokens.count()).toBeGreaterThan(0)
  })

  test('应该正确渲染 KaTeX 数学公式', async ({ page }) => {
    const markdown = `
行内公式: $E = mc^2$

块级公式:
$$
\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$
`
    writeFileSync(join(testDir, 'math.md'), markdown)

    // 打开文件后验证
    // 验证 KaTeX 渲染
    const inlineFormula = page.locator('.katex')
    await expect(inlineFormula.first()).toBeVisible()

    const blockFormula = page.locator('.katex-display')
    await expect(blockFormula).toBeVisible()
  })

  test('应该正确渲染 Mermaid 图表', async ({ page }) => {
    const markdown = `\`\`\`mermaid
graph LR
  A[Start] --> B[Process]
  B --> C[End]
\`\`\`
`
    writeFileSync(join(testDir, 'mermaid.md'), markdown)

    // 打开文件后验证
    // 等待 Mermaid 渲染完成
    await page.waitForSelector('.mermaid-container', { timeout: 10000 })

    // 验证 SVG 图表存在
    const mermaidSvg = page.locator('.mermaid-container svg')
    await expect(mermaidSvg).toBeVisible()

    // 验证图表包含节点
    const nodes = page.locator('.mermaid-container .node')
    expect(await nodes.count()).toBeGreaterThan(0)
  })

  test('应该处理超长内容截断', async ({ page }) => {
    // 创建超过 10000 行的文件
    const lines = Array.from({ length: 12000 }, (_, i) => `Line ${i + 1}`)
    const markdown = lines.join('\n')
    writeFileSync(join(testDir, 'long.md'), markdown)

    // 打开文件后验证
    // 验证截断警告显示
    await expect(page.locator('.content-warning')).toBeVisible()
    await expect(page.locator('.content-warning')).toContainText('12000')
    await expect(page.locator('.content-warning')).toContainText('10000')
  })
})
