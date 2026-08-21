import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const OUT_DIR = join(process.cwd(), 'test-results', 'document-marks-visual')

test.describe('文档树背景标记色', () => {
  test('靠近窗口底部时仍完整显示背景标记栏', async ({ page, electronApp, testDir }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (let index = 0; index < 18; index += 1) {
      writeFileSync(join(testDir, `bottom-${String(index).padStart(2, '0')}.md`), `# Bottom ${index}`)
    }

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 900, height: 560 })
    })
    await openFolderViaIPC(electronApp, testDir)

    const tree = page.locator('.file-tree')
    await tree.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    const row = page.locator('.file-tree-row', { hasText: 'test2.md' })
    await row.hover()

    const preview = page.getByRole('dialog', { name: 'test2.md预览与背景标记' })
    await expect(preview).toBeVisible()
    await expect(preview.getByRole('radiogroup', { name: '设置文档背景标记色' })).toBeVisible()

    const box = await preview.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(8)
    expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight - 8))
    await page.screenshot({ path: join(OUT_DIR, 'document-mark-bottom-edge.png'), fullPage: true })
  })

  test('选择颜色后文件树显示柔和底色，并可取消', async ({ page, electronApp, testDir }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    const markedFileName = 'AGENTSCOPE_使用策略_2026-06.md'
    writeFileSync(join(testDir, markedFileName), [
      '---',
      'title: 不应显示的元数据',
      'tags: [preview]',
      '---',
      '# AgentScope 使用策略',
      '',
      '这是第一段完整的摘要内容，用来确认预览不会在半句话中突然结束。',
      '',
      '```ts',
      'const hiddenCode = true',
      '```',
      '',
      '这是后续内容。'.repeat(80),
    ].join('\n'))
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 900, height: 720 })
    })
    await openFolderViaIPC(electronApp, testDir)

    await page.locator('.file-tree-row', { hasText: 'code.md' }).click()
    const row = page.locator('.file-tree-row', { hasText: markedFileName })
    await row.hover()

    const preview = page.getByRole('dialog', { name: `${markedFileName}预览与背景标记` })
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('这是第一段完整的摘要内容')
    await expect(preview).not.toContainText('不应显示的元数据')
    await expect(preview).not.toContainText('hiddenCode')
    const content = preview.locator('.tooltip-content')
    await expect(content).toContainText(/…$/)
    expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await content.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await expect(content).toContainText(/…$/)
    const picker = preview.getByRole('radiogroup', { name: '设置文档背景标记色' })
    await expect(picker.getByRole('radio')).toHaveCount(7)
    await preview.hover()
    await picker.getByRole('radio', { name: '黄色' }).click()

    await expect(row).toHaveClass(/marked-yellow/)
    await page.screenshot({ path: join(OUT_DIR, 'document-mark-yellow.png'), fullPage: true })

    await row.hover()
    const reopenedPreview = page.getByRole('dialog', { name: `${markedFileName}预览与背景标记` })
    await expect(reopenedPreview).toBeVisible()
    await reopenedPreview.hover()
    await reopenedPreview.getByRole('radio', { name: '取消背景标记' }).click()
    await expect(row).not.toHaveClass(/marked-/)
  })
})
