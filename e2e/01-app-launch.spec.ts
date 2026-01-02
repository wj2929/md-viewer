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

  test('应用窗口应该有正确的最小尺寸', async ({ electronApp, page }) => {
    const window = await electronApp.firstWindow()
    const size = await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    // 验证最小尺寸 (800x600)
    expect(size.width).toBeGreaterThanOrEqual(800)
    expect(size.height).toBeGreaterThanOrEqual(600)
  })

  test('应用应该响应窗口调整大小', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })

    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    expect(size.width).toBe(1400)
    expect(size.height).toBe(900)
  })
})
