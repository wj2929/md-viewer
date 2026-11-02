import { test, expect } from './fixtures/electron'
import type { ElectronApplication } from '@playwright/test'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import katex from 'katex'

type Observation = { operation?: string; range?: { start: number; end: number }; messages: Array<Record<string, unknown>>; exited: boolean; concurrentHelpers?: number; readyMs?: number; elapsedMs?: number; exitCode?: number | null; exitSignal?: string | null }
const memorySamplers = new Map<ElectronApplication, { stop: () => void; metrics: { samples: number; peakTreeRssKb: number; peakProcessRssKb: number; errors: number } }>()

test.afterEach(async ({ electronApp }, testInfo) => {
  const sampler = memorySamplers.get(electronApp)
  if (!sampler) return
  sampler.stop()
  const fs = await import('node:fs/promises')
  await fs.writeFile(testInfo.outputPath('memory-sampling.json'), JSON.stringify(sampler.metrics, null, 2))
  memorySamplers.delete(electronApp)
})

async function observeHelpers(app: ElectronApplication, directory: string, forceWholeFailure = false): Promise<void> {
  if (process.platform === 'darwin') {
    const rootPid = app.process().pid
    const metrics = { samples: 0, peakTreeRssKb: 0, peakProcessRssKb: 0, errors: 0 }
    const sample = (): void => {
      try {
        const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number))
        const owned = new Set([rootPid])
        let previous = 0
        while (previous !== owned.size) {
          previous = owned.size
          for (const [pid, ppid] of rows) if (owned.has(ppid)) owned.add(pid)
        }
        const rss = rows.filter(([pid]) => owned.has(pid)).map(row => row[2])
        metrics.samples++
        metrics.peakTreeRssKb = Math.max(metrics.peakTreeRssKb, rss.reduce((sum, value) => sum + value, 0))
        metrics.peakProcessRssKb = Math.max(metrics.peakProcessRssKb, ...rss)
      } catch { metrics.errors++ }
    }
    const timer = setInterval(sample, 500)
    memorySamplers.set(app, { stop: () => clearInterval(timer), metrics })
    sample()
  }
  await app.evaluate((_electron, options) => {
    const cp = process.getBuiltinModule('node:child_process') as any
    const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
    const path = process.getBuiltinModule('node:path') as typeof import('node:path')
    ;(globalThis as any).__forcePdfWholeFailure = options.forceWholeFailure
    const originalSpawn = cp.spawn
    const observations: Observation[] = []
    let primaryJobId: string | undefined
    ;(globalThis as any).__pdfObservations = observations
    cp.spawn = function (executable: string, args: string[], spawnOptions: unknown) {
      const child = originalSpawn(executable, args, spawnOptions)
      if (!args.some(arg => arg.startsWith('--md-viewer-pdf-helper='))) return child
      const started = Date.now()
      const jobId = args.find(arg => arg.startsWith('--md-viewer-pdf-helper='))!.split('=')[1]
      primaryJobId ??= jobId
      const destination = jobId === primaryJobId ? options.directory : path.join(options.directory, `followup-${jobId}`)
      fs.mkdirSync(destination, { recursive: true })
      const observation: Observation = { messages: [], exited: false, concurrentHelpers: observations.filter(item => !item.exited).length }
      observations.push(observation)
      const root = path.dirname(args.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length))
      const originalSend = child.send.bind(child)
      child.send = function (request: any, ...rest: any[]) {
        observation.operation = request.operation
        observation.range = request.range
        if ((globalThis as any).__holdPdfRequest || (globalThis as any).__disconnectPdfHelper) {
          const callback = rest.at(-1)
          if (typeof callback === 'function') callback(null)
          if ((globalThis as any).__disconnectPdfHelper) {
            ;(globalThis as any).__disconnectPdfHelper = false
            child.disconnect()
          }
          return true
        }
        return originalSend(request, ...rest)
      }
      const originalEmit = child.emit.bind(child)
      child.emit = function (name: string, ...values: any[]) {
        const message = values[0]
        if (name === 'message') {
          observation.messages.push(message)
          if (message.type === 'ready') {
            observation.readyMs = Date.now() - started
            fs.copyFileSync(path.join(root, 'document.html'), path.join(destination, 'document.html'))
          }
          if (message.type === 'ready' && (globalThis as any).__silencePdfStartup) {
            ;(globalThis as any).__silencePdfStartup = false
            return true
          }
          if (message.type === 'part' && (globalThis as any).__crashNextPdfWhole && !observation.range) {
            ;(globalThis as any).__crashNextPdfWhole = false
            const result = originalEmit(name, ...values)
            child.kill('SIGKILL')
            return result
          }
          if (message.type === 'complete') {
            fs.copyFileSync(path.join(root, message.file), path.join(destination, message.file))
            if ((globalThis as any).__forcePdfWholeFailure && message.file === 'whole.pdf') {
              return originalEmit(name, { type: 'failure', code: 'printing', jobId: message.jobId })
            }
          }
        }
        return originalEmit(name, ...values)
      }
      child.on('exit', (code: number | null, signal: string | null) => {
        observation.exited = true
        observation.elapsedMs = Date.now() - started
        observation.exitCode = code
        observation.exitSignal = signal
      })
      return child
    }
  }, { directory, forceWholeFailure })
}

