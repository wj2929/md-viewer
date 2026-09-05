import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import type { WorkspaceRootDelta, WorkspaceWatchService } from '../watching/WorkspaceWatchService'

let tempDir: string | null = null

class FakeWatcher {
  consumer: ((delta: WorkspaceRootDelta) => void) | null = null
  attachIndexConsumer = vi.fn((_root: string, _id: string, consumer: (delta: WorkspaceRootDelta) => void) => {
    this.consumer = consumer
  })
  detachIndexConsumer = vi.fn()
  emit(delta: WorkspaceRootDelta): void {
    this.consumer?.(delta)
  }
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('WorkspaceIndexService', () => {
  it('全量索引、查询、反链并持久化热加载', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-service-'))
    const root = join(tempDir, 'workspace')
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'index.md'), '# 首页\n\n参见 [设计](./docs/design.md#安全边界)。')
    await writeFile(join(root, 'docs', 'design.md'), '# 设计\n\n## 安全边界\n\n授权边界说明。')
    const watcher = new FakeWatcher()
    const store = new WorkspaceIndexStore(join(tempDir, 'storage'))
    const service = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)

    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)
    expect(service.getStatus(root)).toMatchObject({ state: 'ready', indexedDocuments: 2 })

    const results = await service.query(root, '授权边界')
    expect(results).toEqual([
      expect.objectContaining({ relativePath: 'docs/design.md', lineStart: 3, snippet: '## 安全边界' }),
    ])
    expect(await service.getBacklinks(root, 'docs/design.md')).toEqual([
      expect.objectContaining({
        sourceRelativePath: 'index.md',
        lineStart: 3,
        context: '参见 设计。',
        placement: 'prose',
      }),
    ])

    await service.detach(root, 'consumer')
    const warmWatcher = new FakeWatcher()
    const warm = new WorkspaceIndexService(store, warmWatcher as unknown as WorkspaceWatchService)
    await warm.attach(root, 'warm')
    await warm.waitUntilIdle(root)
    expect(warm.getStatus(root)).toMatchObject({ state: 'ready', indexedDocuments: 2 })
  })

  it('反链在查询期区分独立链接与真实表格并保留可读内容', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-backlink-context-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'source.md'), [
      '[分类目录](./target.md) · [示例包首页](./home.md)',
      '',
      '| 文档 | 案例数 | 方式 |',
      '| --- | ---: | --- |',
      '| [目标](./target.md) | 33 | 本地 |',
    ].join('\n'))
    await writeFile(join(root, 'target.md'), '# 目标')
    await writeFile(join(root, 'home.md'), '# 首页')
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
    )

    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)

    expect(await service.getBacklinks(root, 'target.md')).toEqual([
      expect.objectContaining({
        lineStart: 1,
        context: '分类目录 · 示例包首页',
        placement: 'standalone-link',
      }),
      expect.objectContaining({
        lineStart: 5,
        context: '目标 · 33 · 本地',
        placement: 'table',
      }),
    ])
  })

  it('同一 root 的并发 attach 共享一个初始化和 writer runtime', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-attach-race-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'a.md'), '# A')
    const watcher = new FakeWatcher()
    const store = new WorkspaceIndexStore(join(tempDir, 'storage'))
    const acquireLock = vi.spyOn(store, 'acquireLock')
    const service = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)

    await Promise.all([
      service.attach(root, 'consumer-a'),
      service.attach(root, 'consumer-b'),
      service.attach(root, 'consumer-a'),
    ])
    await service.waitUntilIdle(root)

    expect(acquireLock).toHaveBeenCalledTimes(1)
    expect(watcher.attachIndexConsumer).toHaveBeenCalledTimes(2)
    expect(service.getStatus(root)).toMatchObject({ state: 'ready', indexedDocuments: 1 })
    await service.detach(root, 'consumer-a')
    expect(service.getStatus(root).state).toBe('ready')
    await service.detach(root, 'consumer-b')
    expect(service.getStatus(root).state).toBe('detached')
  })

  it('按原始 target 解析 query、fragment 和 URL 编码文件名', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-backlinks-'))
    const root = join(tempDir, 'workspace')
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'index.md'), [
      '[带参数](./docs/design.md?mode=full#安全边界)',
      '[中文](./docs/%E7%9B%AE%E6%A0%87.md)',
      '[井号](./docs/a%23b.md)',
      '[问号](./docs/a%3Fb.md)',
    ].join('\n'))
    await Promise.all([
      writeFile(join(root, 'docs', 'design.md'), '# 设计'),
      writeFile(join(root, 'docs', '目标.md'), '# 目标'),
      writeFile(join(root, 'docs', 'a#b.md'), '# 井号'),
      writeFile(join(root, 'docs', 'a?b.md'), '# 问号'),
    ])
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
    )
    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)

    for (const target of ['docs/design.md', 'docs/目标.md', 'docs/a#b.md', 'docs/a?b.md']) {
      expect(await service.getBacklinks(root, target)).toEqual([
        expect.objectContaining({ sourceRelativePath: 'index.md' }),
      ])
    }
  })

  it('add/change/remove 增量结果与磁盘一致', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-delta-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root, { recursive: true })
    const filePath = join(root, 'a.md')
    await writeFile(filePath, '# A\n\nfirst term')
    const watcher = new FakeWatcher()
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      watcher as unknown as WorkspaceWatchService,
    )
    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)

    await writeFile(filePath, '# A\n\nsecond term')
    expect(watcher.consumer).not.toBeNull()
    const canonicalFilePath = await realpath(filePath)
    watcher.emit({ kind: 'changed', path: canonicalFilePath })
    await new Promise(resolve => setTimeout(resolve, 0))
    await service.waitUntilIdle(root)
    expect(service.getStatus(root)).toMatchObject({ state: 'ready', indexedDocuments: 1, errors: 0 })
    expect(await service.query(root, 'second')).toHaveLength(1)
    expect(await service.query(root, 'first')).toHaveLength(0)

    await rm(filePath)
    watcher.emit({ kind: 'removed', path: canonicalFilePath })
    await new Promise(resolve => setTimeout(resolve, 0))
    await service.waitUntilIdle(root)
    expect(service.getStatus(root)).toMatchObject({ indexedDocuments: 0 })
  })
})
