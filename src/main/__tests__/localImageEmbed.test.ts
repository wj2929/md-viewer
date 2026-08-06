import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import * as path from 'path'
import { embedLocalImagesInExportedHtml } from '../localImageEmbed'

// 用项目内目录做根，避免 os.tmpdir() 落到 /private/var（受保护路径，会被 validateNotProtected 拒）。
const WORK_ROOT = path.join(process.cwd(), '.tmp', 'local-image-embed-test')
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let dir: string

beforeEach(async () => {
  await mkdir(WORK_ROOT, { recursive: true })
  dir = await mkdtemp(path.join(WORK_ROOT, 'case-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('embedLocalImagesInExportedHtml', () => {
  it('把相对路径本地图片内嵌为 data:base64', async () => {
    await mkdir(path.join(dir, 'images'), { recursive: true })
    await writeFile(path.join(dir, 'images', 'a.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    const html = '<p><img src="./images/a.png" alt="a"></p>'

    const result = await embedLocalImagesInExportedHtml(html, path.join(dir, 'doc.md'))

    expect(result).toContain('data:image/png;base64,')
    expect(result).not.toContain('src="./images/a.png"')
  })

  it('对 URL 编码的文件名解码后内嵌', async () => {
    await mkdir(path.join(dir, 'images'), { recursive: true })
    await writeFile(path.join(dir, 'images', 'a b.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    const html = '<img src="./images/a%20b.png" alt="x">'

    const result = await embedLocalImagesInExportedHtml(html, path.join(dir, 'doc.md'))

    expect(result).toContain('data:image/png;base64,')
  })

  it('跳过 http(s)/data 图片，保持原样', async () => {
    const html = '<img src="https://example.com/x.png"><img src="data:image/png;base64,AAAA">'

    const result = await embedLocalImagesInExportedHtml(html, path.join(dir, 'doc.md'))

    expect(result).toBe(html)
  })

  it('越界路径（../）不内嵌，保持原样', async () => {
    const html = '<img src="../../../secret.png">'

    const result = await embedLocalImagesInExportedHtml(html, path.join(dir, 'doc.md'))

    expect(result).toContain('src="../../../secret.png"')
    expect(result).not.toContain('data:image')
  })

  it('图片不存在时保持原样，不抛错', async () => {
    const html = '<img src="./missing.png">'

    const result = await embedLocalImagesInExportedHtml(html, path.join(dir, 'doc.md'))

    expect(result).toBe(html)
  })

  it('无 img 标签时原样返回', async () => {
    const html = '<h1>Title</h1><p>no images</p>'

    const result = await embedLocalImagesInExportedHtml(html, path.join(dir, 'doc.md'))

    expect(result).toBe(html)
  })
})