async function observations(app: ElectronApplication): Promise<Observation[]> {
  return app.evaluate(() => (globalThis as any).__pdfObservations)
}

function linkedContent(pages: number): string {
  const math = katex.renderToString('\\int_0^1 x^2\\,dx=\\frac13', { displayMode: true })
  return Array.from({ length: pages }, (_, i) => `<section style="${i ? 'break-before:page;' : ''}">
    <h1 id="page-${i + 1}">PDF 第 ${i + 1} 页</h1>
    <p><a href="#page-1">开头</a> <a href="#page-17">跨段</a> <a href="#page-${pages}">结尾</a> <a href="https://example.com/pdf-proof">外部链接</a></p>
    ${math}<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90"><rect width="290" height="80" fill="#b3d7ff"/><text x="20" y="45">中文矢量图 ${i + 1}</text></svg>
  </section>`).join('')
}

for (const count of [32, 33]) {
  test(`PDF 分段恢复保留 ${count} 页、中文公式、首尾跨段链接和矢量画面`, async ({ page, electronApp }, testInfo) => {
    test.setTimeout(90_000)
    const directory = testInfo.outputPath('pdf')
    const fs = await import('node:fs/promises')
    await fs.mkdir(directory, { recursive: true })
    const output = join(directory, 'final.pdf')
    await observeHelpers(electronApp, directory, true)
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, output)
    const result = await page.evaluate(async content => window.api.exportPDF(content, '分页保真.md'), linkedContent(count))
    expect(result?.filePath).toBe(output)
    const observed = await observations(electronApp)
    await fs.writeFile(join(directory, 'helpers.json'), JSON.stringify(observed, null, 2))
    expect(observed.every(item => item.exited)).toBe(true)
    expect(observed.at(-1)?.operation).toBe('merge')
    if (count === 32) expect(observed.some(item => item.messages.some(message => message.code === 'range'))).toBe(true)
    const merged = await PDFDocument.load(readFileSync(output), { updateMetadata: false })
    const baseline = await PDFDocument.load(readFileSync(join(directory, 'whole.pdf')), { updateMetadata: false })
    expect(merged.getPageCount()).toBe(count)
    expect(baseline.getPageCount()).toBe(count)
    expect(merged.getTitle()).toBe('分页保真.md')
    const dests = merged.catalog.lookup(PDFName.of('Dests'), PDFDict)
    const refs = new Set(merged.getPages().map(pdfPage => pdfPage.ref.toString()))
    let internalLinks = 0
    let externalLinks = 0
    for (const pdfPage of merged.getPages()) {
      for (const raw of pdfPage.node.Annots()?.asArray() ?? []) {
        const annotation = merged.context.lookup(raw, PDFDict)
        const dest = annotation.get(PDFName.of('Dest'))
        if (dest) {
          expect(dest).toBeInstanceOf(PDFName)
          const target = dests.lookup(dest as PDFName, PDFArray).get(0)
          expect(refs.has(target.toString())).toBe(true)
          internalLinks++
        }
        if (annotation.lookupMaybe(PDFName.of('A'), PDFDict)?.get(PDFName.of('S')) === PDFName.of('URI')) externalLinks++
      }
    }
    expect(internalLinks).toBe(count * 3)
    expect(externalLinks).toBe(count)
    const pdftoppm = '/opt/homebrew/bin/pdftoppm'
    if (existsSync(pdftoppm)) {
      for (const file of ['whole', 'final']) execFileSync(pdftoppm, ['-r', '72', '-png', join(directory, `${file}.pdf`), join(directory, file)], { stdio: 'pipe' })
      const width = String(count).length
      for (let i = 1; i <= count; i++) {
        const suffix = String(i).padStart(width, '0')
        expect(readFileSync(join(directory, `final-${suffix}.png`)).equals(readFileSync(join(directory, `whole-${suffix}.png`)))).toBe(true)
      }
      await testInfo.attach('first-page', { path: join(directory, 'final-01.png'), contentType: 'image/png' })
      await testInfo.attach('last-page', { path: join(directory, `final-${count}.png`), contentType: 'image/png' })
    }
    // 前一个整份请求已被注入拒绝，日常进程不重启，下一份应直接完整打印。
    await electronApp.evaluate(() => { (globalThis as any).__forcePdfWholeFailure = false })
    await electronApp.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, join(directory, 'next.pdf'))
    const next = await page.evaluate(() => window.api.exportPDF('<h1>下一份正常文档</h1>', 'next.md'))
    expect(next?.filePath).toBe(join(directory, 'next.pdf'))
    expect((await PDFDocument.load(readFileSync(join(directory, 'next.pdf')))).getPageCount()).toBe(1)
    const afterRecovery = await observations(electronApp)
    expect(afterRecovery.at(-1)?.operation).toBe('print')
    expect(afterRecovery.at(-1)?.range).toBeUndefined()
    await fs.writeFile(join(directory, 'helpers-after-recovery.json'), JSON.stringify(afterRecovery, null, 2))
  })
}

