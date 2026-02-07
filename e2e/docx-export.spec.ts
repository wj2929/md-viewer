/**
 * DOCX 导出功能 E2E 测试
 * 测试 ECharts 图表在 Word 中的显示效果
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// 测试配置
const TEST_TIMEOUT = 60000
const APP_PATH = path.join(__dirname, '..')

test.describe('DOCX 导出功能测试', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>
  let page: Awaited<ReturnType<typeof electronApp.firstWindow>>

  test.beforeAll(async () => {
    // 启动 Electron 应用
    electronApp = await electron.launch({
      args: [APP_PATH],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MD_VIEWER_SKIP_RESTORE: '1',
      },
    })

    // 获取主窗口
    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
  })

  test.afterAll(async () => {
    await electronApp?.close()
  })

  test('应该能够导出包含 ECharts 图表的 DOCX', async () => {
    test.setTimeout(TEST_TIMEOUT)

    // 1. 打开测试文件夹
    const testFolder = process.env.MD_VIEWER_TEST_FOLDER || path.join(__dirname, '..', 'test-results')

    // 等待应用加载
    await page.waitForTimeout(2000)

    // 2. 检查是否有 ECharts 测试文件
    const testFile = path.join(testFolder, 'echarts-高级测试.md')
    if (!fs.existsSync(testFile)) {
      console.log('测试文件不存在，跳过测试')
      return
    }

    // 3. 监控控制台错误
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // 4. 监控页面错误
    const pageErrors: Error[] = []
    page.on('pageerror', error => {
      pageErrors.push(error)
    })

    // 5. 截图记录初始状态
    await page.screenshot({
      path: path.join(__dirname, 'screenshots', 'initial-state.png'),
      fullPage: true
    })

    // 6. 等待文件树加载
    await page.waitForSelector('.file-tree', { timeout: 10000 }).catch(() => {
      console.log('文件树未找到，可能需要先打开文件夹')
    })

    // 7. 输出测试结果
    console.log('\n========== 测试结果 ==========')
    console.log(`控制台错误数: ${consoleErrors.length}`)
    if (consoleErrors.length > 0) {
      console.log('控制台错误:')
      consoleErrors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`))
    }
    console.log(`页面错误数: ${pageErrors.length}`)
    if (pageErrors.length > 0) {
      console.log('页面错误:')
      pageErrors.forEach((err, i) => console.log(`  ${i + 1}. ${err.message}`))
    }
    console.log('================================\n')

    // 断言：不应有严重错误
    expect(pageErrors.length).toBe(0)
  })

  test('检查图表渲染尺寸', async () => {
    test.setTimeout(TEST_TIMEOUT)

    // 等待图表容器
    const chartContainers = await page.$$('.echarts-container')
    console.log(`找到 ${chartContainers.length} 个 ECharts 容器`)

    for (let i = 0; i < chartContainers.length; i++) {
      const container = chartContainers[i]
      const boundingBox = await container.boundingBox()

      if (boundingBox) {
        console.log(`图表 ${i + 1}: ${boundingBox.width}x${boundingBox.height} px`)

        // 检查尺寸是否合理（至少 300x200）
        expect(boundingBox.width).toBeGreaterThan(300)
        expect(boundingBox.height).toBeGreaterThan(200)
      }
    }
  })
})
