import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { test, expect } from './fixtures/electron'

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

function seed(testDir: string, enabled: boolean, authorized = true): { profile: string; targets: string[]; anchor: string } {
  const profile = join(testDir, 'recent-pinyin-profile')
  mkdirSync(profile, { recursive: true })
  const targets = Array.from({ length: 500 }, (_, i) => join(testDir, 'history',
    i < 6 ? `group-${i}` : i === 7 ? '研发中心' : 'other',
    i < 6 ? '研发中心.md' : i === 6 ? 'yanfa-tools.md' : i === 7 ? 'README.md' : `note-${i}.md`))
  for (const [i, file] of targets.entries()) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `# 最近文件拼音目标 ${i}\n\n只用于独立测试。\n`)
    targets[i] = realpathSync(file)
  }
  writeFileSync(join(profile, 'app-data.json'), JSON.stringify({
    settings: { maxRecentFiles: 500, folderPinyinSearchEnabled: enabled, autoRenderRemoteCharts: false },
    recentFiles: targets.map((file, i) => ({
      id: `recent-pinyin-${i}`, path: file, name: i < 6 ? '研发中心.md' : i === 6 ? 'yanfa-tools.md' : i === 7 ? 'README.md' : `note-${i}.md`,
      folderPath: dirname(file), lastOpened: Date.now() - i * 1000,
    })),
  }))
  if (authorized) {
    writeFileSync(join(profile, 'folder-history.json'), JSON.stringify({ folderHistory:
      [...new Set(targets.map(file => dirname(file)))].map((path, i) => ({
        id: `authorized-folder-${i}`, path, name: basename(path), lastOpened: Date.now() - i * 1000,
      })),
    }))
  }
  const anchor = join(testDir, 'active', 'anchor.md')
  mkdirSync(dirname(anchor), { recursive: true })
  writeFileSync(anchor, '# 当前工作区锚点\n\n拼音筛选不能自动打开候选。\n')
  return { profile, targets, anchor: realpathSync(anchor) }
}

async function openRecent(page: Page): Promise<void> {
  await page.getByRole('button', { name: '最近打开的文件', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '拼音搜索' })).toBeEnabled()
}

async function dictionaryLoaded(page: Page): Promise<boolean> {
  const session = await page.context().newCDPSession(page)
  const urls: string[] = []
  session.on('Debugger.scriptParsed', event => urls.push(event.url))
  await session.send('Debugger.enable')
  await session.detach()
  return urls.some(url => /folderNamePinyin-/.test(url))
}

test('最近文件拼音：500条、默认关闭与字典懒加载、第6项跨根打开、重启保留开关', async ({ testDir }, testInfo) => {
  test.setTimeout(120_000)
  const { profile, targets, anchor } = seed(testDir, false)
  let { app, page } = await launch(profile)
  try {
    await page.evaluate(file => window.api.testOpenMarkdownFile(file), anchor)
    await expect(page.locator('.tab.active')).toContainText('anchor.md')
    await openRecent(page)
    const checkbox = page.getByRole('checkbox', { name: '拼音搜索' })
    await expect(checkbox).not.toBeChecked()
    await page.getByRole('searchbox', { name: '搜索最近文件' }).fill('yanfazhongxin')
    await expect(page.locator('.recent-files-empty')).toHaveText('未找到匹配文件')
    expect(await dictionaryLoaded(page)).toBe(false)
    await checkbox.check()
    await expect(page.locator('.recent-files-menu .folder-pinyin-heading')).toContainText('前 5 / 6')
    expect(await dictionaryLoaded(page)).toBe(true)
    await expect(page.locator('.recent-files-menu .folder-pinyin-list .recent-file-item')).toHaveCount(5)
    await page.screenshot({ path: testInfo.outputPath('recent-pinyin-five-light.png') })
    await page.getByRole('searchbox', { name: '搜索最近文件' }).press('Enter')
    await expect(page.locator('.tab.active')).toContainText('anchor.md')
    await page.getByRole('button', { name: '显示其余 1 项' }).click()
    const sixth = page.locator('.recent-files-menu .folder-pinyin-list .recent-file-item').nth(5)
    await expect(sixth).toHaveAttribute('aria-label', /group-5/)
    await sixth.focus()
    await sixth.press('Enter')
    await expect(page.locator('.tab.active')).toContainText('研发中心.md')
    await expect(page.locator('.markdown-body')).toContainText('最近文件拼音目标 5')
    const workspace = await page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      return bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)?.primaryRoot
    })
    expect(workspace).toBe(dirname(targets[5]))
    await page.screenshot({ path: testInfo.outputPath('recent-pinyin-sixth-opened.png') })
    await app.close()

    ;({ app, page } = await launch(profile))
    await openRecent(page)
    await expect(page.getByRole('checkbox', { name: '拼音搜索' })).toBeChecked()
    expect(await dictionaryLoaded(page)).toBe(false)
    await page.getByRole('searchbox', { name: '搜索最近文件' }).fill('yanf')
    const supplement = page.locator('.recent-files-menu .folder-pinyin-heading')
    await expect(supplement).toContainText('拼音补充')
    await expect(supplement).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.recent-files-list')).toContainText('yanfa-tools.md')
    await supplement.click()
    await expect(page.locator('.recent-files-menu .folder-pinyin-list .recent-file-item')).toHaveCount(5)
    expect(JSON.parse(readFileSync(join(profile, 'app-data.json'), 'utf8')).settings.folderPinyinSearchEnabled).toBe(true)
  } finally {
    await app.close().catch(() => {})
  }
})

