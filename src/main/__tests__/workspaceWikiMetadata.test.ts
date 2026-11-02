import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import type { WorkspaceRootDelta, WorkspaceWatchService } from '../watching/WorkspaceWatchService'

class WikiWatcher {
  coverage = { token: 'root:1:0:0', complete: true }
  getIndexCoverage = vi.fn(() => ({ ...this.coverage }))
  consumer?: (delta: WorkspaceRootDelta) => void
  attachIndexConsumer(_root: string, _id: string, consumer: (delta: WorkspaceRootDelta) => void): void { this.consumer = consumer }
  detachIndexConsumer(): void {}
  emit(delta: WorkspaceRootDelta): void { this.consumer?.(delta) }
}

const directories: string[] = []
const services: Array<{ service: WorkspaceIndexService; root: string }> = []
afterEach(async () => {
  for (const { service, root } of services.splice(0)) await service.detach(root, 'test')
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const directory = await realpath(await mkdtemp(join(process.cwd(), '.tmp', 'mdv-wiki-metadata-')))
  directories.push(directory)
  const root = join(directory, 'workspace')
  await mkdir(root)
  const watcher = new WikiWatcher()
  const store = new WorkspaceIndexStore(join(directory, 'cache'))
  const service = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)
  services.push({ service, root })
  return { directory, root, watcher, store, service }
}

const note = (alias: string) => `---\naliases: [${alias}]\n---\n\n# 正文\n`

