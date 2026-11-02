import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'

async function fixtures(app: ElectronApplication, page: Page, dir: string, files: Record<string, string>) {
  writeFileSync(join(dir, 'sql-format.md'), '# SQL 格式化\n\n' + Object.keys(files).map(name => `[${name}](./${name})`).join('\n\n'))
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source)
  await openFolderViaIPC(app, dir)
  await page.locator('.file-tree-row.file', { hasText: 'sql-format.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('SQL 格式化')
}

const visibleText = (page: Page) => page.getByRole('dialog').locator('.cm-line').allTextContents().then(lines => lines.join('\n'))

test('SQL格式化：默认原文、显式排版、查找复制、原文恢复与高亮独立', async ({ electronApp, page, testDir }, testInfo) => {
  const source = "/* 说明\n   KEEP indent */\nselect o.id, 'it''s <script>window.sqlExecuted=true</script>' as name, -0, 123.4500, 9007199254740993123 from orders o left join users u on u.id=o.user_id where o.id=:id and u.name=?;"
  await fixtures(electronApp, page, testDir, { 'sample.sql': source })
  const tabCount = await page.locator('.tab').count()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByRole('link', { name: 'sample.sql', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const original = dialog.getByRole('button', { name: '原文', exact: true })
  const format = dialog.getByRole('button', { name: '格式化', exact: true })
  await expect(original).toHaveAttribute('aria-pressed', 'true')
  expect(await visibleText(page)).toBe(source)
  await page.evaluate(() => {
    (window as any).sqlFormatLongTasks = []
    ;(window as any).sqlFormatWorkerMs = []
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage(message: any, ...rest: any[]) {
        if (typeof message === 'string') {
          const started = performance.now()
          this.addEventListener('message', () => (window as any).sqlFormatWorkerMs.push(performance.now() - started), { once: true })
        }
        return super.postMessage(message, rest[0])
      }
    }
    new PerformanceObserver(list => {
      (window as any).sqlFormatLongTasks.push(...list.getEntries().map(entry => entry.duration))
    }).observe({ type: 'longtask', buffered: false })
  })
  const start = await page.evaluate(() => performance.now())
  await format.click()
  await expect(dialog.locator('.cm-line')).not.toHaveCount(3)
  await expect(dialog.getByText('SQL 格式化中，暂时显示原文…')).toHaveCount(0)
  await expect(format).toHaveAttribute('aria-pressed', 'true')
  const formatted = await visibleText(page)
  expect(formatted).not.toBe(source)
  expect(formatted).toContain('/* 说明\n   KEEP indent */')
  for (const value of ["'it''s <script>window.sqlExecuted=true</script>'", '-0', '123.4500', '9007199254740993123', ':id', '?']) expect(formatted).toContain(value)
  const editor = dialog.getByRole('textbox', { name: '只读附件文本' })
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  await editor.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  const copied = await editor.evaluate(el => {
    const data = new DataTransfer()
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return data.getData('text/plain')
  })
  expect(copied).toBe(formatted)
  await page.keyboard.type('MUST_NOT_WRITE')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  expect(readFileSync(join(testDir, 'sample.sql'), 'utf8')).toBe(source)
  await dialog.getByRole('checkbox', { name: '语法高亮' }).uncheck()
  await expect(dialog.locator('[class*="attachment-token-"]')).toHaveCount(0)
  await dialog.getByRole('button', { name: /查找/ }).click()
  const search = dialog.locator('.cm-search input[name="search"]')
  await search.pressSequentially('orders')
  await search.press('Enter')
  await expect(dialog.locator('.cm-searchMatch')).toHaveCount(1)
  await search.press('Escape')
  await page.screenshot({ path: testInfo.outputPath('sql-formatted-light.png') })
  await original.click()
  expect(await visibleText(page)).toBe(source)
  await format.click()
  expect(await visibleText(page)).toBe(formatted)
  await dialog.getByRole('checkbox', { name: '语法高亮' }).check()
  await expect(dialog.locator('.attachment-token-keyword').first()).toBeVisible()
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 800, height: 720 }))
  await page.emulateMedia({ colorScheme: 'dark' })
  const bounds = await dialog.boundingBox()
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  await page.screenshot({ path: testInfo.outputPath('sql-formatted-dark-narrow.png') })
  expect(await page.evaluate(() => (window as any).sqlExecuted)).toBeUndefined()
  const elapsed = await page.evaluate(() => performance.now()) - start
  writeFileSync(testInfo.outputPath('format-performance.json'), JSON.stringify({ interactionElapsedMs: elapsed,
    method: '完整格式化/复制/查找/切换交互，含自动化往返；不是单次formatter计时。',
    workerRoundtripMs: await page.evaluate(() => (window as any).sqlFormatWorkerMs),
    longTasks: await page.evaluate(() => (window as any).sqlFormatLongTasks) }, null, 2))
  await dialog.getByRole('button', { name: '关闭附件' }).click()
  await expect(page.locator('.tab')).toHaveCount(tabCount)
})

