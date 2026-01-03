import { test, expect, openFolderViaIPC } from './fixtures/electron'

/**
 * E2E 测试 3: Markdown 渲染功能
 * 验证基础 Markdown、代码高亮、数学公式、Mermaid 图表渲染
 */
test.describe('Markdown 渲染测试', () => {
  test('应该正确渲染基础 Markdown 语法', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 点击 test2.md（包含基础语法）
    await page.click('.file-item:has-text("test2.md")')
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
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 点击 code.md
    await page.click('.file-item:has-text("code.md")')
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证代码块存在
    const codeBlock = page.locator('pre code')
    await expect(codeBlock).toBeVisible()

    // 验证代码高亮（Prism.js 应该添加了语言类）
    const preElement = page.locator('pre.language-javascript, pre:has(code.language-javascript)')
    await expect(preElement).toBeVisible()
  })

  test('应该正确渲染 KaTeX 数学公式', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 点击 math.md
    await page.click('.file-item:has-text("math.md")')
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
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 点击 mermaid.md
    await page.click('.file-item:has-text("mermaid.md")')
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 等待 Mermaid 渲染完成（可能需要更长时间）
    await page.waitForTimeout(3000)

    // 验证 Mermaid 容器或 SVG 存在
    const mermaidContainer = page.locator('.mermaid-container, .mermaid, svg[id^="mermaid"]')
    await expect(mermaidContainer.first()).toBeVisible()
  })

  test('标签栏应该显示打开的文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 打开第一个文件
    await page.click('.file-item:has-text("test1.md")')
    await page.waitForSelector('.tab', { timeout: 5000 })

    // 验证标签存在
    const tab = page.locator('.tab:has-text("test1.md")')
    await expect(tab).toBeVisible()

    // 打开第二个文件
    await page.click('.file-item:has-text("test2.md")')
    await page.waitForTimeout(500)

    // 验证两个标签
    await expect(page.locator('.tab')).toHaveCount(2)
  })

  test('点击标签应该切换预览', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 打开两个文件
    await page.click('.file-item:has-text("test1.md")')
    await page.waitForSelector('.markdown-body', { timeout: 5000 })

    await page.click('.file-item:has-text("test2.md")')
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
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 打开文件
    await page.click('.file-item:has-text("test1.md")')
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
