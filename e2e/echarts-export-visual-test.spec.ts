/**
 * ECharts 导出 HTML 视觉测试
 *
 * 测试目标：
 * 1. 验证导出的 HTML 文件中 ECharts 图表是否正确渲染
 * 2. 检查图表是否居中显示
 * 3. 检查图表是否完整显示（无截断）
 * 4. 检查页面是否有横向滚动条
 * 5. 监控控制台错误和网络错误
 */

import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const EXPORTED_HTML_PATH = process.env.ECHARTS_HTML_PATH || path.join(__dirname, '..', 'test-results', 'echarts-export.html')
const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results', 'echarts-visual')

// 确保截图目录存在
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

test.describe('ECharts 导出 HTML 视觉测试', () => {
  let consoleErrors: string[] = []
  let networkErrors: string[] = []
  let page: Page

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage
    consoleErrors = []
    networkErrors = []

    // 监听控制台错误
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // 监听网络错误
    page.on('requestfailed', (request) => {
      networkErrors.push(`${request.url()} - ${request.failure()?.errorText}`)
    })

    // 加载导出的 HTML 文件
    await page.goto(`file://${EXPORTED_HTML_PATH}`)

    // 等待页面加载完成
    await page.waitForLoadState('networkidle')
  })

  test('阶段 1：基础渲染检查', async () => {
    console.log('=== 阶段 1：基础渲染检查 ===')

    // 1. 检查页面标题
    const title = await page.title()
    console.log(`页面标题: ${title}`)
    expect(title).toContain('ECharts 高级图表测试')

    // 2. 检查 ECharts 容器是否存在
    const echartsContainers = await page.locator('.echarts-container').count()
    console.log(`找到 ${echartsContainers} 个 ECharts 容器`)
    expect(echartsContainers).toBeGreaterThan(0)

    // 3. 等待所有 ECharts 图表渲染完成
    await page.waitForTimeout(3000) // 给图表足够的渲染时间

    // 4. 检查 SVG 元素是否存在（ECharts 使用 SVG 渲染）
    const svgElements = await page.locator('svg').count()
    console.log(`找到 ${svgElements} 个 SVG 元素`)
    expect(svgElements).toBeGreaterThan(0)

    // 5. 截图保存
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-full-page.png'),
      fullPage: true
    })
    console.log('✅ 全页截图已保存')
  })

  test('阶段 2：图表居中和尺寸检查', async () => {
    console.log('=== 阶段 2：图表居中和尺寸检查 ===')

    // 等待图表渲染
    await page.waitForTimeout(3000)

    // 获取页面视口宽度
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    console.log(`视口宽度: ${viewportWidth}px`)

    // 获取所有 ECharts 容器
    const containers = await page.locator('.echarts-container').all()
    console.log(`检查 ${containers.length} 个图表容器`)

    for (let i = 0; i < containers.length; i++) {
      const container = containers[i]
      const boundingBox = await container.boundingBox()

      if (boundingBox) {
        console.log(`\n图表 ${i + 1}:`)
        console.log(`  位置: x=${boundingBox.x}, y=${boundingBox.y}`)
        console.log(`  尺寸: width=${boundingBox.width}, height=${boundingBox.height}`)

        // 检查图表是否在视口内
        expect(boundingBox.x).toBeGreaterThanOrEqual(0)
        expect(boundingBox.x + boundingBox.width).toBeLessThanOrEqual(viewportWidth + 50) // 允许 50px 误差

        // 检查图表高度是否合理
        expect(boundingBox.height).toBeGreaterThan(200) // 至少 200px 高
        expect(boundingBox.height).toBeLessThan(1000) // 不超过 1000px

        // 截图单个图表
        await container.screenshot({
          path: path.join(SCREENSHOT_DIR, `02-chart-${i + 1}.png`)
        })
      }
    }
    console.log('✅ 图表尺寸检查完成')
  })

  test('阶段 3：横向滚动条检查', async () => {
    console.log('=== 阶段 3：横向滚动条检查 ===')

    await page.waitForTimeout(3000)

    // 检查页面是否有横向滚动条
    const hasHorizontalScrollbar = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })

    console.log(`是否有横向滚动条: ${hasHorizontalScrollbar}`)

    if (hasHorizontalScrollbar) {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
      console.log(`⚠️ 检测到横向滚动条！`)
      console.log(`  scrollWidth: ${scrollWidth}px`)
      console.log(`  clientWidth: ${clientWidth}px`)
      console.log(`  差值: ${scrollWidth - clientWidth}px`)
    }

    // 期望没有横向滚动条
    expect(hasHorizontalScrollbar).toBe(false)
    console.log('✅ 无横向滚动条')
  })

  test('阶段 4：SVG 元素检查', async () => {
    console.log('=== 阶段 4：SVG 元素检查 ===')

    await page.waitForTimeout(3000)

    // 获取所有 SVG 元素
    const svgElements = await page.locator('svg').all()
    console.log(`找到 ${svgElements.length} 个 SVG 元素`)

    for (let i = 0; i < Math.min(svgElements.length, 5); i++) {
      const svg = svgElements[i]

      // 获取 SVG 属性
      const width = await svg.getAttribute('width')
      const height = await svg.getAttribute('height')
      const viewBox = await svg.getAttribute('viewBox')

      console.log(`\nSVG ${i + 1}:`)
      console.log(`  width: ${width}`)
      console.log(`  height: ${height}`)
      console.log(`  viewBox: ${viewBox}`)

      // 检查 SVG 是否有有效的尺寸
      if (width) {
        const widthNum = parseFloat(width)
        expect(widthNum).toBeGreaterThan(0)
      }

      if (height) {
        const heightNum = parseFloat(height)
        expect(heightNum).toBeGreaterThan(0)
      }
    }
    console.log('✅ SVG 元素检查完成')
  })

  test('阶段 5：控制台和网络错误检查', async () => {
    console.log('=== 阶段 5：控制台和网络错误检查 ===')

    await page.waitForTimeout(3000)

    // 输出控制台错误
    if (consoleErrors.length > 0) {
      console.log(`\n⚠️ 发现 ${consoleErrors.length} 个控制台错误:`)
      consoleErrors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`)
      })
    } else {
      console.log('✅ 无控制台错误')
    }

    // 输出网络错误
    if (networkErrors.length > 0) {
      console.log(`\n⚠️ 发现 ${networkErrors.length} 个网络错误:`)
      networkErrors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`)
      })
    } else {
      console.log('✅ 无网络错误')
    }

    // 期望没有错误
    expect(consoleErrors.length).toBe(0)
    expect(networkErrors.length).toBe(0)
  })

  test('阶段 6：图表交互性检查', async () => {
    console.log('=== 阶段 6：图表交互性检查 ===')

    await page.waitForTimeout(3000)

    // 获取第一个图表容器
    const firstChart = page.locator('.echarts-container').first()
    const boundingBox = await firstChart.boundingBox()

    if (boundingBox) {
      // 移动鼠标到图表中心
      const centerX = boundingBox.x + boundingBox.width / 2
      const centerY = boundingBox.y + boundingBox.height / 2

      await page.mouse.move(centerX, centerY)
      await page.waitForTimeout(500)

      // 检查是否有 tooltip 出现
      const tooltipVisible = await page.evaluate(() => {
        const tooltips = document.querySelectorAll('.echarts-tooltip, [class*="tooltip"]')
        return tooltips.length > 0
      })

      console.log(`Tooltip 是否可见: ${tooltipVisible}`)

      // 截图交互状态
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '06-interaction.png'),
        fullPage: true
      })
      console.log('✅ 交互性检查完成')
    }
  })

  test('阶段 7：视觉回归基准截图', async () => {
    console.log('=== 阶段 7：视觉回归基准截图 ===')

    await page.waitForTimeout(3000)

    // 获取所有图表容器
    const containers = await page.locator('.echarts-container').all()

    for (let i = 0; i < containers.length; i++) {
      const container = containers[i]

      // 滚动到图表位置
      await container.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)

      // 截图
      await container.screenshot({
        path: path.join(SCREENSHOT_DIR, `07-baseline-chart-${i + 1}.png`)
      })
      console.log(`✅ 图表 ${i + 1} 基准截图已保存`)
    }
  })

  test.afterEach(async () => {
    // 生成测试报告
    const report = {
      timestamp: new Date().toISOString(),
      consoleErrors: consoleErrors.length,
      networkErrors: networkErrors.length,
      errors: {
        console: consoleErrors,
        network: networkErrors
      }
    }

    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, 'test-report.json'),
      JSON.stringify(report, null, 2)
    )
  })
})
