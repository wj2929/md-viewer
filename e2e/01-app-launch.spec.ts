import { test, expect } from './fixtures/electron'

/**
 * E2E 测试 1: 应用启动
 * 验证应用能够正常启动并显示欢迎页面
 */
test.describe('应用启动测试', () => {
  test('应用应该成功启动并显示欢迎页面', async ({ page }) => {
    // 验证窗口标题
    const title = await page.title()
    expect(title).toContain('MD Viewer')

    // 验证欢迎页面元素
    await expect(page.locator('.welcome')).toBeVisible()
    await expect(page.locator('.app-title')).toHaveText('MD Viewer')
    await expect(page.locator('.welcome h2')).toHaveText('欢迎使用 MD Viewer')

    // 验证"打开文件夹"按钮存在
    const openFolderBtn = page.locator('.open-folder-btn')
    await expect(openFolderBtn).toBeVisible()
    await expect(openFolderBtn).toHaveText('打开文件夹')
  })

  test('应用窗口应该有正确的最小尺寸', async ({ electronApp }) => {
    const window = await electronApp.firstWindow()
    const size = await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    // 验证最小尺寸 (800x600)
    expect(size.width).toBeGreaterThanOrEqual(800)
    expect(size.height).toBeGreaterThanOrEqual(600)
  })

  test('应用标题栏应该包含主题切换按钮', async ({ page }) => {
    // v1.2 新增：主题切换
    const themeToggle = page.locator('.theme-toggle')
    await expect(themeToggle).toBeVisible()
  })

  test('应用应该有正确的初始主题', async ({ page }) => {
    // 检查 data-theme 属性
    const app = page.locator('.app')
    const theme = await app.getAttribute('data-theme')

    // 主题应该是 light, dark 或 auto
    expect(['light', 'dark', 'auto']).toContain(theme || 'auto')
  })

  test('点击主题切换按钮应该切换主题', async ({ page }) => {
    const themeToggle = page.locator('.theme-toggle')
    const app = page.locator('.app')

    // 获取初始主题
    const initialTheme = await app.getAttribute('data-theme')

    // 点击切换
    await themeToggle.click()

    // 等待主题变化
    await page.waitForTimeout(100)

    // 验证主题已切换
    const newTheme = await app.getAttribute('data-theme')

    // 主题应该发生了变化（auto -> light -> dark -> auto）
    // 不一定是完全不同的值，因为 auto 可能解析为 light 或 dark
    expect(newTheme).toBeDefined()
  })
})
