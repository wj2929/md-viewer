import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

test.describe('文件树创建副本', () => {
  test('Markdown 文件副本应递增命名并保留源文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    const source = join(testDir, 'test1.md')

    for (const expectedName of ['test1 - 副本.md', 'test1 - 副本 2.md', 'test1 - 副本 3.md']) {
      const result = await page.evaluate(
        async filePath => {
          const bootstrap = await window.api.getWorkspaceBootstrap()
          const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)
          if (!workspace) throw new Error('活动工作区不存在')
          return window.api.duplicatePath(filePath, {
            workspaceId: workspace.id,
            lifecycleEpoch: workspace.lifecycleEpoch,
          })
        },
        source
      )
      expect(result.newPath).toBe(join(testDir, expectedName))
      await expect.poll(() => existsSync(result.newPath)).toBe(true)
      expect(readFileSync(result.newPath, 'utf8')).toBe(readFileSync(source, 'utf8'))
    }

    expect(existsSync(source)).toBe(true)
  })

  test('目录副本应复制目录内容', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)
    const source = join(testDir, 'subfolder')
    const result = await page.evaluate(
      async filePath => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)
        if (!workspace) throw new Error('活动工作区不存在')
        return window.api.duplicatePath(filePath, {
          workspaceId: workspace.id,
          lifecycleEpoch: workspace.lifecycleEpoch,
        })
      },
      source
    )

    expect(result.newPath).toBe(join(testDir, 'subfolder - 副本'))
    await expect.poll(() => existsSync(join(result.newPath, 'nested.md'))).toBe(true)
    expect(existsSync(source)).toBe(true)
  })
})
