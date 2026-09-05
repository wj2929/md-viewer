import type { Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { platform } from 'os'
import { dirname, join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

async function triggerFileTreeMenuAction(
  page: Page,
  action: 'copy' | 'cut' | 'paste',
  target: string | string[]
): Promise<void> {
  const result = await page.evaluate(
    ({ action, target }) => window.api.testFileClipboardAction?.(action, target),
    { action, target }
  )
  expect(result).toEqual({ success: true })
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function pasteInFinder(destinationDir: string, destination: string, move = false): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3 && !existsSync(destination); attempt += 1) {
    try {
      execFileSync('osascript', [
        '-e', `set destinationFolder to POSIX file "${escapeAppleScriptString(destinationDir)}" as alias`,
        '-e', 'set clipboardItem to (the clipboard as «class furl») as alias',
        '-e', `tell application "Finder" to ${move ? 'move' : 'duplicate'} clipboardItem to destinationFolder`,
      ])
      lastError = undefined
    } catch (error) {
      lastError = error
    }
    await expect.poll(() => existsSync(destination), { timeout: 3000 }).toBe(true).catch(() => undefined)
  }
  if (!existsSync(destination) && lastError) throw lastError
}

test.describe('文件树右键菜单复制和剪切', () => {
  test('复制菜单动作应复制文件且保留源文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)

    const source = join(testDir, 'test1.md')
    const destination = join(testDir, 'subfolder', 'test1.md')
    await triggerFileTreeMenuAction(page, 'copy', [source])
    await triggerFileTreeMenuAction(page, 'paste', join(testDir, 'subfolder'))

    await expect.poll(() => existsSync(destination)).toBe(true)
    expect(existsSync(source)).toBe(true)
  })

  test('右键文件粘贴应使用该文件的父目录', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)

    const source = join(testDir, 'test1.md')
    const targetFile = join(testDir, 'subfolder', 'test2.md')
    const destination = join(testDir, 'subfolder', 'test1.md')
    await triggerFileTreeMenuAction(page, 'copy', [source])
    await triggerFileTreeMenuAction(page, 'paste', dirname(targetFile))

    await expect.poll(() => existsSync(destination)).toBe(true)
    expect(existsSync(source)).toBe(true)
  })
  test('macOS 应向 Finder 写入可粘贴的文件剪贴板', async ({ page, electronApp, testDir }) => {
    test.skip(platform() !== 'darwin', '仅在 macOS 上验证 Finder 文件剪贴板')
    await openFolderViaIPC(electronApp, testDir)

    const source = join(testDir, 'test1.md')
    const destinationDir = join(testDir, 'finder-paste-target')
    const destination = join(destinationDir, 'test1.md')
    execFileSync('mkdir', ['-p', destinationDir])

    await triggerFileTreeMenuAction(page, 'copy', [source])
    await pasteInFinder(destinationDir, destination)

    await expect.poll(() => existsSync(destination), { timeout: 10000 }).toBe(true)
  })
  test('macOS 文件剪贴板应支持 Finder 移动文件', async ({ page, electronApp, testDir }) => {
    test.skip(platform() !== 'darwin', '仅在 macOS 上验证 Finder 文件剪贴板')
    await openFolderViaIPC(electronApp, testDir)

    const source = join(testDir, 'test2.md')
    const destinationDir = join(testDir, 'finder-cut-target')
    const destination = join(destinationDir, 'test2.md')
    execFileSync('mkdir', ['-p', destinationDir])

    await triggerFileTreeMenuAction(page, 'cut', [source])
    await pasteInFinder(destinationDir, destination, true)

    await expect.poll(() => existsSync(destination), { timeout: 10000 }).toBe(true)
    expect(existsSync(source)).toBe(false)
  })
  test('切换文件夹后应允许粘贴已复制的源文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)

    const source = join(testDir, 'test1.md')
    const destinationDir = join(testDir, 'subfolder')
    const destination = join(destinationDir, 'test1.md')

    await triggerFileTreeMenuAction(page, 'copy', [source])
    await expect.poll(async () => page.evaluate(() => window.api.queryClipboardState())).toEqual({
      files: [source],
      isCut: false,
      hasFiles: true
    })

    await openFolderViaIPC(electronApp, destinationDir)
    await triggerFileTreeMenuAction(page, 'paste', destinationDir)

    await expect.poll(() => existsSync(destination)).toBe(true)
    expect(existsSync(source)).toBe(true)
  })

  test('切换文件夹后应允许移动已剪切的源文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)

    const source = join(testDir, 'test2.md')
    const destinationDir = join(testDir, 'subfolder')
    const destination = join(destinationDir, 'test2.md')

    await triggerFileTreeMenuAction(page, 'cut', [source])
    await expect.poll(async () => page.evaluate(() => window.api.queryClipboardState())).toEqual({
      files: [source],
      isCut: true,
      hasFiles: true
    })

    await openFolderViaIPC(electronApp, destinationDir)
    await triggerFileTreeMenuAction(page, 'paste', destinationDir)

    await expect.poll(() => existsSync(destination)).toBe(true)
    expect(existsSync(source)).toBe(false)
  })

  test('剪切菜单动作应移动文件并删除源文件', async ({ page, electronApp, testDir }) => {
    await openFolderViaIPC(electronApp, testDir)

    const source = join(testDir, 'test2.md')
    const destination = join(testDir, 'subfolder', 'test2.md')
    await triggerFileTreeMenuAction(page, 'cut', [source])
    await triggerFileTreeMenuAction(page, 'paste', join(testDir, 'subfolder'))

    await expect.poll(() => existsSync(destination)).toBe(true)
    expect(existsSync(source)).toBe(false)
  })
})
