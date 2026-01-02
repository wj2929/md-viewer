import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 测试配置
 * 用于测试 Electron 应用的核心功能
 */
export default defineConfig({
  testDir: './e2e',

  // 测试超时配置
  timeout: 30000,
  expect: {
    timeout: 5000
  },

  // 失败时重试次数
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron 应用串行测试

  // 报告配置
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['json', { outputFile: 'e2e-results.json' }]
  ],

  // 全局配置
  use: {
    // 截图策略
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',

    // 视频录制
    video: 'retain-on-failure',
  },

  // Electron 测试项目配置
  projects: [
    {
      name: 'electron',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
})
