import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ElectronApplication, Page } from '@playwright/test'

async function fixtures(app: ElectronApplication, page: Page, dir: string, files: Record<string, string>) {
  writeFileSync(join(dir, 'highlight.md'), '# 附件高亮\n\n' + Object.keys(files).map(name => `[${name}](./${name})`).join('\n\n'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  await openFolderViaIPC(app, dir)
  await page.locator('.file-tree-row.file', { hasText: 'highlight.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('附件高亮')
}

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

test('附件SQL高亮：开关、查找、复制和只读，浅深色与窄窗', async ({ electronApp, page, testDir }, testInfo) => {
  const sql = "-- 订单查询：只用于测试\nSELECT id, '已完成' AS status, 42 AS total\nFROM orders WHERE enabled = true;\n"
  await fixtures(electronApp, page, testDir, { 'sample.sql': sql })
  const tabCount = await page.locator('.tab').count()
  const before = hash(join(testDir, 'sample.sql'))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByRole('link', { name: 'sample.sql', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const editor = dialog.getByRole('textbox', { name: '只读附件文本' })
  const toggle = dialog.getByRole('checkbox', { name: '语法高亮' })
  await expect(toggle).toBeChecked()
  await expect(dialog.locator('.attachment-token-keyword').first()).toBeVisible()
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  expect(await dialog.locator('.attachment-token-keyword').first().evaluate(el => getComputedStyle(el).color))
    .not.toBe(await dialog.locator('.attachment-token-string').first().evaluate(el => getComputedStyle(el).color))
  await page.screenshot({ path: testInfo.outputPath('attachment-sql-light.png') })
  await editor.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  const copied = await editor.evaluate(el => {
    const data = new DataTransfer()
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return data.getData('text/plain')
  })
  expect(copied).toBe(sql)
  await page.keyboard.type('SHOULD_NOT_CHANGE')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  await expect(dialog).toBeVisible()
  expect(hash(join(testDir, 'sample.sql'))).toBe(before)
  await dialog.getByRole('button', { name: /查找/ }).click()
  const search = dialog.locator('.cm-search input[name="search"]')
  await search.pressSequentially('orders')
  await search.press('Enter')
  await expect(dialog.locator('.cm-searchMatch')).toHaveCount(1)
  await toggle.uncheck()
  await expect(dialog.locator('[class*="attachment-token-"]')).toHaveCount(0)
  await expect(search).toHaveValue('orders')
  await toggle.check()
  await expect(dialog.locator('.attachment-token-keyword').first()).toBeVisible()
  await expect(search).toHaveValue('orders')
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 800, height: 720 }))
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  await page.screenshot({ path: testInfo.outputPath('attachment-sql-dark-narrow.png') })
  await search.press('Escape')
  await expect(dialog.locator('.cm-search')).toHaveCount(0)
  await editor.press('Escape')
  await expect(dialog).toBeVisible()
  await editor.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'sample.sql', exact: true })).toBeFocused()
  await expect(page.locator('.tab')).toHaveCount(tabCount)
})

