import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'

async function fixtures(app: ElectronApplication, page: Page, dir: string, files: Record<string, string>) {
  writeFileSync(join(dir, 'jsonlines.md'), '# JSON Lines\n\n' + Object.keys(files).map(name => `[${name}](./${name})`).join('\n\n'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  await openFolderViaIPC(app, dir)
  await page.locator('.file-tree-row.file', { hasText: 'jsonlines.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('JSON Lines')
}

async function copyText(page: Page) {
  const editor = page.getByRole('dialog').getByRole('textbox', { name: '只读附件文本' })
  await editor.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  return editor.evaluate(el => {
    const data = new DataTransfer()
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return data.getData('text/plain')
  })
}
const lexemes = (source: string) => source.match(/"(?:[^"\\]|\\[\s\S])*"|[^\s]/g)

test('JSONL/NDJSON默认逐条格式化，原文恢复、复制查找和高亮独立，浅深色窄窗', async ({ electronApp, page, testDir }, testInfo) => {
  const source = '{"shard":"db1","table":"orders","id":9007199254740993123,"id":-0,"n":1.00e+400,"s":"<script>window.linesExecuted=true</script>","indexes":{"PRIMARY":{"unique":true,"columns":[{"column":"id"}]}}}\n{"shard":"db2","table":"items","rows":42}\n'
  await fixtures(electronApp, page, testDir, { 'records.jsonl': source, 'records.ndjson': source })
  const tabs = await page.locator('.tab').count()
  for (const name of ['records.jsonl', 'records.ndjson']) {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('link', { name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    const format = dialog.getByRole('button', { name: '格式化', exact: true })
    await expect(format).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByText(/此视图不再是单行记录格式/)).toBeVisible()
    await expect(dialog.locator('.attachment-token-property').first()).toBeVisible()
    const formatted = await copyText(page)
    expect(formatted).toContain('\n\n{')
    expect(lexemes(formatted)).toEqual(lexemes(source))
    expect(formatted.match(/"shard":/g)).toHaveLength(2)
    await expect(dialog.getByRole('textbox')).toHaveAttribute('contenteditable', 'false')
    await page.keyboard.type('MUST_NOT_WRITE')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
    expect(readFileSync(join(testDir, name), 'utf8')).toBe(source)
    await dialog.getByRole('checkbox', { name: '语法高亮' }).uncheck()
    await expect(dialog.locator('[class*="attachment-token-"]')).toHaveCount(0)
    await dialog.getByRole('button', { name: '原文', exact: true }).click()
    expect(await copyText(page)).toBe(source)
    await expect(dialog.getByText(/此视图不再是单行记录格式/)).toHaveCount(0)
    await format.click()
    expect(await copyText(page)).toBe(formatted)
    await dialog.getByRole('checkbox', { name: '语法高亮' }).check()
    await expect(dialog.locator('.attachment-token-property').first()).toBeVisible()
    await dialog.getByRole('textbox').press('ArrowLeft')
    if (name.endsWith('.jsonl')) {
      await page.screenshot({ path: testInfo.outputPath('jsonlines-formatted-light.png') })
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 800, height: 720 }))
      await page.emulateMedia({ colorScheme: 'dark' })
      const bounds = await dialog.boundingBox()
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
      await page.screenshot({ path: testInfo.outputPath('jsonlines-formatted-dark-narrow.png') })
    }
    await dialog.getByRole('button', { name: /查找/ }).click()
    const search = dialog.locator('.cm-search input[name="search"]')
    await search.pressSequentially('db2')
    await search.press('Enter')
    await expect(dialog.locator('.cm-searchMatch')).toHaveCount(1)
    expect(await page.evaluate(() => (window as any).linesExecuted)).toBeUndefined()
    await expect(dialog.getByRole('textbox').locator('script, img, svg, a')).toHaveCount(0)
    await dialog.getByRole('button', { name: '关闭附件' }).click()
    await expect(page.locator('.tab')).toHaveCount(tabs)
  }
})

test('JSONL/NDJSON任一非法记录或预算超限完整回退，不显示格式化前缀', async ({ electronApp, page, testDir }) => {
  const invalid = '{"ok":1}\n\n{bad}\n{"ok":2}\n'
  const files = { 'bad.jsonl': invalid, 'bad.ndjson': invalid, 'many.jsonl': '0\n'.repeat(10_001),
    'deep.ndjson': '{"ok":1}\n' + '['.repeat(65) + '0' + ']'.repeat(65) }
  await fixtures(electronApp, page, testDir, files)
  for (const [name, source] of Object.entries(files)) {
    await page.getByRole('link', { name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(name.startsWith('bad') ? '第 3 行不是有效 JSON，按原文显示。' : '超过格式化预算，按原文显示。')).toBeVisible()
    expect(await copyText(page)).toBe(source)
    await dialog.getByRole('button', { name: '原文', exact: true }).click()
    await expect(dialog.getByText(/按原文显示。/)).toHaveCount(0)
    expect(await copyText(page)).toBe(source)
    await dialog.getByRole('button', { name: '关闭附件' }).click()
    expect(readFileSync(join(testDir, name), 'utf8')).toBe(source)
  }
})

test('结构化JSONL样例三轮打开格式化、查找末条与关闭性能', async ({ electronApp, page, testDir }, testInfo) => {
  const source = Array.from({ length: 80 }, (_, id) => JSON.stringify({ id, table: `sample_${id}`,
    indexes: { PRIMARY: { unique: true, columns: Array.from({ length: 12 }, (_, position) => ({ position, column: `field_${position}` })) } },
    text: 'x'.repeat(500), last: id === 79 ? 'NEEDLE_JSONLINES_END' : '' })).join('\n') + '\n'
  await fixtures(electronApp, page, testDir, { 'schema.jsonl': source })
  await page.evaluate(() => {
    (window as any).jsonLinesTasks = []
    new PerformanceObserver(list => { (window as any).jsonLinesTasks.push(...list.getEntries().map(entry => entry.duration)) }).observe({ type: 'longtask' })
  })
  const runs: object[] = []
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { (window as any).jsonLinesTasks = [] })
    const start = await page.evaluate(() => performance.now())
    await page.getByRole('link', { name: 'schema.jsonl', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox')).toBeVisible()
    await expect(dialog.getByText(/此视图不再是单行记录格式/)).toBeVisible()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const readable = await page.evaluate(() => performance.now())
    await dialog.getByRole('button', { name: /查找/ }).click()
    const search = dialog.locator('.cm-search input[name="search"]')
    await search.pressSequentially('NEEDLE_JSONLINES_END')
    const findStart = await page.evaluate(() => performance.now())
    await search.press('Enter')
    await expect(dialog.locator('.cm-searchMatch')).toHaveCount(1)
    const found = await page.evaluate(() => performance.now())
    const close = await page.evaluate(() => performance.now())
    await dialog.getByRole('button', { name: '关闭附件' }).click()
    await expect(dialog).toHaveCount(0)
    const closed = await page.evaluate(() => performance.now())
    runs.push({ readableMs: readable - start, searchMs: found - findStart, closeMs: closed - close,
      longTasks: await page.evaluate(() => (window as any).jsonLinesTasks) })
  }
  writeFileSync(testInfo.outputPath('jsonlines-performance.json'), JSON.stringify({ bytes: Buffer.byteLength(source),
    method: '点击到正文/格式说明出现后两次rAF，查找/关闭含自动化往返，不是物理显示器绘制时间。', runs }, null, 2))
  expect(readFileSync(join(testDir, 'schema.jsonl'), 'utf8')).toBe(source)
})
