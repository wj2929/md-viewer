import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

test.describe('工作区索引搜索与反向链接', () => {
  test('全文搜索走主进程索引，反链打开来源并定位引用行', async ({ page, electronApp, testDir }, testInfo) => {
    writeFileSync(join(testDir, 'source-link.md'), [
      '# 来源',
      '',
      '普通内容。',
      '',
      '参见 [目标文档](./target-link.md)。',
      '',
      '[独立入口](./target-link.md)',
      '',
      '| 文档 | 说明 |',
      '| --- | --- |',
      '| [目标文档](./target-link.md) | 表格入口 |',
      '',
      '索引搜索唯一标记。',
    ].join('\n'))
    writeFileSync(join(testDir, 'target-link.md'), '# 目标\n\n目标正文。')

    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'target-link.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('目标')

    const backlinksButton = page.getByRole('button', { name: /^链接到这里/ })
    await expect(backlinksButton).toBeVisible({ timeout: 10000 })
    await backlinksButton.click()
    const backlinksPanel = page.getByRole('complementary', { name: '链接到这里' })
    await expect(backlinksPanel).toBeVisible()
    await expect(backlinksPanel.getByText('source-link.md')).toBeVisible({ timeout: 10000 })
    await expect(backlinksPanel.getByText('1 个文档 · 3 处链接')).toBeVisible()
    await expect(backlinksPanel.getByText('参见 目标文档。', { exact: false })).toBeVisible()
    const otherLinks = backlinksPanel.getByRole('button', { name: /其他链接/ })
    await expect(otherLinks).toHaveAttribute('aria-expanded', 'false')
    await expect(backlinksPanel.getByText('独立入口', { exact: true })).toHaveCount(0)
    await expect(backlinksPanel.getByText('表格入口', { exact: true })).toHaveCount(0)
    await expect(backlinksPanel.getByText('根目录')).toHaveCount(1)
    await expect(backlinksPanel.getByText('./target-link.md')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('backlinks-panel.png') })

    await backlinksPanel.getByRole('button', { name: /^打开 source-link.md 第 5 行/ }).click()
    await expect(page.locator('.tab.active')).toContainText('source-link.md')
    await expect(page.locator('.markdown-body h1')).toHaveText('来源')
    await expect(page.getByRole('button', { name: /^链接到这里/ })).toHaveCount(0)

    await page.click('.search-trigger')
    await page.getByText('全文', { exact: true }).click()
    await page.getByRole('button', { name: '搜索全部数据源' }).click()
    await page.getByPlaceholder('搜索当前文件夹...').fill('唯一标记')
    await expect(page.locator('.search-result-item', { hasText: 'source-link.md' })).toBeVisible({ timeout: 10000 })
  })

  test('全部记录搜索应该安全切换目标工作区并定位深层文件', async ({ page, electronApp, testDir }) => {
    const folderA = join(testDir, 'search-root-a')
    const folderB = join(testDir, 'search-root-b')
    const targetDir = join(folderB, 'zz-reveal', 'level-two', 'level-three')
    mkdirSync(folderA, { recursive: true })
    mkdirSync(targetDir, { recursive: true })
    const currentFile = join(folderA, 'current.md')
    const targetFile = join(targetDir, 'history-target.md')
    writeFileSync(currentFile, '# Current Root\n')
    writeFileSync(targetFile, '# History Target\n\n跨工作区定位唯一标记。\n')
    for (let index = 0; index < 60; index += 1) {
      writeFileSync(join(folderB, `aa-history-${String(index).padStart(2, '0')}.md`), `# Filler ${index}\n`)
    }

    await openFolderViaIPC(electronApp, folderB)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })
    const rootFolder = page.locator('.file-tree-row.directory', { hasText: 'zz-reveal' })
    await expect(rootFolder).toHaveAttribute('aria-expanded', 'true')
    await rootFolder.click()
    await expect(rootFolder).toHaveAttribute('aria-expanded', 'false')
    await page.waitForTimeout(400)

    await openFolderViaIPC(electronApp, folderA)
    await expect(page.locator('.nav-folder-path')).toHaveAttribute('title', folderA)
    await page.locator('.file-tree-row.file', { hasText: 'current.md' }).click()

    await page.click('.search-trigger')
    await page.getByText('全文', { exact: true }).click()
    await page.locator('.search-input').fill('跨工作区定位唯一标记')
    const match = page.locator('.search-match-line', { hasText: '跨工作区定位唯一标记' })
    await expect(match).toBeVisible({ timeout: 15000 })
    await match.click()

    await expect(page.locator('.nav-folder-path')).toHaveAttribute('title', folderB, { timeout: 10000 })
    const levelTwo = page.locator('.file-tree-row.directory', { hasText: 'level-two' })
    const levelThree = page.locator('.file-tree-row.directory', { hasText: 'level-three' })
    const targetRow = page.locator('.file-tree-row.file', { hasText: 'history-target.md' })
    await expect(rootFolder).toHaveAttribute('aria-expanded', 'true')
    await expect(levelTwo).toHaveAttribute('aria-expanded', 'true')
    await expect(levelThree).toHaveAttribute('aria-expanded', 'true')
    await expect(targetRow).toHaveClass(/selected/)
    await expect(page.locator('.markdown-body')).toContainText('History Target')
  })

  test('URL 编码文件名中的井号和问号仍可建立反链', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'encoded-source.md'), [
      '# 来源',
      '',
      '[井号目标](./a%23b.md)',
      '[问号目标](./a%3Fb.md)',
    ].join('\n'))
    writeFileSync(join(testDir, 'a#b.md'), '# 井号目标')
    writeFileSync(join(testDir, 'a?b.md'), '# 问号目标')

    await openFolderViaIPC(electronApp, testDir)
    for (const [target, line] of [['a#b.md', 3], ['a?b.md', 4]] as const) {
      await page.locator('.file-tree-row.file', { hasText: target }).click()
      await expect(page.locator('.tab.active')).toContainText(target)
      await page.getByRole('button', { name: /^链接到这里/ }).click()
      const backlinksPanel = page.getByRole('complementary', { name: '链接到这里' })
      await backlinksPanel.getByRole('button', { name: /其他链接/ }).click()
      await expect(backlinksPanel.getByText('encoded-source.md')).toBeVisible({ timeout: 10000 })
      const directLink = backlinksPanel.getByRole('button', {
        name: `打开 encoded-source.md 的独立链接，第 ${line} 行`,
      })
      await expect(directLink).not.toHaveAttribute('aria-expanded')
      await backlinksPanel.getByRole('button', { name: '关闭链接到这里' }).click()
    }
  })
})
