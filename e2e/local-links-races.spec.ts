import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

async function delayRead(electronApp: any, target: string) {
  await electronApp.evaluate(({ ipcMain }, target: string) => {
    const original = (ipcMain as any)._invokeHandlers.get('linkRead:prepareDocument')
    if (typeof original !== 'function') throw new Error('Missing real read handler')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    ;(globalThis as any).__localLinkReadGate = { entered: false, release }
    ipcMain.removeHandler('linkRead:prepareDocument')
    ipcMain.handle('linkRead:prepareDocument', async (event, ...args) => {
      const result = await original(event, ...args) // 保留原主进程真实授权/读取，只延迟交付自建目标。
      if (result.success && result.targetPath === target) {
        ;(globalThis as any).__localLinkReadGate.entered = true
        await gate
      }
      return result
    })
  }, target)
}
test.afterEach(async ({ electronApp, page }, testInfo) => {
  if (!testInfo.title.startsWith('恢复补查与在途')) return
  const status = await page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    return window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)
  })
  const acks = await electronApp.evaluate(() => (globalThis as any).__linkReconcileAcks ?? [])
  await testInfo.attach('real-reconcile-observation', { body: JSON.stringify({ status, acks }), contentType: 'application/json' })
})

for (const change of ['unchanged', 'content', 'resource', 'draft-missing-block'] as const) {
  test(`恢复补查与在途 Wiki 导航：${change}`, async ({ electronApp, page, testDir }, testInfo) => {
    const source = join(testDir, 'A.md'), target = join(testDir, 'B.md')
    writeFileSync(source, '# Root A\n\n[[B#^remote|指定块]]' + (change === 'resource' ? '\n\n![image](./image.png)' : ''))
    writeFileSync(target, '# Target B\n\n实际目标' + (change === 'draft-missing-block' ? '' : ' ^remote'))
    if (change === 'resource') writeFileSync(join(testDir, 'image.png'), Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await openFolderViaIPC(electronApp, testDir)
    const operation = await page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
      return { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
    })
    await expect.poll(() => page.evaluate(async op => (await window.api.getWatchStatus(op.workspaceId, op.lifecycleEpoch)).state, operation)).toBe('healthy')
    if (change === 'draft-missing-block') {
      await page.locator('.file-tree-row.file', { hasText: 'B.md' }).click()
      await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
      await electronApp.evaluate(({ BrowserWindow }, filePath) => {
        BrowserWindow.getAllWindows()[0].webContents.send('markdown:quick-edit', { filePath, mode: 'document' })
      }, target)
      await expect(page.getByLabel('B.md 编辑工作区')).toBeVisible()
      await page.locator('.markdown-workbench-preview-pane .markdown-preview-editable-block', { hasText: '实际目标' }).fill('草稿没有指定块')
      await page.getByRole('button', { name: '退出编辑模式' }).click()
      await expect(page.getByText('草稿预览，未保存')).toBeVisible()
    }
    page.on('dialog', dialog => void dialog.accept())
    await page.locator('.file-tree-row.file', { hasText: 'A.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
    await expect.poll(() => page.evaluate(async op => (await window.api.getWatchStatus(op.workspaceId, op.lifecycleEpoch)).state, operation)).toBe('healthy')
    await electronApp.evaluate(({ ipcMain }) => {
      const original = (ipcMain as any)._invokeHandlers.get('watch:reconciled')
      if (typeof original !== 'function') throw new Error('Missing real reconcile handler')
      ;(globalThis as any).__linkReconcileAcks = []
      ipcMain.removeHandler('watch:reconciled')
      ipcMain.handle('watch:reconciled', async (event, ...args) => {
        const accepted = await original(event, ...args)
        ;(globalThis as any).__linkReconcileAcks.push({ result: args[1], accepted })
        return accepted
      })
    })
    await delayRead(electronApp, target)
    await page.getByRole('link', { name: '指定块', exact: true }).click()
    await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__localLinkReadGate.entered)).toBe(true)
    if (change === 'content') writeFileSync(source, '# Root A updated\n\n[[B#^remote|指定块]]')
    expect(await page.evaluate(op => window.api.notifyWatchGap(op.workspaceId, op.lifecycleEpoch), operation)).toBe(true)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__linkReconcileAcks.some((entry: any) => entry.accepted && entry.result === 'ok'))).toBe(true)
    await expect.poll(() => page.evaluate(async op => (await window.api.getWatchStatus(op.workspaceId, op.lifecycleEpoch)).state, operation)).toBe('healthy')
    if (change === 'content') await expect(page.locator('.markdown-body h1')).toHaveText('Root A updated')
    await electronApp.evaluate(() => (globalThis as any).__localLinkReadGate.release())
    if (change === 'unchanged') {
      await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
      await expect(page.locator('[id="md-block:remote"]')).toBeInViewport()
      await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
    } else {
      await expect(page.getByText(change === 'draft-missing-block' ? '未找到块 ^remote（当前草稿）。'
        : '来源文档已更新，本次跳转已取消，请重新点击链接。', { exact: true })).toBeVisible()
      await expect(page.locator('.markdown-body h1')).toHaveText(change === 'content' ? 'Root A updated' : 'Root A')
      if (change !== 'draft-missing-block') await expect(page.locator('.tab', { hasText: 'B.md' })).toHaveCount(0)
    }
    await testInfo.attach('real-reconcile-acknowledgements', { body: JSON.stringify(await electronApp.evaluate(() => (globalThis as any).__linkReconcileAcks)), contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath(`wiki-reconcile-${change}.png`), animations: 'disabled' })
  })
}

