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
