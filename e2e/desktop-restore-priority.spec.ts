import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function createWindowSnapshot(id: string, workspaceId: string, root: string) {
  const primaryTabId = `${id}-primary-tab`
  const secondaryTabId = `${id}-secondary-tab`
  return {
    id,
    bounds: { x: 40, y: 40, width: 1000, height: 720 },
    isMaximized: false,
    alwaysOnTop: false,
    activeWorkspaceId: workspaceId,
    workspaces: [{
      id: workspaceId,
      name: id,
      primaryRoot: root,
      lifecycleEpoch: 1,
      tabs: [
        { id: primaryTabId, relativePath: 'doc.md', isPinned: false },
        { id: secondaryTabId, relativePath: 'secondary.md', isPinned: true },
      ],
      activeTabId: secondaryTabId,
      splitState: {
        root: {
          type: 'split',
          id: `${id}-split`,
          direction: 'horizontal',
          ratio: 0.45,
          first: { type: 'leaf', id: `${id}-left`, tabId: primaryTabId },
          second: { type: 'leaf', id: `${id}-right`, tabId: secondaryTabId },
        },
        activeLeafId: `${id}-right`,
      },
    }],
  }
}

test('桌面会话先恢复 MRU 窗口并错峰补齐后台窗口', async () => {
  const baseDir = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(baseDir, { recursive: true })
  const sandbox = mkdtempSync(join(baseDir, 'md-viewer-restore-priority-'))
  const userDataDir = join(sandbox, 'user-data')
  const workspaceDir = join(sandbox, 'workspaces')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(workspaceDir, { recursive: true })

  const snapshots = Array.from({ length: 4 }, (_, index) => {
    const root = join(workspaceDir, `root-${index + 1}`)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'doc.md'), `# Primary ${index + 1}\n`)
    writeFileSync(join(root, 'secondary.md'), `# Secondary ${index + 1}\n`)
    if (index === 2) writeFileSync(join(root, 'foreground-target.md'), '# Foreground Target\n')
    return createWindowSnapshot(`window-${index + 1}`, `workspace-${index + 1}`, root)
  })
  writeFileSync(join(userDataDir, 'workspace-session.json'), JSON.stringify({
    desktopSession: {
      version: 1,
      windows: snapshots,
      lastActiveWindowId: 'window-3',
    },
    windowLifecycleV1Migrated: true,
  }))

  const app = await electron.launch({
    args: [`--user-data-dir=${userDataDir}`, join(process.cwd(), 'out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MD_VIEWER_E2E_VISIBLE: '0',
    },
  })
  let stderr = ''
  app.process().stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const windowCreatedAt = app.windows().map(() => Date.now())
  app.on('window', () => windowCreatedAt.push(Date.now()))

  try {
    const foreground = await app.firstWindow()
    await foreground.waitForLoadState('domcontentloaded')
    await foreground.waitForSelector('.app', { timeout: 10_000 })

    const foregroundRoot = await foreground.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      return bootstrap.workspaces.find((workspace) => workspace.primaryRoot)?.primaryRoot
    })
    expect(foregroundRoot).toBe(snapshots[2].workspaces[0].primaryRoot)
    expect(app.windows().length).toBeLessThan(4)

    await expect.poll(() => app.windows().length, { timeout: 8_000 }).toBe(4)
    expect(windowCreatedAt).toHaveLength(4)
    for (let index = 1; index < windowCreatedAt.length; index++) {
      expect(windowCreatedAt[index] - windowCreatedAt[index - 1]).toBeGreaterThanOrEqual(450)
    }

    const restored = [] as Array<{ root?: string; headings: string[] }>
    for (const page of app.windows()) {
      await expect(page.locator('.tab')).toHaveCount(2)
      await expect(page.locator('.markdown-body')).toHaveCount(2)
      restored.push(await page.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        return {
          root: bootstrap.workspaces.find((workspace) => workspace.primaryRoot)?.primaryRoot,
          headings: Array.from(document.querySelectorAll('.markdown-body h1')).map((heading) => heading.textContent ?? ''),
        }
      }))
    }
    expect(new Set(restored.map((item) => item.root))).toEqual(
      new Set(snapshots.map((snapshot) => snapshot.workspaces[0].primaryRoot)),
    )
    for (let index = 0; index < snapshots.length; index++) {
      const restoredWindow = restored.find((item) => item.root === snapshots[index].workspaces[0].primaryRoot)
      expect(restoredWindow?.headings).toEqual(expect.arrayContaining([
        `Primary ${index + 1}`,
        `Secondary ${index + 1}`,
      ]))
    }

    const destroyedListenerCounts = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.webContents.listenerCount('destroyed')))
    expect(Math.max(...destroyedListenerCounts)).toBeLessThanOrEqual(3)
    expect(stderr).not.toContain('MaxListenersExceededWarning')

    const foregroundTarget = join(snapshots[2].workspaces[0].primaryRoot, 'foreground-target.md')
    await app.evaluate(({ app }, filePath) => {
      app.emit('open-file', { preventDefault() {} } as Electron.Event, filePath)
    }, foregroundTarget)
    await expect(foreground.locator('.tab', { hasText: 'foreground-target.md' })).toBeVisible()
    for (const page of app.windows().filter((page) => page !== foreground)) {
      await expect(page.locator('.tab', { hasText: 'foreground-target.md' })).toHaveCount(0)
    }
  } finally {
    await app.close()
    rmSync(sandbox, { recursive: true, force: true })
  }
})
