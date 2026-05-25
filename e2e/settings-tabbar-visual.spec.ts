import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const OUT_DIR = join(process.cwd(), 'test-results', 'settings-tabbar-visual')

test.describe('设置面板与多标签栏视觉 smoke', () => {
  test('设置多 Tab 与标签栏溢出在真实 Electron 中可见', async ({ page, electronApp, testDir }) => {
    mkdirSync(OUT_DIR, { recursive: true })

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 900, height: 760 })
    })

    for (let i = 1; i <= 14; i += 1) {
      writeFileSync(
        join(testDir, `visual-tab-${String(i).padStart(2, '0')}.md`),
        `# Visual Tab ${i}\n\n用于多标签栏视觉验证。`
      )
    }

    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.nav-settings-btn').click()
    await expect(page.getByRole('tablist', { name: '设置分类' })).toBeVisible()
    await page.locator('.settings-panel').screenshot({ path: join(OUT_DIR, 'settings-appearance.png') })

    for (const tabName of ['浏览', '导出', '图表', '系统', '关于']) {
      await page.getByRole('tab', { name: tabName }).click()
      await expect(page.getByRole('tabpanel', { name: tabName })).toBeVisible()
      await page.locator('.settings-panel').screenshot({
        path: join(OUT_DIR, `settings-${tabName}.png`)
      })
    }

    await page.locator('.settings-header .close-btn').click()
    await expect(page.locator('.settings-panel')).toBeHidden()

    for (let i = 1; i <= 14; i += 1) {
      const filePath = join(testDir, `visual-tab-${String(i).padStart(2, '0')}.md`)
      await page.evaluate(async path => {
        await window.api.testOpenMarkdownFile?.(path)
      }, filePath)
    }

    await expect.poll(async () => page.locator('.tab').count()).toBeGreaterThanOrEqual(14)
    await expect(page.getByRole('button', { name: '向左滚动标签' })).toBeVisible()
    await expect(page.getByRole('button', { name: '向右滚动标签' })).toBeVisible()
    await page.screenshot({ path: join(OUT_DIR, 'tabbar-overflow-before-scroll.png'), fullPage: true })

    await page.getByRole('button', { name: '显示全部打开文档' }).click()
    const moreMenu = page.getByRole('menu', { name: '全部打开文档' })
    await expect(moreMenu).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'visual-tab-14.md' })).toBeVisible()
    const moreMenuBox = await moreMenu.boundingBox()
    expect(moreMenuBox).not.toBeNull()
    expect(moreMenuBox!.height).toBeGreaterThan(120)
    expect(moreMenuBox!.y).toBeGreaterThan(70)
    await page.screenshot({ path: join(OUT_DIR, 'tabbar-more-menu.png'), fullPage: true })
    await page.getByRole('menuitemradio', { name: 'visual-tab-10.md' }).click()
    await expect(page.getByRole('menu', { name: '全部打开文档' })).toBeHidden()
    await expect(page.locator('.tab.active .tab-name')).toHaveText('visual-tab-10.md')

    const leftButton = page.getByRole('button', { name: '向左滚动标签' })
    const rightButton = page.getByRole('button', { name: '向右滚动标签' })
    if (await rightButton.isEnabled()) {
      await rightButton.click()
    } else {
      await expect(leftButton).toBeEnabled()
      await leftButton.click()
    }
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(OUT_DIR, 'tabbar-overflow-after-scroll.png'), fullPage: true })
  })

  test('历史文件夹菜单不应被标签栏遮挡', async ({ page, electronApp, testDir }) => {
    mkdirSync(OUT_DIR, { recursive: true })

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 760, height: 720 })
    })

    const historyDirs = ['保利威', '直播平台', 'testmd', 'docs', '模型费用'].map(name => join(testDir, name))
    for (const dir of historyDirs) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.md'), `# ${dir}\n`)
      await page.evaluate(async path => {
        await window.api.setFolderPath(path)
      }, dir)
    }

    await openFolderViaIPC(electronApp, testDir)
    await page.getByRole('button', { name: '最近打开的文件夹' }).click()

    const historyMenu = page.locator('.history-menu')
    const tabBar = page.locator('.tabs')
    await expect(historyMenu).toBeVisible()
    await expect(historyMenu.getByText('保利威')).toBeVisible()

    const historyMenuBox = await historyMenu.boundingBox()
    const tabBarBox = await tabBar.boundingBox()
    expect(historyMenuBox).not.toBeNull()
    expect(tabBarBox).not.toBeNull()
    expect(historyMenuBox!.y).toBeLessThan(tabBarBox!.y)
    expect(historyMenuBox!.height).toBeGreaterThan(120)

    await page.screenshot({ path: join(OUT_DIR, 'folder-history-menu-layering.png'), fullPage: true })
  })

  test('快捷键帮助弹窗包含使用手册入口', async ({ page, electronApp }) => {
    mkdirSync(OUT_DIR, { recursive: true })

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setBounds({ width: 760, height: 620 })
      win?.webContents.send('open-shortcuts-help')
    })

    const shortcutsDialog = page.locator('.shortcuts-help-dialog')
    await expect(shortcutsDialog).toBeVisible()
    await expect(page.getByRole('button', { name: '打开使用手册' })).toBeVisible()

    await shortcutsDialog.screenshot({ path: join(OUT_DIR, 'shortcuts-help.png') })
  })

  test('使用手册中的本地图片应正常加载', async ({ page }) => {
    const failedRequests: string[] = []
    page.on('requestfailed', request => {
      if (request.url().startsWith('local-image:')) {
        failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || 'unknown'}`)
      }
    })
    const manualPath = resolve(process.cwd(), 'docs/user-manual.md')
    await page.evaluate(async path => {
      await window.api.testOpenMarkdownFile?.(path)
    }, manualPath)

    const welcomeImage = page.getByRole('img', { name: 'MD Viewer 欢迎页' })
    await expect(welcomeImage).toBeVisible()
    const readImageState = async () => welcomeImage.evaluate(img => {
      const image = img as HTMLImageElement
      return {
        src: image.getAttribute('src'),
        currentSrc: image.currentSrc,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight
      }
    })

    let finalState = await readImageState()
    const deadline = Date.now() + 5000
    while (finalState.naturalWidth === 0 && Date.now() < deadline) {
      await page.waitForTimeout(100)
      finalState = await readImageState()
    }
    if (finalState.naturalWidth === 0) {
      throw new Error(`local image did not load: ${JSON.stringify({ state: finalState, failedRequests })}`)
    }
  })
})
