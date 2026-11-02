import type { Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import AdmZip from 'adm-zip'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

async function openMarkdownEditViaIPC(
  electronApp: Parameters<typeof openFolderViaIPC>[0],
  filePath: string,
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, path) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('markdown:quick-edit', {
      filePath: path,
      mode: 'document',
    })
  }, filePath)
}

async function expectTemplatePreviewToFit(page: Page, rendererType: string): Promise<void> {
  const geometry = await page.locator('.chart-starter-preview').evaluate((preview, type) => {
    const previewRect = preview.getBoundingClientRect()
    const toolbar = preview.querySelector<HTMLElement>('[class*="-toggle-bar"]')
    const toggleCode = preview.querySelector<HTMLElement>('[data-action="toggleCode"]')
    const visuals = [...preview.querySelectorAll<HTMLElement>('svg, canvas')]
      .filter(element => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1
      })
      .map(element => element.getBoundingClientRect())
    return {
      type,
      verticalOverflow: preview.scrollHeight - preview.clientHeight,
      horizontalOverflow: preview.scrollWidth - preview.clientWidth,
      toolbarPosition: toolbar ? getComputedStyle(toolbar).position : null,
      toggleCodeVisible: toggleCode ? getComputedStyle(toggleCode).display !== 'none' : false,
      visualOverflow: visuals.reduce((maximum, rect) => Math.max(
        maximum,
        previewRect.top - rect.top,
        rect.right - previewRect.right,
        rect.bottom - previewRect.bottom,
        previewRect.left - rect.left,
      ), 0),
    }
  }, rendererType)

  expect(geometry.verticalOverflow, `${rendererType} vertical overflow`).toBeLessThanOrEqual(1)
  expect(geometry.horizontalOverflow, `${rendererType} horizontal overflow`).toBeLessThanOrEqual(1)
  expect(geometry.visualOverflow, `${rendererType} visual clipping`).toBeLessThanOrEqual(1)
  expect(geometry.toggleCodeVisible, `${rendererType} duplicate source action`).toBe(false)
  if (geometry.toolbarPosition) expect(geometry.toolbarPosition, `${rendererType} toolbar`).toBe('absolute')
}

function listRelativeFiles(rootPath: string, relativePath = ''): string[] {
  return readdirSync(join(rootPath, relativePath), { withFileTypes: true })
    .flatMap(entry => {
      const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
      return entry.isDirectory() ? listRelativeFiles(rootPath, childPath) : [childPath]
    })
    .sort()
}

