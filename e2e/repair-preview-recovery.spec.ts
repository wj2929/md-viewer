import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const names = ['recover-a.md', 'recover-b.md', 'recover-c.md']
const reference = names.map(name => `[${name}](./${name})`).join('\n')

async function prepare(entry: 'drag' | 'move-to', page: Page, app: ElectronApplication, root: string) {
  names.forEach(name => writeFileSync(join(root, name), '# Recovery fixture'))
  writeFileSync(join(root, 'references.md'), reference)
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: any[]) => any> })._invokeHandlers
    const state = { moves: 0, previews: 0, applies: 0 }
    ;(globalThis as any).__repairRecoveryTest = state
    for (const channel of ['link-rewrite:executeBatch', 'link-rewrite:createRepairPlan', 'link-rewrite:applyBatch']) {
      const original = handlers.get(channel)
      if (!original) throw new Error('Missing recovery test handler: ' + channel)
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args: any[]) => {
        if (channel === 'link-rewrite:executeBatch') state.moves++
        if (channel === 'link-rewrite:applyBatch') state.applies++
        if (channel === 'link-rewrite:createRepairPlan' && ++state.previews <= 3) {
          // Deterministic UI fault injection; later attempts call the real planner with original receipts.
          throw new Error('链接索引已变化，请重新预览文件操作')
        }
        return original(...args)
      })
    }
    return true
  })
  await openFolderViaIPC(app, root)
  for (const name of names) await page.locator('.file-tree-row.file').filter({ has: page.locator('.file-name', { hasText: name }) }).click({ modifiers: ['Meta'] })
  await expect(page.locator('.file-tree-row.multi-selected')).toHaveCount(3)
  if (entry === 'drag') {
    await page.evaluate(name => {
      const rows = Array.from(document.querySelectorAll('.file-tree-row'))
      const source = rows.find(row => row.querySelector('.file-name')?.textContent === name)!
      const target = rows.find(row => row.querySelector('.file-name')?.textContent === 'subfolder')!
      const dataTransfer = new DataTransfer()
      for (const [node, type] of [[source, 'dragstart'], [target, 'dragover'], [target, 'drop'], [source, 'dragend']] as const) {
        node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
      }
    }, names[0])
  } else {
    await app.evaluate(({ BrowserWindow }, file) => {
      BrowserWindow.getAllWindows()[0].webContents.send('file:move-to-request', { path: file, isDirectory: false })
      return true
    }, join(root, names[0]))
    const dialog = page.locator('.move-to-dialog')
    await dialog.locator('.move-to-root-row', { hasText: basename(root) }).click()
    await dialog.locator('.move-to-tree-row', { hasText: 'subfolder' }).click()
  }
  const dialog = page.locator('.move-to-dialog')
  await dialog.getByRole('button', { name: '移动 3 项' }).click()
  await expect(dialog).toContainText('3 项成功 · 0 项失败')
  await expect(dialog).toContainText('链接索引已变化，请重新预览文件操作')
  await expect(dialog).not.toContainText('Error invoking remote method')
  await expect(dialog.getByRole('button', { name: '重新生成链接修复预览' })).toBeEnabled()
  expect(readFileSync(join(root, 'references.md'), 'utf8')).toBe(reference)
  expect(await app.evaluate(() => (globalThis as any).__repairRecoveryTest)).toEqual({ moves: 1, previews: 3, applies: 0 })
  names.forEach(name => { expect(existsSync(join(root, name))).toBe(false); expect(existsSync(join(root, 'subfolder', name))).toBe(true) })
  return dialog
}

for (const entry of ['drag', 'move-to'] as const) {
  test(`${entry}预览失效后手动恢复，只重算预览且链接更新仍需确认`, async ({ page, electronApp, testDir }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(800, 720); return true })
    await page.getByRole('radio', { name: '暗色主题' }).click()
    const dialog = await prepare(entry, page, electronApp, testDir)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const bounds = await dialog.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client)
    await dialog.screenshot({ path: testInfo.outputPath(`${entry}-recovery-required-dark-800.png`) })
    await dialog.getByRole('button', { name: '重新生成链接修复预览' }).click()
    await expect(dialog.getByRole('button', { name: '查看可更新的链接' })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: '重新生成链接修复预览' })).toHaveCount(0)
    expect(await electronApp.evaluate(() => (globalThis as any).__repairRecoveryTest)).toEqual({ moves: 1, previews: 6, applies: 0 })
    expect(readFileSync(join(testDir, 'references.md'), 'utf8')).toBe(reference)
    await dialog.screenshot({ path: testInfo.outputPath(`${entry}-recovery-ready-dark-800.png`) })
    await dialog.getByRole('button', { name: '查看可更新的链接' }).click()
    await dialog.getByRole('button', { name: '更新 1 个文件中的 3 处链接' }).click()
    await expect(dialog).toContainText('已更新 3 处')
    const saved = readFileSync(join(testDir, 'references.md'), 'utf8')
    names.forEach(name => expect(saved).toContain(`./subfolder/${name}`))
    expect(await electronApp.evaluate(() => (globalThis as any).__repairRecoveryTest)).toEqual({ moves: 1, previews: 6, applies: 1 })
  })

  test(`${entry}恢复时真实回执已过期仍拒绝，不再移动或修改正文`, async ({ page, electronApp, testDir }) => {
    const dialog = await prepare(entry, page, electronApp, testDir)
    await electronApp.evaluate(() => {
      const now = Date.now
      Date.now = () => now() + 301_000
      return true
    })
    await dialog.getByRole('button', { name: '重新生成链接修复预览' }).click()
    await expect(dialog).toContainText('文件操作回执无效或已过期')
    await expect(dialog).toContainText('3 项成功 · 0 项失败')
    await expect(dialog.getByRole('button', { name: '查看可更新的链接' })).toHaveCount(0)
    expect(readFileSync(join(testDir, 'references.md'), 'utf8')).toBe(reference)
    expect(await electronApp.evaluate(() => (globalThis as any).__repairRecoveryTest)).toEqual({ moves: 1, previews: 6, applies: 0 })
  })
}
