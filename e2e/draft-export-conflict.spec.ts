import { readFileSync, writeFileSync, existsSync, utimesSync } from 'fs'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

async function prepareDraft(app: ElectronApplication, page: Page, root: string) {
  const file = join(root, 'findings-example.md')
  const output = join(root, 'export.html')
  const original = '# Findings Example\n\nOriginal content'
  writeFileSync(file, original)
  await openFolderViaIPC(app, root)
  await page.click('.file-tree-row.file:has-text("findings-example.md")')
  await expect(page.locator('.markdown-body h1')).toHaveText('Findings Example')
  await app.evaluate(({ BrowserWindow, dialog }, { file, output }) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output })
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:quick-edit', { filePath: file, mode: 'document' })
    return true
  }, { file, output })
  const workbench = page.getByLabel('findings-example.md 编辑工作区')
  await expect(workbench).toBeVisible()
  await workbench.locator('.cm-content').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.type('\nLOCAL-DRAFT-ONLY')
  await expect(workbench.getByRole('button', { name: '保存修改' })).toBeEnabled()
  await workbench.getByRole('tab', { name: '预览', exact: true }).click()
  await expect(workbench).toBeHidden()
  return { file, output, original, workbench }
}

async function exportHtml(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:export-html')
    return true
  })
}

function confirmSave(page: Page) {
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('是否先保存并继续导出')
    await dialog.accept()
  })
}

for (const metadataOnly of [false, true]) {
  test(`草稿正常保存后导出，元数据变化=${metadataOnly}`, async ({ page, electronApp, testDir }) => {
    const { file, output } = await prepareDraft(electronApp, page, testDir)
    if (metadataOnly) {
      const now = new Date()
      utimesSync(file, now, now)
    }
    confirmSave(page)
    await exportHtml(electronApp)
    await expect.poll(() => existsSync(output)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('LOCAL-DRAFT-ONLY')
    expect(readFileSync(output, 'utf8')).toContain('LOCAL-DRAFT-ONLY')
  })
}

for (const format of ['pdf', 'docx'] as const) {
  test(`${format} 导出同样保留冲突草稿并打开编辑入口`, async ({ page, electronApp, testDir }) => {
    const { file, output, workbench } = await prepareDraft(electronApp, page, testDir)
    const external = '# External Version\n\nEXTERNAL-CHANGE'
    writeFileSync(file, external)
    confirmSave(page)
    await electronApp.evaluate(({ BrowserWindow }, format) => {
      BrowserWindow.getAllWindows()[0].webContents.send(`markdown:export-${format}`)
      return true
    }, format)
    await expect(workbench).toBeVisible()
    await expect(workbench.getByText('保存冲突', { exact: true })).toBeVisible()
    await expect(workbench.locator('.cm-content')).toContainText('LOCAL-DRAFT-ONLY')
    expect(readFileSync(file, 'utf8')).toBe(external)
    expect(existsSync(output)).toBe(false)
  })
}

for (const resolution of ['overwrite', 'reload'] as const) {
  test(`导出遇版本冲突时显露编辑入口，确认后${resolution}并重新导出`, async ({ page, electronApp, testDir }, testInfo) => {
    const { file, output, workbench } = await prepareDraft(electronApp, page, testDir)
    const external = '# External Version\n\nEXTERNAL-CHANGE'
    writeFileSync(file, external)
    confirmSave(page)
    await exportHtml(electronApp)
    await expect(workbench).toBeVisible()
    await expect(workbench.getByText('保存冲突', { exact: true })).toBeVisible()
    await expect(workbench.locator('.cm-content')).toContainText('LOCAL-DRAFT-ONLY')
    expect(readFileSync(file, 'utf8')).toBe(external)
    expect(existsSync(output)).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('conflict-recovery.png') })

    const action = resolution === 'overwrite' ? '保存并覆盖' : '重新载入'
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain(resolution === 'overwrite' ? '覆盖' : '丢弃')
      await dialog.dismiss()
    })
    await workbench.getByRole('button', { name: action, exact: true }).click()
    expect(readFileSync(file, 'utf8')).toBe(external)
    await expect(workbench.locator('.cm-content')).toContainText('LOCAL-DRAFT-ONLY')

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain(resolution === 'overwrite' ? '覆盖' : '丢弃')
      await dialog.accept()
    })
    await workbench.getByRole('button', { name: action, exact: true }).click()
    await expect(workbench.getByText('保存冲突', { exact: true })).toBeHidden()
    await expect(workbench.getByRole('button', { name: '保存修改' })).toBeDisabled()
    if (resolution === 'overwrite') expect(readFileSync(file, 'utf8')).toContain('LOCAL-DRAFT-ONLY')
    else {
      expect(readFileSync(file, 'utf8')).toBe(external)
      await expect(workbench.locator('.cm-content')).not.toContainText('LOCAL-DRAFT-ONLY')
    }
    await workbench.getByRole('tab', { name: '预览', exact: true }).click()
    await exportHtml(electronApp)
    await expect.poll(() => existsSync(output)).toBe(true)
    expect(readFileSync(output, 'utf8')).toContain(resolution === 'overwrite' ? 'LOCAL-DRAFT-ONLY' : 'EXTERNAL-CHANGE')
    await page.screenshot({ path: testInfo.outputPath('resolved-export.png') })
  })
}
