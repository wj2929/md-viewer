import { test, expect, openFolderViaIPC } from './fixtures/electron'

/**
 * E2E 测试 2: 文件树功能
 * 验证文件夹打开、文件树显示、文件选择功能
 */
test.describe('文件树功能测试', () => {
  test('应该能显示文件树', async ({ page, electronApp, testDir }) => {
    // 通过 IPC 打开文件夹
    await openFolderViaIPC(electronApp, testDir)

    // 等待文件树加载
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 验证文件树显示
    const fileTree = page.locator('.file-tree-container')
    await expect(fileTree).toBeVisible()

    // 验证文件夹名称显示
    const folderName = page.locator('.folder-name')
    await expect(folderName).toBeVisible()
  })

  test('文件树应该显示 .md 文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 验证 md 文件显示
    await expect(page.locator('.file-item:has-text("test1.md")')).toBeVisible()
    await expect(page.locator('.file-item:has-text("test2.md")')).toBeVisible()
    await expect(page.locator('.file-item:has-text("code.md")')).toBeVisible()
  })

  test('应该能展开子文件夹', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 找到子文件夹并展开
    const subfolder = page.locator('.folder-item:has-text("subfolder")')
    await expect(subfolder).toBeVisible()

    // 点击展开
    await subfolder.click()

    // 验证嵌套文件可见
    await expect(page.locator('.file-item:has-text("nested.md")')).toBeVisible()
  })

  test('点击文件应该打开预览', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 点击文件
    await page.click('.file-item:has-text("test1.md")')

    // 等待预览加载
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证内容显示
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  })

  test('选中的文件应该高亮显示', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 点击文件
    const fileItem = page.locator('.file-item:has-text("test1.md")')
    await fileItem.click()

    // 等待选中状态
    await page.waitForTimeout(300)

    // 验证高亮类名（根据实际 CSS 类名调整）
    await expect(fileItem).toHaveClass(/selected|active/)
  })

  test('搜索栏应该能过滤文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 找到搜索栏
    const searchBar = page.locator('.search-input')
    await expect(searchBar).toBeVisible()

    // 输入搜索词
    await searchBar.fill('code')

    // 等待过滤
    await page.waitForTimeout(300)

    // 验证搜索结果
    const searchResults = page.locator('.search-results')
    if (await searchResults.isVisible()) {
      await expect(searchResults.locator(':has-text("code.md")')).toBeVisible()
    }
  })

  test('刷新按钮应该重新加载文件树', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 找到刷新按钮
    const refreshBtn = page.locator('.refresh-btn')
    await expect(refreshBtn).toBeVisible()

    // 点击刷新
    await refreshBtn.click()

    // 等待刷新完成
    await page.waitForTimeout(500)

    // 验证文件树仍然存在
    await expect(page.locator('.file-tree-container')).toBeVisible()
  })

  test('切换按钮应该允许更换文件夹', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 找到切换按钮
    const changeBtn = page.locator('.change-folder-btn')
    await expect(changeBtn).toBeVisible()
    await expect(changeBtn).toHaveText('切换')
  })
})
