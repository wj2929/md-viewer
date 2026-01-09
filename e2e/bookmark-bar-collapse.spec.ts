/**
 * BookmarkBar 折叠状态 E2E 测试
 * 测试折叠/展开时的布局行为
 */

import { test, expect, Page } from '@playwright/test'

test.describe('BookmarkBar 折叠布局测试', () => {
  let page: Page

  test.beforeEach(async ({ page: p }) => {
    page = p
    // 假设你的应用运行在 http://localhost:5173
    await page.goto('http://localhost:5173')

    // 打开一个测试文件夹
    // 这里需要根据你的实际应用调整
    await page.click('button:has-text("打开文件夹")')
    // ... 等待文件夹加载完成
  })

  test('折叠状态下 BookmarkBar 不应占据垂直空间', async () => {
    // 确保书签栏默认是折叠的
    const bookmarkBar = page.locator('.bookmark-bar.collapsed')
    await expect(bookmarkBar).toBeVisible()

    // 测量 Header 的高度（应该不包含 BookmarkBar 的 36px）
    const header = page.locator('.app-header')
    const headerBox = await header.boundingBox()

    // NavigationBar (52px) + TabBar (40px) = 92px
    // 如果 BookmarkBar 折叠正常，Header 高度应该接近 92px
    expect(headerBox!.height).toBeLessThanOrEqual(100) // 给一些误差范围
  })

  test('展开状态下 BookmarkBar 应占据 36px 高度', async () => {
    // 点击折叠按钮展开书签栏
    const toggleButton = page.locator('.bookmark-bar-toggle')
    await toggleButton.click()

    // 等待动画完成
    await page.waitForTimeout(300)

    // 检查书签栏是否展开
    const bookmarkBar = page.locator('.bookmark-bar:not(.collapsed)')
    await expect(bookmarkBar).toBeVisible()

    // 测量 Header 的高度（应该包含 BookmarkBar 的 36px）
    const header = page.locator('.app-header')
    const headerBox = await header.boundingBox()

    // NavigationBar (52px) + TabBar (40px) + BookmarkBar (36px) = 128px
    expect(headerBox!.height).toBeGreaterThanOrEqual(125) // 给一些误差范围
  })

  test('折叠状态下仍可以看到并点击悬浮按钮', async () => {
    const bookmarkBar = page.locator('.bookmark-bar.collapsed')
    await expect(bookmarkBar).toBeVisible()

    // 检查悬浮按钮是否可见
    const toggleButton = page.locator('.bookmark-bar.collapsed .bookmark-bar-toggle')
    await expect(toggleButton).toBeVisible()

    // 检查按钮是否可点击
    const isClickable = await toggleButton.isEnabled()
    expect(isClickable).toBe(true)

    // 点击展开
    await toggleButton.click()

    // 验证展开后的状态
    const expandedBar = page.locator('.bookmark-bar:not(.collapsed)')
    await expect(expandedBar).toBeVisible()
  })

  test('折叠/展开切换应该平滑过渡', async () => {
    const toggleButton = page.locator('.bookmark-bar-toggle')

    // 测量初始高度
    const header = page.locator('.app-header')
    const initialBox = await header.boundingBox()

    // 展开
    await toggleButton.click()
    await page.waitForTimeout(200) // 等待过渡动画
    const expandedBox = await header.boundingBox()

    // 折叠
    await toggleButton.click()
    await page.waitForTimeout(200) // 等待过渡动画
    const collapsedBox = await header.boundingBox()

    // 验证：折叠后高度应该恢复到初始高度
    expect(Math.abs(collapsedBox!.height - initialBox!.height)).toBeLessThan(2)

    // 验证：展开后高度应该明显增加
    expect(expandedBox!.height).toBeGreaterThan(initialBox!.height + 30)
  })

  test('折叠状态下书签列表不应该渲染在 DOM 中', async () => {
    const bookmarkBar = page.locator('.bookmark-bar.collapsed')
    await expect(bookmarkBar).toBeVisible()

    // 检查书签列表容器是否存在
    const bookmarkList = page.locator('.bookmark-bar.collapsed .bookmark-bar-list')
    const count = await bookmarkList.count()

    // 折叠状态下不应该渲染书签列表
    expect(count).toBe(0)
  })

  test('展开状态下应该显示书签列表', async () => {
    // 假设已经添加了一些书签
    const toggleButton = page.locator('.bookmark-bar-toggle')
    await toggleButton.click()

    // 等待展开
    await page.waitForTimeout(200)

    // 检查书签列表是否存在
    const bookmarkList = page.locator('.bookmark-bar:not(.collapsed) .bookmark-bar-list')
    await expect(bookmarkList).toBeVisible()

    // 检查是否有书签项
    const bookmarkItems = page.locator('.bookmark-bar-item')
    const count = await bookmarkItems.count()
    expect(count).toBeGreaterThan(0)
  })

  test('窗口宽度小于 1200px 时应该自动折叠', async () => {
    // 设置窗口宽度为 1100px
    await page.setViewportSize({ width: 1100, height: 800 })

    // 等待响应式布局生效
    await page.waitForTimeout(300)

    // 检查书签栏是否自动折叠
    const bookmarkBar = page.locator('.bookmark-bar.collapsed')
    await expect(bookmarkBar).toBeVisible()

    // 尝试展开（应该无效，因为小屏幕下强制折叠）
    // 这部分逻辑取决于你的实现
  })

  test('CSS 计算样式验证', async () => {
    // 折叠状态
    const collapsedBar = page.locator('.bookmark-bar.collapsed')
    await expect(collapsedBar).toHaveCSS('position', 'absolute')
    await expect(collapsedBar).toHaveCSS('height', '0px')

    // 展开
    const toggleButton = page.locator('.bookmark-bar-toggle')
    await toggleButton.click()
    await page.waitForTimeout(200)

    // 展开状态
    const expandedBar = page.locator('.bookmark-bar:not(.collapsed)')
    await expect(expandedBar).toHaveCSS('height', '36px')
    await expect(expandedBar).not.toHaveCSS('position', 'absolute')
  })
})