test.describe('图表能力发现与离线示例包', () => {
  test.beforeEach(async ({ electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  })

  test('首次进入默认展示Mermaid，说明分栏且运行信息不挤标题', async ({ page, electronApp }, testInfo) => {
    await page.getByRole('button', { name: /图表与架构图/ }).click()
    await page.getByRole('tab', { name: /格式参考/ }).click()
    await expect(page.locator('.chart-type-directory [data-renderer-type="mermaid"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.chart-detail h4')).toHaveText('Mermaid')
    await expect(page.locator('.chart-reference-empty')).toHaveCount(0)
    await expect(page.locator('.chart-starter-preview svg')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('toolbar', { name: '图表预览工具' })).toBeVisible()
    for (const [width, height] of [[1400, 900], [1800, 1000], [1000, 720], [1400, 600], [800, 720]]) {
      await electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
      const list = page.locator('.chart-type-directory .chart-catalog-grid')
      await list.evaluate(element => { element.scrollTop = 0 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme)
        await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0 })
        const geometry = await page.evaluate(() => {
          const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
          const paragraphs = document.querySelectorAll('.chart-reference-guidance p:not(.chart-reference-runtime)')
          const first = paragraphs[0].getBoundingClientRect()
          const second = paragraphs[1].getBoundingClientRect()
          const list = rect('.chart-type-directory .chart-catalog-grid')
          const rows = [...document.querySelectorAll('.chart-type-directory .chart-catalog-card')]
            .map(row => row.getBoundingClientRect()).filter(row => row.width > 0 && row.height > 0)
          const content = rect('.settings-content')
          const hint = rect('.chart-keyboard-hint')
          return {
            columns: second.left > first.right,
            runtimeGap: rect('.chart-reference-runtime').top - Math.max(first.bottom, second.bottom),
            fullRows: rows.filter(row => row.top >= list.top && row.bottom <= list.bottom).length,
            viewportRows: rows.filter(row => row.top >= Math.max(content.top, list.top) && row.bottom <= Math.min(content.bottom, list.bottom)).length,
            partialRows: rows.filter(row => row.top < list.bottom - 0.5 && row.bottom > list.bottom + 0.5).length,
            hintGap: hint.top - list.bottom,
            overflow: document.documentElement.scrollWidth - innerWidth,
          }
        })
        await testInfo.attach(`default-${width}-${height}-${theme}-geometry`, { body: JSON.stringify(geometry), contentType: 'application/json' })
        expect(geometry.overflow).toBe(0)
        expect(geometry.runtimeGap).toBeGreaterThanOrEqual(4)
        if (width >= 1400) {
          expect(geometry.columns).toBe(true)
          expect(geometry.fullRows).toBeGreaterThanOrEqual(height >= 900 ? 12 : 9)
          if (height >= 900) expect(geometry.viewportRows).toBeGreaterThanOrEqual(12)
          expect(geometry.partialRows).toBe(0)
          expect(geometry.hintGap).toBeGreaterThanOrEqual(0)
          expect(geometry.hintGap).toBeLessThan(36)
        }
        await expect(page.locator('.chart-starter-preview')).toHaveCount(1)
        await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`default-${width}-${height}-${theme}.png`) })
      }
      if (width >= 1000) {
        const hint = page.locator('.chart-keyboard-hint')
        await hint.scrollIntoViewIfNeeded()
        const outerScroll = await page.locator('.settings-content').evaluate(element => element.scrollTop)
        const bounds = (await list.boundingBox())!
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await page.mouse.wheel(0, 2000)
        const last = list.locator('[data-renderer-type="katex"]')
        await expect(last).toBeInViewport({ ratio: 1 })
        await expect(hint).toBeInViewport({ ratio: 1 })
        expect(await page.locator('.settings-content').evaluate(element => element.scrollTop)).toBe(outerScroll)
        await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`default-${width}-${height}-bottom.png`) })
      }
    }
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
    const first = page.locator('.chart-type-directory [data-renderer-type="mermaid"]')
    await expect(first).toBeVisible()
    await first.focus()
    await expect(first).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.chart-detail h4')).toHaveText('Markmap')
    await expect(page.locator('.chart-type-directory [data-renderer-type="markmap"]')).toBeFocused()
  })

  test('使用和兼容说明常显，导出详情折叠且预览保持首屏可用', async ({ page, electronApp }, testInfo) => {
    await page.getByRole('button', { name: /图表与架构图/ }).click()
    await page.getByRole('tab', { name: /格式参考/ }).click()
    await page.locator('.chart-type-directory [data-renderer-type="mermaid"]').click()
    await expect(page.locator('.chart-starter-preview svg')).toBeVisible({ timeout: 15000 })
    await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0 })
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
      const content = rect('.settings-content')
      const preview = rect('.chart-starter-preview')
      const row = document.querySelector('.chart-catalog-card')!
      return {
        toolbarHeight: rect('.chart-catalog-toolbar').height,
        rowHeight: row.getBoundingClientRect().height,
        rowShadow: getComputedStyle(row).boxShadow,
        previewOffset: preview.top - content.top,
        visibleHeight: Math.min(content.bottom, preview.bottom) - Math.max(content.top, preview.top),
        previewHeight: preview.height,
        categoryTop: rect('.chart-filter-category').top,
        networkTop: rect('.chart-filter-network').top,
      }
    })
    await testInfo.attach('compact-layout-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
    expect(geometry.toolbarHeight).toBeLessThanOrEqual(40)
    expect(geometry.rowHeight).toBeLessThanOrEqual(40)
    expect(geometry.rowShadow).toBe('none')
    expect(geometry.previewOffset).toBeLessThanOrEqual(400)
    expect(geometry.visibleHeight / geometry.previewHeight).toBeGreaterThanOrEqual(0.9)
    expect(Math.abs(geometry.categoryTop - geometry.networkTop)).toBeLessThanOrEqual(1)
    await expect(page.locator('.chart-type-directory .chart-card-description')).toHaveCount(0)
    await expect(page.locator('.chart-type-directory .chart-network-badge')).toHaveCount(3)
    const details = page.locator('.chart-format-details')
    await expect(details).not.toHaveAttribute('open', '')
    await expect(details.locator('summary')).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('heading', { name: '图表与公式', level: 3 })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('heading', { name: '让 AI 参考格式，生成你需要的图表', level: 4 })).toBeInViewport({ ratio: 1 })
    const guidance = page.getByRole('note', { name: '格式参考使用说明' })
    await expect(guidance).toBeInViewport({ ratio: 1 })
    await expect(guidance).toContainText('不必手写复杂的图表代码。选择合适的表达方式，把完整 Markdown 示例和兼容说明交给 Claude、Codex 等 AI 工具，再描述你的需求，由 AI 生成内容，在 MD Viewer 中查看效果。这里提供格式参考，不在应用内调用 AI。')
    await expect(guidance).toContainText('这些图表和公式通过 Markdown 扩展语法嵌入，并非所有 Markdown 查看器都支持。图表内容有的采用上游工具的原生语法，有的使用 MD Viewer 的适配格式或支持子集。请以每种类型的格式说明和示例为准，不能将其等同于完整上游 API，也不保证在其他工具中原样呈现。')
    await expect(page.getByRole('region', { name: '语法与兼容范围' })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('compact-preview-light.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('compact-preview-dark.png') })
    await details.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('open', '')
    await expect(page.getByRole('region', { name: '语法与兼容范围' })).toBeVisible()
    await expect(page.getByRole('region', { name: '格式支持' })).toBeVisible()
    for (const type of ['echarts', 'antv-g6']) {
      await page.locator(`.chart-type-directory [data-renderer-type="${type}"]`).click()
      await expect(page.locator('.chart-starter-preview svg').first()).toBeVisible({ timeout: 15000 })
      await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0 })
      await expect(page.getByRole('region', { name: '语法与兼容范围' })).toBeInViewport({ ratio: 1 })
      if (type === 'antv-g6') await expect(page.getByRole('region', { name: '语法与兼容范围' })).toContainText('不是完整 G6 API')
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`visible-guidance-${type}-dark.png`) })
    }
    await page.locator('.chart-type-directory [data-renderer-type="katex"]').click()
    await expect(details).not.toHaveAttribute('open', '')
    await expect(page.locator('.chart-starter-preview .katex')).toBeVisible()
    expect((await page.locator('.chart-starter-preview').boundingBox())!.height).toBeLessThanOrEqual(160)
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click()
    expect((await page.locator('.chart-template-source').boundingBox())!.height).toBeLessThanOrEqual(160)
    await page.getByRole('tab', { name: '预览', exact: true }).click()
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 600))
    await page.getByRole('combobox', { name: '图表类型', exact: true }).selectOption('mermaid')
    await expect(page.locator('.chart-starter-preview svg')).toBeVisible({ timeout: 15000 })
    await page.locator('.chart-starter-preview').scrollIntoViewIfNeeded()
    await expect(page.getByRole('combobox', { name: '图表类型', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(page.locator('.chart-starter-preview')).toBeInViewport({ ratio: 0.8 })
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('compact-short-narrow-dark.png') })
    await page.getByRole('combobox', { name: '按用途筛选图表' }).selectOption('数据可视化')
    await page.getByRole('combobox', { name: '按运行方式筛选图表' }).selectOption('需要服务')
    await expect(page.getByText('没有匹配的图表类型')).toBeVisible()
    await page.getByRole('button', { name: '重置筛选' }).click()
    await expect(page.getByRole('combobox', { name: '按用途筛选图表' })).toHaveValue('全部')
    await expect(page.getByRole('combobox', { name: '按运行方式筛选图表' })).toHaveValue('全部')
  })

  test('宽窗目录跟随详情高度并按完整行滚动，底部不再留下闲置空间', async ({ page, electronApp }, testInfo) => {
    await page.getByRole('button', { name: /图表与架构图/ }).click()
    await page.getByRole('tab', { name: /格式参考/ }).click()
    const directory = page.getByRole('navigation', { name: '图表类型' })
    const list = directory.locator('.chart-catalog-grid')
    await directory.locator('[data-renderer-type="mermaid"]').click()
    await expect(page.locator('.chart-starter-preview svg')).toBeVisible({ timeout: 15000 })
    for (const height of [1200, 900, 600]) {
      await electronApp.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setContentSize(1400, height), height)
      await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0 })
      await list.evaluate(element => { element.scrollTop = 0 })
      const geometry = await directory.evaluate(element => {
        const list = element.querySelector('.chart-catalog-grid')!
        const listBounds = list.getBoundingClientRect()
        const directoryBounds = element.getBoundingClientRect()
        const detailBounds = document.querySelector('.chart-detail')!.getBoundingClientRect()
        const hintBounds = element.querySelector('.chart-keyboard-hint')!.getBoundingClientRect()
        const rows = [...list.querySelectorAll('.chart-catalog-card')].map(row => row.getBoundingClientRect())
        return {
          bottomDifference: detailBounds.bottom - directoryBounds.bottom,
          listHeight: listBounds.height,
          partiallyVisibleRows: rows.filter(row => row.top < listBounds.bottom - 0.5 && row.bottom > listBounds.bottom + 0.5).length,
          hintBottomDifference: directoryBounds.bottom - hintBounds.bottom,
          listHintGap: hintBounds.top - listBounds.bottom,
        }
      })
      await testInfo.attach(`directory-${height}-geometry`, { body: JSON.stringify(geometry), contentType: 'application/json' })
      expect(Math.abs(geometry.bottomDifference)).toBeLessThanOrEqual(1)
      expect(geometry.partiallyVisibleRows).toBe(0)
      expect(Math.abs(geometry.hintBottomDifference)).toBeLessThanOrEqual(1)
      expect(geometry.listHintGap).toBeGreaterThanOrEqual(0)
      expect(geometry.listHintGap).toBeLessThan(36)
      if (height === 1200) expect(geometry.listHeight).toBeGreaterThan(600)
      await directory.locator('.chart-keyboard-hint').scrollIntoViewIfNeeded()
      const outerScrollTop = await page.locator('.settings-content').evaluate(element => element.scrollTop)
      const bounds = (await list.boundingBox())!
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20)
      await page.mouse.wheel(0, 2000)
      const last = directory.locator('[data-renderer-type="katex"]')
      await expect.poll(() => last.evaluate(element => {
        const row = element.getBoundingClientRect()
        const viewport = element.closest('.chart-catalog-grid')!.getBoundingClientRect()
        return row.top >= viewport.top - 1 && row.bottom <= viewport.bottom + 1
      })).toBe(true)
      expect(await page.locator('.settings-content').evaluate(element => element.scrollTop)).toBe(outerScrollTop)
      await expect(directory.locator('.chart-keyboard-hint')).toBeInViewport({ ratio: 1 })
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`directory-${height}-bottom.png`) })
      await list.evaluate(element => { element.scrollTop = 0 })
    }
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
    await directory.locator('[data-renderer-type="mermaid"]').click()
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click()
    const first = directory.locator('[data-renderer-type="mermaid"]')
    await first.focus()
    for (let index = 0; index < 19; index++) await page.keyboard.press('ArrowDown')
    await expect(directory.locator('[data-renderer-type="katex"]')).toBeFocused()
    await expect(directory.locator('[data-renderer-type="katex"]')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => directory.locator('[data-renderer-type="katex"]').evaluate(element => {
      const row = element.getBoundingClientRect()
      const list = element.closest('.chart-catalog-grid')!.getBoundingClientRect()
      return row.top >= list.top - 1 && row.bottom <= list.bottom + 1
    })).toBe(true)
    await expect(page.locator('.chart-template-source')).toContainText('\\int')
    await expect(page.getByRole('region', { name: '语法与兼容范围' })).toBeVisible()
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('directory-katex-keyboard-dark.png') })
  })

  test('方向键连续切换并保留模式、筛选和焦点，不拦截输入框', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: /图表与架构图/ }).click()
    await page.getByRole('tab', { name: /格式参考/ }).click()
    const directory = page.getByRole('navigation', { name: '图表类型' })
    const mermaid = directory.locator('[data-renderer-type="mermaid"]')
    await mermaid.click()
    await expect(page.locator('.chart-starter-preview svg')).toBeVisible({ timeout: 15000 })
    await expect(directory).toBeVisible()
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click()
    await mermaid.focus()
    await page.keyboard.press('ArrowDown')
    const markmap = directory.locator('[data-renderer-type="markmap"]')
    await expect(markmap).toBeFocused()
    await expect(markmap).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.chart-template-source')).toContainText('```markmap')
    await expect(page.locator('.chart-starter-preview')).toHaveCount(0)
    await page.keyboard.press('ArrowDown')
    await expect(directory.locator('[data-renderer-type="graphviz"]')).toBeFocused()
    await expect(page.locator('.chart-detail h4')).toHaveText('Graphviz')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '复制示例' })).toBeFocused()
    await page.getByRole('searchbox', { name: '搜索图表' }).fill('mermaid')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.chart-detail h4')).toHaveText('Graphviz')
    await expect(page.getByText('当前类型不在筛选结果中')).toBeVisible()
    await expect(page.getByRole('searchbox')).toBeFocused()
    await page.getByRole('searchbox').fill('')
    await page.getByRole('tab', { name: '预览', exact: true }).click()
    await expect(page.locator('.chart-starter-preview svg')).toBeVisible({ timeout: 15000 })
    await page.locator('.chart-reference-browser').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('chart-reference-keyboard-light.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('chart-reference-keyboard-dark.png') })
    await expect(page.getByRole('button', { name: /复制 AI|打开参考文件/ })).toHaveCount(0)
  })

  test('欢迎页直达离线包，联网模板默认自动预览且可关闭', async ({ page }, testInfo) => {
    await page.evaluate(() => {
      const runtime = window as typeof window & { __plantUmlSettingsRequests?: string[] }
      runtime.__plantUmlSettingsRequests = []
      const originalFetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('https://www.plantuml.com/')) {
          runtime.__plantUmlSettingsRequests!.push(url)
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="8" y="24">PlantUML ready</text></svg>',
            { status: 200, headers: { 'content-type': 'image/svg+xml' } },
          )
        }
        return originalFetch(input, init)
      }
    })

    await page.getByRole('button', { name: /图表与架构图/ }).click()
    await expect(page.getByRole('tab', { name: '图表', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: /离线示例/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('内置离线示例包已就绪，无需联网。')).toBeVisible()
    const examplesPanelBounds = await page.locator('.settings-panel-charts').boundingBox()
    expect(examplesPanelBounds).not.toBeNull()
    expect(examplesPanelBounds!.height).toBeLessThanOrEqual(650)
    await page.screenshot({ path: testInfo.outputPath('chart-examples.png') })

    await page.getByRole('tab', { name: /渲染服务/ }).click()
    await expect(page.getByText('服务来源')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('chart-services.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.waitForTimeout(200)
    await page.screenshot({ path: testInfo.outputPath('chart-services-dark.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await page.waitForTimeout(200)

    await page.getByRole('tab', { name: /格式参考/ }).click()
    await expect(page.locator('.chart-catalog-intro')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '按用途筛选图表' })).toHaveValue('全部')
    await expect(page.getByRole('combobox', { name: '按运行方式筛选图表' })).toHaveValue('全部')
    await expect(page.locator('.chart-catalog-card')).toHaveCount(20)
    await page.screenshot({ path: testInfo.outputPath('chart-catalog-light.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.waitForTimeout(200)
    await page.screenshot({ path: testInfo.outputPath('chart-catalog-dark.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await page.waitForTimeout(200)
    await page.locator('.chart-catalog-card[data-renderer-type="mermaid"]').click()
    await expect(page.locator('.chart-starter-preview svg')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('toolbar', { name: '图表预览工具' })).toBeVisible()
    const mermaidToolbarClearance = await page.locator('.chart-starter-preview').evaluate(preview => {
      const toolbar = preview.querySelector<HTMLElement>('.mermaid-toggle-bar')
      const diagram = preview.querySelector<SVGGElement>('.mermaid-container svg g')
      if (!toolbar || !diagram) return null
      return diagram.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom
    })
    expect(mermaidToolbarClearance).not.toBeNull()
    expect(mermaidToolbarClearance!).toBeGreaterThanOrEqual(-1)
    await page.screenshot({ path: testInfo.outputPath('chart-mermaid-detail.png') })
    const fitPreviewButton = page.getByRole('button', { name: '适应大小' })
    await fitPreviewButton.hover()
    await page.screenshot({ path: testInfo.outputPath('chart-toolbar-hover.png') })
    await fitPreviewButton.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(fitPreviewButton).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('chart-toolbar-focus.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.waitForTimeout(200)
    await page.screenshot({ path: testInfo.outputPath('chart-detail-dark.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await page.waitForTimeout(200)

    await page.locator('.chart-catalog-card[data-renderer-type="drawio"]').click()
    await expect(page.locator('.chart-starter-preview[data-renderer-type="drawio"] svg')).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: testInfo.outputPath('chart-drawio-detail.png') })

    await page.locator('.chart-catalog-card[data-renderer-type="svg"]').click()
    await expect(page.locator('.chart-starter-preview[data-renderer-type="svg"] svg')).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: testInfo.outputPath('chart-svg-detail.png') })

    await page.locator('.chart-catalog-card[data-renderer-type="plantuml"]').click()
    await expect(page.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.chart-starter-preview .plantuml-container svg')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __plantUmlSettingsRequests?: string[] }
    ).__plantUmlSettingsRequests?.length ?? 0)).toBe(1)

    await page.getByRole('tab', { name: /渲染服务/ }).click()
    const autoRenderCheckbox = page.getByRole('checkbox', { name: /自动渲染联网图表/ })
    await expect(autoRenderCheckbox).toBeChecked()
    await autoRenderCheckbox.click()
    await expect(page.getByText('已关闭自动渲染；普通文档将每篇确认一次。')).toBeVisible()

    await page.getByRole('tab', { name: /格式参考/ }).click()
    await page.locator('.chart-catalog-card[data-renderer-type="plantuml"]').click()
    await expect(page.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: '连接服务并预览' })).toBeVisible()
    expect(await page.evaluate(() => (
      window as typeof window & { __plantUmlSettingsRequests?: string[] }
    ).__plantUmlSettingsRequests?.length ?? 0)).toBe(1)
  })

  test('内置离线示例无需选位置即可自动准备并打开，同时保留独立 ZIP 导出', async ({ page, electronApp, testDir }, testInfo) => {
    test.setTimeout(60_000)
    await page.evaluate(() => {
      const runtime = window as typeof window & { __plantUmlTestRequests?: string[] }
      runtime.__plantUmlTestRequests = []
      const originalFetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('https://www.plantuml.com/')) {
          runtime.__plantUmlTestRequests!.push(url)
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="8" y="24">C4 ready</text></svg>',
            { status: 200, headers: { 'content-type': 'image/svg+xml' } },
          )
        }
        return originalFetch(input, init)
      }
    })
    const bundledZip = readFileSync(join(process.cwd(), 'resources/examples/md-viewer-chart-examples.zip'))
    const packageVersion = JSON.parse(readFileSync(
      join(process.cwd(), 'resources/examples/md-viewer-chart-examples.manifest.json'), 'utf8',
    )).packageVersion as string
    const zipPath = join(testDir, `md-viewer-chart-examples-v${packageVersion}.zip`)
    const managedUserData = join(testDir, 'managed-user-data')
    const installedPath = join(
      managedUserData,
      'chart-examples',
      `md-viewer-chart-examples-v${packageVersion}`,
    )
    mkdirSync(managedUserData, { recursive: true })

    await electronApp.evaluate(({ app, dialog, ipcMain, shell }, paths) => {
      const originalGetPath = app.getPath.bind(app)
      app.getPath = ((name: Parameters<typeof app.getPath>[0]) =>
        name === 'userData' ? paths.managedUserData : originalGetPath(name)) as typeof app.getPath
      const runtime = globalThis as typeof globalThis & {
        __chartExamplesTest?: { openDialogCalls: number; shownPath: string | null; krokiRequests: Array<{ format?: string; source?: string }> }
      }
      runtime.__chartExamplesTest = { openDialogCalls: 0, shownPath: null, krokiRequests: [] }
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.zipPath })
      const originalShowOpenDialog = dialog.showOpenDialog.bind(dialog)
      dialog.showOpenDialog = (async (...args: Parameters<typeof dialog.showOpenDialog>) => {
        runtime.__chartExamplesTest!.openDialogCalls += 1
        return originalShowOpenDialog(...args)
      }) as typeof dialog.showOpenDialog
      shell.showItemInFolder = filePath => {
        runtime.__chartExamplesTest!.shownPath = filePath
      }
      ipcMain.removeHandler('render:krokiSvg')
      ipcMain.handle('render:krokiSvg', async (_event, payload: { format?: string; source?: string }) => {
        runtime.__chartExamplesTest!.krokiRequests.push(payload)
        if (runtime.__chartExamplesTest!.krokiRequests.length === 1) {
          return { ok: false, error: '模拟 Kroki 服务暂时不可用' }
        }
        return {
          ok: true,
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="8" y="24">Kroki ready</text></svg>',
        }
      })
    }, { zipPath, managedUserData })

    await page.getByRole('button', { name: /图表与架构图/ }).click()
    expect(await page.evaluate(() => typeof window.api.installChartExamples)).toBe('function')
    await expect(page.getByText(/无需选择位置或手工解压/)).toBeVisible()

    const exportButton = page.getByRole('button', { name: '仅导出 ZIP…' })
    await exportButton.click()
    await expect(page.getByText('示例包已导出。')).toBeVisible()
    await expect.poll(() => existsSync(zipPath)).toBe(true)
    expect(readFileSync(zipPath).equals(bundledZip)).toBe(true)
    const archiveEntries = new AdmZip(zipPath).getEntries()
    expect(archiveEntries).toHaveLength(112)
    const expectedInstalledFiles = archiveEntries
      .map(entry => entry.entryName.replace(/^md-viewer-chart-examples\//, ''))
      .sort()

    await page.getByRole('button', { name: '在文件管理器中显示' }).click()
    await expect.poll(() => electronApp.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        __chartExamplesTest?: { shownPath: string | null }
      }
      return runtime.__chartExamplesTest?.shownPath
    })).toBe(zipPath)

    await page.getByRole('button', { name: '打开离线示例…' }).click()
    await expect(page.locator('.settings-overlay')).toHaveCount(0)
    expect(await electronApp.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        __chartExamplesTest?: { openDialogCalls: number }
      }
      return runtime.__chartExamplesTest?.openDialogCalls
    })).toBe(0)
    expect(listRelativeFiles(installedPath)).toEqual(expectedInstalledFiles)
    await expect(page.locator('.file-tree-row.file', { hasText: 'README.md' })).toHaveCount(1)
    await expect(page.locator('.markdown-body h1')).toHaveText('MD Viewer 图表示例')
    await expect(page.getByRole('heading', { name: '先选一条路线' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '渲染失败时' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('chart-examples-opened.png') })

    await page.getByRole('link', { name: 'Renderer 专项案例库' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Renderer 专项案例库')
    await page.getByRole('link', { name: '公式与知识' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('公式与知识')
    await page.screenshot({ path: testInfo.outputPath('chart-examples-category-guide.png') })
    await page.locator('tr', { hasText: 'KaTeX' }).getByRole('link', { name: '打开' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('KaTeX 专项案例')
    await page.locator('a[href="#heading-katex-010"]').click()
    await expect(page.locator('#heading-katex-010')).toBeInViewport()
    await page.getByRole('link', { name: '示例包首页' }).first().click()
    await expect(page.locator('.markdown-body h1')).toHaveText('MD Viewer 图表示例')

    await page.locator('.file-tree-row.file', { hasText: '01-quick-start.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('图表与公式快速入门')
    const referencePath = join(installedPath, '01-quick-start.md')
    const reference = readFileSync(referencePath, 'utf8')
    expect(reference).toContain('支持 @ 的工具')
    expect(reference).toContain('不是完整 G6 API')
    expect(reference).toContain('不是完整 Plotly.js')
    await electronApp.evaluate(({ clipboard, Menu }) => {
      const runtime = globalThis as typeof globalThis & { __copiedChartReferencePath?: string }
      clipboard.writeText = value => { runtime.__copiedChartReferencePath = value }
      const build = Menu.buildFromTemplate.bind(Menu)
      Menu.buildFromTemplate = template => {
        const menu = build(template)
        menu.popup = () => {
          const item = menu.items.find(item => item.label === '复制文件路径')
          if (!item) throw new Error('Missing reference-path menu action')
          ;(item.click as () => void)()
        }
        return menu
      }
    })
    await page.locator('.tab.active', { hasText: '01-quick-start.md' }).click({ button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __copiedChartReferencePath?: string }
    ).__copiedChartReferencePath)).toBe(referencePath)

    await expect(page.locator('.katex-display')).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
    expect(await page.locator('.katex-display').evaluate(element => element.closest('p') === null)).toBe(true)
    const katexAnnotation = page.locator('.katex-display annotation')
    await expect(katexAnnotation).toContainText('\\begin{aligned}')
    await expect(katexAnnotation).toContainText('\\frac{4}{3}\\pi r^3')
    const katexBounds = await page.locator('.katex-display').boundingBox()
    expect(katexBounds?.height).toBeGreaterThan(40)
    expect(katexBounds?.height).toBeLessThan(140)
    await expect(page.locator('.c4plantuml-wrapper .plantuml-container svg')).toBeVisible()
    const krokiFailure = page.locator('.remote-chart-failure[data-remote-renderer="kroki"]')
    await expect(krokiFailure.getByRole('alert')).toContainText('模拟 Kroki 服务暂时不可用')
    await expect(krokiFailure).toContainText('[用户] -> [MD Viewer]')
    expect(await page.evaluate(() => (window as typeof window & { __plantUmlTestRequests?: string[] }).__plantUmlTestRequests)).toHaveLength(2)
    expect(await electronApp.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        __chartExamplesTest?: { krokiRequests: unknown[] }
      }
      return runtime.__chartExamplesTest?.krokiRequests.length
    })).toBe(1)
    await expect(page.locator('.remote-chart-consent')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('chart-examples-remote-auto.png') })

    const katexBlockHeading = page.getByRole('heading', { name: 'KaTeX 块级公式' })
    await katexBlockHeading.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('chart-examples-katex-block.png') })
    await krokiFailure.screenshot({ path: testInfo.outputPath('chart-examples-kroki-failure.png') })

    await krokiFailure.getByRole('button', { name: '重试当前图表' }).click()
    await expect(page.locator('.kroki-wrapper .kroki-container svg')).toBeVisible()
    expect(await electronApp.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        __chartExamplesTest?: { krokiRequests: Array<{ format?: string; source?: string }> }
      }
      return runtime.__chartExamplesTest?.krokiRequests
    })).toEqual([
      expect.objectContaining({ format: 'nomnoml' }),
      expect.objectContaining({ format: 'nomnoml' }),
    ])
    await page.screenshot({ path: testInfo.outputPath('chart-examples-remote-rendered.png') })

    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('tab', { name: '图表', exact: true }).click()
    await page.getByRole('tab', { name: /渲染服务/ }).click()
    const autoRenderCheckbox = page.getByRole('checkbox', { name: /自动渲染联网图表/ })
    await expect(autoRenderCheckbox).toBeChecked()
    await autoRenderCheckbox.click()
    await page.getByRole('button', { name: '关闭设置' }).click()

    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), join(installedPath, 'README.md'))
    await expect(page.locator('.markdown-body h1')).toHaveText('MD Viewer 图表示例')
    await page.locator('.file-tree-row.file', { hasText: '01-quick-start.md' }).click()
    const documentConsent = page.getByRole('button', { name: '渲染本篇 3 个联网图表' })
    await expect(documentConsent).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('chart-examples-document-consent.png') })
    await documentConsent.click()
    await expect(page.locator('.c4plantuml-wrapper .plantuml-container svg')).toBeVisible()
    await expect(page.locator('.kroki-wrapper .kroki-container svg')).toBeVisible()

    const echartsGalleryPath = join(
      installedPath,
      '03-renderer-gallery',
      'data-visualization',
      'echarts.md',
    )
    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), echartsGalleryPath)
    await expect(page.locator('.markdown-body h1')).toContainText('ECharts 专项案例')
    await expect(page.locator('.echarts-wrapper .echarts-container svg')).toHaveCount(25, { timeout: 30000 })
    await page.screenshot({ path: testInfo.outputPath('chart-examples-gallery-page.png') })

    const katexGalleryPath = join(
      installedPath,
      '03-renderer-gallery',
      'formula-and-knowledge',
      'katex.md',
    )
    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), katexGalleryPath)
    await expect(page.locator('.markdown-body h1')).toContainText('KaTeX 专项案例')
    await expect(page.locator('.katex-error')).toHaveCount(0)
    const katexPositioning = await page.locator('.markdown-body').evaluate(root => ({
      top: root.querySelectorAll('.katex [style*="top:"]').length,
      relative: root.querySelectorAll('.katex [style*="position:relative"]').length,
      left: root.querySelectorAll('.katex [style*="left:"]').length,
      missingClasses: [
        'brace-center', 'brace-left', 'brace-right', 'fix', 'inner', 'llap', 'mathbf',
        'mover', 'mult', 'munder', 'overline', 'overline-line', 'rlap', 'stretchy',
        'text', 'thinbox', 'underline', 'underline-line', 'vbox',
      ].filter(className => root.querySelector(`.katex .${className}`) === null),
    }))
    expect(katexPositioning.top).toBeGreaterThan(100)
    expect(katexPositioning.relative).toBeGreaterThan(0)
    expect(katexPositioning.left).toBeGreaterThan(0)
    expect(katexPositioning.missingClasses).toEqual([])
    await page.getByRole('heading', { name: '10. 矩阵' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('chart-examples-katex-complex.png') })
  })

  test('所有 renderer 的代表性模板都能完整适配预览画布', async ({ page, electronApp }, testInfo) => {
    test.setTimeout(90_000)
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('plantuml')) {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><rect width="640" height="320" fill="#eef4ff"/><text x="320" y="160" text-anchor="middle">PlantUML preview</text></svg>',
            { status: 200, headers: { 'content-type': 'image/svg+xml' } },
          )
        }
        return originalFetch(input, init)
      }
    })
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('render:krokiSvg')
      ipcMain.handle('render:krokiSvg', async () => ({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><rect width="640" height="320" fill="#eef8ef"/><text x="320" y="160" text-anchor="middle">Kroki preview</text></svg>',
      }))
    })

    await page.getByRole('button', { name: /图表与架构图/ }).click()
    await page.getByRole('tab', { name: /格式参考/ }).click()

    const cases = [
      ['mermaid', '.mermaid-wrapper svg'],
      ['echarts', '.echarts-wrapper .echarts-container svg'],
      ['markmap', '.markmap-wrapper .markmap-container svg g'],
      ['katex', '.katex'],
      ['d2', '.d2-wrapper .d2-container svg'],
      ['graphviz', '.graphviz-wrapper .graphviz-container svg'],
      ['drawio', '.drawio-container[data-drawio-ready="true"] svg'],
      ['structurizr', '.structurizr-wrapper .structurizr-container svg'],
      ['antv-g6', '.antv-g6-wrapper .antv-g6-container svg'],
      ['svg', '.svg-wrapper .svg-container svg'],
      ['infographic', '.infographic-wrapper .infographic-container svg'],
      ['excalidraw', '.excalidraw-wrapper svg'],
      ['vega-lite', '.vega-lite-wrapper .vega-lite-container svg'],
      ['bpmn', '.bpmn-wrapper .bpmn-container svg'],
      ['wavedrom', '.wavedrom-wrapper .wavedrom-container svg'],
      ['plotly', '.plotly-wrapper .plotly-container svg'],
      ['dbml', '.dbml-wrapper .dbml-container svg'],
      ['plantuml', '.plantuml-wrapper .plantuml-container svg'],
      ['c4plantuml', '.c4plantuml-wrapper .plantuml-container svg'],
      ['kroki', '.kroki-wrapper .kroki-container svg'],
    ] as const

    for (const [type, readySelector] of cases) {
      await test.step(type, async () => {
        await page.locator(`.chart-catalog-card[data-renderer-type="${type}"]`).click()
        const previewTab = page.getByRole('tab', { name: '预览', exact: true })
        if (await previewTab.getAttribute('aria-selected') !== 'true') await previewTab.click()
        const connectButton = page.getByRole('button', { name: '连接服务并预览' })
        if (await connectButton.isVisible().catch(() => false)) await connectButton.click()
        await expect(page.locator(`.chart-starter-preview ${readySelector}`).first()).toBeVisible({ timeout: 20_000 })
        await page.waitForTimeout(type === 'markmap' ? 600 : 50)
        await expectTemplatePreviewToFit(page, type)
        if (type === 'plantuml' || type === 'c4plantuml') {
          const aspectRatioError = await page.locator(`.chart-starter-preview ${readySelector}`).first().evaluate(svg => {
            const element = svg as SVGSVGElement
            const box = element.getBoundingClientRect()
            const viewBox = element.viewBox.baseVal
            if (!viewBox.width || !viewBox.height || !box.width || !box.height) return null
            return Math.abs((box.width / box.height) / (viewBox.width / viewBox.height) - 1)
          })
          expect(aspectRatioError, `${type} SVG aspect ratio`).not.toBeNull()
          expect(aspectRatioError!, `${type} SVG aspect ratio`).toBeLessThanOrEqual(0.02)
        }
        if (['echarts', 'markmap', 'structurizr', 'graphviz', 'plantuml', 'vega-lite'].includes(type)) {
          await page.screenshot({ path: testInfo.outputPath(`chart-${type}-fitted-detail.png`) })
        }
          })
    }
  })

  test('编辑器模板只插入到发起图表设置的文档', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'test1.md'))
    const workbench = page.getByLabel('test1.md 编辑工作区')
    await expect(workbench).toBeVisible()
    await workbench.getByRole('button', { name: '插入图表' }).click()

    await expect(page.getByText('插入目标：test1.md')).toBeVisible()
    await page.locator('.chart-catalog-card[data-renderer-type="mermaid"]').click()
    await page.getByRole('button', { name: '插入到 test1.md' }).click()

    await expect(page.locator('.settings-overlay')).toHaveCount(0)
    await expect(workbench.locator('.cm-content')).toContainText('flowchart LR')
    await expect(workbench.locator('.cm-content')).toContainText('Render[渲染图表]')
  })

  test('窄窗口使用常驻类型选择器且页面无横向溢出', async ({ page, electronApp }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 720))
    expect(await page.evaluate(() => window.innerWidth)).toBe(800)
    await page.getByRole('button', { name: /图表与架构图/ }).click()
    await expect(page.getByText('内置离线示例包已就绪，无需联网。')).toBeVisible()
    await page.getByRole('tab', { name: /格式参考/ }).click()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    const picker = page.getByRole('combobox', { name: '图表类型', exact: true })
    await expect(picker).toBeVisible()
    await expect(picker).toHaveValue('mermaid')
    await expect(page.getByRole('heading', { name: '让 AI 参考格式，生成你需要的图表', level: 4 })).toBeInViewport({ ratio: 1 })
    expect(await page.locator('.settings-content').evaluate(element => element.scrollTop)).toBe(0)
    await expect(page.locator('.chart-starter-preview svg')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('navigation', { name: '图表类型' })).toBeHidden()
    await page.screenshot({ path: testInfo.outputPath('chart-catalog-narrow.png') })

    await picker.selectOption('markmap')
    await expect(page.locator('.chart-starter-preview .markmap-container svg g').first()).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(600)
    await expectTemplatePreviewToFit(page, 'markmap-narrow')
    await page.locator('.chart-starter-preview').evaluate(element => element.scrollIntoView({ block: 'end' }))
    await expect(picker).toBeInViewport({ ratio: 1 })
    const detailOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(detailOverflow).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('chart-detail-narrow.png') })
    await picker.selectOption('katex')
    await page.getByRole('combobox', { name: '示例形式' }).selectOption('katex-block')
    await expect(page.locator('.chart-starter-preview .katex-display')).toBeVisible()
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click()
    await expect(page.locator('.chart-template-source')).toContainText('$$')
    await page.getByRole('combobox', { name: '示例形式' }).selectOption('katex-inline')
    await expect(page.locator('.chart-template-source')).toContainText('$\\int')
    await page.locator('.chart-template-source').evaluate(element => element.scrollIntoView({ block: 'end' }))
    await expect(picker).toBeInViewport({ ratio: 1 })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('chart-reference-narrow-dark.png') })
  })
})
