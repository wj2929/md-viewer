import { test, expect } from './fixtures/electron'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import AdmZip from 'adm-zip'

const DOCX_SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL

/**
 * E2E: 导出前预检面板（v2.6）
 * 有风险文档 → 触发导出 → 面板出现 → 取消不导出 / 继续则导出；
 * 干净文档 → 面板不出现，静默直导。
 */

let testDir: string

test.beforeAll(() => {
  testDir = join(process.cwd(), '.tmp', 'e2e-preflight')
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })

  writeFileSync(
    join(testDir, 'risky.md'),
    [
      '# 风险文档',
      '',
      '![缺失的图片](./no-such-image.png)',
      '',
      '```kroki',
      '[用户]->[系统]: 请求',
      '```',
      '',
    ].join('\n')
  )
  writeFileSync(join(testDir, 'clean.md'), '# 干净文档\n\n正文，没有任何风险因素。\n')
})

test.afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

async function openMarkdownFile(page: Page, filePath: string) {
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), filePath)
  await page.waitForTimeout(500)
}

async function mockSaveDialog(electronApp: ElectronApplication, filePath: string) {
  await electronApp.evaluate(({ dialog }, savePath) => {
    ;(globalThis as any).__mdViewerSaveDialogCalls = []
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      ;(globalThis as any).__mdViewerSaveDialogCalls.push(args)
      return { canceled: false, filePath: savePath }
    }) as typeof dialog.showSaveDialog
  }, filePath)
}

async function triggerExport(
  electronApp: ElectronApplication,
  channel: 'markdown:export-html' | 'markdown:export-docx'
) {
  await electronApp.evaluate(({ BrowserWindow }, ch) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send(ch)
  }, channel)
}

async function setDocxSettings(page: Page, serverUrl: string) {
  await page.evaluate(url => {
    return window.api.updateAppSettings({
      docxExport: {
        remoteEnabled: true,
        serverUrl: url,
        style: 'standard',
        styleTouched: true,
        timeoutMs: 120000,
        embedFont: false,
        localFallbackEnabled: false,
      },
    })
  }, serverUrl)
}

async function waitForFile(filePath: string, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (existsSync(filePath)) return
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`导出文件未出现：${filePath}`)
}

test.describe('导出前预检面板', () => {
  test('风险文档：面板出现，点「取消导出」则不导出', async ({ electronApp, page }) => {
    await openMarkdownFile(page, join(testDir, 'risky.md'))
    const exportPath = join(testDir, 'risky-cancelled.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerExport(electronApp, 'markdown:export-html')

    const panel = page.locator('.preflight-overlay')
    await expect(panel).toBeVisible({ timeout: 10000 })
    // 两类风险都要被点名：缺图 + 外部服务型图表
    await expect(panel).toContainText('no-such-image.png')
    await expect(panel).toContainText('kroki')

    await panel.getByRole('button', { name: '取消导出' }).click()
    await expect(panel).not.toBeVisible()

    // 取消后不应弹保存对话框、不应产出文件
    await page.waitForTimeout(1500)
    const calls = await electronApp.evaluate(() => (globalThis as any).__mdViewerSaveDialogCalls ?? [])
    expect(calls.length).toBe(0)
    expect(existsSync(exportPath)).toBe(false)
  })

  test('风险文档：点「继续导出」则正常导出', async ({ electronApp, page }) => {
    await openMarkdownFile(page, join(testDir, 'risky.md'))
    const exportPath = join(testDir, 'risky-continued.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerExport(electronApp, 'markdown:export-html')

    const panel = page.locator('.preflight-overlay')
    await expect(panel).toBeVisible({ timeout: 10000 })
    await panel.getByRole('button', { name: '继续导出' }).click()
    await expect(panel).not.toBeVisible()

    await waitForFile(exportPath)
    const calls = await electronApp.evaluate(() => (globalThis as any).__mdViewerSaveDialogCalls ?? [])
    expect(calls.length).toBeGreaterThan(0)
  })

  test('干净文档：面板不出现，静默直导', async ({ electronApp, page }) => {
    await openMarkdownFile(page, join(testDir, 'clean.md'))
    const exportPath = join(testDir, 'clean.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath)
    // 全程面板不应出现过（导出已完成仍不可见即视为未弹出）
    await expect(page.locator('.preflight-overlay')).not.toBeVisible()
  })

  test('DOCX 服务不可用：面板出现「仍要导出」变体，取消则不导出', async ({ electronApp, page }) => {
    // 指向必死端口，预检 ping 应失败并默认拦截 docx
    await setDocxSettings(page, 'http://127.0.0.1:59999')
    await openMarkdownFile(page, join(testDir, 'clean.md'))
    const exportPath = join(testDir, 'clean-service-down.docx')
    await mockSaveDialog(electronApp, exportPath)

    await triggerExport(electronApp, 'markdown:export-docx')

    const panel = page.locator('.preflight-overlay')
    await expect(panel).toBeVisible({ timeout: 15000 })
    await expect(panel).toContainText('DOCX 服务')
    await expect(panel.getByRole('button', { name: /仍要导出/ })).toBeVisible()

    await panel.getByRole('button', { name: '取消导出' }).click()
    await expect(panel).not.toBeVisible()
    await page.waitForTimeout(1500)
    expect(existsSync(exportPath)).toBe(false)
  })

  test('GUI DOCX：失败图表中性化，不漏源码', async ({ electronApp, page }) => {
    test.skip(!DOCX_SERVICE_URL, '未设置 MD_VIEWER_DOCX_SERVICE_URL，跳过 GUI DOCX 真实导出')
    test.setTimeout(120000)

    // 断掉 kroki 外网，强制该图表客户端渲染失败
    await page.route('https://kroki.io/**', route => route.abort())

    await setDocxSettings(page, DOCX_SERVICE_URL!)
    await openMarkdownFile(page, join(testDir, 'risky.md'))
    const exportPath = join(testDir, 'risky-gui.docx')
    await mockSaveDialog(electronApp, exportPath)

    await triggerExport(electronApp, 'markdown:export-docx')

    const panel = page.locator('.preflight-overlay')
    await expect(panel).toBeVisible({ timeout: 15000 })
    await panel.locator('.export-task-btn-primary').click()
    await expect(panel).not.toBeVisible()

    await waitForFile(exportPath, 90000)
    const zip = new AdmZip(exportPath)
    const documentXml = zip.readAsText('word/document.xml')
    // kroki 源码不得残留；应有中性占位
    expect(documentXml).not.toContain('[用户]-&gt;[系统]')
    expect(documentXml).not.toContain('[用户]->[系统]')
    expect(documentXml).toContain('图表未渲染')
  })
})
