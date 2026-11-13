import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { test, expect } from './fixtures/electron'

test('GUI HTML 导出的图表与公式在断网窄屏完整显示', async ({ page, electronApp, testDir }, info) => {
  const blocks = readFileSync(join(__dirname, 'fixtures/test-echarts.md'), 'utf8').match(/```echarts[\s\S]*?```/g)!.slice(0, 2)
  const source = join(testDir, 'ECharts 高级图表测试.md')
  writeFileSync(source, '# ECharts 高级图表测试\n\n' + blocks.join('\n\n') + '\n\n公式 $E=mc^2$\n\n$$\\frac{-b+\\sqrt{b^2-4ac}}{2a}$$\n')
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), source)
  await expect(page.locator('.markdown-body h1')).toHaveText('ECharts 高级图表测试')
  await expect(page.locator('.echarts-container svg')).toHaveCount(2)
  const output = info.outputPath('gui-offline-export.html')
  await electronApp.evaluate(({ dialog, BrowserWindow }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output })
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:export-html')
  }, output)
  await expect.poll(() => existsSync(output) ? readFileSync(output, 'utf8').includes('data:font/woff2;base64,') : false, { timeout: 20000 }).toBe(true)
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 900 }, offline: true })
    const document = await context.newPage()
    const external: string[] = []
    document.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()) })
    await document.goto(pathToFileURL(output).href)
    await document.evaluate(() => globalThis.document.fonts.ready)
    await expect(document.locator('.katex').first()).toBeVisible()
    for (const [index, label] of ['6月', 'Q4'].entries()) {
      const geometry = await document.locator('.echarts-container > svg').nth(index).evaluate((element, label) => {
        const svg = element as SVGSVGElement
        const last = Array.from(svg.querySelectorAll('text')).find(node => node.textContent === label)!
        const box = svg.getBoundingClientRect(), text = last.getBoundingClientRect()
        return { viewWidth: svg.viewBox.baseVal.width, ratio: box.width / box.height,
          expectedRatio: svg.viewBox.baseVal.width / svg.viewBox.baseVal.height,
          visible: text.left >= box.left - 1 && text.right <= box.right + 1 && text.bottom <= box.bottom + 1 }
      }, label)
      expect(geometry.viewWidth).toBeGreaterThanOrEqual(900)
      expect(geometry.ratio).toBeCloseTo(geometry.expectedRatio, 2)
      expect(geometry.visible).toBe(true)
    }
    expect(await document.evaluate(() => globalThis.document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    expect(external).toEqual([])
    await document.screenshot({ path: info.outputPath('gui-offline-400.png'), fullPage: true })
  } finally { await browser.close() }
})
