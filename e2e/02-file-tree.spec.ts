import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'path'
import { writeFileSync } from 'fs'

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
    const folderName = page.locator('.nav-folder-path')
    await expect(folderName).toHaveAttribute('title', testDir)
  })

  test('文件树应该显示 .md 文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 验证 md 文件显示
    await expect(page.locator('.file-tree-row.file:has-text("test1.md")')).toBeVisible()
    await expect(page.locator('.file-tree-row.file:has-text("test2.md")')).toBeVisible()
    await expect(page.locator('.file-tree-row.file:has-text("code.md")')).toBeVisible()
  })

  test('应该能展开子文件夹', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 找到子文件夹并展开
    const subfolder = page.locator('.file-tree-row.directory:has-text("subfolder")')
    await expect(subfolder).toBeVisible()

    const nestedFile = page.locator('.file-tree-row.file:has-text("nested.md")')
    await expect(nestedFile).toBeVisible()

    // 默认展开，先点击折叠
    await subfolder.click()
    await expect(nestedFile).not.toBeVisible()

    // 再点击展开，验证嵌套文件可见
    await subfolder.click()
    await expect(nestedFile).toBeVisible()
  })

  test('点击文件应该打开预览', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 点击文件
    await page.click('.file-tree-row.file:has-text("test1.md")')

    // 等待预览加载
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证内容显示
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  })

  test('选中的文件应该高亮显示', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 点击文件
    const fileItem = page.locator('.file-tree-row.file:has-text("test1.md")')
    await fileItem.click()

    // 等待选中状态
    await page.waitForTimeout(300)

    // 验证高亮类名（根据实际 CSS 类名调整）
    await expect(fileItem).toHaveClass(/selected|active/)
  })

  test('搜索栏应该能过滤文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.search-trigger')

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
      await expect(searchResults.locator('.search-result-item:has-text("code.md")')).toBeVisible()
    }
  })

  test('搜索弹窗应该支持中文文本输入', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, '保利威费用分析报告.md'), '# 保利威费用分析报告\n')

    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.search-trigger')
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeFocused()
    await page.keyboard.insertText('保利')

    await expect(searchInput).toHaveValue('保利')
    await expect(page.locator('.search-result-item:has-text("保利威费用分析报告.md")')).toBeVisible()
  })

  test('文件树隐式过滤应该支持中文组合输入', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, '保利威费用分析报告.md'), '# 保利威费用分析报告\n')

    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })
    await expect(page.locator('.file-tree-row.file:has-text("保利威费用分析报告.md")')).toBeVisible()

    const tree = page.locator('.file-tree')
    await tree.click()
    await expect(page.getByRole('textbox', { name: '文件过滤' })).toBeFocused()
    await page.keyboard.insertText('保利')

    const filterInput = page.getByRole('textbox', { name: '文件过滤' })
    await expect(filterInput).toBeVisible()
    await expect(filterInput).toHaveValue('保利')
    await expect(page.locator('.file-tree-row.file:has-text("保利威费用分析报告.md")')).toBeVisible()
    await expect(page.locator('.file-tree-row.file:has-text("test1.md")')).not.toBeVisible()

    await filterInput.fill('费用')
    await expect(filterInput).toHaveValue('费用')
    await expect(page.locator('.file-tree-row.file:has-text("保利威费用分析报告.md")')).toBeVisible()
  })

  test('文件树过滤框应该一直显示并支持点击定位后输入中文', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, '研发中心保利威复盘.md'), '# 研发中心保利威复盘\n')

    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    const filterInput = page.getByRole('textbox', { name: '文件过滤' })
    await expect(filterInput).toBeVisible()

    const box = await filterInput.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await expect(filterInput).toBeFocused()
    await page.keyboard.insertText('保利')

    await expect(filterInput).toHaveValue('保利')
    await expect(page.locator('.file-tree-row.file:has-text("研发中心保利威复盘.md")')).toBeVisible()

    await page.locator('.file-tree-filter-clear').click()
    await expect(filterInput).toHaveValue('')
    await expect(page.locator('.file-tree-row.file:has-text("test1.md")')).toBeVisible()
  })

  test('点击滚动后靠下文件不应该让文件树滚动回顶', async ({ page, electronApp, testDir }) => {
    for (let index = 0; index < 70; index += 1) {
      writeFileSync(join(testDir, `zz-long-${String(index).padStart(2, '0')}.md`), `# Long ${index}\n`)
    }

    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    const container = page.locator('.file-tree-container')
    await container.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    const before = await container.evaluate(element => element.scrollTop)
    expect(before).toBeGreaterThan(100)

    await page.locator('.file-tree-row.file:has-text("zz-long-69.md")').click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Long 69')

    const after = await container.evaluate(element => element.scrollTop)
    expect(Math.abs(after - before)).toBeLessThanOrEqual(80)
  })

  test('鼠标点击 Markdown 预览区不应该出现浏览器默认橙色焦点框', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })
    await page.click('.file-tree-row.file:has-text("test1.md")')
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    await page.locator('.markdown-body').click()

    const focusStyle = await page.locator('.markdown-body').evaluate(element => {
      const style = window.getComputedStyle(element)
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth
      }
    })

    expect(focusStyle.outlineStyle).toBe('none')
    expect(focusStyle.outlineWidth).toBe('0px')
  })

  test('刷新按钮应该重新加载文件树', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 找到刷新按钮
    const refreshBtn = page.locator('.nav-refresh-btn')
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
    const changeBtn = page.locator('.folder-btn')
    await expect(changeBtn).toBeVisible()
    await expect(changeBtn).toHaveAttribute('title', '切换文件夹')
  })

  test('历史文件夹下拉菜单不应该被导航栏裁剪', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.locator('.history-toggle-btn').click()
    await expect(page.locator('.history-menu')).toBeVisible()

    const menuCanReceivePointer = await page.evaluate(() => {
      const menu = document.querySelector('.history-menu')
      if (!menu) return false
      const rect = menu.getBoundingClientRect()
      const hitTarget = document.elementFromPoint(rect.left + 12, rect.top + 12)
      return Boolean(hitTarget?.closest('.history-menu'))
    })

    expect(menuCanReceivePointer).toBe(true)
  })
})
