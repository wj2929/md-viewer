import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {} }))
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})
import { readdir } from 'node:fs'
import { findWikiDocumentFile } from '../localResourceResolver'

const directories: string[] = []
afterEach(async () => {
  vi.mocked(readdir).mockImplementation((await vi.importActual<typeof import('node:fs')>('node:fs')).readdir)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(process.cwd(), '.tmp', 'wiki-file-')))
  directories.push(root)
  await mkdir(join(root, 'notes'))
  const source = join(root, 'notes', 'source.md')
  await writeFile(source, '# Source')
  const write = async (name: string) => {
    const target = join(root, name)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, '# Target')
    return target
  }
  return { root, source, write }
}

describe('普通 Wiki 文件名候选', () => {
  it('保留源目录、根目录、全根 basename 的优先级及索引外目录', async () => {
    const { root, source, write } = await fixture()
    const vendor = await write('vendor/Guide.md')
    expect(await findWikiDocumentFile(root, source, 'Guide')).toEqual({ status: 'found', canonicalPath: vendor })
    const atRoot = await write('Guide.md')
    expect(await findWikiDocumentFile(root, source, 'Guide')).toEqual({ status: 'found', canonicalPath: atRoot })
    const local = await write('notes/Guide.md')
    expect(await findWikiDocumentFile(root, source, 'Guide')).toEqual({ status: 'found', canonicalPath: local })
  })
  it('同级多个 Markdown 后缀或 basename 是歧义，不取第一个', async () => {
    const { root, source, write } = await fixture()
    await write('a/Guide.md'); await write('b/Guide.md')
    expect(await findWikiDocumentFile(root, source, 'Guide')).toEqual({ status: 'ambiguous' })
    await write('notes/Guide.md'); await write('notes/Guide.markdown')
    expect(await findWikiDocumentFile(root, source, 'Guide')).toEqual({ status: 'ambiguous' })
  })
  it('未知点号名称优先同名真实资源，再 Markdown 扩展；名称不二次解码', async () => {
    const { root, source, write } = await fixture()
    const markdown = await write('版本 1.0.md')
    expect(await findWikiDocumentFile(root, source, '版本 1.0')).toEqual({ status: 'found', canonicalPath: markdown })
    const resource = await write('vendor/版本 1.0')
    expect(await findWikiDocumentFile(root, source, '版本 1.0')).toEqual({ status: 'found', canonicalPath: resource })
    const percent = await write('100%25.md')
    expect(await findWikiDocumentFile(root, source, '100%25')).toEqual({ status: 'found', canonicalPath: percent })
  })
  it('只有完整缺失返回 missing，目录、断链和越界软链都不能回落别名', async () => {
    const { root, source, write } = await fixture()
    expect(await findWikiDocumentFile(root, source, 'Absent')).toEqual({ status: 'missing' })
    await mkdir(join(root, 'Guide.md'))
    expect(await findWikiDocumentFile(root, source, 'Guide')).toEqual({ status: 'unavailable' })
    await symlink(join(root, 'absent'), join(root, 'Broken.md'))
    expect(await findWikiDocumentFile(root, source, 'Broken')).toEqual({ status: 'unavailable' })
    const other = await fixture()
    await symlink(await other.write('target.md'), join(root, 'Outside.md'))
    expect(await findWikiDocumentFile(root, source, 'Outside')).toEqual({ status: 'unavailable' })
    await write('notes/valid.md')
    expect(await findWikiDocumentFile(root, source, '../valid')).toEqual({ status: 'invalid' })
  })
  it('glob 吞掉的读取错误仍使查询不完整', async () => {
    const { root, source } = await fixture()
    vi.mocked(readdir).mockImplementation((_directory, _options, callback: any) => {
      callback(Object.assign(new Error('injected'), { code: 'EACCES' }), [])
    })
    expect(await findWikiDocumentFile(root, source, 'Absent')).toEqual({ status: 'unavailable' })
  })
})