test('SQL格式化：不支持的方言、数字、过程体和异常结构完整回退', async ({ electronApp, page, testDir }) => {
  const files = {
    'exponent.sql': 'select 1.00e+400;', 'postgres.sql': 'select $$a  b$$;',
    'procedure.sql': 'create procedure p() begin select 1; end;',
    'nested.sql': 'select 1 /* outer /* inner */ outer */;', 'broken.sql': "select 'unclosed",
  }
  await fixtures(electronApp, page, testDir, files)
  for (const [name, source] of Object.entries(files)) {
    await page.getByRole('link', { name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '格式化', exact: true }).click()
    await expect(dialog.getByText('暂不支持可靠格式化此 SQL 结构，按原文显示。')).toBeVisible()
    expect(await visibleText(page)).toBe(source)
    await dialog.getByRole('button', { name: '原文', exact: true }).click()
    await expect(dialog.getByText(/可靠格式化/)).toHaveCount(0)
    await dialog.getByRole('button', { name: '关闭附件' }).click()
    expect(readFileSync(join(testDir, name), 'utf8')).toBe(source)
  }
})

test('SQL格式化：输入和token超预算仍可查找全文与关闭', async ({ electronApp, page, testDir }) => {
  const files = { 'large.sql': 'select 1;\n'.repeat(20_000) + '-- NEEDLE_FORMAT_END',
    'statements.sql': 'select 1;\n'.repeat(2500) + '-- NEEDLE_TOKEN_END' }
  await fixtures(electronApp, page, testDir, files)
  for (const [name, needle] of [['large.sql', 'NEEDLE_FORMAT_END'], ['statements.sql', 'NEEDLE_TOKEN_END']]) {
    await page.getByRole('link', { name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '格式化', exact: true }).click()
    await expect(dialog.getByText('超过 SQL 格式化预算，按原文显示。')).toBeVisible()
    await dialog.getByRole('button', { name: /查找/ }).click()
    const search = dialog.locator('.cm-search input[name="search"]')
    await search.pressSequentially(needle)
    await search.press('Enter')
    await expect(dialog.locator('.cm-searchMatch')).toHaveCount(1)
    await dialog.getByRole('button', { name: '关闭附件' }).click()
    expect(readFileSync(join(testDir, name), 'utf8')).toBe(files[name as keyof typeof files])
  }
})

test('SQL格式化：Worker超时、切原文及关闭终止请求，迟到不闪回', async ({ electronApp, page, testDir }) => {
  const source = 'select 1; -- FORMAT_DELAY_FIXTURE'
  await fixtures(electronApp, page, testDir, { 'delayed.sql': source })
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    ;(window as any).sqlWorkers = { started: 0, terminated: 0 }
    window.Worker = class extends NativeWorker {
      sql = false
      postMessage(message: any, ...rest: any[]) {
        if (typeof message === 'string' && message.includes('FORMAT_DELAY_FIXTURE')) {
          this.sql = true
          ;(window as any).sqlWorkers.started++
          return
        }
        return super.postMessage(message, rest[0])
      }
      terminate() {
        if (this.sql) (window as any).sqlWorkers.terminated++
        super.terminate()
      }
    }
  })
  for (const action of ['timeout', 'original', 'close']) {
    await page.getByRole('link', { name: 'delayed.sql', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '格式化', exact: true }).click()
    await expect(dialog.getByText('SQL 格式化中，暂时显示原文…')).toBeVisible()
    if (action === 'timeout') await expect(dialog.getByText('SQL 格式化未完成，按原文显示。')).toBeVisible()
    else if (action === 'original') await dialog.getByRole('button', { name: '原文', exact: true }).click()
    else await dialog.getByRole('button', { name: '关闭附件' }).click()
    if (action !== 'close') {
      expect(await visibleText(page)).toBe(source)
      await dialog.getByRole('button', { name: '关闭附件' }).click()
    }
    await expect(dialog).toHaveCount(0)
  }
  expect(await page.evaluate(() => (window as any).sqlWorkers)).toEqual({ started: 3, terminated: 3 })
  expect(readFileSync(join(testDir, 'delayed.sql'), 'utf8')).toBe(source)
})
