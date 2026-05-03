import { test, expect } from './fixtures/electron'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * E2E 测试 5: 导出功能
 * 验证 HTML 和 PDF 导出功能
 */

let testDir: string

async function openMarkdownFile(page: Page, filePath: string): Promise<void> {
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), filePath)
  await page.waitForSelector('.markdown-body', { timeout: 10000 })
}

async function mockSaveDialog(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, filePath) => {
    ;(globalThis as any).__mdViewerSaveDialogCalls = []
    dialog.showSaveDialog = async (...args: unknown[]) => {
      const options = args.length === 1 ? args[0] : args[1]
      ;(globalThis as any).__mdViewerSaveDialogCalls.push(options)
      return { canceled: false, filePath }
    }
  }, filePath)
}

async function getSaveDialogCalls(electronApp: ElectronApplication): Promise<Array<{ defaultPath?: string }>> {
  return electronApp.evaluate(() => (globalThis as any).__mdViewerSaveDialogCalls ?? [])
}

async function triggerMarkdownExport(
  electronApp: ElectronApplication,
  channel: 'markdown:export-html' | 'markdown:export-pdf'
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, channel) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.webContents.send(channel)
  }, channel)
}

async function waitForFile(filePath: string, timeout = 10000): Promise<void> {
  await expect.poll(() => existsSync(filePath), { timeout }).toBe(true)
}

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
    await openMarkdownFile(page, join(testDir, 'export-test.md'))

    const exportPath = join(testDir, 'exported.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect(htmlContent).toContain('<!DOCTYPE html>')
    expect(htmlContent).toContain('Export Test')
    expect(htmlContent).toContain('<span class="token keyword">function</span>')
    expect(htmlContent).toContain('<span class="token function">hello</span>')

    // 验证包含 KaTeX CSS
    expect(htmlContent).toContain('katex')

    // 验证包含 Prism 高亮
    expect(htmlContent).toContain('language-javascript')
  })

  test('应该能导出 PDF 文件', async ({ page, electronApp }) => {
    await openMarkdownFile(page, join(testDir, 'export-test.md'))

    const exportPath = join(testDir, 'exported.pdf')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-pdf')

    await waitForFile(exportPath, 20000)
    const buffer = readFileSync(exportPath)

    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.toString('utf-8', 0, 4)).toBe('%PDF')
  })

  test('导出的 HTML 应该包含完整的样式', async ({ page, electronApp }) => {
    await openMarkdownFile(page, join(testDir, 'export-test.md'))

    const exportPath = join(testDir, 'styled.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect(htmlContent).toContain('<style>')
    expect(htmlContent).toContain('.markdown-body')
    expect(htmlContent).toContain('--bg-primary')

    // 验证包含代码高亮样式
    expect(htmlContent).toContain('.token')
  })

  test('没有打开标签时不应该触发导出', async ({ page, electronApp }) => {
    const exportPath = join(testDir, 'empty.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-html')
    await page.waitForTimeout(500)

    expect(existsSync(exportPath)).toBe(false)
    expect(await getSaveDialogCalls(electronApp)).toHaveLength(0)
  })

  test('导出应该处理特殊字符文件名', async ({ page, electronApp }) => {
    const specialMarkdown = '# Special Test'
    const markdownPath = join(testDir, '特殊-文件名 (1).md')
    writeFileSync(markdownPath, specialMarkdown)
    await openMarkdownFile(page, markdownPath)

    const exportPath = join(testDir, 'special.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath)
    const calls = await getSaveDialogCalls(electronApp)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect(calls.at(-1)?.defaultPath).toBe('特殊-文件名 (1).html')
    expect(htmlContent).toContain('Special Test')
    expect(htmlContent).toContain('<title>特殊-文件名 (1).md</title>')
  })
})
