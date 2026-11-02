import { test, expect, openFolderViaIPC } from './fixtures/electron'
import type { Page } from '@playwright/test'
import { mkdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

async function operation(page: Page) {
  return page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.primaryRoot)
    if (!workspace) throw new Error('missing fixture workspace')
    return { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
  })
}

async function read(page: Page, target: string) {
  return page.evaluate(async file => {
    try { return { ok: true, text: await window.api.readFile(file) } }
    catch (error) { return { ok: false, error: String(error) } }
  }, target)
}

function document(root: string, name: string, heading: string, padding: number, time: number) {
  const file = join(root, name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `# ${heading}\n\n${'x'.repeat(padding)}`)
  utimesSync(file, time, time)
}

test('普通 Password 文档可点击阅读，目录名不误拦，时间和大小汇总完整', async ({ electronApp, page, testDir }, testInfo) => {
  const root = join(testDir, 'ordinary-documents')
  document(root, '00-control.md', 'Synthetic control', 0, 1000)
  document(root, 'FillPassword.md', 'Synthetic FillPassword', 60, 2000)
  document(root, 'api_FillPassword_review.md', 'Synthetic API review', 120, 3000)
  document(root, 'reset-password-guide.md', 'Synthetic reset guide', 20, 4000)
  document(root, 'AControl/child.md', 'Synthetic group control', 300, 5000)
  document(root, 'PasswordReset/README.md', 'Synthetic reset documentation', 200, 6000)
  document(root, 'PasswordReset/second.md', 'Synthetic second document', 200, 2000)
  await openFolderViaIPC(electronApp, root)
  const topRows = page.locator('.file-tree > .file-tree-item > .file-tree-row .file-name')
  await expect(topRows).toHaveCount(6)

  for (const [name, heading] of [
    ['FillPassword.md', 'Synthetic FillPassword'],
    ['api_FillPassword_review.md', 'Synthetic API review'],
    ['reset-password-guide.md', 'Synthetic reset guide'],
    ['README.md', 'Synthetic reset documentation'],
  ]) {
    const row = page.locator('.file-tree-row.file').filter({ hasText: name })
    if (await row.count() === 0) {
      await page.locator('.file-tree-row.directory').filter({ hasText: 'PasswordReset' }).click()
    }
    await row.click()
    await expect(page.locator('.markdown-body h1')).toHaveText(heading)
  }
  await page.locator('.file-tree-row.file').filter({ hasText: 'api_FillPassword_review.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Synthetic API review')

  await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'size', direction: 'desc' } }))
  await expect(topRows).toHaveText(['PasswordReset', 'AControl', 'api_FillPassword_review.md', 'FillPassword.md', 'reset-password-guide.md', '00-control.md'])
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
  const paths = ['00-control.md', 'FillPassword.md', 'api_FillPassword_review.md', 'reset-password-guide.md', 'AControl/child.md', 'PasswordReset/README.md', 'PasswordReset/second.md']
  const context = await operation(page)
  const metadata = await page.evaluate(({ paths, context }) => window.api.getFileTreeMetadata(paths, context), { paths, context })
  expect(metadata).toEqual(paths.map(relativePath => {
    const info = statSync(join(root, relativePath))
    return { relativePath, value: { size: info.size, mtimeMs: info.mtimeMs } }
  }))
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('ordinary-password-size.png') })

  await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'modified', direction: 'desc' } }))
  await expect(topRows).toHaveText(['PasswordReset', 'AControl', 'reset-password-guide.md', 'api_FillPassword_review.md', 'FillPassword.md', '00-control.md'])
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
  await expect(page.getByText(/无法打开文件：.*fs:readFile/)).toHaveCount(0)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('ordinary-password-modified.png') })
})

test('真实受保护文件仍拒绝且提示准确，属性失败不隐瞒，根外与软链仍隔离', async ({ electronApp, page, testDir }, testInfo) => {
  const root = join(testDir, 'protected-fixtures')
  document(root, '00-control.md', 'Synthetic control', 0, 1000)
  for (const name of ['myPassword.md', '.ssh/FillPassword.md', '.env', 'FillPassword.key']) {
    document(root, name, 'Synthetic protected fixture', 0, 1000)
  }
  const outside = join(testDir, 'unregistered')
  document(outside, 'FillPassword.md', 'Synthetic outside fixture', 0, 1000)
  symlinkSync(join(outside, 'FillPassword.md'), join(root, 'escape.md'))
  symlinkSync(join(root, 'myPassword.md'), join(root, 'alias.md'))
  await openFolderViaIPC(electronApp, root)
  expect((await read(page, join(root, '00-control.md'))).ok).toBe(true)
  for (const name of ['myPassword.md', '.ssh/FillPassword.md', '.env', 'FillPassword.key', 'alias.md']) {
    const result = await read(page, join(root, name))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('受保护')
    expect(result.error).not.toContain('不在任何已授权')
    expect(result.error).not.toContain(root)
  }
  for (const target of [join(outside, 'FillPassword.md'), join(root, 'escape.md')]) {
    const result = await read(page, target)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不在任何已授权')
  }
  const context = await operation(page)
  const metadata = await page.evaluate(context => window.api.getFileTreeMetadata(
    ['myPassword.md', '.ssh/FillPassword.md', 'alias.md', 'escape.md'], context,
  ), context)
  expect(metadata).toEqual(['myPassword.md', '.ssh/FillPassword.md', 'alias.md', 'escape.md'].map(relativePath => ({ relativePath, value: null })))
  expect(JSON.stringify(metadata)).not.toContain(root)

  await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'size', direction: 'desc' } }))
  await expect(page.locator('.file-tree-sort-status')).toContainText('部分文档属性读取失败')
  await page.locator('.file-tree-row.file').filter({ hasText: 'myPassword.md' }).click()
  await expect(page.getByText(/无法打开文件：.*受保护/)).toBeVisible()
  await expect(page.getByText(/无法打开文件：.*不在任何已授权/)).toHaveCount(0)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('protected-path-rejection.png') })
})
