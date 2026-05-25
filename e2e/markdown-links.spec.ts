import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'path'
import { writeFileSync } from 'fs'

async function openMarkdownEditViaIPC(
  electronApp: Parameters<typeof openFolderViaIPC>[0],
  filePath: string,
  leafId?: string
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, params) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('markdown:quick-edit', {
      filePath: params.filePath,
      mode: 'document',
      leafId: params.leafId,
    })
  }, { filePath, leafId })
}

test.describe('Markdown 链接交互', () => {
  test('内部 .md 链接在未保存草稿时应先确认再跳转', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'link-source.md'), [
      '# Link Source',
      '',
      '[打开目标](./link-target.md#目标章节)',
      '',
      '可编辑正文',
    ].join('\n'))
    writeFileSync(join(testDir, 'link-target.md'), [
      '# Link Target',
      '',
      '## 目标章节',
      '',
      '目标内容',
    ].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("link-source.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Link Source')

    await openMarkdownEditViaIPC(electronApp, join(testDir, 'link-source.md'))
    await expect(page.getByLabel('link-source.md 编辑工作区')).toBeVisible()

    const paragraph = page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', {
      hasText: '可编辑正文',
    })
    await paragraph.fill('未保存草稿正文')
    await page.getByRole('button', { name: '退出编辑模式' }).click()
    await expect(page.getByLabel('link-source.md 编辑工作区')).toBeHidden()
    await expect(page.getByText('草稿预览，未保存')).toBeVisible()

    const link = page.locator('.preview-pane .markdown-body a', { hasText: '打开目标' })
    await expect(link).toBeVisible()

    let dialogCount = 0
    page.once('dialog', async dialog => {
      dialogCount += 1
      expect(dialog.message()).toContain('当前文档有未保存编辑草稿')
      await dialog.dismiss()
    })
    await link.click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Link Source')
    expect(dialogCount).toBe(1)

    page.once('dialog', async dialog => {
      dialogCount += 1
      expect(dialog.message()).toContain('当前文档有未保存编辑草稿')
      await dialog.accept()
    })
    await link.click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Link Target')
    await expect(page.locator('.markdown-body h2', { hasText: '目标章节' })).toBeVisible()
    expect(dialogCount).toBe(2)
  })

  test('内部 .md 链接支持中文和空格文件名', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'link-cn-source.md'), [
      '# 中文链接源',
      '',
      '[打开中文目标](<./目标 文档.md#二级标题>)',
    ].join('\n'))
    writeFileSync(join(testDir, '目标 文档.md'), [
      '# 中文目标',
      '',
      '## 二级标题',
      '',
      '目标内容',
    ].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("link-cn-source.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('中文链接源')

    await page.locator('.preview-pane .markdown-body a', { hasText: '打开中文目标' }).click()

    await expect(page.locator('.markdown-body h1')).toHaveText('中文目标')
    await expect(page.locator('.markdown-body h2', { hasText: '二级标题' })).toBeVisible()
  })

  test('正文目录中的页内锚点链接应滚动到对应标题', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'toc-source.md'), [
      '# 目录测试',
      '',
      '## 目录',
      '',
      '1. [总览：三平台兼容性矩阵](#1-总览三平台兼容性矩阵)',
      '2. [窗口布局差异（ASCII 线框图）](#2-窗口布局差异ascii-线框图)',
      '',
      ...Array.from({ length: 80 }, (_, index) => `前置内容 ${index + 1}`),
      '',
      '## 1. 总览：三平台兼容性矩阵',
      '',
      '目标章节内容',
      '',
      ...Array.from({ length: 20 }, (_, index) => `后置内容 ${index + 1}`),
      '',
      '## 2. 窗口布局差异（ASCII 线框图）',
      '',
      '第二个目标章节内容',
    ].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("toc-source.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('目录测试')

    const preview = page.locator('.preview')
    await expect(preview).toBeVisible()
    await expect(preview.locator('h2', { hasText: '1. 总览：三平台兼容性矩阵' })).not.toBeInViewport()

    await page.locator('.preview-pane .markdown-body a', { hasText: '总览：三平台兼容性矩阵' }).click()

    await expect(preview.locator('h2', { hasText: '1. 总览：三平台兼容性矩阵' })).toBeInViewport()
  })
})
