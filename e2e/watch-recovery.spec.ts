import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

async function observeProcesses(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ utilityProcess }) => {
    const state = { children: [] as any[], maxLag: 0, ticks: 0, expected: performance.now() + 20, lagSamples: [] as any[], cpu: process.cpuUsage() }
    ;(globalThis as any).__watchProbe = state
    setInterval(() => {
      const now = performance.now()
      const lag = now - state.expected
      const cpu = process.cpuUsage()
      if (lag > 50 && state.lagSamples.length < 50) state.lagSamples.push({
        at: now, lag, cpuMs: (cpu.user + cpu.system - state.cpu.user - state.cpu.system) / 1000,
        command: state.children.at(-1)?.commands.at(-1)?.type,
        message: state.children.at(-1)?.messages.at(-1)?.type,
      })
      state.cpu = cpu
      state.maxLag = Math.max(state.maxLag, lag)
      state.expected = now + 20
      state.ticks++
    }, 20).unref()
    const fork = utilityProcess.fork.bind(utilityProcess)
    utilityProcess.fork = (...args) => {
      if (args[0].endsWith('watcherProcess.js')) args[2] = { ...args[2], stdio: 'pipe' }
      const child = fork(...args)
      if (args[0].endsWith('watcherProcess.js')) {
        const entry = { child, commands: [] as any[], messages: [] as any[], killDurations: [] as number[], stderr: '', exited: false, exitCode: null as number | null }
        const kill = child.kill.bind(child)
        child.kill = () => {
          const start = performance.now()
          const result = kill()
          entry.killDurations.push(performance.now() - start)
          return result
        }
        child.stderr?.on('data', chunk => { entry.stderr += chunk.toString() })
        child.on('message', message => entry.messages.push(message))
        state.children.push(entry)
        const post = child.postMessage.bind(child)
        child.postMessage = (message, ports) => { entry.commands.push(message); return post(message, ports) }
        child.on('exit', code => { entry.exited = true; entry.exitCode = code })
      }
      return child
    }
  })
}
async function health(page: Page) {
  return page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    return window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)
  })
}