async function fixture(electronApp: any, page: any, testDir: string) {
  writeFileSync(join(testDir, 'A.md'), '# Root A\n\n[B](./B.md)\n\n[C](./C.md)')
  writeFileSync(join(testDir, 'B.md'), '# Target B\n\n原始base')
  writeFileSync(join(testDir, 'C.md'), '# Target C')
  await openFolderViaIPC(electronApp, testDir)
  await page.waitForTimeout(550)
  await page.locator('.file-tree-row.file', { hasText: 'A.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
}

test('迟到B不能覆盖后点C的已提交正文与来路', async ({ electronApp, page, testDir }) => {
  await fixture(electronApp, page, testDir)
  await delayRead(electronApp, join(testDir, 'B.md'))
  await page.getByRole('link', { name: 'B', exact: true }).click()
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__localLinkReadGate.entered)).toBe(true)
  await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
  await page.getByRole('link', { name: 'C', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target C')
  await electronApp.evaluate(() => (globalThis as any).__localLinkReadGate.release())
  await page.waitForTimeout(600)
  await expect(page.locator('.markdown-body h1')).toHaveText('Target C')
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await expect(page.locator('.tab', { hasText: 'B.md' })).toHaveCount(0)
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
})

test('实际目标另一leaf新草稿及焦点不被迟到磁盘结果覆盖或转移', async ({ electronApp, page, testDir }) => {
  await fixture(electronApp, page, testDir)
  await electronApp.evaluate(({ BrowserWindow }, filePath) => {
    BrowserWindow.getAllWindows()[0].webContents.send('file:open-in-split', { filePath, direction: 'horizontal' })
  }, join(testDir, 'B.md'))
  const left = page.locator('.split-leaf-panel').first(), right = page.locator('.split-leaf-panel').last()
  await expect(right.locator('.markdown-body h1')).toHaveText('Target B')
  const leafId = (await right.getAttribute('data-leaf-id'))!
  await electronApp.evaluate(({ BrowserWindow }, data) => {
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:quick-edit', { ...data, mode: 'document' })
  }, { filePath: join(testDir, 'B.md'), leafId })
  const editor = right.locator('.markdown-editor-pane .cm-content')
  await expect(editor).toBeVisible()
  await delayRead(electronApp, join(testDir, 'B.md'))
  await left.getByRole('link', { name: 'B', exact: true }).click()
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__localLinkReadGate.entered)).toBe(true)
  await editor.click()
  await editor.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await editor.pressSequentially('\n\n新草稿必须保持')
  await expect(right.locator('.markdown-body')).toContainText('新草稿必须保持')
  await electronApp.evaluate(() => (globalThis as any).__localLinkReadGate.release())
  await expect(left.locator('.markdown-body')).toContainText('新草稿必须保持')
  await expect(right).toHaveClass(/active/)
  await expect(editor).toBeFocused()
  await expect(left.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await page.waitForTimeout(600)
  await expect(editor).toBeFocused()
  await expect(editor).toContainText('新草稿必须保持')
  page.on('dialog', dialog => dialog.accept())
  await right.getByRole('button', { name: '放弃编辑', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(right.locator('.markdown-body')).not.toContainText('新草稿必须保持')
})
