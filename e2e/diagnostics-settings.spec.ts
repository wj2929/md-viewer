import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const OUT_DIR = join(process.cwd(), 'test-results', 'diagnostics-settings')

test.describe('诊断日志真实 Electron smoke', () => {
  test('设置页展示真实状态并生成可关联且脱敏的 JSONL', async ({ page, electronApp, testDir }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', error => pageErrors.push(error.message))

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 800, height: 600 })
    })
    await openFolderViaIPC(electronApp, testDir)
    await page.getByRole('treeitem', { name: /test1\.md/ }).click()
    await expect(page.getByRole('heading', { name: 'Test 1' })).toBeVisible()
    await page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)
      if (!workspace?.primaryRoot) throw new Error('测试工作区未激活')
      const operation = {
        workspaceId: workspace.id,
        lifecycleEpoch: workspace.lifecycleEpoch,
      }
      await Promise.all(Array.from(
        { length: 100 },
        () => window.api.getWorkspaceBacklinks(operation, 'test1.md'),
      ))
    })

    await expect.poll(
      () => page.evaluate(() => window.api.getDiagnosticLogStatus()),
      { timeout: 10_000 },
    ).toMatchObject({ state: 'ready', enabled: true, usingCustomDirectory: false })

    await page.locator('.nav-settings-btn').click()
    await page.getByRole('tab', { name: '系统' }).click()
    const section = page.getByRole('heading', { name: '诊断与日志' }).locator('..')
    await section.scrollIntoViewIfNeeded()
    await expect(section.getByText('正在记录诊断事件')).toBeVisible()
    await expect(section.getByLabel('日志总大小上限')).toHaveValue('10')
    await expect(section.getByLabel('保留时间')).toHaveValue('7')
    await section.screenshot({ path: join(OUT_DIR, 'system-default-800x600.png') })

    await section.locator('label.setting-switch').click()
    await expect(section.getByText('已停止记录')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.api.getDiagnosticLogStatus()))
      .toMatchObject({ state: 'disabled', enabled: false })
    await section.locator('label.setting-switch').click()
    await expect(section.getByText('正在记录诊断事件')).toBeVisible()

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2)
    })
    await section.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const layout = await section.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowingDescendants: [...element.querySelectorAll<HTMLElement>('*')]
        .filter(child => child.scrollWidth > child.clientWidth + 1)
        .map(child => ({
          tag: child.tagName,
          className: child.className,
          clientWidth: child.clientWidth,
          scrollWidth: child.scrollWidth,
        })),
    }))
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
    expect(layout.overflowingDescendants).toEqual([])
    const visualViewport = await page.evaluate(() => ({
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
    }))
    const panelBox = await page.locator('.settings-panel').boundingBox()
    expect(panelBox).not.toBeNull()
    expect(panelBox!.x).toBeGreaterThanOrEqual(0)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(visualViewport.width + 1)
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(visualViewport.height + 1)
    await page.screenshot({ path: join(OUT_DIR, 'system-default-200-percent.png') })
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1)
    })
    await page.locator('.settings-header .close-btn').click()
    await page.getByRole('radio', { name: '暗色主题' }).click()
    await page.locator('.nav-settings-btn').click()
    await page.getByRole('tab', { name: '系统' }).click()
    await section.scrollIntoViewIfNeeded()
    await section.screenshot({ path: join(OUT_DIR, 'system-dark.png') })

    const resolvedStatus = await page.evaluate(() => window.api.getDiagnosticLogStatus())
    expect(resolvedStatus.effectiveDirectory).toContain('diagnostic-logs')
    await expect.poll(() => resolvedStatus.effectiveDirectory
      ? readdirSync(resolvedStatus.effectiveDirectory).filter(name => name.endsWith('.jsonl')).length
      : 0).toBeGreaterThan(0)

    await page.waitForTimeout(350)
    const logText = readdirSync(resolvedStatus.effectiveDirectory!)
      .filter(name => name.endsWith('.jsonl'))
      .sort()
      .map(name => readFileSync(join(resolvedStatus.effectiveDirectory!, name), 'utf8'))
      .join('\n')
    const events = logText.split('\n').filter(Boolean).map(line => JSON.parse(line))
    const queryWindows = events.filter(event => event.event === 'index.query.window')
    expect(queryWindows.reduce(
      (sum, event) => sum + Number(event.metadata?.backlinksQueryCount ?? 0),
      0,
    )).toBeGreaterThanOrEqual(100)
    expect(events.some(event =>
      event.event.startsWith('index.work.') && event.metadata?.workloadKind === 'backlinks'
    )).toBe(false)
    expect(Buffer.byteLength(logText, 'utf8')).toBeLessThan(50 * 1024)
    const folderOperation = events.find(event => event.event === 'folder.open.start')?.operationId
    expect(folderOperation).toMatch(/^folder_/)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'folder.scan.summary', operationId: folderOperation }),
      expect.objectContaining({ event: 'folder.open.terminal', operationId: folderOperation }),
      expect.objectContaining({
        event: 'folder.open.terminal',
        operationId: folderOperation,
        processRole: 'renderer',
      }),
      expect.objectContaining({ event: 'file.io.summary' }),
      expect.objectContaining({ event: 'file.preview.summary' }),
    ]))
    expect(logText).not.toContain(testDir)
    expect(logText).not.toContain('test1.md')
    expect(logText).not.toContain('Hello World')

    const bundlePath = join(testDir, 'diagnostics.zip')
    await electronApp.evaluate(({ dialog }, outputPath) => {
      ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: outputPath })
    }, bundlePath)
    await section.getByRole('button', { name: '导出诊断包' }).click()
    await expect(section.getByText('诊断包已导出。')).toBeVisible()
    expect(existsSync(bundlePath)).toBe(true)
    const zip = new AdmZip(readFileSync(bundlePath))
    expect(zip.getEntries().map(entry => entry.entryName).sort()).toEqual([
      'README.txt',
      'diagnostics.json',
      'performance-events.jsonl',
    ])
    expect(zip.readAsText('performance-events.jsonl')).not.toContain(testDir)
    const diagnosticSummary = JSON.parse(zip.readAsText('diagnostics.json')).performanceEvents
    expect(diagnosticSummary.queryAggregation).toMatchObject({
      operations: expect.any(Number),
      errors: 0,
      slow: 0,
    })
    expect(diagnosticSummary.queryAggregation.operations).toBeGreaterThanOrEqual(100)
    expect(diagnosticSummary.writer.scope).toBe('currentBoot')

    const canaryPath = join(resolvedStatus.effectiveDirectory!, 'do-not-delete.canary')
    writeFileSync(canaryPath, 'CANARY')
    await electronApp.evaluate(({ dialog }) => {
      ;(dialog as any).showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    await section.getByRole('button', { name: '清除日志…' }).click()
    await expect(section.getByText(/已清除 \d+ 个文件/)).toBeVisible()
    expect(readFileSync(canaryPath, 'utf8')).toBe('CANARY')

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
