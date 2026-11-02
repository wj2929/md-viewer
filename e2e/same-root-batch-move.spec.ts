import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const names = ['batch-a.md', 'batch-b.md', 'batch-c.md']
async function openBatch(entry: 'drag' | 'move-to', page: Page, electronApp: ElectronApplication, root: string) {
  for (const name of names) {
    const row = page.locator('.file-tree-row.file').filter({ has: page.locator('.file-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}\u0024`) }) })
    await row.click({ modifiers: ['Meta'] })
  }
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
    await electronApp.evaluate(({ BrowserWindow }, file) => {
      BrowserWindow.getAllWindows()[0].webContents.send('file:move-to-request', { path: file, isDirectory: false })
      return true
    }, join(root, names[0]))
    const dialog = page.locator('.move-to-dialog')
    await dialog.locator('.move-to-root-row', { hasText: basename(root) }).click()
    await dialog.locator('.move-to-tree-row', { hasText: 'subfolder' }).click()
  }
  await expect(page.locator('.move-to-dialog').getByRole('button', { name: '移动 3 项' })).toBeEnabled()
}

for (const entry of ['drag', 'move-to'] as const) test(`${entry}同根三项独立移动一次确认全部完成，链接修复另行确认`, async ({ page, electronApp, testDir }, testInfo) => {
  names.forEach((name, index) => writeFileSync(join(testDir, name), index === 1 ? '---\naliases: StableB\n---\n\n# B' : `# Batch ${index}`))
  const reference = '[A](./batch-a.md) 与 [B](./batch-b.md) 与 [C](./batch-c.md)。别名 [[StableB]]。'
  writeFileSync(join(testDir, 'reference.md'), reference)
  await openFolderViaIPC(electronApp, testDir)
  await openBatch(entry, page, electronApp, testDir)
  const dialog = page.locator('.move-to-dialog')
  await dialog.getByRole('button', { name: '移动 3 项' }).click()
  await expect(dialog).toContainText('3 项成功 · 0 项失败')
  await expect(dialog).not.toContainText('未执行')
  names.forEach(name => { expect(existsSync(join(testDir, name))).toBe(false); expect(existsSync(join(testDir, 'subfolder', name))).toBe(true) })
  expect(readFileSync(join(testDir, 'reference.md'), 'utf8')).toBe(reference)
  await expect(dialog.getByRole('button', { name: '查看可更新的链接' })).toBeVisible()
  await dialog.screenshot({ path: testInfo.outputPath(`${entry}-batch-moved.png`) })
  await dialog.getByRole('button', { name: '查看可更新的链接' }).click()
  await dialog.getByRole('button', { name: '更新 1 个文件中的 3 处链接' }).click()
  await expect(dialog).toContainText('已更新 3 处')
  const saved = readFileSync(join(testDir, 'reference.md'), 'utf8')
  names.forEach(name => expect(saved).toContain(`./subfolder/${name}`))
  expect(saved).toContain('[[StableB]]')
})

test('相互依赖的批次保留首项成功并明确暂停剩余项，暗色窄窗不误报失败', async ({ page, electronApp, testDir }, testInfo) => {
  names.forEach(name => writeFileSync(join(testDir, name), name === names[0] ? '# A\n\n[B](./batch-b.md)' : '# Other'))
  await openFolderViaIPC(electronApp, testDir)
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(800, 720); return true })
  await page.getByRole('radio', { name: '暗色主题' }).click()
  await openBatch('drag', page, electronApp, testDir)
  const dialog = page.locator('.move-to-dialog')
  await dialog.getByRole('button', { name: '移动 3 项' }).click()
  await expect(dialog).toContainText('1 项成功 · 0 项失败 · 2 项未执行')
  await expect(dialog).toContainText('请重新预览剩余文件操作')
  expect(existsSync(join(testDir, 'subfolder', names[0]))).toBe(true)
  expect(existsSync(join(testDir, names[0]))).toBe(false)
  for (const name of names.slice(1)) { expect(existsSync(join(testDir, name))).toBe(true); expect(existsSync(join(testDir, 'subfolder', name))).toBe(false) }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await dialog.screenshot({ path: testInfo.outputPath('dependent-batch-paused-dark-800.png') })
})

test('确认前重建索引使旧批次失效，不移动任何文件', async ({ page, electronApp, testDir }) => {
  names.forEach(name => writeFileSync(join(testDir, name), '# Standalone'))
  await openFolderViaIPC(electronApp, testDir)
  await openBatch('drag', page, electronApp, testDir)
  await page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    await window.api.rebuildWorkspaceIndex({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch })
  })
  const dialog = page.locator('.move-to-dialog')
  await dialog.getByRole('button', { name: '移动 3 项' }).click()
  await expect(dialog).toContainText('0 项成功 · 0 项失败 · 3 项未执行')
  await expect(dialog).toContainText('链接索引已变化')
  names.forEach(name => { expect(existsSync(join(testDir, name))).toBe(true); expect(existsSync(join(testDir, 'subfolder', name))).toBe(false) })
})
