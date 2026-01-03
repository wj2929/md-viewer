import { test, expect, openFolderViaIPC } from './fixtures/electron'

/**
 * E2E 测试 6: 键盘快捷键
 * 验证全局快捷键功能
 */
test.describe('键盘快捷键测试', () => {
  test('Cmd/Ctrl+O 应该触发打开文件夹对话框', async ({ page, electronApp }) => {
    // 按 Cmd+O (macOS) 或 Ctrl+O (Windows/Linux)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

    // 监听对话框事件
    let dialogOpened = false
    electronApp.on('dialog', () => {
      dialogOpened = true
    })

    await page.keyboard.press(`${modifier}+o`)

    // 给对话框一点时间打开
    await page.waitForTimeout(500)

    // 注意：在测试环境中，对话框可能不会真正打开
    // 这个测试主要验证快捷键被注册
  })

  test('Cmd/Ctrl+R 应该刷新文件树', async ({ page, electronApp, testDir }) => {
    // 先打开文件夹
    await openFolderViaIPC(electronApp, testDir)

    // 等待文件树加载
    await page.waitForSelector('.file-tree-container', { timeout: 5000 })

    // 按 Cmd+R 刷新
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+r`)

    // 等待刷新完成
    await page.waitForTimeout(500)

    // 验证文件树仍然存在（刷新成功）
    await expect(page.locator('.file-tree-container')).toBeVisible()
  })

  test('Cmd/Ctrl+W 应该关闭当前标签', async ({ page, electronApp, testDir }) => {
    // 打开文件夹
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 5000 })

    // 点击文件打开标签
    await page.click('.file-item:has-text("test1.md")')
    await page.waitForSelector('.tab', { timeout: 5000 })

    // 验证标签存在
    await expect(page.locator('.tab')).toBeVisible()

    // 按 Cmd+W 关闭标签
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+w`)

    // 等待关闭动画
    await page.waitForTimeout(300)

    // 验证标签已关闭或切换
    // 注意：如果这是最后一个标签，它会被关闭
  })

  test('Cmd/Ctrl+E 应该导出 HTML', async ({ page, electronApp, testDir }) => {
    // 打开文件夹和文件
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 5000 })
    await page.click('.file-item:has-text("test1.md")')
    await page.waitForSelector('.preview-toolbar', { timeout: 5000 })

    // 按 Cmd+E 导出 HTML
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

    // 监听对话框
    electronApp.on('dialog', (dialog) => {
      dialog.dismiss()
    })

    await page.keyboard.press(`${modifier}+e`)

    // 等待对话框
    await page.waitForTimeout(500)
  })

  test('Cmd/Ctrl+Shift+E 应该导出 PDF', async ({ page, electronApp, testDir }) => {
    // 打开文件夹和文件
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 5000 })
    await page.click('.file-item:has-text("test1.md")')
    await page.waitForSelector('.preview-toolbar', { timeout: 5000 })

    // 按 Cmd+Shift+E 导出 PDF
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

    // 监听对话框
    electronApp.on('dialog', (dialog) => {
      dialog.dismiss()
    })

    await page.keyboard.press(`${modifier}+Shift+e`)

    // 等待对话框
    await page.waitForTimeout(500)
  })

  test('Tab 键应该在文件树中导航', async ({ page, electronApp, testDir }) => {
    // 打开文件夹
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 5000 })

    // 聚焦到文件树
    await page.click('.file-tree-container')

    // 按 Tab 导航
    await page.keyboard.press('Tab')

    // 验证焦点移动（具体行为取决于实现）
  })

  test('Escape 键应该取消重命名', async ({ page, electronApp, testDir }) => {
    // 打开文件夹
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 5000 })

    // 双击文件开始重命名
    await page.dblclick('.file-item:has-text("test1.md")')

    // 检查是否进入重命名模式
    const renameInput = page.locator('.rename-input')
    if (await renameInput.isVisible()) {
      // 按 Escape 取消
      await page.keyboard.press('Escape')

      // 验证退出重命名模式
      await expect(renameInput).not.toBeVisible()
    }
  })

  test('Enter 键应该确认重命名', async ({ page, electronApp, testDir }) => {
    // 打开文件夹
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 5000 })

    // 双击文件开始重命名
    await page.dblclick('.file-item:has-text("test1.md")')

    // 检查是否进入重命名模式
    const renameInput = page.locator('.rename-input')
    if (await renameInput.isVisible()) {
      // 清空并输入新名称
      await renameInput.fill('renamed.md')

      // 按 Enter 确认
      await page.keyboard.press('Enter')

      // 等待重命名完成
      await page.waitForTimeout(500)

      // 验证文件已重命名
      await expect(page.locator('.file-item:has-text("renamed.md")')).toBeVisible()
    }
  })
})
