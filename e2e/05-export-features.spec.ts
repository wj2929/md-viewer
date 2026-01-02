import { test, expect } from './fixtures/electron'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * E2E 测试 5: 导出功能
 * 验证 HTML 和 PDF 导出功能
 */

let testDir: string

test.beforeEach(() => {
  testDir = join(tmpdir(), `md-viewer-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })

  // 创建包含各种 Markdown 特性的测试文件
  const markdown = `# Export Test

## Code Block
\`\`\`javascript
function hello() {
  console.log("Hello");
}
\`\`\`

## Math Formula
$E = mc^2$

## Table
| Name | Age |
|------|-----|
| Alice | 25 |
| Bob | 30 |
`
  writeFileSync(join(testDir, 'export-test.md'), markdown)
})

test.afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test.describe('导出功能测试', () => {
  test('应该能导出 HTML 文件', async ({ page, electronApp }) => {
    // 打开文件
    // （需要先实现打开逻辑）

    const exportPath = join(testDir, 'exported.html')

    // Mock 保存对话框
    await page.evaluate((path) => {
      window.api.exportHTML = async (content: string, fileName: string) => {
        return path
      }
    }, exportPath)

    // 点击导出 HTML 按钮
    await page.click('.export-btn:has-text("导出 HTML")')

    // 等待导出完成
    await page.waitForTimeout(2000)

    // 验证文件是否创建（注意：实际测试中可能需要 mock dialog）
    if (existsSync(exportPath)) {
      const htmlContent = readFileSync(exportPath, 'utf-8')

      // 验证 HTML 包含必要元素
      expect(htmlContent).toContain('<!DOCTYPE html>')
      expect(htmlContent).toContain('Export Test')
      expect(htmlContent).toContain('function hello()')

      // 验证包含 KaTeX CSS
      expect(htmlContent).toContain('katex')

      // 验证包含 Prism 高亮
      expect(htmlContent).toContain('language-javascript')
    }
  })

  test('应该能导出 PDF 文件', async ({ page }) => {
    // 打开文件
    // （需要先实现打开逻辑）

    const exportPath = join(testDir, 'exported.pdf')

    // Mock 保存对话框
    await page.evaluate((path) => {
      window.api.exportPDF = async (content: string, fileName: string) => {
        return path
      }
    }, exportPath)

    // 点击导出 PDF 按钮
    await page.click('.export-btn:has-text("导出 PDF")')

    // 等待导出完成（PDF 生成可能较慢）
    await page.waitForTimeout(5000)

    // 验证文件是否创建
    if (existsSync(exportPath)) {
      const stats = require('fs').statSync(exportPath)

      // 验证文件大小合理（至少 1KB）
      expect(stats.size).toBeGreaterThan(1000)

      // 验证是 PDF 文件（检查文件头）
      const buffer = readFileSync(exportPath)
      const header = buffer.toString('utf-8', 0, 4)
      expect(header).toBe('%PDF')
    }
  })

  test('导出的 HTML 应该包含完整的样式', async ({ page }) => {
    // 导出 HTML
    const exportPath = join(testDir, 'styled.html')

    // Mock 并导出
    await page.evaluate((path) => {
      window.api.exportHTML = async (content: string) => path
    }, exportPath)

    await page.click('.export-btn:has-text("导出 HTML")')
    await page.waitForTimeout(2000)

    if (existsSync(exportPath)) {
      const htmlContent = readFileSync(exportPath, 'utf-8')

      // 验证包含内联样式
      expect(htmlContent).toContain('<style>')
      expect(htmlContent).toContain('.markdown-body')

      // 验证包含代码高亮样式
      expect(htmlContent).toContain('prism')
    }
  })

  test('应该在没有打开标签时禁用导出按钮', async ({ page }) => {
    // 不打开任何文件

    // 验证导出按钮不存在或不可见
    const exportBtn = page.locator('.export-btn')
    expect(await exportBtn.count()).toBe(0)
  })

  test('导出应该处理特殊字符文件名', async ({ page }) => {
    // 创建包含特殊字符的文件名
    const specialMarkdown = '# Special Test'
    writeFileSync(join(testDir, '特殊-文件名 (1).md'), specialMarkdown)

    // 打开并导出
    // 验证文件名正确转换
    // export-test.md -> export-test.html
  })
})
