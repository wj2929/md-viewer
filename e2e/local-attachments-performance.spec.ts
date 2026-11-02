import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

test('360KiB JSON与近5MiB文本各三轮真实查看、查找和关闭性能', async ({ electronApp, page, testDir }, testInfo) => {
  const record = JSON.stringify({ text: '内容 '.repeat(20), kind: 'sample' })
  const json = '{"id":9007199254740993123,"records":[' + Array.from({ length: 2200 }, () => record).join(',') + '],"marker":"NEEDLE_END_JSON"}'
  const line = 'fixture plain text data '.repeat(4) + '\n'
  const txt = line.repeat(Math.floor((5 * 1024 * 1024 - 128) / Buffer.byteLength(line))) + 'NEEDLE_END_TEXT\n'
  writeFileSync(join(testDir, 'perf.md'), '# Performance\n\n[JSON样本](./sample.json)\n\n[文本样本](./sample.txt)')
  writeFileSync(join(testDir, 'sample.json'), json)
  writeFileSync(join(testDir, 'sample.txt'), txt)
  await openFolderViaIPC(electronApp, testDir)
  await page.locator('.file-tree-row.file', { hasText: 'perf.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Performance')
  const tabCount = await page.locator('.tab').count()
  await page.evaluate(() => {
    const data = { runs: [] as any[], active: null as any }
    ;(window as any).__attachmentPerformance = data
    const observer = new PerformanceObserver(list => {
      if (data.active) data.active.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })))
    })
    observer.observe({ entryTypes: ['longtask'] })
    document.addEventListener('click', event => {
      const target = event.target as Element
      if (target.closest('a[href="./sample.json"],a[href="./sample.txt"]')) {
        data.active = { click: performance.now(), longTasks: [] }
        data.runs.push(data.active)
      }
      if (target.closest('.local-attachment-dialog button[aria-label="关闭附件"]') && data.active) data.active.close = performance.now()
    }, true)
    new MutationObserver(() => {
      const active = data.active
      if (!active) return
      if (!active.readable && !active.readableScheduled && document.querySelector('.local-attachment-dialog .cm-content .cm-line')) {
        active.readableScheduled = true
        requestAnimationFrame(() => requestAnimationFrame(() => { active.readable = performance.now() }))
      }
      if (active.close && !active.closed && !active.closedScheduled && !document.querySelector('.local-attachment-dialog')) {
        active.closedScheduled = true
        requestAnimationFrame(() => requestAnimationFrame(() => { active.closed = performance.now() }))
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
  for (const [label, needle] of [['JSON样本', 'NEEDLE_END_JSON'], ['文本样本', 'NEEDLE_END_TEXT']]) {
    for (let round = 0; round < 3; round++) {
      const link = page.getByRole('link', { name: label })
      const offset = await link.evaluate(node => node.getBoundingClientRect().top)
      await link.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
      await expect.poll(() => page.evaluate(() => Boolean((window as any).__attachmentPerformance.active.readable))).toBe(true)
      await dialog.getByRole('button', { name: /查找/ }).click()
      const search = dialog.locator('.cm-search input[name="search"]')
      await search.pressSequentially(needle)
      await page.evaluate(() => { (window as any).__attachmentPerformance.active.search = performance.now() })
      const profiler = label === '文本样本' && round === 2 ? await page.context().newCDPSession(page) : null
      if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start') }
      await search.press('Enter')
      await expect(dialog.locator('.cm-searchMatch')).toHaveCount(1)
      await page.evaluate(() => { (window as any).__attachmentPerformance.active.found = performance.now() })
      await expect(dialog.locator('.cm-content')).toContainText(needle)
      if (profiler) {
        const { profile } = await profiler.send('Profiler.stop')
        writeFileSync(testInfo.outputPath('search-cpu-profile.json'), JSON.stringify(profile))
        await profiler.detach()
      }
      if (round === 2) await page.screenshot({ path: testInfo.outputPath(label === 'JSON样本' ? 'json-large.png' : 'text-large.png') })
      await dialog.getByRole('button', { name: '关闭附件', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => Boolean((window as any).__attachmentPerformance.active.closed))).toBe(true)
      await expect(link).toBeFocused()
      expect(Math.abs(await link.evaluate(node => node.getBoundingClientRect().top) - offset)).toBeLessThan(3)
      await expect(page.locator('.tab')).toHaveCount(tabCount)
    }
  }
  const runs = await page.evaluate(() => (window as any).__attachmentPerformance.runs.map((run: any) => ({
    readableMs: run.readable - run.click, searchMs: run.found - run.search, closeMs: run.closed - run.close,
    longTasks: run.longTasks.map((entry: any) => ({ duration: entry.duration })),
  })))
  expect(runs).toHaveLength(6)
  writeFileSync(testInfo.outputPath('performance.json'), JSON.stringify({
    method: 'renderer点击到CodeMirror正文挂载后两次rAF；查找Enter到匹配可见；关闭点击到正文恢复后两次rAF。查找含自动化往返开销；不等同物理显示器绘制。',
    jsonBytes: Buffer.byteLength(json), textBytes: Buffer.byteLength(txt), runs,
  }, null, 2))
})
