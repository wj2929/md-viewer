import { mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

async function status(page: Page) {
  return page.evaluate(async () => {
    const boot = await window.api.getWorkspaceBootstrap()
    const workspace = boot.workspaces.find(item => item.id === boot.activeWorkspaceId)!
    const context = { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
    return { root: workspace.primaryRoot, health: await window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch), index: await window.api.getWorkspaceIndexStatus(context) }
  })
}
async function search(page: Page, text: string) {
  return page.evaluate(async text => {
    const boot = await window.api.getWorkspaceBootstrap()
    const workspace = boot.workspaces.find(item => item.id === boot.activeWorkspaceId)!
    return window.api.queryWorkspaceIndex({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }, text)
  }, text)
}

test.describe('复杂目录监听与索引收敛', () => {
  test('POSIX 冒号文件变更不使整个工作区降级', async ({ page, electronApp, testDir }) => {
    test.skip(process.platform === 'win32', 'Windows does not allow colon filenames')
    writeFileSync(join(testDir, 'colon:name.md'), '# Colon initial')
    writeFileSync(join(testDir, 'demo.csproj'), '<Project />')
    mkdirSync(join(testDir, 'bin'))
    const generated = join(testDir, 'bin/colon:generated.md')
    writeFileSync(generated, '# Generated colon initial')
    await openFolderViaIPC(electronApp, testDir)
    await expect.poll(async () => (await status(page)).health.state).toBe('healthy')
    await page.locator('.file-tree-row.file', { hasText: 'colon:name.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Colon initial')
    writeFileSync(join(testDir, 'colon:name.md'), '# Colon changed\n\ncolonregressionneedle')
    await expect(page.locator('.markdown-body h1')).toHaveText('Colon changed')
    await expect.poll(async () => (await search(page, 'colonregressionneedle')).length).toBe(1)
    expect((await status(page)).health.state).toBe('healthy')
    await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
    writeFileSync(join(testDir, 'test1.md'), '# Normal after colon')
    await expect(page.locator('.markdown-body h1')).toHaveText('Normal after colon')
    expect((await status(page)).health.state).toBe('healthy')
    const bin = page.locator('.file-tree-row.directory', { hasText: 'bin' })
    if (await bin.getAttribute('aria-expanded') === 'false') await bin.click()
    await page.locator('.file-tree-row.file', { hasText: 'colon:generated.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Generated colon initial')
    await expect.poll(async () => (await status(page)).health.state).toBe('healthy')
    expect((await status(page)).root).toBe(testDir)
    expect((await status(page)).health.partialCoverage).toBe(true)
    writeFileSync(generated, '# Generated colon changed\n\ngeneratedcolonneedle')
    await expect(page.locator('.markdown-body h1')).toHaveText('Generated colon changed')
    await expect.poll(async () => (await search(page, 'generatedcolonneedle')).length).toBe(1)
    const secondWindow = electronApp.waitForEvent('window')
    await page.evaluate(() => window.api.newWindow())
    const other = await secondWindow
    await other.waitForSelector('.app')
    await other.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(testDir, 'test1.md'))
    await expect(other.locator('.markdown-body h1')).toHaveText('Normal after colon')
    writeFileSync(generated, '# Generated colon second change')
    writeFileSync(join(testDir, 'test1.md'), '# Other window live')
    await expect(page.locator('.markdown-body h1')).toHaveText('Generated colon second change')
    await expect(other.locator('.markdown-body h1')).toHaveText('Other window live')
    expect((await status(page)).root).toBe(testDir)
    expect((await status(other)).health.state).toBe('healthy')
  })

  for (const shape of ['burst', 'three-waves'] as const) {
    test(`501→751 文档的 ${shape} 变更自动收敛，无需手工重试`, async ({ page, electronApp, testDir }, testInfo) => {
      test.setTimeout(45000)
      const root = join(testDir, shape)
      mkdirSync(root)
      writeFileSync(join(root, 'alive.md'), '# Burst initial')
      for (let i = 0; i < 20; i++) mkdirSync(join(root, `group-${i}`))
      for (let i = 0; i < 500; i++) writeFileSync(join(root, `group-${i % 20}/item-${i}.md`), `# Original ${i}\n\nburstoriginal${i}`)
      await openFolderViaIPC(electronApp, root)
      await expect.poll(async () => (await status(page)).health.state, { timeout: 15000 }).toBe('healthy')
      await page.locator('.file-tree-row.file', { hasText: 'alive.md' }).click()
      await expect(page.locator('.markdown-body h1')).toHaveText('Burst initial')
      for (let wave = 0; wave < 3; wave++) {
        const begin = Math.floor(wave * 500 / 3)
        const end = Math.floor((wave + 1) * 500 / 3)
        for (let i = begin; i < end; i++) {
          const file = join(root, `group-${i % 20}/item-${i}.md`)
          if (i < 250) unlinkSync(file)
          else if (i < 350) renameSync(file, join(root, `group-${i % 20}/renamed-${i}.md`))
          else { writeFileSync(`${file}.tmp`, `# Atomic ${i}`); renameSync(`${file}.tmp`, file) }
          writeFileSync(join(root, `group-${i % 20}/added-${i}.md`), `# Added ${i}\n\nburstadded${i}`)
        }
        if (shape === 'three-waves' && wave < 2) await page.waitForTimeout(750)
      }
      writeFileSync(join(root, 'alive.md'), '# Burst final')
      const lastWaveEnded = performance.now()
      await expect(page.locator('.markdown-body h1')).toHaveText('Burst final', { timeout: 10000 })
      await expect.poll(async () => {
        const current = await status(page)
        return { root: current.root, watch: current.health.state, index: current.index.state, count: current.index.indexedDocuments, pending: current.index.pendingDocuments }
      }, { timeout: 10000 }).toEqual({ root, watch: 'healthy', index: 'ready', count: 751, pending: 0 })
      expect(readdirSync(root, { recursive: true }).filter(name => String(name).endsWith('.md'))).toHaveLength(751)
      expect(await search(page, 'burstoriginal249')).toHaveLength(0)
      expect(await search(page, 'burstadded499')).toHaveLength(1)
      const convergenceMs = performance.now() - lastWaveEnded
      expect(convergenceMs).toBeLessThan(10000)
      await testInfo.attach('burst-convergence', { body: JSON.stringify({ shape, convergenceMs }), contentType: 'application/json' })
      for (const directory of await page.locator('.file-tree-row.directory').all()) {
        if (await directory.getAttribute('aria-expanded') === 'false') await directory.click()
      }
      await expect(page.locator('.file-tree-row.file')).toHaveCount(751)
      writeFileSync(join(root, 'alive.md'), '# Live after burst')
      await expect(page.locator('.markdown-body h1')).toHaveText('Live after burst')
    })
  }

  test('80 层文件树仍保留可读标签并收到最深层文件变更', async ({ page, electronApp, testDir }, testInfo) => {
    const root = join(testDir, 'deep-root')
    mkdirSync(root)
    const directories: string[] = []
    let deepest = root
    for (let i = 0; i < 80; i++) { deepest = join(deepest, `层 ${i}`); mkdirSync(deepest); directories.push(deepest) }
    const file = join(deepest, '末端 #? [图].md')
    const safeFile = process.platform === 'win32' ? join(deepest, '末端 [图].md') : file
    writeFileSync(safeFile, '# Deep initial')
    await electronApp.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, root)
    await page.getByRole('button', { name: /^(打开文件夹|切换文件夹)$/ }).first().click()
    await expect.poll(async () => (await status(page)).root).toBe(root)
    await expect.poll(async () => (await status(page)).health.state).toBe('healthy')
    await testInfo.attach('deep-tree-observation', { body: await page.evaluate(async root => JSON.stringify({
      tree: await window.api.readDir(root),
      rows: [...document.querySelectorAll('.file-tree-row')].map(row => row.getAttribute('data-file-path')),
      body: document.body.innerText.slice(0, 1500),
    }), root), contentType: 'application/json' })
    for (const directory of directories) {
      const row = page.locator(`.file-tree-row.directory[data-file-path=${JSON.stringify(directory)}]`)
      if (await row.getAttribute('aria-expanded') === 'false') await row.click()
    }
    const row = page.locator(`.file-tree-row.file[data-file-path=${JSON.stringify(safeFile)}]`)
    await row.click()
    expect((await status(page)).root).toBe(root)
    await expect(row).toHaveAttribute('aria-level', '81')
    await expect(page.locator('.markdown-body h1')).toHaveText('Deep initial')
    writeFileSync(safeFile, '# Deep changed')
    await expect(page.locator('.markdown-body h1')).toHaveText('Deep changed')
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      await page.setViewportSize({ width: theme === 'light' ? 1200 : 800, height: 700 })
      await row.scrollIntoViewIfNeeded()
      const bounds = await row.locator('.file-name').evaluate(element => {
        const label = element.getBoundingClientRect()
        const tree = element.closest('.file-tree')!.getBoundingClientRect()
        return { width: label.width, left: label.left, right: label.right, treeLeft: tree.left, treeRight: tree.right }
      })
      expect(bounds.width).toBeGreaterThan(60)
      expect(bounds.left).toBeGreaterThanOrEqual(bounds.treeLeft)
      expect(bounds.right).toBeLessThanOrEqual(bounds.treeRight)
      await page.mouse.move(650, 100)
      await page.screenshot({ path: testInfo.outputPath(`deep-tree-${theme}.png`) })
    }
  })
})
