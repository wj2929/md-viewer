import { writeFileSync } from 'fs'
import { join } from 'path'
import AdmZip from 'adm-zip'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const BENCHMARK_ENABLED = process.env.MD_VIEWER_CHART_BENCHMARK === '1'
const BENCHMARK_MODE = process.env.MD_VIEWER_CHART_BENCHMARK_MODE === 'fixed' ? 'fixed' : 'single'
const RENDERER_FILTER = new Set((process.env.MD_VIEWER_CHART_BENCHMARK_RENDERERS || '').split(',').filter(Boolean))
const RUNS = 5
const WARNING_LIMITS = {
  medianReadyMs: 2000,
  p95ReadyMs: 4000,
  maxLongTaskMs: 200,
  totalLongTaskMs: 500,
  maxEventLoopLagMs: 250,
  privateMemoryDeltaMb: 150,
  domNodes: 50_000,
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

test.describe('图表案例单 renderer 文件性能基准', () => {
  test.skip(!BENCHMARK_ENABLED, '仅在明确设置 MD_VIEWER_CHART_BENCHMARK=1 时运行')

  test('隐藏测量全部 renderer 候选页', async ({ page, electronApp, testDir }, testInfo) => {
    test.setTimeout(20 * 60 * 1000)
    const extractedRoot = join(testDir, 'chart-package')
    const archivePath = BENCHMARK_MODE === 'single'
      ? join(process.cwd(), '.tmp/chart-examples-single-renderer.zip')
      : join(process.cwd(), 'resources/examples/md-viewer-chart-examples.zip')
    const candidatesArchive = new AdmZip(archivePath)
    candidatesArchive.extractAllTo(extractedRoot, true)
    const packageRoot = join(extractedRoot, 'md-viewer-chart-examples')

    await page.evaluate(() => {
      const runtime = window as typeof window & { __chartBenchmarkOriginalFetch?: typeof fetch }
      runtime.__chartBenchmarkOriginalFetch = window.fetch.bind(window)
      window.fetch = async input => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (/plantuml/i.test(url)) {
          return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="8" y="24">PlantUML benchmark</text></svg>', {
            status: 200,
            headers: { 'content-type': 'image/svg+xml' },
          })
        }
        return runtime.__chartBenchmarkOriginalFetch!(input)
      }
    })
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('render:krokiSvg')
      ipcMain.handle('render:krokiSvg', async () => ({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="8" y="24">Kroki benchmark</text></svg>',
      }))
    })

    await openFolderViaIPC(electronApp, packageRoot)
    const candidates = candidatesArchive.getEntries()
      .map(entry => entry.entryName.replace(/^md-viewer-chart-examples\//, ''))
      .filter(name => name.startsWith('03-renderer-gallery/'))
      .filter(name => name.endsWith('.md') && !name.endsWith('/README.md'))
      .map(name => {
        const pageName = name.split('/').at(-1)?.replace(/\.md$/, '') || ''
        const rendererType = pageName.replace(/-\d{2}$/, '')
        return {
          rendererType,
          pageName,
          filePath: join(packageRoot, name),
        }
      })
      .filter(candidate => RENDERER_FILTER.size === 0 || RENDERER_FILTER.has(candidate.rendererType))

    const results: Array<Record<string, unknown>> = []
    const outputPath = testInfo.outputPath('chart-gallery-benchmark.json')
    for (const candidate of candidates) {
      const readyTimes: number[] = []
      const longTasks: number[] = []
      const eventLoopLags: number[] = []
      const memoryDeltas: number[] = []
      let domNodes = 0
      let svgCount = 0
      let canvasCount = 0
      let errorCount = 0

      for (let run = -1; run < RUNS; run += 1) {
        await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), join(packageRoot, 'README.md'))
        await expect(page.locator('.markdown-body h1')).toHaveText('MD Viewer 图表示例')
        const memoryBefore = await electronApp.evaluate(({ app, BrowserWindow }) => {
          const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId()
          return app.getAppMetrics().find(metric => metric.pid === pid)?.memory.privateBytes ?? 0
        })
        await page.evaluate(() => {
          const runtime = window as typeof window & {
            __chartBenchmark?: { longTasks: number[]; maxLag: number; stop: () => void }
          }
          const longTasks: number[] = []
          const observer = new PerformanceObserver(list => {
            longTasks.push(...list.getEntries().map(entry => entry.duration))
          })
          try { observer.observe({ entryTypes: ['longtask'] }) } catch { /* unsupported */ }
          let expected = performance.now() + 16
          let maxLag = 0
          const timer = window.setInterval(() => {
            const now = performance.now()
            maxLag = Math.max(maxLag, now - expected)
            expected = now + 16
          }, 16)
          runtime.__chartBenchmark = {
            longTasks,
            get maxLag() { return maxLag },
            stop: () => { observer.disconnect(); window.clearInterval(timer) },
          }
        })

        const startedAt = Date.now()
        await expect(async () => {
          await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), candidate.filePath)
          await expect(page.locator('.markdown-body h1')).toContainText(`${candidate.rendererType} 专项案例`, { timeout: 3000 })
        }).toPass({ timeout: 30_000 })
        await page.evaluate(() => new Promise<void>(resolve => {
          const root = document.querySelector('.markdown-body')
          if (!root) { resolve(); return }
          let timer = window.setTimeout(finish, 700)
          const observer = new MutationObserver(() => {
            window.clearTimeout(timer)
            timer = window.setTimeout(finish, 700)
          })
          function finish() {
            observer.disconnect()
            resolve()
          }
          observer.observe(root, { childList: true, subtree: true })
        }))
        await page.waitForTimeout(100)
        const readyMs = Math.max(0, Date.now() - startedAt - 800)
        const metrics = await page.evaluate(() => {
          const runtime = window as typeof window & {
            __chartBenchmark?: { longTasks: number[]; maxLag: number; stop: () => void }
          }
          const benchmark = runtime.__chartBenchmark
          benchmark?.stop()
          return {
            longTasks: benchmark?.longTasks ?? [],
            maxLag: benchmark?.maxLag ?? 0,
            domNodes: document.querySelectorAll('*').length,
            svgCount: document.querySelectorAll('.markdown-body svg').length,
            canvasCount: document.querySelectorAll('.markdown-body canvas').length,
            errorCount: document.querySelectorAll('.markdown-body [class$="-error"], .markdown-body .remote-chart-failure').length,
          }
        })
        const memoryAfter = await electronApp.evaluate(({ app, BrowserWindow }) => {
          const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId()
          return app.getAppMetrics().find(metric => metric.pid === pid)?.memory.privateBytes ?? 0
        })

        if (run >= 0) {
          readyTimes.push(readyMs)
          longTasks.push(...metrics.longTasks)
          eventLoopLags.push(metrics.maxLag)
          memoryDeltas.push(Math.max(0, memoryAfter - memoryBefore) / 1024)
          domNodes = Math.max(domNodes, metrics.domNodes)
          svgCount = Math.max(svgCount, metrics.svgCount)
          canvasCount = Math.max(canvasCount, metrics.canvasCount)
          errorCount = Math.max(errorCount, metrics.errorCount)
        }
      }

      const medianReadyMs = percentile(readyTimes, 0.5)
      const p95ReadyMs = percentile(readyTimes, 0.95)
      const maxLongTaskMs = Math.max(0, ...longTasks)
      const totalLongTaskMs = longTasks.reduce((sum, duration) => sum + duration, 0) / RUNS
      const maxEventLoopLagMs = Math.max(0, ...eventLoopLags)
      const privateMemoryDeltaMb = Math.max(0, ...memoryDeltas)
      const measured = { medianReadyMs, p95ReadyMs, maxLongTaskMs, totalLongTaskMs, maxEventLoopLagMs, privateMemoryDeltaMb, domNodes }
      const warnings = Object.entries(WARNING_LIMITS)
        .filter(([key, limit]) => measured[key as keyof typeof measured] > limit)
        .map(([key]) => key)
      results.push({
        rendererType: candidate.rendererType,
        pageName: candidate.pageName,
        readyTimes,
        medianReadyMs,
        p95ReadyMs,
        maxLongTaskMs,
        totalLongTaskMs,
        maxEventLoopLagMs,
        privateMemoryDeltaMb,
        domNodes,
        svgCount,
        canvasCount,
        errorCount,
        warnings,
      })
      writeFileSync(outputPath, `${JSON.stringify({ limits: WARNING_LIMITS, results }, null, 2)}\n`)

      if (['infographic', 'drawio', 'excalidraw', 'bpmn', 'graphviz'].includes(candidate.rendererType)) {
        await page.screenshot({ path: testInfo.outputPath(`${candidate.pageName}-top.png`) })
        await page.locator('.preview').evaluate(element => { element.scrollTop = element.scrollHeight })
        await page.waitForTimeout(100)
        await page.screenshot({ path: testInfo.outputPath(`${candidate.pageName}-bottom.png`) })
      }
    }

    console.log(`[chart-benchmark] ${outputPath}`)
  })
})
