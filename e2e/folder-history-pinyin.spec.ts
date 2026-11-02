import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const OUT = join(process.cwd(), process.env.MD_VIEWER_PINYIN_EXECUTABLE
  ? '.tmp/folder-history-pinyin-packaged/history'
  : 'test-results/folder-history-pinyin')

async function launch(profile: string): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env.MD_VIEWER_PINYIN_EXECUTABLE
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, ...(executablePath ? [] : [join(process.cwd(), 'out/main/index.js')])],
    env: {
      ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1',
      MD_VIEWER_E2E_VISIBLE: process.env.MD_VIEWER_E2E_VISIBLE ?? '0',
      MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs'),
    },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.app')
  return { app, page }
}

function seed(profile: string, testDir: string, count: number, enabled?: boolean, namesOverride?: string[]): string[] {
  mkdirSync(profile, { recursive: true })
  const names = namesOverride ?? Array.from({ length: count }, (_, i) => i === count - 1 ? 'yanfa-tools' : count > 10 ? `研发中心${i}` : '研发中心')
  const roots = Array.from({ length: count }, (_, i) => {
    const root = join(testDir, `分组${i}`, names[i])
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, `sample-${i}.md`), `# 示例 ${i}\n\n只用于目录搜索测试。\n`)
    return realpathSync(root)
  })
  writeFileSync(join(profile, 'folder-history.json'), JSON.stringify({ folderHistory: roots.map((path, i) => ({
    id: `fixture-${i}`, path, name: names[i], lastOpened: Date.now() - i,
  })) }))
  if (enabled !== undefined) writeFileSync(join(profile, 'app-data.json'), JSON.stringify({ settings: {
    imageDir: 'assets', autoSave: true, bookmarkPanelWidth: 240, bookmarkPanelCollapsed: true,
    bookmarkBarCollapsed: true, sidebarWidth: 280, sidebarCollapsed: false,
    maxFolderHistory: 300, autoRenderRemoteCharts: true, folderPinyinSearchEnabled: enabled,
  } }))
  return roots
}

async function openHistory(page: Page): Promise<void> {
  await page.getByRole('button', { name: '最近打开的文件夹' }).click()
  await expect(page.getByRole('checkbox', { name: '拼音搜索' })).toBeEnabled()
}

async function pinyinLoaded(page: Page): Promise<boolean> {
  const session = await page.context().newCDPSession(page)
  const urls: string[] = []
  session.on('Debugger.scriptParsed', event => urls.push(event.url))
  await session.send('Debugger.enable')
  await session.detach()
  return urls.some(url => /folderNamePinyin-/.test(url))
}

test('最近文件夹：打开和重新打开菜单自动聚焦搜索框，可直接输入', async ({ testDir }, testInfo) => {
  const profile = join(testDir, 'focus-profile')
  const roots = seed(profile, testDir, 3, false, ['研发中心', '产品文档', '会议记录'])
  const { app, page } = await launch(profile)
  try {
    const trigger = page.getByRole('button', { name: '最近打开的文件夹', exact: true })
    await trigger.click()
    const input = page.getByRole('searchbox', { name: '搜索最近文件夹' })
    await expect(input).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('folder-history-focus-open.png') })
    await testInfo.attach('active-element', { body: JSON.stringify(await page.evaluate(() => ({
      tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'),
    }))), contentType: 'application/json' })
    await expect(input).toBeFocused()
    await page.keyboard.insertText('研发')
    await expect(input).toHaveValue('研发')
    await expect(page.locator('.history-list .history-item')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('研发')
    await page.screenshot({ path: testInfo.outputPath('folder-history-focus-reopened.png') })
    await page.keyboard.press('Escape')
    await openFolderViaIPC(app, roots[0])
    await trigger.click()
    await expect(input).toBeFocused()
    await page.keyboard.insertText('会议')
    await expect(input).toHaveValue('会议')
    await expect(page.locator('.history-list .history-item')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('folder-history-focus-workspace.png') })
  } finally {
    await app.close().catch(() => {})
  }
})