test.describe('隔离监听与恢复补查', () => {
  test.afterEach(async ({ electronApp, page }, testInfo) => {
    const processes = await electronApp.evaluate(() => (globalThis as any).__watchProbe?.children.map((entry: any) => ({
      exited: entry.exited, exitCode: entry.exitCode, stderr: entry.stderr, killDurations: entry.killDurations,
      commands: entry.commands.map((command: any) => ({ ...command, path: command.path ? '<fixture>' : undefined })),
      messages: entry.messages,
    })))
    const timing = await electronApp.evaluate(() => {
      const probe = (globalThis as any).__watchProbe
      return { maxLag: probe?.maxLag, lagSamples: probe?.lagSamples }
    })
    await testInfo.attach('watch-observation', { body: JSON.stringify({ status: await health(page), timing, processes }, null, 2), contentType: 'application/json' })
  })
  test('精准剪枝仍可发现文档，显式打开后通过真实文件事件更新', async ({ page, electronApp, testDir }, testInfo) => {
    await observeProcesses(electronApp)
    writeFileSync(join(testDir, 'demo.csproj'), '<Project />')
    mkdirSync(join(testDir, 'bin'))
    const generated = join(testDir, 'bin/manual.md')
    writeFileSync(generated, '# Generated manual\n\nuniquegeneratedsearch')
    await openFolderViaIPC(electronApp, testDir)
    await expect.poll(async () => (await health(page)).state).toBe('healthy')
    expect((await health(page)).partialCoverage).toBe(true)
    await expect(page.locator('.watch-status')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '刷新文件列表', exact: true })).toHaveAttribute('data-tooltip', '自动刷新正常，已忽略构建目录，点击查看')
    await page.getByRole('button', { name: '刷新文件列表', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '自动刷新状态' })
    await expect(dialog).toContainText('自动刷新正常，已忽略构建目录')
    await expect(dialog).toContainText('已忽略 1 个 bin/obj 构建目录')
    await expect(dialog).toContainText('生成目录内未打开文件')
    await expect(dialog).toContainText('已打开文件仍会监听')
    await page.screenshot({ path: testInfo.outputPath('watch-build-directories.png') })
    await page.keyboard.press('Escape')
    const bin = page.locator('.file-tree-row.directory', { hasText: 'bin' })
    if (await bin.getAttribute('aria-expanded') === 'false') await bin.click()
    await page.locator('.file-tree-row.file', { hasText: 'manual.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Generated manual')
    await expect.poll(async () => (await health(page)).state).toBe('healthy')
    writeFileSync(generated, '# Generated externally updated')
    await expect(page.locator('.markdown-body h1')).toHaveText('Generated externally updated')
    await expect.poll(async () => JSON.stringify(await page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
      return window.api.queryWorkspaceIndex({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }, 'externally')
    }))).toContain('manual.md')
  })

  test('资源错误后的 ready 不洗白；手动刷新与新代重试均可用', async ({ page, electronApp, testDir }, testInfo) => {
    await observeProcesses(electronApp)
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
    await expect.poll(async () => (await health(page)).state).toBe('healthy')
    const headerHeight = await page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height)
    await electronApp.evaluate(() => {
      const entry = (globalThis as any).__watchProbe.children.at(-1)
      const create = entry.commands.find((message: any) => message.type === 'create' && message.kind === 'root')
      entry.child.emit('message', { ...create, type: 'error', code: 'EMFILE' })
      entry.child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    })
    await expect(page.locator('.watch-refresh[data-watch-state="degraded"]')).toBeVisible()
    await expect(page.locator('.watch-status')).toHaveCount(0)
    expect(await page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height)).toBe(headerHeight)
    await page.screenshot({ path: testInfo.outputPath('watch-degraded-collapsed.png') })
    await page.getByRole('button', { name: '刷新文件列表', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '自动刷新状态' })).toContainText('自动刷新暂不可用')
    writeFileSync(join(testDir, 'test1.md'), '# Changed while degraded')
    await page.getByRole('button', { name: '刷新内容', exact: true }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Changed while degraded')
    expect((await health(page)).state).toBe('degraded')
    await expect(page.getByRole('button', { name: '刷新内容', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('watch-degraded-light.png') })
    await page.setViewportSize({ width: 800, height: 600 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: testInfo.outputPath('watch-degraded-narrow.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: '重试自动刷新', exact: true }).click()
    await expect.poll(async () => (await health(page)).state, { timeout: 15000 }).toBe('healthy')
    writeFileSync(join(testDir, 'test1.md'), '# Recovered live')
    await expect(page.locator('.markdown-body h1')).toHaveText('Recovered live')
  })

  test('子进程停止调度时主窗口仍可操作，回收后补齐缺口内增删改', async ({ page, electronApp, testDir }) => {
    test.skip(process.platform === 'win32', 'SIGSTOP fault injection requires POSIX')
    await observeProcesses(electronApp)
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
    await expect.poll(async () => (await health(page)).state).toBe('healthy')
    await electronApp.evaluate(() => {
      const probe = (globalThis as any).__watchProbe
      probe.maxLag = 0
      const entry = probe.children.at(-1)
      if (entry.exited || !entry.child.pid) throw new Error('no owned child')
      process.kill(entry.child.pid, 'SIGSTOP')
    })
    writeFileSync(join(testDir, 'test1.md'), '# Changed during gap')
    writeFileSync(join(testDir, 'gap-added.md'), '# Added during gap')
    renameSync(join(testDir, 'test2.md'), join(testDir, 'gap-renamed.md'))
    unlinkSync(join(testDir, 'math.md'))
    const interaction = performance.now()
    await page.locator('.file-tree-row.file', { hasText: 'code.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Code Example')
    expect(performance.now() - interaction).toBeLessThan(500)
    await expect.poll(async () => electronApp.evaluate(() => (globalThis as any).__watchProbe.children.length), { timeout: 12000 }).toBeGreaterThan(1)
    await expect.poll(async () => (await health(page)).state, { timeout: 15000 }).toBe('healthy')
    await expect(page.locator('.file-tree-row.file', { hasText: 'gap-added.md' })).toBeVisible()
    await expect(page.locator('.file-tree-row.file', { hasText: 'gap-renamed.md' })).toBeVisible()
    await expect(page.locator('.file-tree-row.file', { hasText: 'math.md' })).toHaveCount(0)
    await page.locator('.tab', { hasText: 'test1.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Changed during gap')
    const observation = await electronApp.evaluate(() => {
      const probe = (globalThis as any).__watchProbe
      return { maxLag: probe.maxLag, oldExited: probe.children[0].exited }
    })
    expect(observation.oldExited).toBe(true)
    expect(observation.maxLag).toBeLessThan(250)
  })
})
