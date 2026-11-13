import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('大文档完整渲染实测：六千节正文、长任务与CPU采样', async ({ electronApp, page, testDir }, info) => {
  test.setTimeout(120_000)
  const source = '# Large fixture\n\n' + Array.from({ length: 6000 }, (_, i) => `## Section ${i}\nParagraph **${i}** ${'public fixture text '.repeat(6)}[link](https://example.invalid)\n\n`).join('')
  const target = join(testDir, 'large-render.md')
  writeFileSync(target, source)
  await openFolderViaIPC(electronApp, testDir)
  await page.evaluate(() => {
    const data = { longTasks: [] as number[], maxGap: 0, previous: performance.now(), start: performance.now() }
    ;(window as any).__largeRenderProbe = data
    ;(window as any).__largeRenderTimer = setInterval(() => {
      const now = performance.now()
      data.maxGap = Math.max(data.maxGap, now - data.previous)
      data.previous = now
    }, 25)
    new PerformanceObserver(list => data.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' })
  })
  const session = await page.context().newCDPSession(page)
  await session.send('Profiler.enable')
  await session.send('Profiler.start')
  try {
    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), target)
    await expect(page.locator('.markdown-body h2')).toHaveCount(6000, { timeout: 90_000 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const { profile } = await session.send('Profiler.stop')
    writeFileSync(info.outputPath('render-cpu-profile.json'), JSON.stringify(profile))
    const result = await page.evaluate(() => {
      clearInterval((window as any).__largeRenderTimer)
      const data = (window as any).__largeRenderProbe
      return { readableMs: performance.now() - data.start, maxHeartbeatGapMs: data.maxGap, longTasks: data.longTasks, headings: document.querySelectorAll('.markdown-body h2').length }
    })
    writeFileSync(info.outputPath('render-performance.json'), JSON.stringify({ ...result, bytes: Buffer.byteLength(source), characters: source.length, lines: source.split('\n').length, method: '真实Electron完整DOM及两次rAF；25ms主线程心跳、LongTask、CPU采样。含自动化往返，不代表物理显示器绘制。' }, null, 2))
    await page.screenshot({ path: info.outputPath('large-document.png') })
  } finally {
    await session.detach()
    await page.evaluate(() => clearInterval((window as any).__largeRenderTimer)).catch(() => {})
  }
})
