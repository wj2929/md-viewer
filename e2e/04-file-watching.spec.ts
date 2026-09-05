import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { mkdirSync, writeFileSync, rmSync, appendFileSync, unlinkSync, renameSync } from 'fs'
import { join } from 'path'

/**
 * E2E 测试 4: 文件监听功能 (v1.1 核心功能)
 * 验证文件修改、添加、删除时的自动刷新
 */

let testDir: string

test.beforeEach(() => {
  // 主进程 watcher 会拒绝层级过浅的目录；这里使用更深的临时目录，
  // 让 E2E 覆盖真实文件监听链路，而不是被安全策略提前拦截。
  testDir = join(process.cwd(), '.tmp', 'e2e', 'file-watching', `case-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'watch-test.md'), '# Original Content\n\nInitial text')
})

test.afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test.describe('文件监听功能测试 (v1.1)', () => {
  test('应该在文件修改时自动刷新标签页内容', async ({ page, electronApp }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证初始内容
    await expect(page.locator('.markdown-body h1')).toHaveText('Original Content')

    // 修改文件
    writeFileSync(join(testDir, 'watch-test.md'), '# Updated Content\n\nModified text')

    // 等待自动刷新（最多 3 秒）
    await page.waitForTimeout(3000)

    // 验证内容已更新
    await expect(page.locator('.markdown-body h1')).toHaveText('Updated Content')
    await expect(page.locator('.markdown-body p')).toHaveText('Modified text')
  })

  test('应该在文件添加时刷新文件树', async ({ page, electronApp }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    // 记录初始文件数量
    const initialCount = await page.locator('.file-tree-row.file').count()

    // 添加新文件
    writeFileSync(join(testDir, 'new-file.md'), '# New File\n\nNew content')

    // 等待文件树刷新（最多 3 秒）
    await page.waitForTimeout(3000)

    // 验证文件树增加了新文件
    const newCount = await page.locator('.file-tree-row.file').count()
    expect(newCount).toBe(initialCount + 1)

    // 验证新文件可见
    await expect(page.locator('.file-tree-row.file', { hasText: 'new-file.md' })).toBeVisible()
  })

  test('应该在文件删除时保留缺失标签，并在同路径重建后恢复', async ({ page, electronApp }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证标签页打开
    await expect(page.locator('.tab', { hasText: 'watch-test.md' })).toBeVisible()

    // 删除文件
    unlinkSync(join(testDir, 'watch-test.md'))

    // 等待缺失占位和文件树刷新
    await expect(page.getByText('文件已被删除或暂时不可访问')).toBeVisible()

    // 标签和分屏上下文必须保留，文件树则移除磁盘上已不存在的文件
    await expect(page.locator('.tab', { hasText: 'watch-test.md' })).toBeVisible()
    await expect(page.locator('.file-tree-row.file', { hasText: 'watch-test.md' })).not.toBeVisible()

    // 同路径重建后自动恢复原标签
    writeFileSync(join(testDir, 'watch-test.md'), '# Recreated Content')
    await expect(page.locator('.markdown-body h1')).toHaveText('Recreated Content')
    await expect(page.getByText('文件已被删除或暂时不可访问')).not.toBeVisible()
  })

  test('应该在快速连续修改时正确处理', async ({ page, electronApp }) => {
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 快速连续修改 5 次
    for (let i = 1; i <= 5; i++) {
      writeFileSync(join(testDir, 'watch-test.md'), `# Version ${i}\n\nContent ${i}`)
      await page.waitForTimeout(500)
    }

    // 等待最后一次更新
    await page.waitForTimeout(3000)

    // 验证显示最新内容
    await expect(page.locator('.markdown-body h1')).toHaveText('Version 5')
    await expect(page.locator('.markdown-body p')).toHaveText('Content 5')
  })

  test('应该正确处理子目录中的文件变化', async ({ page, electronApp }) => {
    // 创建子目录和文件
    mkdirSync(join(testDir, 'subfolder'))
    writeFileSync(join(testDir, 'subfolder', 'nested.md'), '# Nested File')

    await openFolderViaIPC(electronApp, testDir)
    await expect(page.locator('.file-tree-row.directory:has-text("subfolder")')).toBeVisible()
    await page.click('.file-tree-row.file:has-text("nested.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Nested File')

    // 修改子目录中的文件
    writeFileSync(join(testDir, 'subfolder', 'nested.md'), '# Modified Nested File')

    await expect(page.locator('.markdown-body h1')).toHaveText('Modified Nested File')
  })

  test('应该监听主动选择的隐藏祖先目录根', async ({ page, electronApp }) => {
    const hiddenRoot = join(process.cwd(), '.tmp', 'e2e', '.claude', 'plans', `case-${Date.now()}`)
    const hiddenFile = join(hiddenRoot, 'bubbly-puzzling-pearl.md')
    mkdirSync(hiddenRoot, { recursive: true })
    writeFileSync(hiddenFile, '# Hidden Root Original')

    try {
      await openFolderViaIPC(electronApp, hiddenRoot)
      await expect(page.locator('.markdown-body h1')).toHaveText('Hidden Root Original')

      writeFileSync(hiddenFile, '# Hidden Root Updated')

      await expect(page.locator('.markdown-body h1')).toHaveText('Hidden Root Updated')
    } finally {
      rmSync(hiddenRoot, { recursive: true, force: true })
    }
  })

  test('外部重命名只显示候选，用户确认后才迁移标签路径', async ({ page, electronApp }) => {
    const oldPath = join(testDir, 'watch-test.md')
    const newPath = join(testDir, 'renamed.md')
    await openFolderViaIPC(electronApp, testDir)
    await expect(page.locator('.markdown-body h1')).toHaveText('Original Content')

    renameSync(oldPath, newPath)

    await expect(page.getByText('文件已被删除或暂时不可访问')).toBeVisible()
    await expect(page.getByText('检测到可能的新位置：renamed.md')).toBeVisible()
    await expect(page.locator('.tab', { hasText: 'watch-test.md' })).toBeVisible()
    await expect(page.locator('.tab', { hasText: 'renamed.md' })).not.toBeVisible()

    await page.getByRole('button', { name: '使用可能的新位置' }).click()

    await expect(page.locator('.tab', { hasText: 'renamed.md' })).toBeVisible()
    await expect(page.locator('.tab', { hasText: 'watch-test.md' })).not.toBeVisible()
    await expect(page.locator('.markdown-body h1')).toHaveText('Original Content')
  })

  test('atomic replace 后应该刷新内容且不延迟关闭标签', async ({ page, electronApp }) => {
    const target = join(testDir, 'watch-test.md')
    const replacement = join(testDir, 'watch-test.md.tmp')
    await openFolderViaIPC(electronApp, testDir)
    await expect(page.locator('.markdown-body h1')).toHaveText('Original Content')

    writeFileSync(replacement, '# Atomic Updated\n\nReplacement text')
    renameSync(replacement, target)

    await expect(page.locator('.markdown-body h1')).toHaveText('Atomic Updated')
    await page.waitForTimeout(1000)
    await expect(page.locator('.tab', { hasText: 'watch-test.md' })).toBeVisible()
    await expect(page.locator('.markdown-body p')).toHaveText('Replacement text')
  })

  test('切换 root 后旧 epoch 和旧 watcher 事件不得污染当前视图', async ({ page, electronApp }) => {
    const oldRoot = join(process.cwd(), '.tmp', 'e2e', 'file-watching-stale', `old-${Date.now()}`)
    const newRoot = join(process.cwd(), '.tmp', 'e2e', 'file-watching-stale', `new-${Date.now()}`)
    const oldFile = join(oldRoot, 'old.md')
    const newFile = join(newRoot, 'new.md')
    mkdirSync(oldRoot, { recursive: true })
    mkdirSync(newRoot, { recursive: true })
    writeFileSync(oldFile, '# Old Root')
    writeFileSync(newFile, '# New Root')

    try {
      await openFolderViaIPC(electronApp, oldRoot)
      await expect(page.locator('.markdown-body h1')).toHaveText('Old Root')
      const oldWorkspace = await page.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        const active = bootstrap.workspaces.find(workspace => workspace.id === bootstrap.activeWorkspaceId)
        if (!active) throw new Error('missing active workspace')
        return { id: active.id, lifecycleEpoch: active.lifecycleEpoch }
      })

      await openFolderViaIPC(electronApp, newRoot)
      await expect(page.locator('.markdown-body h1')).toHaveText('New Root')
      const windowId = await page.evaluate(() => window.api.getWindowId())

      writeFileSync(oldFile, '# Old Root Changed')
      await electronApp.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()
          .find(window => window.id === payload.windowId)
          ?.webContents.send('file:changed', {
            workspaceId: payload.workspace.id,
            lifecycleEpoch: payload.workspace.lifecycleEpoch,
            path: payload.filePath,
          })
      }, { windowId, workspace: oldWorkspace, filePath: oldFile })

      await page.waitForTimeout(1000)
      await expect(page.locator('.markdown-body h1')).toHaveText('New Root')
      await expect(page.locator('.file-tree-row.file', { hasText: 'old.md' })).not.toBeVisible()
      await expect(page.locator('.file-tree-row.file', { hasText: 'new.md' })).toBeVisible()
    } finally {
      rmSync(oldRoot, { recursive: true, force: true })
      rmSync(newRoot, { recursive: true, force: true })
    }
  })

  test('应该正确处理目录监听深度之外的已打开文件变化', async ({ page, electronApp }) => {
    const deepDir = join(testDir, 'level1', 'level2', 'level3')
    const deepFile = join(deepDir, 'deep.md')
    mkdirSync(deepDir, { recursive: true })
    writeFileSync(deepFile, '# Deep File')

    await openFolderViaIPC(electronApp, testDir)
    await electronApp.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('open-specific-file', filePath)
    }, deepFile)
    await expect(page.locator('.tab', { hasText: 'deep.md' })).toBeVisible()
    await expect(page.locator('.markdown-body h1')).toHaveText('Deep File')

    writeFileSync(deepFile, '# Modified Deep File')

    await expect(page.locator('.markdown-body h1')).toHaveText('Modified Deep File')
  })
})