test('目录拼音：真实选择、第6项、两窗口重读及同profile完整重启恢复开与关', async ({ testDir }) => {
  test.setTimeout(120_000)
  mkdirSync(OUT, { recursive: true })
  const profile = join(testDir, 'persistent-profile')
  const roots = seed(profile, testDir, 7)
  let { app, page } = await launch(profile)
  try {
    await openFolderViaIPC(app, roots[6])
    await openHistory(page)
    const checkbox = page.getByRole('checkbox', { name: '拼音搜索' })
    await expect(checkbox).not.toBeChecked()
    await page.getByRole('searchbox', { name: '搜索最近文件夹' }).fill('yanfazhongxin')
    await expect(page.locator('.folder-pinyin-group')).toHaveCount(0)
    expect(await pinyinLoaded(page)).toBe(false)
    await expect(page.locator('.history-menu')).not.toContainText(/仅目录名称全拼|重启后保留|两入口共用/)
    await checkbox.check()
    await expect(checkbox).toBeEnabled()
    await expect(page.locator('.folder-pinyin-heading')).toContainText('前 5 / 6')
    expect(await pinyinLoaded(page)).toBe(true)
    await expect(page.locator('.folder-pinyin-list .history-item')).toHaveCount(5)
    await page.screenshot({ path: join(OUT, 'pinyin-five-light.png') })
    await page.getByRole('button', { name: '显示其余 1 项' }).click()
    const sixth = page.locator('.folder-pinyin-list .history-item').nth(5)
    await expect(sixth.locator('.history-path')).toHaveAttribute('title', roots[5])
    await sixth.focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      return bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)?.primaryRoot
    })).toBe(roots[5])
    await app.close()

    ;({ app, page } = await launch(profile))
    await openFolderViaIPC(app, roots[5])
    await openHistory(page)
    await expect(page.getByRole('checkbox', { name: '拼音搜索' })).toBeChecked()
    expect(await pinyinLoaded(page)).toBe(false)
    await page.getByRole('searchbox', { name: '搜索最近文件夹' }).fill('yanfa')
    const supplement = page.getByRole('button', { name: /拼音补充 · 6/ })
    await expect(supplement).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.history-list')).toContainText('yanfa-tools')
    await expect(page.locator('.folder-pinyin-list')).toHaveCount(0)
    await supplement.click()
    await expect(page.locator('.folder-pinyin-list .history-item')).toHaveCount(5)
    await page.emulateMedia({ colorScheme: 'dark' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 600, height: 720 }))
    const bounds = await page.locator('.history-menu').boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    await page.screenshot({ path: join(OUT, 'pinyin-supplement-dark-narrow.png') })
    await page.keyboard.press('Escape')

    const windowPromise = app.waitForEvent('window')
    const windowId = await page.evaluate(() => window.api.newWindow())
    const other = await windowPromise
    await other.waitForSelector('.app')
    await other.evaluate(path => window.api.testOpenMarkdownFile?.(path), join(roots[0], 'sample-0.md'))
    await openHistory(other)
    await expect(other.getByRole('checkbox', { name: '拼音搜索' })).toBeChecked()
    await openHistory(page)
    await page.getByRole('checkbox', { name: '拼音搜索' }).uncheck()
    await expect(page.getByRole('checkbox', { name: '拼音搜索' })).toBeEnabled()
    await other.getByRole('button', { name: '最近打开的文件夹' }).click()
    await openHistory(other)
    await expect(other.getByRole('checkbox', { name: '拼音搜索' })).not.toBeChecked()
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), windowId)
    await app.close()

    ;({ app, page } = await launch(profile))
    await openFolderViaIPC(app, roots[5])
    await openHistory(page)
    await expect(page.getByRole('checkbox', { name: '拼音搜索' })).not.toBeChecked()
    await page.getByRole('searchbox', { name: '搜索最近文件夹' }).fill('yanfa')
    await expect(page.locator('.history-list')).toContainText('yanfa-tools')
    await expect(page.locator('.folder-pinyin-group')).toHaveCount(0)
    expect(await pinyinLoaded(page)).toBe(false)
    expect(JSON.parse(readFileSync(join(profile, 'app-data.json'), 'utf8')).settings.folderPinyinSearchEnabled).toBe(false)
  } finally {
    await app.close().catch(() => {})
  }
})

