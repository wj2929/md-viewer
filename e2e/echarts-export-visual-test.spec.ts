import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const exportedHtml = process.env.ECHARTS_HTML_PATH || path.join(__dirname, '..', 'test-results', 'echarts-export.html')
test.skip(!fs.existsSync(exportedHtml), `缺少导出的 ECharts HTML：${exportedHtml}`)

test.describe('ECharts 导出 HTML 视觉测试', () => {
  let consoleErrors: string[], networkErrors: string[], externalStyles: string[]

  test.beforeEach(async ({ page, context }) => {
    consoleErrors = []; networkErrors = []; externalStyles = []
    await context.setOffline(true)
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('requestfailed', request => { networkErrors.push(`${request.url()} - ${request.failure()?.errorText}`) })
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && ['stylesheet', 'font'].includes(request.resourceType())) externalStyles.push(request.url())
    })
    await page.goto(pathToFileURL(exportedHtml).href)
    await page.evaluate(() => document.fonts.ready)
  })

  test('阶段 1：基础渲染检查', async ({ page }, info) => {
    expect(await page.title()).toContain('ECharts 高级图表测试')
    expect(await page.locator('.echarts-container').count()).toBeGreaterThan(0)
    expect(await page.locator('.echarts-container > svg').count()).toBeGreaterThan(0)
    await page.screenshot({ path: info.outputPath('01-full-page.png'), fullPage: true })
  })

  test('阶段 2：图表居中和尺寸检查', async ({ page }, info) => {
    const width = await page.evaluate(() => window.innerWidth)
    const containers = await page.locator('.echarts-container').all()
    for (const [index, container] of containers.entries()) {
      const box = await container.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
      expect(box!.height).toBeGreaterThan(200)
      expect(box!.height).toBeLessThan(1000)
      await container.screenshot({ path: info.outputPath(`02-chart-${index + 1}.png`) })
    }
  })

  test('阶段 3：横向滚动条检查', async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })

  test('阶段 4：SVG 坐标系完整', async ({ page }) => {
    const charts = await page.locator('.echarts-container > svg').evaluateAll(elements => elements.map(element => {
      const svg = element as SVGSVGElement
      return { width: Number(svg.getAttribute('width')), height: Number(svg.getAttribute('height')),
        viewWidth: svg.viewBox.baseVal.width, viewHeight: svg.viewBox.baseVal.height, position: getComputedStyle(svg).position }
    }))
    expect(charts.length).toBeGreaterThan(0)
    for (const chart of charts) {
      expect(chart.width).toBeGreaterThan(0)
      expect(chart.height).toBeGreaterThan(0)
      expect(chart.viewWidth).toBeGreaterThan(0)
      expect(chart.viewHeight).toBeGreaterThan(0)
      expect(chart.position).toBe('static')
    }
  })

  test('阶段 5：断网时无控制台、网络或外部样式请求', async () => {
    expect(consoleErrors).toEqual([])
    expect(networkErrors).toEqual([])
    expect(externalStyles).toEqual([])
  })

  test('阶段 6：宽窄屏末尾分类均完整，不把静态图当交互图', async ({ page }, info) => {
    for (const width of [1280, 900, 400]) {
      await page.setViewportSize({ width, height: 900 })
      for (const [index, label] of ['6月', 'Q4'].entries()) {
        const chart = page.locator('.echarts-container').nth(index)
        const geometry = await chart.evaluate((container, label) => {
          const svg = container.querySelector('svg')!
          const text = Array.from(svg.querySelectorAll('text')).find(node => node.textContent === label)!
          const box = svg.getBoundingClientRect(), outer = container.getBoundingClientRect()
          const last = text?.getBoundingClientRect(), view = svg.viewBox.baseVal
          return { found: !!text, svgWidth: box.width, svgHeight: box.height, ratio: box.width / box.height,
            viewRatio: view.width / view.height, fitsContainer: box.right <= outer.right + 1 && box.bottom <= outer.bottom + 1,
            lastVisible: !!last && last.left >= box.left - 1 && last.right <= box.right + 1 && last.top >= box.top - 1 && last.bottom <= box.bottom + 1,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }
        }, label)
        expect(geometry.found, label).toBe(true)
        expect(geometry.svgWidth).toBeGreaterThan(0)
        expect(geometry.svgHeight).toBeGreaterThan(0)
        expect(geometry.ratio).toBeCloseTo(geometry.viewRatio, 2)
        expect(geometry.fitsContainer).toBe(true)
        expect(geometry.lastVisible, `${width}px: ${label}`).toBe(true)
        expect(geometry.overflow).toBe(false)
        await chart.screenshot({ path: info.outputPath(`06-${width}-chart-${index + 1}.png`) })
      }
    }
  })

  test('阶段 7：视觉验收截图', async ({ page }, info) => {
    for (const [index, chart] of (await page.locator('.echarts-container').all()).entries()) {
      await chart.screenshot({ path: info.outputPath(`07-chart-${index + 1}.png`) })
    }
  })

  test('阶段 8：公式字体随 HTML 离线加载', async ({ page }) => {
    await expect(page.locator('.katex').first()).toBeVisible()
    const fonts = await page.evaluate(async () => {
      await document.fonts.load('16px KaTeX_Main')
      await document.fonts.load('italic 16px KaTeX_Math')
      return { main: document.fonts.check('16px KaTeX_Main'), math: document.fonts.check('italic 16px KaTeX_Math'),
        embedded: (document.documentElement.innerHTML.match(/data:font\/woff2;base64,/g) || []).length }
    })
    expect(fonts.main).toBe(true)
    expect(fonts.math).toBe(true)
    expect(fonts.embedded).toBeGreaterThanOrEqual(20)
    expect(externalStyles).toEqual([])
    expect(networkErrors).toEqual([])
  })

  test.afterEach(async ({}, info) => {
    await info.attach('offline-export-diagnostics', { body: JSON.stringify({ consoleErrors, networkErrors, externalStyles }), contentType: 'application/json' })
  })
})