test('PDF 普通 GUI 公式导出每份只启动一次打印 helper', async ({ page, electronApp, testDir }, testInfo) => {
  test.setTimeout(60_000)
  const directory = testInfo.outputPath('normal')
  const fs = await import('node:fs/promises')
  await fs.mkdir(directory, { recursive: true })
  await observeHelpers(electronApp, directory)
  const output = join(directory, 'math.pdf')
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(testDir, 'math.md'))
  await page.waitForSelector('.katex')
  await electronApp.evaluate(({ dialog, BrowserWindow }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:export-pdf')
  }, output)
  await expect.poll(() => existsSync(output), { timeout: 25_000 }).toBe(true)
  expect((await observations(electronApp)).map(item => item.operation)).toEqual(['print'])
  expect((await PDFDocument.load(readFileSync(output))).getPageCount()).toBe(1)
  const warmOutput = join(directory, 'math-warm.pdf')
  await electronApp.evaluate(({ dialog, BrowserWindow }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:export-pdf')
  }, warmOutput)
  await expect.poll(() => existsSync(warmOutput), { timeout: 25_000 }).toBe(true)
  expect((await observations(electronApp)).map(item => item.operation)).toEqual(['print', 'print'])
  await page.screenshot({ path: testInfo.outputPath('normal-complete.png') })

  // 真正终止自己的打印进程；parent 应在同一应用中恢复，而非继承失败队列。
  const crashOutput = join(directory, 'after-crash.pdf')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    ;(globalThis as any).__crashNextPdfWhole = true
  }, crashOutput)
  await page.evaluate(content => window.api.exportPDF(content, 'crash.md'), linkedContent(17))
  expect((await PDFDocument.load(readFileSync(crashOutput))).getPageCount()).toBe(17)
  expect((await observations(electronApp)).some(item => item.exitSignal === 'SIGKILL')).toBe(true)

  const disconnectedOutput = join(directory, 'disconnected.pdf')
  await fs.writeFile(disconnectedOutput, 'existing target')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    ;(globalThis as any).__disconnectPdfHelper = true
  }, disconnectedOutput)
  await expect(page.evaluate(() => window.api.exportPDF('<h1>断连</h1>', 'disconnect.md'))).rejects.toThrow('打印进程启动失败')
  expect(readFileSync(disconnectedOutput, 'utf8')).toBe('existing target')
  expect((await observations(electronApp)).at(-1)?.exitCode).toBe(1)

  await electronApp.evaluate(({ dialog }, root) => {
    const path = process.getBuiltinModule('node:path') as typeof import('node:path')
    dialog.showSaveDialog = async (_window: any, options: any) => ({ canceled: false, filePath: path.join(root, options.defaultPath) })
  }, directory)
  const concurrent = await page.evaluate(() => Promise.all([
    window.api.exportPDF('<h1>并发文档A</h1>', 'concurrent-a.md'),
    window.api.exportPDF('<h1>并发文档B</h1>', 'concurrent-b.md'),
  ]))
  expect(concurrent.map(item => item?.filePath).sort()).toEqual([join(directory, 'concurrent-a.pdf'), join(directory, 'concurrent-b.pdf')])
  for (const name of ['concurrent-a.pdf', 'concurrent-b.pdf']) expect((await PDFDocument.load(readFileSync(join(directory, name)))).getPageCount()).toBe(1)

  const timeoutOutput = join(directory, 'timeout.pdf')
  await fs.writeFile(timeoutOutput, 'existing target')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    ;(globalThis as any).__silencePdfStartup = true
  }, timeoutOutput)
  await expect(page.evaluate(() => window.api.exportPDF('<h1>启动无响应</h1>', 'timeout.md'))).rejects.toThrow('导出超时')
  expect(readFileSync(timeoutOutput, 'utf8')).toBe('existing target')
  expect((await observations(electronApp)).at(-1)?.exited).toBe(true)

  const extraWindow = electronApp.waitForEvent('window')
  await page.evaluate(() => window.api.newWindow())
  const owner = await extraWindow
  await owner.waitForSelector('.app')
  const cancelledOutput = join(directory, 'cancelled.pdf')
  await fs.writeFile(cancelledOutput, 'existing target')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    ;(globalThis as any).__holdPdfRequest = true
  }, cancelledOutput)
  const beforeCancel = (await observations(electronApp)).length
  const cancelled = owner.evaluate(() => window.api.exportPDF('<h1>关闭窗口取消</h1>', 'cancel.md')).catch(() => undefined)
  await expect.poll(async () => (await observations(electronApp)).length).toBe(beforeCancel + 1)
  await owner.close()
  await cancelled
  await expect.poll(async () => (await observations(electronApp)).at(-1)?.exited).toBe(true)
  expect(readFileSync(cancelledOutput, 'utf8')).toBe('existing target')
  await electronApp.evaluate(() => { (globalThis as any).__holdPdfRequest = false })
  const finalOutput = join(directory, 'after-cancel.pdf')
  await electronApp.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, finalOutput)
  await page.evaluate(() => window.api.exportPDF('<h1>其它窗口仍可导出</h1>', 'final.md'))
  expect((await PDFDocument.load(readFileSync(finalOutput))).getPageCount()).toBe(1)
  const lifecycle = await observations(electronApp)
  expect(lifecycle.every(item => item.exited && item.concurrentHelpers === 0)).toBe(true)
  await fs.writeFile(join(directory, 'helpers-lifecycle.json'), JSON.stringify(lifecycle, null, 2))
})