test('300项历史冷态/热态搜索及加载期间输入、清空、关闭保持响应', async ({ testDir }) => {
  test.setTimeout(120_000)
  mkdirSync(OUT, { recursive: true })
  const rounds: { coldMs: number; hotMs: number; longTasks: number[]; resourceMs: number | null }[] = []
  for (let round = 0; round < 3; round++) {
    const profile = join(testDir, `benchmark-profile-${round}`)
    const names = Array.from({ length: 300 }, (_, i) => i === 299 ? 'docs-tools' : `研发中心${i}`)
    const roots = seed(profile, join(testDir, `round-${round}`), 300, true, names)
    const { app, page } = await launch(profile)
    try {
      await openFolderViaIPC(app, roots[299])
      await openHistory(page)
      expect(await pinyinLoaded(page)).toBe(false)
      await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索最近文件夹"]')!
        const state = { start: 0, end: 0, longTasks: [] as number[] }
        Object.assign(window, { pinyinTiming: state })
        new PerformanceObserver(list => { state.longTasks.push(...list.getEntries().map(entry => entry.duration)) }).observe({ type: 'longtask' })
        input.addEventListener('input', () => { state.start = performance.now(); state.end = 0 })
        new MutationObserver(() => {
          if (!state.end && state.start && document.querySelector('.folder-pinyin-list .history-item')) state.end = performance.now()
        }).observe(document.body, { subtree: true, childList: true })
      })
      await page.getByRole('searchbox', { name: '搜索最近文件夹' }).fill('yan')
      await expect(page.locator('.folder-pinyin-heading')).toContainText('前 5 / 299')
      const cold = await page.evaluate(() => {
        const state = (window as unknown as { pinyinTiming: { start: number; end: number; longTasks: number[] } }).pinyinTiming
        const resource = performance.getEntriesByType('resource').find(entry => /folderNamePinyin-/.test(entry.name))
        return { ms: state.end - state.start, longTasks: [...state.longTasks], resourceMs: resource?.duration ?? null }
      })
      await page.getByRole('searchbox', { name: '搜索最近文件夹' }).fill('yanf')
      await expect(page.locator('.folder-pinyin-heading')).toContainText('前 5 / 299')
      const hot = await page.evaluate(() => {
        const state = (window as unknown as { pinyinTiming: { start: number; end: number } }).pinyinTiming
        return state.end - state.start
      })
      rounds.push({ coldMs: cold.ms, hotMs: hot, longTasks: cold.longTasks, resourceMs: cold.resourceMs })
      expect(cold.ms).toBeGreaterThan(0)
      expect(cold.ms).toBeLessThanOrEqual(500)
      expect(hot).toBeGreaterThan(0)
      expect(hot).toBeLessThan(100)
      await page.getByRole('searchbox', { name: '搜索最近文件夹' }).fill('')
      await expect(page.locator('.folder-pinyin-group')).toHaveCount(0)
      await expect(page.locator('.history-list .history-item')).toHaveCount(300)
      await page.keyboard.press('Escape')
      await expect(page.locator('.history-menu')).toHaveCount(0)
    } finally { await app.close() }
  }
  writeFileSync(join(OUT, 'performance.json'), JSON.stringify({ rounds }, null, 2))
})

test('真实字典加载中继续输入、清空、关闭，迟到结果不回写', async ({ testDir }) => {
  test.setTimeout(60_000)
  const profile = join(testDir, 'delayed-profile')
  const roots = seed(profile, join(testDir, 'delayed-roots'), 300, true)
  const { app, page } = await launch(profile)
  const release = async (): Promise<void> => {
    await app.evaluate(({ BrowserWindow }) => {
      const held = (globalThis as unknown as { heldPinyinFiles?: (() => void)[] }).heldPinyinFiles
      held?.splice(0).forEach(resume => resume())
      BrowserWindow.getAllWindows()[0]?.webContents.session.protocol.uninterceptProtocol('file')
    })
  }
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const { fileURLToPath } = process.getBuiltinModule('node:url') as typeof import('node:url')
      const path = process.getBuiltinModule('node:path') as typeof import('node:path')
      const window = BrowserWindow.getAllWindows()[0]
      const root = path.dirname(fileURLToPath(window.webContents.getURL())) + path.sep
      const held: (() => void)[] = []
      Object.assign(globalThis, { heldPinyinFiles: held })
      BrowserWindow.getAllWindows()[0].webContents.session.protocol.interceptFileProtocol('file', (request, callback) => {
        const file = fileURLToPath(request.url)
        if (!file.startsWith(root)) { callback({ error: -10 }); return }
        if (/folderNamePinyin-.*\.js$/.test(file)) held.push(() => callback({ path: file }))
        else callback({ path: file })
      })
    })
    await openFolderViaIPC(app, roots[299])
    await openHistory(page)
    const input = page.getByRole('searchbox', { name: '搜索最近文件夹' })
    await input.fill('yanfazhongxin')
    await expect(page.locator('.folder-pinyin-status')).toHaveText('拼音加载中…')
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { heldPinyinFiles: unknown[] }).heldPinyinFiles.length)).toBeGreaterThan(0)
    await input.fill('zhongxin')
    await expect(page.locator('.folder-pinyin-list')).toHaveCount(0)
    await input.fill('')
    await expect(page.locator('.history-list .history-item')).toHaveCount(300)
    await page.keyboard.press('Escape')
    await expect(page.locator('.history-menu')).toHaveCount(0)
    await release()
    await openHistory(page)
    await expect(page.locator('.folder-pinyin-list')).toHaveCount(0)
    await input.fill('yanfazhongxin')
    await expect(page.locator('.folder-pinyin-heading')).toContainText('前 5 / 299')
  } finally {
    await release()
    await app.close()
  }
})

