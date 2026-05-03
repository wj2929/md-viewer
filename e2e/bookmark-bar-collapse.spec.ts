/**
 * BookmarkBar 折叠状态 E2E 测试
 * 测试当前 Electron 应用中的折叠/展开布局行为
 */

import { basename, join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'
import type { Page } from '@playwright/test'

async function seedBookmark(page: Page, filePath: string): Promise<void> {
  await page.evaluate(
    async ({ filePath, fileName }) => {
      await window.api.clearBookmarks()
      await window.api.updateAppSettings({
        bookmarkBarCollapsed: true,
        bookmarkPanelCollapsed: true
      })
      await window.api.addBookmark({
        filePath,
        fileName,
        title: '测试书签'
      })
    },
    { filePath, fileName: basename(filePath) }
  )
}

test.describe('BookmarkBar 折叠布局测试', () => {
  test.beforeEach(async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1400, height: 900 })

    const bookmarkPath = join(testDir, 'test1.md')
    await openFolderViaIPC(electronApp, testDir)
    await seedBookmark(page, bookmarkPath)

    await page.reload()
    await page.waitForSelector('.app', { timeout: 10000 })
    await openFolderViaIPC(electronApp, testDir)
    await expect(page.locator('.tab-bar-bookmark-trigger')).toBeVisible()
  })

  test('折叠状态下 BookmarkBar 不应占据垂直空间', async ({ page }) => {
    const collapsedBar = page.locator('.bookmark-bar.collapsed')
    await expect(collapsedBar).toBeHidden()
    await expect(page.locator('.tab-bar-bookmark-trigger')).toBeVisible()

    const headerHeight = await page.locator('.app-header').evaluate(el => el.getBoundingClientRect().height)
    await page.locator('.tab-bar-bookmark-trigger').click()
    const expandedBar = page.locator('.bookmark-bar:not(.collapsed)')
    await expect(expandedBar).toBeVisible()
    await expect(expandedBar).toHaveCSS('height', '40px')

    const expandedHeaderHeight = await page.locator('.app-header').evaluate(el => el.getBoundingClientRect().height)
    expect(expandedHeaderHeight).toBeGreaterThan(headerHeight + 35)
  })

  test('展开状态下 BookmarkBar 应占据 40px 高度', async ({ page }) => {
    await page.locator('.tab-bar-bookmark-trigger').click()

    const bookmarkBar = page.locator('.bookmark-bar:not(.collapsed)')
    await expect(bookmarkBar).toBeVisible()
    await expect(bookmarkBar).toHaveCSS('height', '40px')
  })

  test('折叠状态下仍可以看到并点击 TabBar 触发按钮', async ({ page }) => {
    const toggleButton = page.locator('.tab-bar-bookmark-trigger')
    await expect(toggleButton).toBeVisible()
    await expect(toggleButton).toBeEnabled()

    await toggleButton.click()
    await expect(page.locator('.bookmark-bar:not(.collapsed)')).toBeVisible()
  })

  test('折叠/展开切换应该恢复 Header 高度', async ({ page }) => {
    const trigger = page.locator('.tab-bar-bookmark-trigger')
    const initialHeight = await page.locator('.app-header').evaluate(el => el.getBoundingClientRect().height)

    await trigger.click()
    const expandedBar = page.locator('.bookmark-bar:not(.collapsed)')
    await expect(expandedBar).toBeVisible()
    await expect(expandedBar).toHaveCSS('height', '40px')
    const expandedHeight = await page.locator('.app-header').evaluate(el => el.getBoundingClientRect().height)

    await page.locator('.bookmark-bar:not(.collapsed) .bookmark-bar-toggle').click()
    await expect(page.locator('.tab-bar-bookmark-trigger')).toBeVisible()
    const collapsedHeight = await page.locator('.app-header').evaluate(el => el.getBoundingClientRect().height)

    expect(expandedHeight).toBeGreaterThan(initialHeight + 35)
    expect(Math.abs(collapsedHeight - initialHeight)).toBeLessThan(2)
  })

  test('折叠状态下书签列表不应该渲染在 BookmarkBar 中', async ({ page }) => {
    await expect(page.locator('.bookmark-bar.collapsed .bookmark-bar-list')).toHaveCount(0)
  })

  test('展开状态下应该显示书签列表', async ({ page }) => {
    await page.locator('.tab-bar-bookmark-trigger').click()

    await expect(page.locator('.bookmark-bar:not(.collapsed) .bookmark-bar-list')).toBeVisible()
    await expect(page.locator('.bookmark-bar-item')).toHaveCount(1)
  })

  test('窗口宽度小于 1200px 时应该自动折叠', async ({ page }) => {
    await page.locator('.tab-bar-bookmark-trigger').click()
    await expect(page.locator('.bookmark-bar:not(.collapsed)')).toBeVisible()

    await page.setViewportSize({ width: 1100, height: 800 })

    await expect(page.locator('.bookmark-bar:not(.collapsed)')).toBeHidden()
    await expect(page.locator('.tab-bar-bookmark-trigger')).toBeVisible()
  })

  test('CSS 计算样式验证', async ({ page }) => {
    await expect(page.locator('.bookmark-bar.collapsed')).toHaveCSS('display', 'none')

    await page.locator('.tab-bar-bookmark-trigger').click()

    const expandedBar = page.locator('.bookmark-bar:not(.collapsed)')
    await expect(expandedBar).toHaveCSS('height', '40px')
    await expect(expandedBar).not.toHaveCSS('display', 'none')
  })
})
