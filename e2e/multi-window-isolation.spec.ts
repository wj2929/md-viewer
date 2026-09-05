import type { Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { test, expect } from './fixtures/electron'

/**
 * 多窗口读授权边界回归测试
 *
 * md-viewer 是个人本机工具，用户打开的多个文件夹之间没有信任边界。
 * 读类操作放宽到"任一已授权文件夹（任一已打开窗口根 / 历史 / 最近 / 书签）"即可放行。
 *
 * 本测试验证放宽后的正确边界：
 *  - 窗口 A 能读窗口 B 已打开的文件夹里的文件（跨文件夹分屏的基础）
 *  - 任一窗口都不能读"从未打开、也未登记"的第三个文件夹里的文件
 *  - validateNotProtected 仍生效：任一窗口都不能读 ~/.ssh/id_rsa 之类受保护路径
 */

interface Folders {
  folderA: string
  folderB: string
  folderC: string
  fileA: string
  fileB: string
  fileC: string
  cleanup: () => void
}

function createFolders(): Folders {
  // 使用项目内 .tmp 目录，避开 macOS 上 os.tmpdir() 解析到 /private/var（受保护路径）
  const baseDir = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(baseDir, { recursive: true })
  const root = mkdtempSync(join(baseDir, 'md-viewer-multiwin-'))
  const folderA = join(root, 'folder-a')
  const folderB = join(root, 'folder-b')
  const folderC = join(root, 'folder-c-unregistered')
  mkdirSync(folderA, { recursive: true })
  mkdirSync(folderB, { recursive: true })
  mkdirSync(folderC, { recursive: true })
  const fileA = join(folderA, 'a.md')
  const fileB = join(folderB, 'b.md')
  const fileC = join(folderC, 'c.md')
  writeFileSync(fileA, '# A\n\n窗口 A 的文件')
  writeFileSync(fileB, '# B\n\n窗口 B 的文件')
  writeFileSync(fileC, '# C\n\n从未打开的文件夹')
  return {
    folderA,
    folderB,
    folderC,
    fileA,
    fileB,
    fileC,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

async function bindWindowToFolderFile(page: Page, markdownFile: string): Promise<void> {
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), markdownFile)
  await page.waitForSelector('.file-tree-container', { timeout: 10000 })
}

async function tryReadFile(page: Page, filePath: string): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async path => {
    try {
      await window.api.readFile(path)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, filePath)
}

test.describe('多窗口读授权边界', () => {
  test('同一文件在两个窗口中都应收到外部刷新', async ({ page, electronApp }) => {
    const folders = createFolders()
    try {
      await bindWindowToFolderFile(page, folders.fileA)
      await expect(page.locator('.markdown-body h1')).toHaveText('A')

      const windowCountBefore = electronApp.windows().length
      await page.evaluate(() => window.api.newWindow())
      await expect.poll(() => electronApp.windows().length).toBe(windowCountBefore + 1)
      const windowB = electronApp.windows()[electronApp.windows().length - 1]
      await windowB.waitForLoadState('domcontentloaded')
      await windowB.waitForSelector('.app', { timeout: 10000 })
      await bindWindowToFolderFile(windowB, folders.fileA)
      await expect(windowB.locator('.markdown-body h1')).toHaveText('A')

      writeFileSync(folders.fileA, '# Shared Updated\n\n两个窗口都应刷新')

      await expect(page.locator('.markdown-body h1')).toHaveText('Shared Updated')
      await expect(windowB.locator('.markdown-body h1')).toHaveText('Shared Updated')
      await expect(page.locator('.markdown-body')).toContainText('两个窗口都应刷新')
      await expect(windowB.locator('.markdown-body')).toContainText('两个窗口都应刷新')
    } finally {
      folders.cleanup()
    }
  })

  test('链接影响 capability 不能被另一窗口使用', async ({ page, electronApp }) => {
    const folders = createFolders()
    try {
      writeFileSync(folders.fileA, '# A\n\n[Self](./a.md)')
      await bindWindowToFolderFile(page, folders.fileA)
      const operation = await page.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        const workspace = bootstrap.workspaces.find(item => item.primaryRoot)
        if (!workspace) throw new Error('missing workspace')
        return { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
      })
      const impact = await page.evaluate(async ({ operation }) =>
        window.api.createLinkImpact(operation, {
          oldRelativePath: 'a.md',
          newRelativePath: 'archive/a.md',
        }), { operation })

      const windowCountBefore = electronApp.windows().length
      await page.evaluate(() => window.api.newWindow())
      await expect.poll(() => electronApp.windows().length).toBe(windowCountBefore + 1)
      const windowB = electronApp.windows()[electronApp.windows().length - 1]
      await windowB.waitForLoadState('domcontentloaded')
      await windowB.waitForSelector('.app', { timeout: 10000 })
      await bindWindowToFolderFile(windowB, folders.fileA)
      const operationB = await windowB.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        const workspace = bootstrap.workspaces.find(item => item.primaryRoot)
        if (!workspace) throw new Error('missing workspace')
        return { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
      })

      const stolen = await windowB.evaluate(async ({ operation, impactId }) => {
        try {
          await window.api.executeLinkRewriteOperation(operation, {
            impactId,
            mapping: { oldRelativePath: 'a.md', newRelativePath: 'archive/a.md' },
            reason: 'move',
            confirm: true,
          })
          return { ok: true }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      }, { operation: operationB, impactId: impact.impactId })

      expect(stolen.ok).toBe(false)
      expect(stolen.message).toContain('链接影响预览无效或已过期')
    } finally {
      folders.cleanup()
    }
  })

  test('root replacement 后旧 capability 和旧 epoch 均不可用', async ({ page }) => {
    const folders = createFolders()
    try {
      writeFileSync(folders.fileA, '# A\n\n[Self](./a.md)')
      await bindWindowToFolderFile(page, folders.fileA)
      const stale = await page.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        const workspace = bootstrap.workspaces.find(item => item.primaryRoot)
        if (!workspace) throw new Error('missing workspace')
        const operation = { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
        const impact = await window.api.createLinkImpact(operation, {
          oldRelativePath: 'a.md',
          newRelativePath: 'archive/a.md',
        })
        return { operation, impactId: impact.impactId }
      })

      await bindWindowToFolderFile(page, folders.fileB)
      const current = await page.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        const workspace = bootstrap.workspaces.find(item => item.primaryRoot)
        if (!workspace) throw new Error('missing workspace')
        return { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
      })
      expect(current.workspaceId).toBe(stale.operation.workspaceId)
      expect(current.lifecycleEpoch).toBeGreaterThan(stale.operation.lifecycleEpoch)

      const result = await page.evaluate(async ({ operation, impactId }) => {
        try {
          await window.api.executeLinkRewriteOperation(operation, {
            impactId,
            mapping: { oldRelativePath: 'a.md', newRelativePath: 'archive/a.md' },
            reason: 'move',
            confirm: true,
          })
          return { ok: true }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      }, stale)

      expect(result.ok).toBe(false)
      expect(result.message).toContain('工作区已失效')
    } finally {
      folders.cleanup()
    }
  })

  test('读放宽到任一已打开文件夹，但拒绝未登记文件夹与受保护路径', async ({ page, electronApp }) => {
    const folders = createFolders()
    try {
      // 窗口 A：绑定文件夹 A
      await bindWindowToFolderFile(page, folders.fileA)

      // 打开第二个窗口，绑定文件夹 B
      const windowCountBefore = electronApp.windows().length
      await page.evaluate(() => window.api.newWindow())
      await expect.poll(() => electronApp.windows().length).toBe(windowCountBefore + 1)

      const windows = electronApp.windows()
      const windowB = windows[windows.length - 1]
      await windowB.waitForLoadState('domcontentloaded')
      await windowB.waitForSelector('.app', { timeout: 10000 })
      await bindWindowToFolderFile(windowB, folders.fileB)

      // 各自能读自己根内的文件
      await expect.poll(() => tryReadFile(page, folders.fileA).then(r => r.ok)).toBe(true)
      await expect.poll(() => tryReadFile(windowB, folders.fileB).then(r => r.ok)).toBe(true)

      // 放宽后的预期：窗口 A 能读窗口 B 已打开文件夹里的文件（跨文件夹分屏的基础）
      await expect.poll(() => tryReadFile(page, folders.fileB).then(r => r.ok)).toBe(true)
      // 反向亦然
      await expect.poll(() => tryReadFile(windowB, folders.fileA).then(r => r.ok)).toBe(true)

      // 边界一：任一窗口都不能读"从未打开、也未登记"的第三个文件夹
      const aReadsC = await tryReadFile(page, folders.fileC)
      expect(aReadsC.ok).toBe(false)
      expect(aReadsC.error).toContain('安全错误')

      // 边界二：validateNotProtected 仍生效——不能读受保护路径
      const aReadsSsh = await tryReadFile(page, join(homedir(), '.ssh', 'id_rsa'))
      expect(aReadsSsh.ok).toBe(false)
      expect(aReadsSsh.error).toContain('安全错误')
    } finally {
      folders.cleanup()
    }
  })
})
