import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { _electron as electron } from '@playwright/test'
import { test as base, expect, openFolderViaIPC } from './fixtures/electron'

const executablePath = process.env.MD_VIEWER_PINYIN_EXECUTABLE
const test = executablePath ? base.extend({
  electronApp: async ({ testDir }, use) => {
    const profile = join(testDir, 'packaged-profile')
    const app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${profile}`],
      env: {
        ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1',
        MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs'),
      },
    })
    try { await use(app) } finally { await app.close() }
  },
}) : base

const OUT_DIR = join(process.cwd(), executablePath
  ? '.tmp/folder-history-pinyin-packaged/move'
  : 'test-results/move-to-visual')

test.describe('跨目录移动视觉', () => {
  test('展示最近目录搜索和目标确认', async ({ page, electronApp, testDir }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    const sourceRoot = join(testDir, '当前项目')
    const targetRoot = join(testDir, '知识库归档')
    const targetImports = join(targetRoot, 'imports')
    const sourceIndex = join(sourceRoot, 'index.md')
    const sourceNote = join(sourceRoot, '待归档方案.md')
    const sourceConfig = join(sourceRoot, 'config.md')
    const targetIndex = join(targetRoot, 'index.md')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetImports, { recursive: true })
    writeFileSync(sourceIndex, '# 当前项目\n\n[待归档方案](./待归档方案.md)\n')
    writeFileSync(sourceNote, '# 待归档方案\n\n[原根配置](./config.md)\n')
    writeFileSync(sourceConfig, '# 配置\n')
    writeFileSync(targetIndex, '# 知识库归档\n\n[即将到达](./imports/待归档方案.md)\n')

    const sourceIndexBefore = readFileSync(sourceIndex)
    const sourceNoteBefore = readFileSync(sourceNote)
    const targetIndexBefore = readFileSync(targetIndex)
    const sourceIndexMtimeBefore = statSync(sourceIndex).mtimeMs
    const sourceNoteMtimeBefore = statSync(sourceNote).mtimeMs
    const targetIndexMtimeBefore = statSync(targetIndex).mtimeMs

    await openFolderViaIPC(electronApp, targetRoot)
    await openFolderViaIPC(electronApp, sourceRoot)
    await page.locator('.file-tree-row', { hasText: '待归档方案.md' }).click()
    await electronApp.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('file:move-to-request', {
        path: filePath,
        isDirectory: false,
      })
    }, sourceNote)

    const dialog = page.locator('.move-to-dialog')
    await expect(dialog).toBeVisible()
    const pinyin = dialog.getByRole('checkbox', { name: '拼音搜索' })
    await expect(pinyin).toBeEnabled()
    await pinyin.check()
    await expect(pinyin).toBeEnabled()
    const input = page.getByRole('textbox', { name: '搜索移动目标目录' })
    await input.fill('zhi')
    await expect(dialog.locator('.folder-pinyin-heading')).toContainText('拼音匹配')
    await input.fill('zhishikug')
    await expect(dialog.locator('.folder-pinyin-heading')).toContainText('拼音匹配')
    await dialog.screenshot({ path: join(OUT_DIR, 'move-pinyin-prefix.png') })
    await dialog.locator('.move-to-root-row', { hasText: '知识库归档' }).click()
    await dialog.locator('.move-to-tree-row', { hasText: 'imports' }).click()
    await expect(dialog.locator('.move-to-target')).toContainText('知识库归档/imports')
    await pinyin.uncheck()
    await expect(pinyin).toBeEnabled()
    await expect(dialog.locator('.move-to-root-row', { hasText: '知识库归档' })).toHaveCount(0)
    await expect(dialog.locator('.move-to-target')).toContainText('知识库归档/imports')
    await dialog.screenshot({ path: join(OUT_DIR, 'move-pinyin-selected-target.png') })
    await expect(dialog).toContainText('来源工作区将断开 1 处链接')
    await expect(dialog).toContainText('移动文档将断开 1 处、改变目标 0 处')
    await expect(dialog).toContainText('目标工作区将新增解析 1 处')
    await expect(dialog).toContainText('不会自动修改来源或目标工作区中的任何链接')

    expect(readFileSync(sourceIndex)).toEqual(sourceIndexBefore)
    expect(readFileSync(sourceNote)).toEqual(sourceNoteBefore)
    expect(readFileSync(targetIndex)).toEqual(targetIndexBefore)
    expect(statSync(sourceIndex).mtimeMs).toBe(sourceIndexMtimeBefore)
    expect(statSync(sourceNote).mtimeMs).toBe(sourceNoteMtimeBefore)
    expect(statSync(targetIndex).mtimeMs).toBe(targetIndexMtimeBefore)

    await dialog.getByRole('button', { name: '移动 1 项' }).click()
    await expect(dialog.getByRole('heading', { name: /移动结果/ })).toBeVisible()
    await expect(dialog).toContainText('待归档方案.md')
    await expect(dialog).toContainText('已移动')
    await expect(dialog).toContainText('没有可自动修复的链接')
    expect(existsSync(sourceNote)).toBe(false)
    expect(readFileSync(join(targetImports, '待归档方案.md'))).toEqual(sourceNoteBefore)
    expect(readFileSync(sourceIndex)).toEqual(sourceIndexBefore)
    expect(readFileSync(targetIndex)).toEqual(targetIndexBefore)
    expect(statSync(sourceIndex).mtimeMs).toBe(sourceIndexMtimeBefore)
    expect(statSync(targetIndex).mtimeMs).toBe(targetIndexMtimeBefore)
    await dialog.screenshot({ path: join(OUT_DIR, 'move-to-folder-dialog.png') })
  })
})