describe('workspace Wiki metadata snapshots', () => {
  it('反链确认普通 alias、不计嵌入或 frontmatter，并保留覆盖缺口', async () => {
    const { root, service } = await fixture()
    await writeFile(join(root, 'target.md'), note('Guide'))
    await writeFile(join(root, 'source.md'), '---\nvalue: "[[Guide]]"\n---\n\n[[Guide]]\n\n![[Guide]]')
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    expect(await service.getBacklinks(root, 'target.md')).toMatchObject({ coverage: 'complete', items: [{ sourceRelativePath: 'source.md', lineStart: 5 }] })
    await mkdir(join(root, 'vendor'))
    await writeFile(join(root, 'vendor', 'Guide.md'), '# Actual file')
    expect((await service.getBacklinks(root, 'target.md')).items).toEqual([])
    await rm(join(root, 'vendor', 'Guide.md'))
    await writeFile(join(root, 'bad.md'), '---\naliases: [broken\n---')
    await service.refreshRelativePaths(root, ['bad.md'])
    expect(await service.getBacklinks(root, 'target.md')).toEqual({ coverage: 'partial', items: [] })
  })

  it('无效 UTF-8 不提供可信 alias，但不新增读取失败正文副本', async () => {
    const { root, service } = await fixture()
    await writeFile(join(root, 'target.md'), Buffer.concat([Buffer.from(note('Guide')), Buffer.from([0xff])]))
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    expect(service.getWikiSnapshot(root)?.ready).toBe(false)
    expect(service.getWikiSnapshot(root)?.aliases.has('Guide')).toBe(false)
  })
  it('首次扫描未完成不能判定唯一，不为查询 attach 根', async () => {
    const { root, service, store } = await fixture()
    await writeFile(join(root, 'a.md'), note('Guide'))
    expect(service.getWikiSnapshot(root)).toBeNull()
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const original = store.load.bind(store)
    vi.spyOn(store, 'load').mockImplementationOnce(async (...args) => { await waiting; return original(...args) })
    await service.attach(root, 'test')
    expect(service.getWikiSnapshot(root)?.ready).toBe(false)
    release()
    await service.waitUntilIdle(root)
    const snapshot = service.getWikiSnapshot(root)!
    expect(snapshot.ready).toBe(true)
    expect([...snapshot.aliases.get('Guide')!]).toEqual(['a.md'])
  })

  it('热缓存复用仍恢复别名，不多提交且持久 document 无新字段', async () => {
    const { root, service, store } = await fixture()
    await writeFile(join(root, 'a.md'), note('Guide') + '[[Guide]]\n![[Guide]]')
    const commit = vi.spyOn(store, 'commit')
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    expect(commit).toHaveBeenCalledTimes(1)
    await service.rebuild(root)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(service.getWikiSnapshot(root)?.aliases.get('Guide')?.has('a.md')).toBe(true)
    await service.detach(root, 'test')
    const watcher = new WikiWatcher()
    const warm = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)
    services.push({ service: warm, root })
    await warm.attach(root, 'test'); await warm.waitUntilIdle(root)
    expect(warm.getWikiSnapshot(root)?.ready).toBe(true)
    expect(warm.getWikiSnapshot(root)?.aliases.get('Guide')?.has('a.md')).toBe(true)
    expect(commit).toHaveBeenCalledTimes(1)
    const document = warm.getIndexedDocuments(root)[0]
    expect(Object.hasOwn(document, 'aliases')).toBe(false)
    expect(document.outboundLinks.every(link => !Object.hasOwn(link, 'wikiEmbed'))).toBe(true)
    expect(warm.getWikiSnapshot(root)?.metadata.get('a.md')?.links.map(link => link.wikiEmbed)).toEqual([false, true])
  })

  it('直接刷新入队立即失效，旧快照内容不被增量改写', async () => {
    const { root, service } = await fixture()
    await writeFile(join(root, 'a.md'), note('Before'))
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    const before = service.getWikiSnapshot(root)!
    await writeFile(join(root, 'a.md'), note('After'))
    const refresh = service.refreshRelativePaths(root, ['a.md'])
    expect(before.isCurrent()).toBe(false)
    expect(service.getWikiSnapshot(root)?.ready).toBe(false)
    await refresh
    const after = service.getWikiSnapshot(root)!
    expect(after.ready).toBe(true)
    expect(after.aliases.has('Before')).toBe(false)
    expect(after.aliases.get('After')?.has('a.md')).toBe(true)
    expect(before.aliases.get('Before')?.has('a.md')).toBe(true)
    expect(before.aliases.has('After')).toBe(false)
  })

  it('重复别名保存所有候选，改名及删除撤销旧路径', async () => {
    const { root, service, watcher } = await fixture()
    await writeFile(join(root, 'a.md'), note('Guide'))
    await writeFile(join(root, 'b.md'), note('Guide'))
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    expect(service.getWikiSnapshot(root)?.aliases.get('Guide')?.size).toBe(2)
    await rename(join(root, 'a.md'), join(root, 'c.md'))
    const snapshot = service.getWikiSnapshot(root)!
    const move = service.refreshMovedRelativePaths(root, [{ oldRelativePath: 'a.md', newRelativePath: 'c.md' }])
    expect(snapshot.isCurrent()).toBe(false)
    await move
    expect([...service.getWikiSnapshot(root)!.aliases.get('Guide')!].sort()).toEqual(['b.md', 'c.md'])
    await rm(join(root, 'b.md'))
    watcher.emit({ kind: 'removed', path: join(root, 'b.md') })
    await service.waitUntilIdle(root)
    expect([...service.getWikiSnapshot(root)!.aliases.get('Guide')!]).toEqual(['c.md'])
  })

  it('目录增删只对新增子树对齐，推断 renamed 不触发全量扫描', async () => {
    const { root, service, watcher, store } = await fixture()
    await writeFile(join(root, 'base.md'), '# Base')
    const loads = vi.spyOn(store, 'load')
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    await mkdir(join(root, 'new', 'nested'), { recursive: true })
    await writeFile(join(root, 'new', 'nested', 'target.md'), note('Fresh'))
    watcher.emit({ kind: 'folder-added', path: join(root, 'new') })
    watcher.emit({ kind: 'folder-added', path: join(root, 'new', 'nested') })
    expect(service.getWikiSnapshot(root)?.ready).toBe(false)
    await service.waitUntilIdle(root)
    expect(service.getWikiSnapshot(root)?.aliases.get('Fresh')?.has('new/nested/target.md')).toBe(true)
    watcher.emit({ kind: 'renamed', oldPath: join(root, 'x.md'), newPath: join(root, 'y.md'), inferred: true })
    await service.waitUntilIdle(root)
    expect(loads).toHaveBeenCalledTimes(1)
    await rm(join(root, 'new'), { recursive: true })
    watcher.emit({ kind: 'folder-removed', path: join(root, 'new') })
    await service.waitUntilIdle(root)
    expect(service.getWikiSnapshot(root)?.aliases.has('Fresh')).toBe(false)
  })

  it('监听缺口独立失效且补查不等待自身健康状态', async () => {
    const { root, service, watcher } = await fixture()
    await writeFile(join(root, 'a.md'), note('Guide'))
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    const snapshot = service.getWikiSnapshot(root)!
    watcher.coverage = { token: 'root:1:1:0', complete: false }
    expect(snapshot.isCurrent()).toBe(false)
    expect(service.getWikiSnapshot(root)?.ready).toBe(false)
    await service.reconcileWatch(root, 'refresh')
    await service.reconcileWatch(root, 'drain')
    expect(service.getWikiSnapshot(root)?.ready).toBe(false)
    watcher.coverage = { token: 'root:1:1:1', complete: true }
    expect(service.getWikiSnapshot(root)?.ready).toBe(true)
    const final = service.getWikiSnapshot(root)!
    await service.detach(root, 'test')
    expect(final.isCurrent()).toBe(false)
  })

  it('只读写锁状态不阻止完整 metadata', async () => {
    const { root, service, store } = await fixture()
    await writeFile(join(root, 'a.md'), note('Guide'))
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    const second = new WorkspaceIndexService(store, new WikiWatcher() as unknown as WorkspaceWatchService)
    services.push({ service: second, root })
    await second.attach(root, 'test'); await second.waitUntilIdle(root)
    expect(second.getStatus(root).state).toBe('read-only')
    expect(second.getWikiSnapshot(root)?.ready).toBe(true)
  })

  it('不完整 YAML 阻断别名唯一性但不损坏正文索引，未观察目录不贡献别名', async () => {
    const { root, service } = await fixture()
    await mkdir(join(root, 'env'))
    await writeFile(join(root, 'env', 'ignored.md'), note('Ignored'))
    await writeFile(join(root, 'a.md'), note('Guide'))
    await writeFile(join(root, 'bad.md'), '---\naliases: [broken\n---\n正文')
    await service.attach(root, 'test'); await service.waitUntilIdle(root)
    expect(service.getStatus(root).state).toBe('ready')
    expect(service.getWikiSnapshot(root)?.ready).toBe(false)
    expect(service.getWikiSnapshot(root)?.aliases.has('Ignored')).toBe(false)
    await writeFile(join(root, 'bad.md'), '# 修复')
    await service.refreshRelativePaths(root, ['bad.md'])
    expect(service.getWikiSnapshot(root)?.ready).toBe(true)
  })
})
