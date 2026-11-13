import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('五千文档首索引：索引就绪、正文可读、构建期间可操作', async ({ electronApp, page, testDir }, info) => {
  test.setTimeout(120_000)
  const root = join(testDir, 'index-performance')
  mkdirSync(root)
  writeFileSync(join(root, 'README.md'), '# Index performance fixture\n\nPublic fixture only.\n')
  let bytes = 0
  for (let group = 0; group < 10; group++) {
    const directory = join(root, `group-${group}`)
    mkdirSync(directory)
    for (let index = 0; index < 500; index++) {
      const content = `---\naliases: [public-${group}-${index}]\n---\n# Document ${group}-${index}\n\n[Root](../README.md)\n\n${'Public index performance fixture. '.repeat(64)}\n\nUNIQUE_${group}_${index}\n`
      bytes += Buffer.byteLength(content)
      writeFileSync(join(directory, `document-${index}.md`), content)
    }
  }
  await electronApp.evaluate(() => {
    const probe = { maxGap: 0, previous: performance.now() }
    ;(globalThis as any).__indexHeartbeat = probe
    ;(globalThis as any).__indexHeartbeatTimer = setInterval(() => {
      const now = performance.now(); probe.maxGap = Math.max(probe.maxGap, now - probe.previous); probe.previous = now
    }, 25)
  })
  const started = Date.now()
  try {
    await openFolderViaIPC(electronApp, root)
    await expect(page.locator('.markdown-body h1')).toHaveText('Index performance fixture')
    const readableMs = Date.now() - started
    const context = await page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
      return { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
    })
    const during = await page.evaluate(operation => window.api.getWorkspaceIndexStatus(operation), context)
    const interactionStarted = Date.now()
    await page.getByRole('button', { name: /^目录树排序：/ }).click()
    await expect(page.getByRole('dialog', { name: '目录树全局排序' })).toBeVisible()
    await page.keyboard.press('Escape')
    const interactionMs = Date.now() - interactionStarted
    await expect.poll(() => page.evaluate(operation => window.api.getWorkspaceIndexStatus(operation), context), { timeout: 90_000, intervals: [100, 250, 500] }).toMatchObject({ state: 'ready', indexedDocuments: 5001, pendingDocuments: 0, errors: 0 })
    const indexedMs = Date.now() - started
    const match = await page.evaluate(operation => window.api.queryWorkspaceIndex(operation, 'UNIQUE_9_499', 10), context)
    expect(match.some(item => item.relativePath === 'group-9/document-499.md')).toBe(true)
    const mainHeartbeatMaxGapMs = await electronApp.evaluate(() => (globalThis as any).__indexHeartbeat.maxGap)
    const events = await electronApp.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('fs')!, path = process.getBuiltinModule('path')!
      const directory = path.join(app.getPath('userData'), 'diagnostic-logs')
      return fs.readdirSync(directory).filter(name => name.endsWith('.jsonl')).flatMap(name => fs.readFileSync(path.join(directory, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))).filter(event => event.category === 'index' || event.event.startsWith('index.'))
    })
    writeFileSync(info.outputPath('index-performance.json'), JSON.stringify({ documents: 5001, bytes, readableMs, indexedMs, interactionMs, during, mainHeartbeatMaxGapMs, events, method: '自建约10MiB夹具与全新profile，正文可读到索引ready及末文件命中；25ms主进程心跳，含自动化往返。本机存储结果，不外推同步盘或其他设备。' }, null, 2))
    await page.screenshot({ path: info.outputPath('index-ready.png') })
  } finally {
    await electronApp.evaluate(() => clearInterval((globalThis as any).__indexHeartbeatTimer))
  }
})
