import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect } from './fixtures/electron'

type WorkspaceBootstrap = {
  activeWorkspaceId: string | null
  workspaces: Array<{
    id: string
    primaryRoot: string | null
    lifecycleEpoch: number
  }>
}

async function getBootstrap(page: Page): Promise<WorkspaceBootstrap> {
  return page.evaluate(() => window.api.getWorkspaceBootstrap())
}

async function openMarkdownFile(page: Page, filePath: string, fileName: string): Promise<void> {
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), filePath)
  await page.locator('.file-tree-container').waitFor({ state: 'visible', timeout: 10000 })
  await expect(page.locator('.tab', { hasText: fileName })).toBeVisible({ timeout: 10000 })
}

async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.locator('.app').waitFor({ state: 'visible', timeout: 10000 })
}

async function findPageByWindowId(
  electronApp: ElectronApplication,
  windowId: number
): Promise<Page> {
  await expect.poll(async () => {
    const pages = electronApp.windows()
    const ids = await Promise.all(
      pages.map((page) => page.evaluate(() => window.api.getWindowId()))
    )
    return ids.includes(windowId)
  }).toBe(true)

  const pages = electronApp.windows()
  const ids = await Promise.all(
    pages.map((page) => page.evaluate(() => window.api.getWindowId()))
  )
  const page = pages[ids.indexOf(windowId)]
  if (!page) throw new Error(`找不到窗口 ${windowId}`)
  return page
}

async function createAndIdentifyWindow(
  origin: Page,
  electronApp: ElectronApplication
): Promise<{ windowId: number; page: Page }> {
  const count = electronApp.windows().length
  const windowId = await origin.evaluate(() => window.api.newWindow())
  await expect.poll(() => electronApp.windows().length).toBe(count + 1)
  const page = await findPageByWindowId(electronApp, windowId)
  await page.waitForLoadState('domcontentloaded')
  await waitForWorkspaceReady(page)
  return { windowId, page }
}

function activeWorkspace(bootstrap: WorkspaceBootstrap) {
  return bootstrap.workspaces.find((workspace) => workspace.id === bootstrap.activeWorkspaceId)
}