test('PDF 大型图表参考库通过真实 GUI 导出完整文档', async ({ page, electronApp, testDir }, testInfo) => {
  test.skip(process.env.MD_VIEWER_PDF_LARGE_REGRESSION !== '1', '大型119页专项单独启用，避免每轮普通交互重复重型打印')
  test.setTimeout(270_000)
  const fs = await import('node:fs/promises')
  const directory = testInfo.outputPath('large')
  await fs.mkdir(directory, { recursive: true })
  const document = join(testDir, 'test-diagram-design.md')
  copyFileSync(join(process.cwd(), 'e2e/fixtures/test-diagram-design.md'), document)
  await observeHelpers(electronApp, directory)
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), document)
  await page.waitForSelector('.markdown-body', { timeout: 20_000 })
  const output = join(directory, 'diagrams.pdf')
  await electronApp.evaluate(({ dialog, BrowserWindow }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:export-pdf')
  }, output)
  await expect.poll(async () => {
    if (existsSync(output)) return 'complete'
    const failure = await page.locator('.toast-error').allTextContents()
    return failure.length ? failure.join('\n') : 'waiting'
  }, { timeout: 240_000 }).toBe('complete')
  const observed = await observations(electronApp)
  await fs.writeFile(join(directory, 'helpers.json'), JSON.stringify(observed, null, 2))
  const doc = await PDFDocument.load(readFileSync(output))
  const packaged = await electronApp.evaluate(({ app }) => app.isPackaged)
  // 旧观测的119页快照遗漏DOCTYPE；双向验证后，安装样式的原标准模式基线为121页。
  // 开发态既有getExportStyles读取源码CSS，标准模式为117页，不改变两条样式选择路径。
  expect(doc.getPageCount()).toBe(packaged ? 121 : 117)
  expect(observed.at(-1)?.operation).toBe('merge')
  const snapshot = readFileSync(join(directory, 'document.html'), 'utf8')
  expect(snapshot.startsWith('<!DOCTYPE html>')).toBe(true)
  const caseIds = (html: string): string[] => [...new Set([...html.matchAll(/id="(md-case-[^"]+)"/g)].map(match => match[1]))].filter(id => id !== 'md-case-...').sort()
  expect(caseIds(snapshot)).toEqual(caseIds(readFileSync(document, 'utf8')))
  expect(caseIds(snapshot)).toHaveLength(129)
  expect(snapshot.match(/<svg\b/g)).toHaveLength(145)
  const pdftotext = '/opt/homebrew/bin/pdftotext'
  if (existsSync(pdftotext)) {
    const headings = await page.evaluate(html => {
      const parsed = new DOMParser().parseFromString(html, 'text/html')
      return [...parsed.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6')]
        .filter(node => !node.closest('svg')).map(node => node.textContent ?? '').filter(Boolean)
    }, snapshot)
    const normalize = (text: string): string => text.normalize('NFKC').replace(/[\s\u200b]/g, '')
    const text = execFileSync(pdftotext, ['-layout', output, '-'], { encoding: 'utf8' })
    const rawText = execFileSync(pdftotext, ['-raw', output, '-'], { encoding: 'utf8' })
    const views = [normalize(text), normalize(rawText)]
    const missing = headings.filter(heading => !views.some(plain => plain.includes(normalize(heading))))
    await fs.writeFile(join(directory, 'text-comparison.json'), JSON.stringify({ headings: headings.length, missing }, null, 2))
    await fs.writeFile(join(directory, 'extracted.txt'), text)
    await fs.writeFile(join(directory, 'extracted-raw.txt'), rawText)
    expect(missing).toEqual([])
  }
  const pdftoppm = '/opt/homebrew/bin/pdftoppm'
  if (existsSync(pdftoppm)) {
    execFileSync(pdftoppm, ['-r', '72', '-png', output, join(directory, 'final')], { stdio: 'pipe' })
    let compared = 0
    let nativeText = ''
    for (const item of observed.filter(item => item.range)) {
      const part = item.messages.find(message => message.type === 'complete')
      if (!part) continue
      const pages = Number(part.pages)
      const name = String(part.file).replace(/\.pdf$/, '')
      if (existsSync(pdftotext)) nativeText += execFileSync(pdftotext, ['-raw', join(directory, String(part.file)), '-'], { encoding: 'utf8' })
      execFileSync(pdftoppm, ['-r', '72', '-png', join(directory, String(part.file)), join(directory, name)], { stdio: 'pipe' })
      for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
        const original = `${name}-${String(pageIndex + 1).padStart(String(pages).length, '0')}.png`
        const final = `final-${String(item.range!.start + pageIndex).padStart(String(doc.getPageCount()).length, '0')}.png`
        expect(readFileSync(join(directory, original)).equals(readFileSync(join(directory, final)))).toBe(true)
        compared++
      }
    }
    expect(compared).toBe(doc.getPageCount())
    if (existsSync(pdftotext)) {
      const mergedText = readFileSync(join(directory, 'extracted-raw.txt'), 'utf8')
      expect(nativeText.replace(/\s+/g, '')).toBe(mergedText.replace(/\s+/g, ''))
    }
    await fs.writeFile(join(directory, 'pixel-comparison.json'), JSON.stringify({ pages: compared, identical: true }))
  }
  await page.screenshot({ path: testInfo.outputPath('large-complete.png') })
  const recoveryOutput = join(directory, 'after-native-failure.pdf')
  await electronApp.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, recoveryOutput)
  await page.evaluate(() => window.api.exportPDF('<h1>原生失败后的正常导出</h1>', 'recovery.md'))
  expect((await PDFDocument.load(readFileSync(recoveryOutput))).getPageCount()).toBe(1)
  const recovered = await observations(electronApp)
  expect(recovered.at(-1)?.operation).toBe('print')
  expect(recovered.at(-1)?.range).toBeUndefined()
  expect(recovered.every(item => item.exited)).toBe(true)
  await fs.writeFile(join(directory, 'helpers-after-recovery.json'), JSON.stringify(recovered, null, 2))
})