test('附件JSON保真格式化与高亮独立，JSONL逐条着色', async ({ electronApp, page, testDir }, testInfo) => {
  const json = String.raw`{"id":9007199254740993123,"id":-0,"n":1.00e+400,"text":"<script>window.attachmentExecuted=true</script>"}`
  const jsonl = '{"id":1,"name":"first"}\n{"id":2,"name":"second"}\n'
  await fixtures(electronApp, page, testDir, { 'sample.json': json, 'records.jsonl': jsonl })
  await page.getByRole('link', { name: 'sample.json', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.attachment-token-property').first()).toBeVisible()
  await expect(dialog.locator('.attachment-token-number', { hasText: '9007199254740993123' })).toBeVisible()
  await dialog.getByRole('button', { name: '原文', exact: true }).click()
  await expect(dialog.locator('.cm-line')).toHaveCount(1)
  expect(await dialog.locator('.cm-line').innerText()).toBe(json)
  await dialog.getByRole('checkbox', { name: '语法高亮' }).uncheck()
  await dialog.getByRole('button', { name: '格式化', exact: true }).click()
  await expect(dialog.locator('[class*="attachment-token-"]')).toHaveCount(0)
  await expect(dialog.getByRole('textbox')).toContainText('9007199254740993123')
  await expect(dialog.getByRole('textbox')).toContainText('1.00e+400')
  await dialog.getByRole('checkbox', { name: '语法高亮' }).check()
  await expect(dialog.locator('.attachment-token-property').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('attachment-json-formatted.png') })
  await dialog.getByRole('button', { name: '关闭附件' }).click()
  await page.getByRole('link', { name: 'records.jsonl', exact: true }).click()
  await expect(dialog.locator('.attachment-token-number')).toHaveCount(2)
  await expect(dialog.getByRole('button', { name: '格式化', exact: true })).toBeVisible()
  expect(readFileSync(join(testDir, 'sample.json'), 'utf8')).toBe(json)
  expect(readFileSync(join(testDir, 'records.jsonl'), 'utf8')).toBe(jsonl)
  expect(await page.evaluate(() => (window as any).attachmentExecuted)).toBeUndefined()
})

test('附件YAML/XML/HTML/SVG只高亮源码，TXT不猜测语言，不发起外部请求', async ({ electronApp, page, testDir }, testInfo) => {
  const files = {
    'sample.yaml': 'name: "测试"\ncount: 42\n# 保留注释\n',
    'sample.xml': '<root name="测试"><item>正文</item></root>',
    'sample.html': '<script>window.attachmentExecuted=true</script><img src="https://example.invalid/pixel">',
    'sample.svg': '<svg xmlns="http://www.w3.org/2000/svg" onload="window.attachmentExecuted=true"><text>测试</text></svg>',
    'sample.txt': 'SELECT 42; 普通文本不猜测语言。',
  }
  await fixtures(electronApp, page, testDir, files)
  const attempted: string[] = []
  await page.route(/^https?:/, async route => { attempted.push(route.request().url()); await route.abort() })
  for (const [name, content] of Object.entries(files)) {
    await page.getByRole('link', { name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    const editor = dialog.getByRole('textbox', { name: '只读附件文本' })
    await expect(editor).toBeVisible()
    if (name.endsWith('.txt')) await expect(dialog.getByRole('checkbox', { name: '语法高亮' })).toHaveCount(0)
    else await expect(dialog.locator('[class*="attachment-token-"]').first()).toBeVisible()
    await expect(editor.locator('script, img, svg, a')).toHaveCount(0)
    if (name.endsWith('.yaml') || name.endsWith('.xml')) await page.screenshot({ path: testInfo.outputPath(`attachment-${name}.png`) })
    await dialog.getByRole('button', { name: '关闭附件' }).click()
    expect(readFileSync(join(testDir, name), 'utf8')).toBe(content)
  }
  expect(await page.evaluate(() => (window as any).attachmentExecuted)).toBeUndefined()
  expect(attempted).toEqual([])
})

test('大SQL与长行回退纯文本，全文可查找且关闭保持响应', async ({ electronApp, page, testDir }, testInfo) => {
  test.setTimeout(60_000)
  const files = {
    'large.sql': 'SELECT 1 AS value; -- fixture\n'.repeat(110_000) + '-- NEEDLE_END_SQL',
    'long.sql': 'SELECT ' + 'x'.repeat(32 * 1024) + ' AS NEEDLE_LONG_SQL;',
  }
  await fixtures(electronApp, page, testDir, files)
  const runs: object[] = []
  for (const [name, needle] of [['large.sql', 'NEEDLE_END_SQL'], ['long.sql', 'NEEDLE_LONG_SQL']]) {
    const start = await page.evaluate(() => performance.now())
    await page.getByRole('link', { name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: '语法高亮' })).toBeDisabled()
    await expect(dialog.locator('[class*="attachment-token-"]')).toHaveCount(0)
    const readable = await page.evaluate(() => performance.now())
    await dialog.getByRole('button', { name: /查找/ }).click()
    const search = dialog.locator('.cm-search input[name="search"]')
    await search.pressSequentially(needle)
    const queryStart = await page.evaluate(() => performance.now())
    await search.press('Enter')
    await expect(dialog.locator('.cm-searchMatch')).toHaveCount(1)
    const found = await page.evaluate(() => performance.now())
    const close = await page.evaluate(() => performance.now())
    await dialog.getByRole('button', { name: '关闭附件' }).click()
    await expect(dialog).toHaveCount(0)
    const closed = await page.evaluate(() => performance.now())
    runs.push({ name, readableMs: readable - start, searchMs: found - queryStart, closeMs: closed - close })
  }
  writeFileSync(testInfo.outputPath('sql-performance.json'), JSON.stringify({ method: '含Playwright往返开销，不等同物理显示器绘制。', runs }, null, 2))
})