test('拼音名称前缀：三字母与未完成音节、完整匹配优先及内部负例', async ({ testDir }) => {
  test.setTimeout(60_000)
  mkdirSync(OUT, { recursive: true })
  const names = ['盐房资料', '材料研发', '研发中心', '研发', '研发档案', '研发方案', '研发记录', '研发项目', '研发文件', '研发计划', '盐方', 'yanfa-tools', '重庆项目', '银行资料', '中心资料', '旅游资料']
  const profile = join(testDir, 'prefix-profile')
  const roots = seed(profile, testDir, names.length, true, names)
  const { app, page } = await launch(profile)
  try {
    await openFolderViaIPC(app, roots[11])
    await openHistory(page)
    const input = page.getByRole('searchbox', { name: '搜索最近文件夹' })
    for (const [query, count] of [['yan', 10], ['yanf', 10], ['yanfa', 11]] as const) {
      await input.fill(query)
      const supplement = page.getByRole('button', { name: new RegExp(`拼音补充 · ${count}$`) })
      await expect(supplement).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('.history-list')).toContainText('yanfa-tools')
      await expect(page.locator('.folder-pinyin-list')).toHaveCount(0)
      await supplement.click()
      await expect(page.locator('.folder-pinyin-list .history-item')).toHaveCount(5)
      if (query === 'yan') await page.screenshot({ path: join(OUT, 'prefix-three-letter.png') })
      if (query === 'yanf') {
        await page.getByRole('button', { name: '显示其余 5 项' }).click()
        await expect(page.locator('.folder-pinyin-list')).not.toContainText('材料研发')
      }
      if (query === 'yanfa') {
        await expect(page.locator('.folder-pinyin-list .history-name')).toHaveText(['研发', '研发中心', '研发档案', '研发方案', '研发记录'])
        await page.getByRole('button', { name: '显示其余 6 项' }).click()
        const ordered = await page.locator('.folder-pinyin-list .history-name').allTextContents()
        expect(ordered.indexOf('材料研发')).toBeLessThan(ordered.indexOf('盐房资料'))
        expect(ordered).not.toContain('yanfa-tools')
      }
    }
    for (const [query, name] of [['cho', '重庆项目'], ['chongq', '重庆项目'], ['yinh', '银行资料'], ['zhong', '中心资料'], ['lvy', '旅游资料'], ['yanfax', '研发项目']]) {
      await input.fill(query)
      await expect(page.locator('.folder-pinyin-list .history-name')).toHaveText([name])
    }
    for (const query of ['yf', 'anfa', 'yanfazq', 'yanxin', "x'ian"]) {
      await input.fill(query)
      await expect(page.locator('.folder-pinyin-group')).toHaveCount(0)
    }
    await input.fill('yanf')
    await expect(page.getByRole('button', { name: /拼音补充 · 10$/ })).toBeVisible()
    await page.keyboard.press('Enter')
    const activeRoot = await page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      return bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)?.primaryRoot
    })
    expect(activeRoot).toBe(roots[11])
    await page.emulateMedia({ colorScheme: 'dark' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 800, height: 720 }))
    await page.getByRole('button', { name: /拼音补充 · 10$/ }).click()
    await page.screenshot({ path: join(OUT, 'prefix-unfinished-dark-narrow.png') })
  } finally { await app.close() }
})
