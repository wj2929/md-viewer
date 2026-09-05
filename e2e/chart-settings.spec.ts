import type { Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
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
  test('欢迎页直达离线包，联网模板默认自动预览且可关闭', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 900 })
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

    await page.getByRole('tab', { name: /模板库/ }).click()
    await expect(page.getByText('MD Viewer 支持 20 类图表与公式渲染。')).toBeVisible()
    await expect(page.getByText('3 类需要服务')).toBeVisible()
    await expect(page.getByText('PlantUML、C4-PlantUML 和 Kroki')).toBeVisible()
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

    await page.getByRole('button', { name: '返回模板库' }).click()
    await page.locator('.chart-catalog-card[data-renderer-type="drawio"]').click()
    await expect(page.locator('.chart-starter-preview[data-renderer-type="drawio"] svg')).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: testInfo.outputPath('chart-drawio-detail.png') })

    await page.getByRole('button', { name: '返回模板库' }).click()
    await page.locator('.chart-catalog-card[data-renderer-type="svg"]').click()
    await expect(page.locator('.chart-starter-preview[data-renderer-type="svg"] svg')).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: testInfo.outputPath('chart-svg-detail.png') })

    await page.getByRole('button', { name: '返回模板库' }).click()
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

    await page.getByRole('tab', { name: /模板库/ }).click()
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
    const zipPath = join(testDir, 'md-viewer-chart-examples-v2.8.0-r4.zip')
    const managedUserData = join(testDir, 'managed-user-data')
    const installedPath = join(
      managedUserData,
      'chart-examples',
      'md-viewer-chart-examples-v2.8.0-r4',
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
    expect(statSync(zipPath).size).toBe(405583)
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
    await page.setViewportSize({ width: 1400, height: 900 })
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
    await page.getByRole('tab', { name: /模板库/ }).click()

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
        await page.getByRole('button', { name: '返回模板库' }).click()
      })
    }
  })

  test('编辑器模板只插入到发起图表设置的文档', async ({ page, electronApp, testDir }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
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

  test('窄窗口图表目录保持单列且页面无横向溢出', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 600, height: 720 })
    await page.getByRole('button', { name: /图表与架构图/ }).click()
    await expect(page.getByText('内置离线示例包已就绪，无需联网。')).toBeVisible()
    await page.getByRole('tab', { name: /模板库/ }).click()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    const cards = page.locator('.chart-catalog-card')
    const first = await cards.nth(0).boundingBox()
    const second = await cards.nth(1).boundingBox()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(Math.abs((first?.x ?? 0) - (second?.x ?? 0))).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('chart-catalog-narrow.png') })

    await page.locator('.chart-catalog-card[data-renderer-type="markmap"]').click()
    await expect(page.locator('.chart-starter-preview .markmap-container svg g').first()).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(600)
    await expectTemplatePreviewToFit(page, 'markmap-narrow')
    const detailOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(detailOverflow).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('chart-detail-narrow.png') })
  })
})
