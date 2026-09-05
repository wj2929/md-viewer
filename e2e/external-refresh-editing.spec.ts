import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

interface ActiveWorkspace {
  id: string
  lifecycleEpoch: number
}

async function getActiveWorkspace(page: Page): Promise<ActiveWorkspace> {
  return page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)
    if (!workspace) throw new Error('missing active workspace')
    return { id: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
  })
}

async function sendChanged(
  electronApp: ElectronApplication,
  page: Page,
  filePath: string,
  workspace: ActiveWorkspace
): Promise<void> {
  const windowId = await page.evaluate(() => window.api.getWindowId())
  await electronApp.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()
      .find(window => window.id === payload.windowId)
      ?.webContents.send('file:changed', {
        workspaceId: payload.workspace.id,
        lifecycleEpoch: payload.workspace.lifecycleEpoch,
        path: payload.filePath,
      })
  }, { windowId, workspace, filePath })
}

async function openEditor(electronApp: ElectronApplication, page: Page, filePath: string): Promise<void> {
  const windowId = await page.evaluate(() => window.api.getWindowId())
  await electronApp.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()
      .find(window => window.id === payload.windowId)
      ?.webContents.send('markdown:quick-edit', {
        filePath: payload.filePath,
        mode: 'document',
      })
  }, { windowId, filePath })
}

test.describe('外部刷新编辑保护', () => {
  test('源码输入仍在防抖窗口时保留输入并进入外部冲突', async ({ page, electronApp, testDir }) => {
    const filePath = join(testDir, 'pending-input.md')
    const original = `# Pending Input\n\n${'x'.repeat(90_000)}`
    writeFileSync(filePath, original)
    await openFolderViaIPC(electronApp, testDir)
    await page.click('.file-tree-row.file:has-text("pending-input.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Pending Input')
    await openEditor(electronApp, page, filePath)

    const workbench = page.getByLabel('pending-input.md 编辑工作区')
    const editor = workbench.locator('.cm-content')
    await expect(workbench).toBeVisible()
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' LOCAL-PENDING')

    const workspace = await getActiveWorkspace(page)
    writeFileSync(filePath, '# External Pending')
    await sendChanged(electronApp, page, filePath, workspace)

    await expect(editor).toContainText('LOCAL-PENDING')
    await expect(workbench.getByText(/磁盘文件已被外部修改/)).toBeVisible()
    expect(readFileSync(filePath, 'utf-8')).toBe('# External Pending')
  })

  test('IME composition 期间外部修改不得覆盖组合输入', async ({ page, electronApp, testDir }) => {
    const filePath = join(testDir, 'ime-input.md')
    writeFileSync(filePath, '# IME Input\n\nOriginal')
    await openFolderViaIPC(electronApp, testDir)
    await page.click('.file-tree-row.file:has-text("ime-input.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('IME Input')
    await openEditor(electronApp, page, filePath)

    const workbench = page.getByLabel('ime-input.md 编辑工作区')
    const editor = workbench.locator('.cm-content')
    await expect(workbench).toBeVisible()
    await editor.click()
    await page.keyboard.press('End')
    await editor.dispatchEvent('compositionstart')
    await page.keyboard.type(' 本地组合输入')

    const workspace = await getActiveWorkspace(page)
    writeFileSync(filePath, '# External IME')
    await sendChanged(electronApp, page, filePath, workspace)

    await expect(editor).toContainText('本地组合输入')
    await expect(workbench.getByText(/磁盘文件已被外部修改/)).toBeVisible()
    await editor.dispatchEvent('compositionend')
    expect(readFileSync(filePath, 'utf-8')).toBe('# External IME')
  })

  test('保存进行中发生外部修改时不覆盖外部版本并保留草稿', async ({ page, electronApp, testDir }) => {
    const filePath = join(testDir, 'save-in-flight.md')
    writeFileSync(filePath, '# Save In Flight\n\nOriginal')
    await openFolderViaIPC(electronApp, testDir)
    await page.click('.file-tree-row.file:has-text("save-in-flight.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Save In Flight')
    await openEditor(electronApp, page, filePath)

    const workbench = page.getByLabel('save-in-flight.md 编辑工作区')
    const editor = workbench.locator('.cm-content')
    await expect(workbench).toBeVisible()
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type('\nLocal save draft')
    await expect(workbench.getByRole('button', { name: '保存修改' })).toBeEnabled()
    await page.evaluate(() => window.api.testSetEditableSaveDelay?.(1000))

    await workbench.getByRole('button', { name: '保存修改' }).click()
    await expect(workbench.getByRole('button', { name: '保存修改' })).toHaveText('保存中...')

    const workspace = await getActiveWorkspace(page)
    writeFileSync(filePath, '# External During Save')
    await sendChanged(electronApp, page, filePath, workspace)

    await expect(editor).toContainText('Local save draft')
    await expect(workbench.getByText(/磁盘文件已被外部修改|磁盘文件版本已变化/)).toBeVisible()
    await page.waitForTimeout(1200)
    expect(readFileSync(filePath, 'utf-8')).toBe('# External During Save')
    await page.evaluate(() => window.api.testSetEditableSaveDelay?.(0))
  })
})