test.describe('工作区转移', () => {
  test('没有标签和有效来源窗口时隐藏整条标签控制行', async ({ page }) => {
    await waitForWorkspaceReady(page)
    await expect(page.locator('.tabs')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '合并其他窗口' })).toHaveCount(0)
  })

  test('只有当前窗口时隐藏合并入口', async ({ page }) => {
    await waitForWorkspaceReady(page)
    await expect(page.getByRole('button', { name: '合并其他窗口' })).toHaveCount(0)
  })

  test('通过导入面板导入最后一个来源工作区，并关闭来源窗口', async ({ page: target, electronApp, testDir }) => {
    const targetFile = join(testDir, 'test2.md')
    const sourceRoot = join(testDir, 'subfolder')
    const sourceFile = join(sourceRoot, 'nested.md')

    await openMarkdownFile(target, targetFile, 'test2.md')
    const targetBefore = await getBootstrap(target)
    const targetWorkspace = activeWorkspace(targetBefore)
    expect(targetWorkspace?.primaryRoot).toBe(testDir)

    const source = await createAndIdentifyWindow(target, electronApp)
    await openMarkdownFile(source.page, sourceFile, 'nested.md')
    const sourceBefore = await getBootstrap(source.page)
    const sourceWorkspace = activeWorkspace(sourceBefore)
    expect(sourceBefore.workspaces).toHaveLength(1)
    expect(sourceWorkspace?.primaryRoot).toBe(sourceRoot)

    await target.getByRole('button', { name: '合并其他窗口' }).click()
    const dialog = target.getByRole('dialog', { name: '合并其他窗口' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio').check()
    await expect(dialog.getByText(/1 个会话将移入当前窗口/)).toBeVisible()

    const confirm = dialog.getByRole('button', { name: '合并此窗口' })
    await confirm.click()

    await expect.poll(async () => {
      const bootstrap = await getBootstrap(target)
      const active = activeWorkspace(bootstrap)
      return {
        roots: bootstrap.workspaces.map((workspace) => workspace.primaryRoot).sort(),
        activeRoot: active?.primaryRoot,
        importedEpoch: bootstrap.workspaces.find((workspace) => workspace.id === sourceWorkspace?.id)?.lifecycleEpoch,
      }
    }).toEqual({
      roots: [sourceRoot, testDir].sort(),
      activeRoot: sourceRoot,
      importedEpoch: (sourceWorkspace?.lifecycleEpoch ?? 0) + 1,
    })

    await expect(target.locator('.tab', { hasText: 'nested.md' })).toBeVisible({ timeout: 10000 })
    await expect.poll(() => electronApp.windows().length).toBe(1)
    await expect.poll(async () => {
      const ids = await Promise.all(
        electronApp.windows().map((page) => page.evaluate(() => window.api.getWindowId()))
      )
      return ids.includes(source.windowId)
    }).toBe(false)
  })

  test('拆分多工作区来源时保留来源窗口，并替换目标占位工作区', async ({ page: source, electronApp, testDir }) => {
    const retainedFile = join(testDir, 'test1.md')
    const transferredRoot = join(testDir, 'subfolder')
    const transferredFile = join(transferredRoot, 'nested.md')

    await openMarkdownFile(source, retainedFile, 'test1.md')
    const retainedBefore = activeWorkspace(await getBootstrap(source))
    expect(retainedBefore?.primaryRoot).toBe(testDir)

    const created = await source.evaluate(() => window.api.createWorkspace())
    await source.evaluate(path => window.api.testOpenMarkdownFile?.(path), transferredFile)
    await expect(source.locator('.file-tree-container')).toBeVisible({ timeout: 10000 })
    await expect(source.locator('.tab', { hasText: 'nested.md' })).toBeVisible({ timeout: 10000 })

    const sourceBefore = await getBootstrap(source)
    const transferredBefore = activeWorkspace(sourceBefore)
    const staleSourcePresentations = sourceBefore.workspaces.map((workspace) => ({
      workspaceId: workspace.id,
      lifecycleEpoch: workspace.lifecycleEpoch,
      label: workspace.primaryRoot?.split(/[/\\]/).pop() || '空白会话',
      isEmptyPlaceholder: workspace.primaryRoot === null,
      hasMeaningfulState: true,
      tabCount: 1,
      activeTabName: workspace.id === transferredBefore?.id ? 'nested.md' : 'test1.md',
      tabNames: [workspace.id === transferredBefore?.id ? 'nested.md' : 'test1.md'],
      hasSplit: false,
      hasDraft: false,
    }))
    expect(sourceBefore.workspaces.map((workspace) => workspace.primaryRoot).sort()).toEqual([testDir, transferredRoot].sort())
    expect(transferredBefore?.id).toBe(created.id)
    expect(transferredBefore?.primaryRoot).toBe(transferredRoot)

    const sourceWindowId = await source.evaluate(() => window.api.getWindowId())
    await source.locator('.workspace-switcher-trigger').click()
    await source.getByRole('menuitem', { name: '将当前工作区拆分为新窗口' }).click()

    await expect.poll(() => electronApp.windows().length).toBe(2)
    await expect.poll(async () => {
      const ids = await Promise.all(
        electronApp.windows().map((page) => page.evaluate(() => window.api.getWindowId()))
      )
      return ids.some((id) => id !== sourceWindowId)
    }).toBe(true)
    const targetIds = await Promise.all(
      electronApp.windows().map((page) => page.evaluate(() => window.api.getWindowId()))
    )
    const targetId = targetIds.find((id) => id !== sourceWindowId)
    if (targetId === undefined) throw new Error('拆分目标窗口未创建')
    const target = await findPageByWindowId(electronApp, targetId)
    await waitForWorkspaceReady(target)

    await expect.poll(async () => {
      const bootstrap = await getBootstrap(source)
      return bootstrap.workspaces.map((workspace) => workspace.primaryRoot)
    }, { timeout: 10000 }).toEqual([testDir])

    await expect.poll(async () => {
      const bootstrap = await getBootstrap(target)
      const active = activeWorkspace(bootstrap)
      return {
        count: bootstrap.workspaces.length,
        root: active?.primaryRoot,
        hasPlaceholder: bootstrap.workspaces.some((workspace) => workspace.primaryRoot === null),
        epoch: active?.lifecycleEpoch,
      }
    }).toEqual({
      count: 1,
      root: transferredRoot,
      hasPlaceholder: false,
      epoch: (transferredBefore?.lifecycleEpoch ?? 0) + 1,
    })

    await expect(target.locator('.tab', { hasText: 'nested.md' })).toBeVisible({ timeout: 10000 })
    await expect(source.locator('.tab', { hasText: 'nested.md' })).toHaveCount(0)
    const staleResult = await source.evaluate(
      (payload) => window.api.updateWorkspacePresentations(payload),
      staleSourcePresentations
    )
    expect(staleResult).toEqual({ applied: false })
    await expect.poll(async () => {
      const bootstrap = await getBootstrap(source)
      return bootstrap.workspaces.map((workspace) => workspace.primaryRoot)
    }).toEqual([testDir])
    await expect.poll(async () => {
      const [sourceCandidates, targetCandidates] = await Promise.all([
        source.evaluate(() => window.api.listWorkspaceMergeSources()),
        target.evaluate(() => window.api.listWorkspaceMergeSources()),
      ])
      return {
        source: sourceCandidates.map((item) => item.windowId),
        target: targetCandidates.map((item) => item.windowId),
      }
    }, { timeout: 10000 }).toEqual({ source: [targetId], target: [sourceWindowId] })
    await expect(source.getByRole('button', { name: '合并其他窗口' })).toBeVisible({ timeout: 10000 })
    await expect(target.getByRole('button', { name: '合并其他窗口' })).toBeVisible({ timeout: 10000 })
  })
  test('合并面板独立于工作区菜单，并在窄窗口内保持可见', async ({ page: target, electronApp, testDir }) => {
    const targetFile = join(testDir, 'test1.md')
    const sourceFile = join(testDir, 'subfolder', 'nested.md')
    const visualDir = join(process.cwd(), 'test-results', 'workspace-transfer-visual')
    mkdirSync(visualDir, { recursive: true })

    await openMarkdownFile(target, targetFile, 'test1.md')
    const created = await target.evaluate(() => window.api.createWorkspace())
    await target.evaluate(path => window.api.testOpenMarkdownFile?.(path), sourceFile)
    await expect.poll(async () => (await getBootstrap(target)).activeWorkspaceId).toBe(created.id)

    const source = await createAndIdentifyWindow(target, electronApp)
    await openMarkdownFile(source.page, sourceFile, 'nested.md')

    const targetWindowId = await target.evaluate(() => window.api.getWindowId())
    await electronApp.evaluate(({ BrowserWindow }, windowId) => {
      const window = BrowserWindow.getAllWindows().find((item) => item.id === windowId)
      window?.setBounds({ width: 768, height: 720 })
    }, targetWindowId)

    const switcher = target.locator('.workspace-switcher-trigger')
    await switcher.click()
    const menu = target.getByRole('menu', { name: '工作区' })
    await expect(menu).toBeVisible()
    await target.screenshot({ path: join(visualDir, 'switcher-menu-open.png'), fullPage: true })

    await menu.getByRole('menuitem', { name: '合并其他窗口' }).click()
    const dialog = target.getByRole('dialog', { name: '合并其他窗口' })
    await expect(menu).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio').first()).toBeVisible()
    await expect(dialog.getByText('窗口 1 · subfolder')).toBeVisible()
    await expect(dialog.getByText('1 个会话 · 1 个标签')).toBeVisible()
    await expect(dialog.getByText('MD Viewer', { exact: true })).toHaveCount(0)
    await expect(dialog.getByText(/undefined/)).toHaveCount(0)

    const [box, viewport, hasHorizontalOverflow] = await Promise.all([
      dialog.boundingBox(),
      target.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
      target.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ])
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(8)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 8)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    expect(hasHorizontalOverflow).toBe(false)
    await dialog.screenshot({ path: join(visualDir, 'merge-dialog-768x720.png') })
  })
  test('按真实窗口分组并区分同名会话', async ({ page: target, electronApp, testDir }) => {
    const videoRoot = join(testDir, 'video')
    const videoA = join(videoRoot, 'a.md')
    const videoB = join(videoRoot, 'b.md')
    const visualDir = join(process.cwd(), 'test-results', 'workspace-transfer-visual')
    mkdirSync(videoRoot, { recursive: true })
    mkdirSync(visualDir, { recursive: true })
    writeFileSync(videoA, '# Video A')
    writeFileSync(videoB, '# Video B')

    await openMarkdownFile(target, join(testDir, 'test1.md'), 'test1.md')
    const source = await createAndIdentifyWindow(target, electronApp)
    await openMarkdownFile(source.page, videoA, 'a.md')
    const first = activeWorkspace(await getBootstrap(source.page))
    const second = await source.page.evaluate(() => window.api.createWorkspace())
    await source.page.evaluate(path => window.api.testOpenMarkdownFile?.(path), videoB)
    await expect.poll(async () => activeWorkspace(await getBootstrap(source.page))?.id).toBe(second.id)
    await source.page.evaluate((payload) => window.api.updateWorkspacePresentations(payload), [
      {
        workspaceId: first!.id,
        lifecycleEpoch: first!.lifecycleEpoch,
        label: 'video',
        isEmptyPlaceholder: false,
        tabCount: 1,
        activeTabName: 'a.md',
        tabNames: ['a.md'],
        hasSplit: false,
        hasDraft: false,
      },
      {
        workspaceId: second.id,
        lifecycleEpoch: second.lifecycleEpoch,
        label: 'video',
        isEmptyPlaceholder: false,
        tabCount: 1,
        activeTabName: 'b.md',
        tabNames: ['b.md'],
        hasSplit: false,
        hasDraft: false,
      },
    ])
    await expect.poll(async () => {
      const sources = await target.evaluate(() => window.api.listWorkspaceMergeSources())
      return sources[0]?.workspaces.map((workspace) => ({ name: workspace.name, summary: workspace.summary }))
    }).toEqual([
      { name: 'video', summary: '当前：a.md · 1 个标签' },
      { name: 'video（会话 2）', summary: '当前：b.md · 1 个标签' },
    ])

    await target.getByRole('button', { name: '合并其他窗口' }).click()
    const dialog = target.getByRole('dialog', { name: '合并其他窗口' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio')).toHaveCount(1)
    await expect(dialog.getByText('2 个会话 · 2 个标签')).toBeVisible()
    await expect(dialog.getByText('窗口 1 · video')).toBeVisible()
    await expect(dialog.getByText(/undefined|MD Viewer/)).toHaveCount(0)
    await dialog.screenshot({ path: join(visualDir, 'merge-dialog-duplicate-sessions.png') })

    expect(first?.id).not.toBe(second.id)
  })
  test('按真实来源窗口展示多会话拓扑并过滤纯空窗口', async ({ page: target, electronApp, testDir }) => {
    const visualDir = join(process.cwd(), 'test-results', 'workspace-transfer-visual')
    mkdirSync(visualDir, { recursive: true })
    await openMarkdownFile(target, join(testDir, 'test1.md'), 'test1.md')

    const sourceA = await createAndIdentifyWindow(target, electronApp)
    const videoRoot = join(testDir, 'video-sessions')
    const bibleRoot = join(testDir, '00_设定圣经')
    mkdirSync(videoRoot, { recursive: true })
    mkdirSync(bibleRoot, { recursive: true })
    const sourceAFiles = [
      join(videoRoot, '直播课规划.md'),
      join(videoRoot, 'GoAgent.md'),
      join(videoRoot, 'FastGPT.md'),
      join(videoRoot, 'report.md'),
      join(bibleRoot, '世界观.md'),
    ]
    sourceAFiles.forEach((file, index) => writeFileSync(file, `# Session ${index + 1}`))
    const sourceAIds: string[] = []
    for (const [index, file] of sourceAFiles.entries()) {
      if (index > 0) await sourceA.page.evaluate(() => window.api.createWorkspace())
      await openMarkdownFile(sourceA.page, file, file.split('/').pop()!)
      sourceAIds.push(activeWorkspace(await getBootstrap(sourceA.page))!.id)
    }
    await expect.poll(async () => (await getBootstrap(sourceA.page)).workspaces.map((workspace) => workspace.id)).toEqual(sourceAIds)

    const sourceB = await createAndIdentifyWindow(target, electronApp)
    const sourceBFile = join(videoRoot, '智能基座平台.md')
    writeFileSync(sourceBFile, '# Platform')
    await openMarkdownFile(sourceB.page, sourceBFile, '智能基座平台.md')
    const sourceBWorkspace = activeWorkspace(await getBootstrap(sourceB.page))!
    const sourceBId = sourceBWorkspace.id
    await sourceB.page.evaluate((payload) => window.api.updateWorkspacePresentations(payload), [{
      workspaceId: sourceBId, lifecycleEpoch: sourceBWorkspace.lifecycleEpoch, label: '视频', isEmptyPlaceholder: false, hasMeaningfulState: true, tabCount: 1,
      activeTabName: '智能基座平台.md', tabNames: ['智能基座平台.md'], hasSplit: false, hasDraft: false,
    }])

    const sourceC = await createAndIdentifyWindow(target, electronApp)
    const sourceCWorkspace = activeWorkspace(await getBootstrap(sourceC.page))!
    const sourceCId = sourceCWorkspace.id
    await sourceC.page.evaluate((payload) => window.api.updateWorkspacePresentations(payload), [{
      workspaceId: sourceCId, lifecycleEpoch: sourceCWorkspace.lifecycleEpoch, label: '00_设定圣经', isEmptyPlaceholder: false, hasMeaningfulState: false, tabCount: 0,
      activeTabName: null, tabNames: [], hasSplit: false, hasDraft: false,
    }])

    const sourceSummary = await target.evaluate(() => window.api.listWorkspaceMergeSources())
    expect(sourceSummary.map((source) => ({ title: source.title, count: source.workspaceCount }))).toEqual([
      { title: '窗口 1 · 00_设定圣经', count: 5 },
      { title: '窗口 2 · 视频', count: 1 },
    ])

    await target.getByRole('button', { name: '合并其他窗口' }).click()
    const dialog = target.getByRole('dialog', { name: '合并其他窗口' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio')).toHaveCount(2)
    await expect(dialog.getByText('窗口 1 · 00_设定圣经')).toBeVisible()
    await expect(dialog.getByText('5 个会话 · 5 个标签')).toBeVisible()
    await expect(dialog.getByText('窗口 2 · 视频')).toBeVisible()
    await expect(dialog.getByText('1 个会话 · 1 个标签')).toBeVisible()
    await expect(dialog.getByText('窗口 3 · 00_设定圣经')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '合并此窗口' })).toBeVisible()
    await expect(dialog.getByText(/undefined|MD Viewer/)).toHaveCount(0)
    await dialog.screenshot({ path: join(visualDir, 'merge-dialog-three-window-topology.png') })
  })
})
