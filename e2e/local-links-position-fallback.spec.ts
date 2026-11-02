import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

test('长表格来源内容已变化时回退到静态标题，不命中旧重复链接', async ({ electronApp, page, testDir }) => {
  const table = '|编号|内容|\n|---|---|\n' + Array.from({ length: 120 }, (_, n) => `|${n}|fixture row|`).join('\n')
  const tail = Array.from({ length: 35 }, (_, n) => `尾部段落 ${n}\n`).join('\n')
  const source = '# Source\n\n' + table + '\n\n## 返回章节\n\n[B](./B.md)\n\n' + tail
  writeFileSync(join(testDir, 'A.md'), source)
  writeFileSync(join(testDir, 'B.md'), '# Target B')
  await openFolderViaIPC(electronApp, testDir)
  await page.waitForTimeout(550)
  const link = page.getByRole('link', { name: 'B', exact: true })
  await link.scrollIntoViewIfNeeded()
  const offset = await page.locator('.markdown-body h2').evaluate(node => node.getBoundingClientRect().top - node.closest('.preview')!.getBoundingClientRect().top)
  await link.click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  writeFileSync(join(testDir, 'A.md'), source.replace('[B](./B.md)', '原链接已经移除，标题仍在。').replace(table, table + '\n|新增|fixture new row|'))
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body')).toContainText('原链接已经移除，标题仍在。')
  await expect.poll(async () => Math.abs(await page.locator('.markdown-body h2').evaluate(node => node.getBoundingClientRect().top - node.closest('.preview')!.getBoundingClientRect().top) - offset)).toBeLessThan(3)
})

test('动态图表中的MD链接使用标题回退，不伪造静态链接occurrence', async ({ electronApp, page, testDir }, testInfo) => {
  writeFileSync(join(testDir, 'A.md'), '# Source\n\n## 图表章节\n\n```dot\ndigraph G { a [label="B", href="./B.md"]; }\n```\n\n' + Array.from({ length: 35 }, (_, n) => `尾段 ${n}\n`).join('\n'))
  writeFileSync(join(testDir, 'B.md'), '# Target B')
  await openFolderViaIPC(electronApp, testDir)
  await page.waitForTimeout(550)
  const link = page.locator('.markdown-body svg a')
  await expect(link).toBeVisible()
  expect(await link.getAttribute('data-mdv-link-ordinal')).toBeNull()
  const href = await link.evaluate(node => ({ href: node.getAttribute('href'), xlinkHref: node.getAttribute('xlink:href') }))
  await testInfo.attach('dynamic-anchor', { body: JSON.stringify(href), contentType: 'application/json' })
  await link.click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Source')
  await expect(page.locator('.markdown-body svg a')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('dynamic-source-return.png') })
})
