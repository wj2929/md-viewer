import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'

/**
 * Electron 测试 Fixture
 * 提供启动和关闭 Electron 应用的能力
 */
type ElectronFixtures = {
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    // 启动 Electron 应用
    const app = await electron.launch({
      args: [join(__dirname, '../../out/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'production'
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

    await use(page)
  }
})

export { expect } from '@playwright/test'
