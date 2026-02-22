/**
 * 自动截图脚本 — 为 README 生成图表渲染效果截图
 *
 * 用法: npx playwright test scripts/take-screenshots.ts --config=scripts/screenshot.config.ts
 * 或:   npx tsx scripts/take-screenshots.ts
 */

import { _electron as electron } from '@playwright/test'
import { join } from 'path'
import { mkdirSync, existsSync, copyFileSync } from 'fs'

const PROJECT_ROOT = join(__dirname, '..')
const FIXTURES_DIR = join(PROJECT_ROOT, 'e2e', 'fixtures')
const OUTPUT_DIR = join(PROJECT_ROOT, 'docs', 'images')

// 要截图的图表文件及其等待选择器
const CHARTS = [
  { file: 'test-mermaid.md', name: 'chart-mermaid', waitFor: '.mermaid-container svg', scrollTo: '.mermaid-container' },
  { file: 'test-echarts.md', name: 'chart-echarts', waitFor: '.echarts-container canvas', scrollTo: '.echarts-container' },
  { file: 'test-markmap.md', name: 'chart-markmap', waitFor: '.markmap-container svg', scrollTo: '.markmap-container' },
  { file: 'test-graphviz.md', name: 'chart-graphviz', waitFor: '.graphviz-container svg', scrollTo: '.graphviz-container' },
  { file: 'test-plantuml.md', name: 'chart-plantuml', waitFor: '.plantuml-container img, .plantuml-container svg', scrollTo: '.plantuml-container' },
  { file: 'test-drawio.md', name: 'chart-drawio', waitFor: '.drawio-container svg', scrollTo: '.drawio-container' },
  { file: 'test-katex.md', name: 'chart-katex', waitFor: '.katex', scrollTo: '.katex-display' },
]

async function main() {
  console.log('📸 启动 MD Viewer 截图...')

  // 确保输出目录存在
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // 确保应用已构建
  const mainJs = join(PROJECT_ROOT, 'out', 'main', 'index.js')
  if (!existsSync(mainJs)) {
    console.error('❌ 应用未构建,请先运行 npm run build')
    process.exit(1)
  }

  // 启动 Electron
  const app = await electron.launch({
    args: [mainJs],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MD_VIEWER_SKIP_RESTORE: '1',
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.app', { timeout: 15000 })
  console.log('✅ 应用启动成功')

  // 通过 IPC 打开 fixtures 目录
  await app.evaluate(async ({ app: _app }, fixturesDir) => {
    const { BrowserWindow } = await import('electron')
    const Store = (await import('electron-store')).default
    const { setAllowedBasePath } = await import('./security')

    const store = new Store()
    store.set('lastOpenedFolder', fixturesDir)
    setAllowedBasePath(fixturesDir)

    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      windows[0].webContents.send('restore-folder', fixturesDir)
    }
  }, FIXTURES_DIR)

  // 等待文件树加载
  await page.waitForSelector('.file-tree', { timeout: 10000 })
  await page.waitForTimeout(2000)
  console.log('✅ 文件树加载完成')

  // 设置窗口大小
  await app.evaluate(async () => {
    const { BrowserWindow } = await import('electron')
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.setSize(1400, 900)
      win.center()
    }
  })
  await page.waitForTimeout(500)

  for (const chart of CHARTS) {
    console.log(`📷 截图: ${chart.name} (${chart.file})...`)

    try {
      // 点击文件树中的文件
      const fileItem = page.locator(`.file-tree-item:has-text("${chart.file}")`)
      if (await fileItem.count() === 0) {
        console.log(`  ⚠️ 文件树中未找到 ${chart.file}，跳过`)
        continue
      }
      await fileItem.first().click()
      await page.waitForTimeout(1000)

      // 等待图表渲染
      try {
        await page.waitForSelector(chart.waitFor, { timeout: 15000 })
        // 额外等待渲染完成（动画等）
        await page.waitForTimeout(2000)
      } catch {
        console.log(`  ⚠️ ${chart.name} 渲染超时，尝试截取当前状态`)
      }

      // 滚动到第一个图表
      const chartEl = page.locator(chart.scrollTo).first()
      if (await chartEl.count() > 0) {
        await chartEl.scrollIntoViewIfNeeded()
        await page.waitForTimeout(500)
      }

      // 截取内容区域
      const contentArea = page.locator('.markdown-content, .content-area, .markdown-body').first()
      if (await contentArea.count() > 0) {
        await contentArea.screenshot({
          path: join(OUTPUT_DIR, `${chart.name}.png`),
          type: 'png',
        })
      } else {
        // fallback: 截全窗口
        await page.screenshot({
          path: join(OUTPUT_DIR, `${chart.name}.png`),
          type: 'png',
        })
      }

      console.log(`  ✅ ${chart.name}.png 已保存`)
    } catch (err) {
      console.log(`  ❌ ${chart.name} 截图失败: ${err instanceof Error ? err.message : err}`)
    }
  }

  // 关闭应用
  await app.close()
  console.log('\n🎉 截图完成! 输出目录:', OUTPUT_DIR)
}

main().catch(err => {
  console.error('❌ 脚本执行失败:', err)
  process.exit(1)
})
