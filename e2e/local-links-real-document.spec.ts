import { test, expect } from './fixtures/electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'

const realDocument = process.env.MD_VIEWER_LOCAL_LINKS_REAL_DOC

test('指定真实文档只读抽样三处JSON及一次MD来源返回', async ({ electronApp, page }, testInfo) => {
  test.skip(!realDocument, '只在明确指定的本机只读核验中运行；常规测试不用用户目录。')
  const source = realDocument!
  const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  const sourceBefore = sha(source)
  await electronApp.evaluate(({ shell }) => {
    const reject = () => { throw new Error('Readonly check forbids external actions') }
    shell.openPath = reject as any
    shell.openExternal = reject as any
    shell.showItemInFolder = reject
  })
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), source)
  await page.waitForTimeout(550) // 等待测试注入的延迟显式打开事件，不混入实际点击测量。
  await expect(page.locator('.tab.active .tab-name')).toHaveText(basename(source))
  const jsonLinks = page.locator('.markdown-body a')
  const refs = await jsonLinks.evaluateAll(nodes => nodes.map(node => node.getAttribute('href') ?? '').filter(href => /\.json$/i.test(href)))
  expect(refs.length).toBeGreaterThanOrEqual(3)
  const checks: { bytes: number; unchanged: boolean }[] = []
  for (const index of [0, Math.floor(refs.length / 2), refs.length - 1]) {
    const ref = refs[index]
    const target = resolve(dirname(source), decodeURIComponent(ref))
    const before = sha(target)
    const link = page.locator(`.markdown-body a[href=${JSON.stringify(ref)}]`).first()
    await link.scrollIntoViewIfNeeded()
    const offset = await link.evaluate(node => node.getBoundingClientRect().top)
    const count = await page.locator('.tab').count()
    await link.click()
    await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
    await expect(page.locator('.tab')).toHaveCount(count)
    await page.getByRole('button', { name: '关闭附件', exact: true }).click()
    await expect(link).toBeFocused()
    expect(Math.abs(await link.evaluate(node => node.getBoundingClientRect().top) - offset)).toBeLessThan(3)
    const unchanged = sha(target) === before
    expect(unchanged).toBe(true)
    checks.push({ bytes: readFileSync(target).length, unchanged })
  }
  const mdRef = await page.locator('.markdown-body a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href') ?? '').find(href => /\.(?:md|markdown|mdown|mkd|mkdn)(?:#.*)?$/i.test(href)))
  expect(mdRef).toBeTruthy()
  const mdLink = page.locator(`.markdown-body a[href=${JSON.stringify(mdRef)}]`).first()
  await mdLink.scrollIntoViewIfNeeded()
  const offset = await mdLink.evaluate(node => node.getBoundingClientRect().top - node.closest('.preview')!.getBoundingClientRect().top)
  await mdLink.click()
  await expect(page.locator('.link-origin-floating')).toBeVisible()
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.tab.active .tab-name')).toHaveText(basename(source))
  await expect.poll(async () => Math.abs(await mdLink.evaluate(node => node.getBoundingClientRect().top - node.closest('.preview')!.getBoundingClientRect().top) - offset)).toBeLessThan(3)
  expect(sha(source)).toBe(sourceBefore)
  writeFileSync(testInfo.outputPath('readonly-result.json'), JSON.stringify({ sourceUnchanged: true, jsonLinkCount: refs.length, checks, mdReturned: true }, null, 2))
})
