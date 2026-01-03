import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Electron E2E 测试 Fixture
 * 提供启动和关闭 Electron 应用的能力
 */
type ElectronFixtures = {
  electronApp: ElectronApplication
  page: Page
  testDir: string
}

export const test = base.extend<ElectronFixtures>({
  testDir: async ({}, use) => {
    // 创建临时测试目录
    const dir = join(tmpdir(), `md-viewer-e2e-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    // 创建测试文件
    writeFileSync(join(dir, 'test1.md'), '# Test 1\n\nHello World\n\n## Subtitle\n\nSome content here.')
    writeFileSync(join(dir, 'test2.md'), '# Test 2\n\n**Bold** and *italic* text\n\n- List item 1\n- List item 2')
    writeFileSync(
      join(dir, 'code.md'),
      '# Code Example\n\n```javascript\nfunction hello() {\n  console.log("Hello World");\n}\n```'
    )
    writeFileSync(join(dir, 'math.md'), '# Math Example\n\n$E = mc^2$\n\n$$\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$')
    writeFileSync(
      join(dir, 'mermaid.md'),
      '# Mermaid Example\n\n```mermaid\ngraph LR\n  A[Start] --> B[Process]\n  B --> C[End]\n```'
    )

    // 创建子目录
    mkdirSync(join(dir, 'subfolder'))
    writeFileSync(join(dir, 'subfolder', 'nested.md'), '# Nested File\n\nNested content here.')

    await use(dir)

    // 清理测试目录
    rmSync(dir, { recursive: true, force: true })
  },

  electronApp: async ({}, use) => {
    // 启动 Electron 应用
    const app = await electron.launch({
      args: [join(__dirname, '../../out/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // 跳过恢复上次打开的文件夹
        MD_VIEWER_SKIP_RESTORE: '1'
      }
    })

    await use(app)

    // 关闭应用
    await app.close()
  },

  page: async ({ electronApp }, use) => {
    // 获取第一个窗口
    const page = await electronApp.firstWindow()

    // 等待应用加载完成
    await page.waitForLoadState('domcontentloaded')

    // 等待 React 渲染完成
    await page.waitForSelector('.app', { timeout: 10000 })

    await use(page)
  }
})

export { expect } from '@playwright/test'

/**
 * 辅助函数：通过 Electron IPC 打开文件夹
 * 绕过系统对话框
 */
export async function openFolderViaIPC(
  electronApp: ElectronApplication,
  folderPath: string
): Promise<void> {
  await electronApp.evaluate(async ({ app }, folderPath) => {
    const { BrowserWindow } = await import('electron')
    const Store = (await import('electron-store')).default
    const { setAllowedBasePath } = await import('./security')

    const store = new Store()
    store.set('lastOpenedFolder', folderPath)
    setAllowedBasePath(folderPath)

    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      windows[0].webContents.send('restore-folder', folderPath)
    }
  }, folderPath)
}
