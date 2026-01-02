import { test, expect } from './fixtures/electron'
import { mkdirSync, writeFileSync, rmSync, appendFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * E2E 测试 4: 文件监听功能 (v1.1 核心功能)
 * 验证文件修改、添加、删除时的自动刷新
 */

let testDir: string

test.beforeEach(() => {
  testDir = join(tmpdir(), `md-viewer-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'watch-test.md'), '# Original Content\n\nInitial text')
})

test.afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test.describe('文件监听功能测试 (v1.1)', () => {
  test('应该在文件修改时自动刷新标签页内容', async ({ page }) => {
    // 打开文件夹并选择文件
    // （需要先实现打开逻辑）

    // 验证初始内容
    await expect(page.locator('.markdown-body h1')).toHaveText('Original Content')

    // 修改文件
    writeFileSync(join(testDir, 'watch-test.md'), '# Updated Content\n\nModified text')

    // 等待自动刷新（最多 3 秒）
    await page.waitForTimeout(3000)

    // 验证内容已更新
    await expect(page.locator('.markdown-body h1')).toHaveText('Updated Content')
    await expect(page.locator('.markdown-body p')).toHaveText('Modified text')
  })

  test('应该在文件添加时刷新文件树', async ({ page }) => {
    // 打开文件夹
    // （需要先实现打开逻辑）

    // 记录初始文件数量
    const initialCount = await page.locator('.file-item').count()

    // 添加新文件
    writeFileSync(join(testDir, 'new-file.md'), '# New File\n\nNew content')

    // 等待文件树刷新（最多 3 秒）
    await page.waitForTimeout(3000)

    // 验证文件树增加了新文件
    const newCount = await page.locator('.file-item').count()
    expect(newCount).toBe(initialCount + 1)

    // 验证新文件可见
    await expect(page.locator('.file-item', { hasText: 'new-file.md' })).toBeVisible()
  })

  test('应该在文件删除时关闭标签并刷新文件树', async ({ page }) => {
    // 打开文件夹并选择文件
    // （需要先实现打开逻辑）

    // 验证标签页打开
    await expect(page.locator('.tab', { hasText: 'watch-test.md' })).toBeVisible()

    // 删除文件
    unlinkSync(join(testDir, 'watch-test.md'))

    // 等待标签关闭和文件树刷新（最多 3 秒）
    await page.waitForTimeout(3000)

    // 验证标签页已关闭
    await expect(page.locator('.tab', { hasText: 'watch-test.md' })).not.toBeVisible()

    // 验证文件树中不再显示该文件
    await expect(page.locator('.file-item', { hasText: 'watch-test.md' })).not.toBeVisible()
  })

  test('应该在快速连续修改时正确处理', async ({ page }) => {
    // 打开文件
    // （需要先实现打开逻辑）

    // 快速连续修改 5 次
    for (let i = 1; i <= 5; i++) {
      writeFileSync(join(testDir, 'watch-test.md'), `# Version ${i}\n\nContent ${i}`)
      await page.waitForTimeout(500)
    }

    // 等待最后一次更新
    await page.waitForTimeout(3000)

    // 验证显示最新内容
    await expect(page.locator('.markdown-body h1')).toHaveText('Version 5')
    await expect(page.locator('.markdown-body p')).toHaveText('Content 5')
  })

  test('应该正确处理子目录中的文件变化', async ({ page }) => {
    // 创建子目录和文件
    mkdirSync(join(testDir, 'subfolder'))
    writeFileSync(join(testDir, 'subfolder', 'nested.md'), '# Nested File')

    // 打开文件夹
    // （需要先实现打开逻辑）

    // 修改子目录中的文件
    writeFileSync(join(testDir, 'subfolder', 'nested.md'), '# Modified Nested File')

    // 如果该文件已打开，验证自动刷新
    // （需要先打开该文件）

    await page.waitForTimeout(3000)
    // 验证内容更新
  })
})
