import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('正文DOM提交不冒充绘制完成，释放原帧后无重读即可就绪', async ({ page, electronApp, testDir }, info) => {
  await openFolderViaIPC(electronApp, testDir)
  const target = join(testDir, 'raf-evidence.md')
  writeFileSync(target, '# Synthetic RAF evidence\n\nFixture body committed before frame callbacks.\n')
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window)
    const cancel = window.cancelAnimationFrame.bind(window)
    const held = new Map<number, FrameRequestCallback>()
    let sequence = 0
    let enabled = true
    ;(window as any).__previewFrameGate = {
      held,
      release() {
        enabled = false
        for (const callback of held.values()) original(callback)
        held.clear()
      },
    }
    window.requestAnimationFrame = callback => {
      if (!enabled) return original(callback)
      const id = --sequence
      held.set(id, callback)
      return id
    }
    window.cancelAnimationFrame = id => {
      if (id < 0) held.delete(id)
      else cancel(id)
    }
  })
  const records = () => electronApp.evaluate(({ app }) => {
    const fs = process.getBuiltinModule('node:fs')!
    const path = process.getBuiltinModule('node:path')!
    const directory = path.join(app.getPath('userData'), 'diagnostic-logs')
    if (!fs.existsSync(directory)) return []
    return fs.readdirSync(directory).filter(name => name.endsWith('.jsonl')).flatMap(name =>
      fs.readFileSync(path.join(directory, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)))
  })
  try {
    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), target)
    await expect.poll(() => page.locator('.markdown-body h1').allTextContents()).toContain('Synthetic RAF evidence')
    await expect.poll(() => page.evaluate(() => (window as any).__previewFrameGate.held.size)).toBeGreaterThan(0)
    // Observe beyond the existing post-render delay without changing production timeouts.
    await page.waitForTimeout(6200)
    const before = await records()
    const starts = before.filter(event => event.event === 'file.open.start')
    const operation = starts[starts.length - 1].operationId
    const related = (events: any[]) => events.filter(event => event.metadata?.relatedOperationId === operation)
    expect(related(before).some(event => event.metadata.previewState === 'dom-committed')).toBe(true)
    expect(related(before).some(event => ['preview-core-ready', 'preview-ready'].includes(event.metadata.previewState))).toBe(false)
    expect(before.some(event => event.operationId === operation && ['file.preview.summary', 'file.open.terminal'].includes(event.event))).toBe(false)
    const dom = await page.evaluate(() => ({
      headings: Array.from(document.querySelectorAll('.markdown-body h1')).map(element => element.textContent),
      visibility: document.visibilityState,
      heldFrames: (window as any).__previewFrameGate.held.size,
    }))
    await page.evaluate(() => (window as any).__previewFrameGate.release())
    await expect.poll(async () => related(await records()).some(event => event.metadata.previewState === 'preview-ready'), { timeout: 15000 }).toBe(true)
    const after = await records()
    expect(after.filter(event => event.event === 'file.open.start')).toHaveLength(starts.length)
    const phases = related(after).map(event => event.metadata.previewState)
    expect(phases.indexOf('dom-committed')).toBeLessThan(phases.indexOf('preview-core-ready'))
    expect(phases.indexOf('preview-core-ready')).toBeLessThan(phases.indexOf('preview-ready'))
    expect((await page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
    await info.attach('dom-frame-observation', {
      body: JSON.stringify({ dom, operation, before: related(before), after: related(after), nativeOsOcclusionReproduced: false }, null, 2),
      contentType: 'application/json',
    })
    await page.screenshot({ path: info.outputPath('dom-frame-ready.png'), animations: 'disabled' })
  } finally {
    await page.evaluate(() => (window as any).__previewFrameGate?.release()).catch(() => {})
  }
})
