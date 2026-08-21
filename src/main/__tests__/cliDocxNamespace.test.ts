import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { namespaceLocalImages } from '../cli/docxSourceExporter'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

// 1x1 PNG
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function setup(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-ns-'))
  await mkdir(path.join(tempDir, 'images'), { recursive: true })
  await writeFile(path.join(tempDir, 'images', 'a.png'), PNG_1x1)
  return tempDir
}

describe('namespaceLocalImages', () => {
  it('本地图片引用重写为 __partN__/ 前缀,并收集对应资源', async () => {
    const dir = await setup()
    const md = '# 标题\n\n![图](images/a.png)\n\n正文'
    const { markdown, resources } = await namespaceLocalImages(md, path.join(dir, 'ch.md'), 2)

    expect(markdown).toContain('![图](__part2__/images/a.png)')
    expect(markdown).not.toContain('](images/a.png)')
    expect(resources).toHaveLength(1)
    expect(resources[0]).toMatchObject({
      path: '__part2__/images/a.png',
      kind: 'binary',
      mediaType: 'image/png',
    })
    expect(resources[0].base64.length).toBeGreaterThan(0)
  })

  it('不同 partIndex 前缀不同,避免同名图撞车', async () => {
    const dir = await setup()
    const md = '![x](images/a.png)'
    const p0 = await namespaceLocalImages(md, path.join(dir, 'ch.md'), 0)
    const p1 = await namespaceLocalImages(md, path.join(dir, 'ch.md'), 1)
    expect(p0.resources[0].path).toBe('__part0__/images/a.png')
    expect(p1.resources[0].path).toBe('__part1__/images/a.png')
  })

  it('远程/data 图片不重写不收集', async () => {
    const dir = await setup()
    const md = '![net](https://x.com/a.png)\n\n![d](data:image/png;base64,AAAA)'
    const { markdown, resources } = await namespaceLocalImages(md, path.join(dir, 'ch.md'), 0)
    expect(markdown).toContain('https://x.com/a.png')
    expect(markdown).not.toContain('__part0__')
    expect(resources).toHaveLength(0)
  })

  it('围栏代码块内的图片语法不重写(避免破坏示例代码)', async () => {
    const dir = await setup()
    const md = '```md\n![示例](images/a.png)\n```\n\n![真图](images/a.png)'
    const { markdown, resources } = await namespaceLocalImages(md, path.join(dir, 'ch.md'), 0)
    // 围栏内保持原样
    expect(markdown).toContain('```md\n![示例](images/a.png)\n```')
    // 围栏外被重写
    expect(markdown).toContain('![真图](__part0__/images/a.png)')
    // 只收集一次(围栏外那个)
    expect(resources).toHaveLength(1)
  })

  it('读不到的图片:引用仍重写,但不收集资源(服务端会告警)', async () => {
    const dir = await setup()
    const md = '![缺](images/missing.png)'
    const { markdown, resources } = await namespaceLocalImages(md, path.join(dir, 'ch.md'), 0)
    expect(markdown).toContain('__part0__/images/missing.png')
    expect(resources).toHaveLength(0)
  })
})