test('最近文件拼音：原文优先、仅文件名、IME和Escape、与目录共用设置及窄窗滚动', async ({ testDir }, testInfo) => {
  test.setTimeout(120_000)
  const { profile, anchor } = seed(testDir, true)
  const { app, page } = await launch(profile)
  try {
    await page.evaluate(file => window.api.testOpenMarkdownFile(file), anchor)
    await expect(page.locator('.tab.active')).toContainText('anchor.md')
    await openRecent(page)
    const input = page.getByRole('searchbox', { name: '搜索最近文件' })
    await input.fill('yanfa')
    const supplement = page.locator('.recent-files-menu .folder-pinyin-heading')
    await expect(supplement).toContainText('拼音补充 · 6')
    await expect(supplement).toHaveAttribute('aria-expanded', 'false')
    await supplement.click()
    await expect(page.locator('.recent-files-menu .folder-pinyin-list')).not.toContainText('README.md')
    await input.dispatchEvent('compositionstart')
    await input.fill('yanf')
    await expect(page.locator('.recent-files-menu .folder-pinyin-group')).toHaveCount(0)
    await input.press('Enter')
    await expect(page.locator('.tab.active')).toContainText('anchor.md')
    await input.dispatchEvent('compositionend')
    await expect(supplement).toContainText('拼音补充 · 6')
    await input.fill('yanfazhongxin')
    await expect(page.locator('.recent-files-menu .folder-pinyin-heading')).toContainText('前 5 / 6')
    await page.getByRole('button', { name: '显示其余 1 项' }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 800, height: 720 }))
    await page.emulateMedia({ colorScheme: 'dark' })
    const more = page.getByRole('button', { name: '仅显示前 5 项' })
    await more.scrollIntoViewIfNeeded()
    const bounds = await page.locator('.recent-files-menu').boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    expect(bounds!.height).toBeLessThanOrEqual(400)
    const overflow = await page.locator('.recent-files-results').evaluate(el => ({
      outer: el.scrollWidth - el.clientWidth,
      nested: el.querySelector('.folder-pinyin-list')!.scrollHeight > el.querySelector('.folder-pinyin-list')!.clientHeight,
    }))
    expect(overflow.outer).toBeLessThanOrEqual(1)
    expect(overflow.nested).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('recent-pinyin-dark-narrow-expanded.png') })
    await input.fill('')
    await expect(page.locator('.recent-files-menu .folder-pinyin-group')).toHaveCount(0)
    await input.press('Escape')
    await expect(page.getByRole('button', { name: '最近打开的文件', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '最近打开的文件夹', exact: true }).click()
    const shared = page.getByRole('checkbox', { name: '拼音搜索' })
    await expect(shared).toBeChecked()
    await shared.uncheck()
    await expect(shared).toBeEnabled()
    await page.keyboard.press('Escape')
    await openRecent(page)
    await expect(page.getByRole('checkbox', { name: '拼音搜索' })).not.toBeChecked()
    await page.getByRole('searchbox', { name: '搜索最近文件' }).fill('yanfazhongxin')
    await expect(page.locator('.recent-files-empty')).toHaveText('未找到匹配文件')
  } finally {
    await app.close().catch(() => {})
  }
})

test('最近文件拼音：只有最近文件元数据不会扩大目录读取授权', async ({ testDir }, testInfo) => {
  const { profile, anchor } = seed(testDir, true, false)
  const { app, page } = await launch(profile)
  try {
    await page.evaluate(file => window.api.testOpenMarkdownFile(file), anchor)
    await expect(page.locator('.tab.active')).toContainText('anchor.md')
    await openRecent(page)
    await page.getByRole('searchbox', { name: '搜索最近文件' }).fill('yanfazhongxin')
    const row = page.locator('.recent-files-menu .folder-pinyin-list .recent-file-item').first()
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByText(/无法打开最近文件：.*不在任何已授权的文件夹内/)).toBeVisible()
    await expect(page.locator('.tab.active')).toContainText('anchor.md')
    const workspace = await page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      return bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)?.primaryRoot
    })
    expect(workspace).toBe(dirname(anchor))
    await page.screenshot({ path: testInfo.outputPath('recent-pinyin-unapproved-root-rejected.png') })
  } finally {
    await app.close().catch(() => {})
  }
})
