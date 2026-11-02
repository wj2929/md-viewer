import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPdfExportStyles } from '../ipc/exportStyles'

let directory: string
vi.mock('electron', () => ({ app: { getAppPath: () => directory } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../renderer/src/assets/katex-woff2.css?raw', () => ({
  default: Array.from({ length: 20 }, (_, i) => `@font-face{font-family:KaTeX_Test;src:url(./KaTeX_Test-${i}.woff2?no-inline)}`).join('\n'),
}))

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mdv-pdf-assets-test-'))
  const assets = path.join(directory, 'out/renderer/assets')
  await mkdir(assets, { recursive: true })
  const rules: string[] = []
  for (let i = 0; i < 20; i++) {
    await writeFile(path.join(assets, `KaTeX_Test-${i}.woff2`), `woff2-fixture-${i}`)
    rules.push(`@font-face{font-family:KaTeX_Test;src:url("./KaTeX_Test-${i}.woff2") format("woff2")}`)
  }
  await writeFile(path.join(assets, 'katex-woff2-fixture.css'), '.app{height:100vh}body{overflow:hidden}\n' + rules.join('\n'))
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('sealed PDF font assets', () => {
  it('inlines exactly the bundled font files, including URLs in combined Markdown CSS', async () => {
    const result = await getPdfExportStyles('@font-face{src:url(./KaTeX_Test-1.woff2)}', 'pre{color:red}')
    expect(result.katexCss.match(/data:font\/woff2;base64,/g)).toHaveLength(20)
    expect(result.katexCss).not.toContain('./KaTeX_')
    expect(result.katexCss).not.toContain('.app')
    expect(result.katexCss).not.toContain('overflow:hidden')
    expect(result.markdownCss).toContain('data:font/woff2;base64,')
    expect(result.prismCss).toBe('pre{color:red}')
  })
  it('maps source font names to the existing hashed production assets', async () => {
    const assets = path.join(directory, 'out/renderer/assets')
    const cssFile = path.join(assets, 'katex-woff2-fixture.css')
    let css = await readFile(cssFile, 'utf8')
    for (let i = 0; i < 20; i++) {
      const original = `KaTeX_Test-${i}.woff2`
      const hashed = `KaTeX_Test-${i}-hash1234.woff2`
      await rename(path.join(assets, original), path.join(assets, hashed))
      css = css.replace(original, hashed)
    }
    await writeFile(cssFile, css)
    const result = await getPdfExportStyles('p{color:black}', '')
    expect(result.katexCss.match(/data:font\/woff2;base64,/g)).toHaveLength(20)
    expect(result.katexCss).not.toContain('.woff2?no-inline')
    expect(result.katexCss).not.toContain('.app')
  })
  it('fails closed for incomplete fonts without fetching remote resources', async () => {
    await rm(path.join(directory, 'out/renderer/assets/KaTeX_Test-19.woff2'))
    await expect(getPdfExportStyles('', '')).rejects.toThrow('包内公式字体读取失败')
  })
  it('does not read arbitrary files named by bundled CSS', async () => {
    const css = path.join(directory, 'out/renderer/assets/katex-woff2-fixture.css')
    await writeFile(css, (await readFile(css, 'utf8')).replace('KaTeX_Test-1.woff2', '../../secret.woff2'))
    await expect(getPdfExportStyles('', '')).rejects.toThrow('包内公式字体读取失败')
  })
})
