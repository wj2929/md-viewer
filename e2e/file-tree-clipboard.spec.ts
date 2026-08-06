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
    execFileSync('osascript', [
      '-e',
      `tell application "Finder" to activate`,
      '-e',
      `tell application "Finder" to set target of front window to POSIX file "${destinationDir}"`,
      '-e',
      `tell application "System Events" to keystroke "v" using command down`
    ])

    await expect.poll(() => existsSync(destination), { timeout: 10000 }).toBe(true)
  })
  test('macOS Finder 剪切后使用 Option-Command-V 应移动文件', async ({ page, electronApp, testDir }) => {
    test.skip(platform() !== 'darwin', '仅在 macOS 上验证 Finder 文件剪贴板')
    await openFolderViaIPC(electronApp, testDir)

    const source = join(testDir, 'test2.md')
    const destinationDir = join(testDir, 'finder-cut-target')
    const destination = join(destinationDir, 'test2.md')
    execFileSync('mkdir', ['-p', destinationDir])

    await triggerFileTreeMenuAction(page, 'cut', [source])
    execFileSync('osascript', [
      '-e',
      `tell application "Finder" to activate`,
      '-e',
      `tell application "Finder" to set target of front window to POSIX file "${destinationDir}"`,
      '-e',
      `tell application "System Events" to keystroke "v" using {command down, option down}`
    ])

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
