import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  test,
  expect,
  openFolderViaIPC
} from './fixtures/electron'

test.describe('macOS /private/tmp 文件夹授权', () => {
  test('可以打开 /private/tmp 下的嵌套 Markdown 文件夹', async ({
    electronApp,
    page
  }) => {
    test.skip(
      process.platform !== 'darwin',
      '仅适用于 macOS /private/tmp'
    )

    const temporaryRoot = mkdtempSync(
      '/private/tmp/mdv-private-tmp-e2e-'
    )
    const nestedRoot = join(
      temporaryRoot,
      'nested',
      'workspace'
    )
    const markdownPath = join(
      nestedRoot,
      'private-temp.md'
    )

    mkdirSync(nestedRoot, { recursive: true })
    writeFileSync(
      markdownPath,
      '# Private temp workspace\n\n可正常打开。'
    )

    try {
      await openFolderViaIPC(electronApp, nestedRoot)
      await expect(
        page.locator('.tab.active', {
          hasText: 'private-temp.md'
        })
      ).toBeVisible()
      await expect(
        page.locator('.markdown-body')
      ).toContainText('Private temp workspace')
    } finally {
      rmSync(temporaryRoot, {
        recursive: true,
        force: true
      })
    }
  })
})
