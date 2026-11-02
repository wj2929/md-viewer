import { readFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { test as base, expect, type Route } from '@playwright/test'

async function fulfillPinnedLibrary(route: Route, library: string, version: string): Promise<void> {
  const root = resolve(process.cwd(), 'node_modules', library)
  const installed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  if (installed !== version) throw new Error(`测试需要 ${library}@${version}，本地版本为 ${installed}`)
  const pathname = new URL(route.request().url()).pathname
  const relative = decodeURIComponent(pathname.slice(`/npm/${library}@${version}/`.length))
  const file = resolve(root, relative)
  if (!file.startsWith(root + sep)) throw new Error('测试资源路径越界')
  await route.fulfill({
    path: file,
    contentType: 'application/javascript',
    headers: { 'access-control-allow-origin': '*' },
  })
}

// 保留固定CDN URL及原渲染行为，仅用同版本npm文件替代不稳定的网络传输。
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/**', route => fulfillPinnedLibrary(route, 'mermaid', '11.12.2'))
    await page.route('https://cdn.jsdelivr.net/npm/dompurify@3.3.1/dist/**', route => fulfillPinnedLibrary(route, 'dompurify', '3.3.1'))
    await use(page)
  },
})
export { expect }
