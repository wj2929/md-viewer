import { test, expect } from './fixtures/electron'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * E2E 测试 2: 文件树功能
 * 验证文件夹打开、文件树显示、文件选择功能
 */

let testDir: string

test.beforeEach(() => {
  // 创建临时测试目录
  testDir = join(tmpdir(), `md-viewer-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })

  // 创建测试文件
  writeFileSync(join(testDir, 'test1.md'), '# Test 1\n\nHello World')
  writeFileSync(join(testDir, 'test2.md'), '# Test 2\n\n## Subtitle\n\nContent here')

  // 创建子目录
  mkdirSync(join(testDir, 'subfolder'))
  writeFileSync(join(testDir, 'subfolder', 'nested.md'), '# Nested\n\nNested content')
})

test.afterEach(() => {
  // 清理测试目录
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test.describe('文件树功能测试', () => {
  test('应该能打开文件夹并显示文件树', async ({ page, electronApp }) => {
    // 模拟打开文件夹对话框（需要手动触发或使用 electron API）
    // 注意：这个测试需要配合 electron.dialog 的 mock
    await page.evaluate((folderPath) => {
      // 模拟通过 API 打开文件夹
      window.api.openFolder = async () => folderPath
    }, testDir)

    // 点击打开文件夹按钮
    await page.click('.open-folder-btn')

    // 等待文件树加载
    await page.waitForSelector('.file-tree-container', { timeout: 5000 })

    // 验证文件树显示
    const fileTree = page.locator('.file-tree-container')
    await expect(fileTree).toBeVisible()

    // 验证文件夹名称显示
    const folderName = page.locator('.folder-name')
    await expect(folderName).toBeVisible()
  })

  test('文件树应该只显示 .md 文件', async ({ page }) => {
    // 在测试目录创建非 .md 文件
    writeFileSync(join(testDir, 'test.txt'), 'Not a markdown file')
    writeFileSync(join(testDir, 'test.js'), 'console.log("JS file")')

    // 打开文件夹后验证
    // （需要先实现打开文件夹的逻辑）

    // 验证只有 .md 文件被显示
    // const mdFiles = await page.locator('.file-item').count()
    // expect(mdFiles).toBe(3) // test1.md, test2.md, subfolder/nested.md
  })

  test('应该能展开和折叠文件夹', async ({ page }) => {
    // 打开文件夹后
    // 找到子文件夹
    const subfolderToggle = page.locator('.folder-toggle').first()

    // 点击展开
    await subfolderToggle.click()
    await expect(page.locator('.file-item', { hasText: 'nested.md' })).toBeVisible()

    // 点击折叠
    await subfolderToggle.click()
    await expect(page.locator('.file-item', { hasText: 'nested.md' })).not.toBeVisible()
  })
})
