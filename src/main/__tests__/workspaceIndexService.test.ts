import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceIndexService,
  resolveIndexedWikiTargetStatus,
} from '../indexing/WorkspaceIndexService'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import type { IndexedDocument } from '../indexing/types'
import type { WorkspaceRootDelta, WorkspaceWatchService } from '../watching/WorkspaceWatchService'
import { sanitizeDiagnosticMetadata } from '../../shared/diagnostics'

let tempDir: string | null = null

class FakeWatcher {
  getIndexCoverage() { return { token: 'test', complete: true } }
  consumer: ((delta: WorkspaceRootDelta) => void) | null = null
  attachIndexConsumer = vi.fn((_root: string, _id: string, consumer: (delta: WorkspaceRootDelta) => void) => {
    this.consumer = consumer
  })
  detachIndexConsumer = vi.fn()
  emit(delta: WorkspaceRootDelta): void {
    this.consumer?.(delta)
  }
}

beforeEach(async () => { await mkdir(join(process.cwd(), '.tmp'), { recursive: true }) })

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('WorkspaceIndexService', () => {
  it('全量索引、查询、反链并持久化热加载', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-service-'))
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
    expect((await service.getBacklinks(root, 'docs/design.md')).items).toEqual([
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

  it('合并同一时间片的索引进度，但最终完整数量与就绪状态立即发布', async () => {
    tempDir = await mkdtemp(join(process.cwd(), '.tmp', 'mdv-index-progress-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root)
    await Promise.all(Array.from({ length: 64 }, (_, index) => writeFile(join(root, `${index}.md`), `# Fixture ${index}\n`)))
    const service = new WorkspaceIndexService(new WorkspaceIndexStore(join(tempDir, 'storage')), new FakeWatcher() as unknown as WorkspaceWatchService)
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const statuses: Array<{ state: string; indexedDocuments: number }> = []
    try {
      await service.attach(root, 'consumer')
      service.subscribeStatus(root, 'test', status => statuses.push({ ...status }))
      await service.waitUntilIdle(root)
      expect(statuses.length).toBeLessThanOrEqual(3)
      expect(statuses.at(-1)).toMatchObject({ state: 'ready', indexedDocuments: 64, pendingDocuments: 0, errors: 0 })
      expect(service.getStatus(root)).toMatchObject({ state: 'ready', indexedDocuments: 64 })
    } finally {
      clock.mockRestore()
      service.unsubscribeStatus(root, 'test')
      await service.detach(root, 'consumer')
    }
  })

  it('最近文件集合在排序截断前过滤，不泄露其他文件且保留普通查询', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-recent-filter-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root)
    await writeFile(join(root, 'high.md'), 'marker marker marker')
    await writeFile(join(root, 'recent.md'), 'marker')
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
    )
    await service.attach(root, 'consumer')
    try {
      await service.waitUntilIdle(root)
      expect(await service.query(root, 'marker', 1)).toEqual([
        expect.objectContaining({ relativePath: 'high.md' }),
      ])
      expect(await service.query(root, 'marker', 1, new Set(['recent.md']))).toEqual([
        expect.objectContaining({ relativePath: 'recent.md' }),
      ])
      expect(await service.query(root, 'marker', 1, new Set())).toEqual([])
      expect(await service.query(root, 'marker', 1, new Set(['../high.md']))).toEqual([])
    } finally {
      await service.detach(root, 'consumer')
    }
  })

  it('Wiki 反链支持工作区路径、当前目录优先并拒绝歧义 basename', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-wiki-backlinks-'))
    const root = join(tempDir, 'workspace')
    await mkdir(join(root, 'docs'), { recursive: true })
    await mkdir(join(root, 'other'), { recursive: true })
    await writeFile(join(root, 'index.md'), '[[docs/Target#标题|显式目标]]\n[[Target|歧义目标]]')
    await writeFile(join(root, 'docs', 'source.md'), '参见 [[Target|附近目标]]。')
    await writeFile(join(root, 'docs', 'Target.md'), '# 标题')
    await writeFile(join(root, 'other', 'Target.md'), '# 同名')
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
    )
    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)

    expect((await service.getBacklinks(root, 'docs/Target.md')).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRelativePath: 'index.md', rawTarget: 'docs/Target#标题' }),
      expect.objectContaining({ sourceRelativePath: 'docs/source.md', rawTarget: 'Target' }),
    ]))
    expect((await service.getBacklinks(root, 'other/Target.md')).items).toEqual([])
  })

  it('Wiki resolver 在当前目录之后优先工作区根文件', () => {
    const documents = new Map([
      ['Target.md', {} as IndexedDocument],
      ['archive/Target.md', {} as IndexedDocument],
      ['docs/source.md', {} as IndexedDocument],
    ])

    expect(resolveIndexedWikiTargetStatus(documents, 'docs/source.md', 'Target')).toEqual({
      target: 'Target.md',
      ambiguous: false,
    })
    expect(resolveIndexedWikiTargetStatus(documents, 'docs/source.md', 'archive/Target')).toEqual({
      target: 'archive/Target.md',
      ambiguous: false,
    })
  })

  it('反链在查询期区分独立链接与真实表格并保留可读内容', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-backlink-context-'))
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

    expect((await service.getBacklinks(root, 'target.md')).items).toEqual([
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
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-attach-race-'))
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
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-backlinks-'))
    const root = join(tempDir, 'workspace')
    await mkdir(join(root, 'docs'), { recursive: true })
    const links = [
      '[带参数](./docs/design.md?mode=full#安全边界)',
      '[中文](./docs/%E7%9B%AE%E6%A0%87.md)',
      '[井号](./docs/a%23b.md)',
    ]
    const files = [
      ['design.md', '# 设计'],
      ['目标.md', '# 目标'],
      ['a#b.md', '# 井号'],
    ]
    const targets = ['docs/design.md', 'docs/目标.md', 'docs/a#b.md']
    if (process.platform !== 'win32') {
      links.push('[问号](./docs/a%3Fb.md)')
      files.push(['a?b.md', '# 问号'])
      targets.push('docs/a?b.md')
    }
    await writeFile(join(root, 'index.md'), links.join('\n'))
    await Promise.all(files.map(([name, content]) => writeFile(join(root, 'docs', name), content)))
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
    )
    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)

    for (const target of targets) {
      expect((await service.getBacklinks(root, target)).items).toEqual([
        expect.objectContaining({ sourceRelativePath: 'index.md' }),
      ])
    }
  })

  it('目录移动后把整个已索引子树映射到新路径', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-directory-move-'))
    const root = join(tempDir, 'workspace')
    await mkdir(join(root, 'docs', 'nested'), { recursive: true })
    await writeFile(join(root, 'docs', 'a.md'), '# A\n\ndirectory move term')
    await writeFile(join(root, 'docs', 'nested', 'b.md'), '# B\n\nnested move term')
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
    )
    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)

    await mkdir(join(root, 'archive'), { recursive: true })
    await rename(join(root, 'docs'), join(root, 'archive', 'docs'))
    await service.refreshMovedRelativePaths(root, [{
      oldRelativePath: 'docs',
      newRelativePath: 'archive/docs',
    }])
    await service.waitUntilIdle(root)

    expect((await service.query(root, 'directory move term'))[0]?.relativePath)
      .toBe('archive/docs/a.md')
    expect((await service.query(root, 'nested move term'))[0]?.relativePath)
      .toBe('archive/docs/nested/b.md')
    expect(service.getIndexedDocuments(root).map(document => document.relativePath).sort())
      .toEqual(['archive/docs/a.md', 'archive/docs/nested/b.md'])
  })

  it('add/change/remove 增量结果与磁盘一致', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-delta-'))
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

  it('新空目录建立持久化基准；热加载复用；存储缺失仍重新提交', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-empty-baseline-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root)
    const store = new WorkspaceIndexStore(join(tempDir, 'storage'))
    const commit = vi.spyOn(store, 'commit')
    const service = new WorkspaceIndexService(store, new FakeWatcher() as unknown as WorkspaceWatchService)
    await service.attach(root, 'one')
    await service.waitUntilIdle(root)
    expect(commit).toHaveBeenCalledTimes(1)
    await service.rebuild(root)
    expect(commit).toHaveBeenCalledTimes(1)
    vi.spyOn(store, 'load').mockResolvedValueOnce(null)
    await service.rebuild(root)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(service.getStatus(root)).toMatchObject({ state: 'ready', indexedDocuments: 0 })
    await service.detach(root, 'one')
  })

  it('只读 runtime 更新内存但不提交也不抢占 writer lease', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-read-only-baseline-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root)
    await writeFile(join(root, 'a.md'), '# Before')
    const store = new WorkspaceIndexStore(join(tempDir, 'storage'))
    const lease = await store.acquireLock(await realpath(root))
    const commit = vi.spyOn(store, 'commit')
    const service = new WorkspaceIndexService(store, new FakeWatcher() as unknown as WorkspaceWatchService)
    await service.attach(root, 'reader')
    await service.waitUntilIdle(root)
    await writeFile(join(root, 'a.md'), '# After')
    await service.refreshRelativePaths(root, ['a.md'])
    expect(await service.query(root, 'After')).toHaveLength(1)
    expect(service.getStatus(root).state).toBe('read-only')
    expect(commit).not.toHaveBeenCalled()
    expect(await lease.isHeld()).toBe(true)
    await service.detach(root, 'reader')
    await lease.release()
  })

  it('重复事件和没有变化的 rebuild 不重复提交整个索引', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-noop-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root)
    const file = join(root, 'a.md')
    await writeFile(file, '# A')
    const store = new WorkspaceIndexStore(join(tempDir, 'storage'))
    const commit = vi.spyOn(store, 'commit')
    const watcher = new FakeWatcher()
    const service = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)
    await service.attach(root, 'one')
    await service.waitUntilIdle(root)
    const generation = service.getStatus(root).generation
    const canonicalFile = await realpath(file)
    for (let i = 0; i < 200; i++) watcher.emit({ kind: 'changed', path: canonicalFile })
    await service.waitUntilIdle(root)
    await Promise.all([service.rebuild(root), service.rebuild(root)])
    expect(commit).toHaveBeenCalledTimes(1)
    expect(service.getStatus(root).generation).toBe(generation)
    await service.detach(root, 'one')
  })

  it('提交失败后相同内容仍会重试，并能由新实例读取成功代次', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-commit-retry-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root)
    const file = join(root, 'a.md')
    await writeFile(file, '# Before')
    const store = new WorkspaceIndexStore(join(tempDir, 'storage'))
    const service = new WorkspaceIndexService(store, new FakeWatcher() as unknown as WorkspaceWatchService)
    await service.attach(root, 'one')
    await service.waitUntilIdle(root)
    await writeFile(file, '# After')
    const commit = vi.spyOn(store, 'commit').mockRejectedValueOnce(new Error('injected commit failure'))
    await service.refreshRelativePaths(root, ['a.md'])
    expect(service.getStatus(root).state).toBe('error')
    await service.refreshRelativePaths(root, ['a.md'])
    expect(commit).toHaveBeenCalledTimes(2)
    expect(service.getStatus(root)).toMatchObject({ state: 'ready', errors: 0 })
    const loaded = await new WorkspaceIndexStore(join(tempDir, 'storage')).load(
      await realpath(root), await store.inspectRootFingerprint(root),
    )
    expect(loaded?.documents[0].headings[0].text).toBe('After')
    await service.detach(root, 'one')
  })

  it('在途提交期间只保留一个尾随 flush，显式刷新等到自己的变更持久化', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-tail-flush-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root)
    await writeFile(join(root, 'a.md'), '# A')
    await writeFile(join(root, 'b.md'), '# B')
    const store = new WorkspaceIndexStore(join(tempDir, 'storage'))
    const watcher = new FakeWatcher()
    const service = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)
    await service.attach(root, 'one')
    await service.waitUntilIdle(root)
    const original = store.commit.bind(store)
    let release!: () => void
    let started!: () => void
    const beginning = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const commit = vi.spyOn(store, 'commit').mockImplementationOnce(async options => {
      started()
      await gate
      return original(options)
    })
    await writeFile(join(root, 'a.md'), '# A changed')
    watcher.emit({ kind: 'changed', path: await realpath(join(root, 'a.md')) })
    await beginning
    await writeFile(join(root, 'b.md'), '# B changed')
    const b = await realpath(join(root, 'b.md'))
    for (let i = 0; i < 200; i++) { watcher.emit({ kind: 'changed', path: b }); await Promise.resolve() }
    let explicitDone = false
    const explicit = service.refreshRelativePaths(root, ['b.md']).then(() => { explicitDone = true })
    expect(explicitDone).toBe(false)
    expect(service.getStatus(root).state).toBe('updating')
    release()
    await explicit
    await service.waitUntilIdle(root)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(service.getStatus(root)).toMatchObject({ state: 'ready', indexedDocuments: 2 })
    const loaded = await store.load(await realpath(root), await store.inspectRootFingerprint(root))
    expect(loaded?.documents.find(document => document.relativePath === 'b.md')?.headings[0].text).toBe('B changed')
    await service.detach(root, 'one')
  })

  it('已开始的扫描之后到达重建请求保留一轮尾随扫描', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-tail-build-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root)
    await writeFile(join(root, 'a.md'), '# A')
    const store = new WorkspaceIndexStore(join(tempDir, 'storage'))
    const service = new WorkspaceIndexService(store, new FakeWatcher() as unknown as WorkspaceWatchService)
    await service.attach(root, 'one')
    await service.waitUntilIdle(root)
    let release!: () => void
    let started!: () => void
    const beginning = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const original = store.load.bind(store)
    const load = vi.spyOn(store, 'load').mockImplementationOnce(async (...args) => {
      started()
      await gate
      return original(...args)
    })
    const first = service.rebuild(root)
    await beginning
    const second = service.rebuild(root)
    const third = service.rebuild(root)
    release()
    await Promise.all([first, second, third])
    expect(load).toHaveBeenCalledTimes(2)
    expect(service.getStatus(root).state).toBe('ready')
    await service.detach(root, 'one')
  })

  it('记录 build/query/backlinks 的聚合耗时且不记录查询正文', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-diagnostics-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'source.md'), '[目标](./target.md)\n\nprivate search phrase')
    await writeFile(join(root, 'target.md'), '# 目标')
    const recordMainEvent = vi.fn()
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
      { recordMainEvent },
    )

    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)
    await service.query(root, 'private search phrase')
    await service.getBacklinks(root, 'target.md')
    await Promise.all([service.rebuild(root), service.rebuild(root)])
    await service.detach(root, 'consumer')

    const events = recordMainEvent.mock.calls.map(([event]) => event)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'index.work.start', metadata: expect.objectContaining({ workloadKind: 'build' }) }),
      expect.objectContaining({
        event: 'index.query.window',
        metadata: expect.objectContaining({ workloadKind: 'query', queryCount: 1, operationCount: 1 }),
      }),
      expect.objectContaining({
        event: 'index.query.window',
        metadata: expect.objectContaining({ workloadKind: 'backlinks', backlinksQueryCount: 1, operationCount: 1 }),
      }),
    ]))
    expect(events.some(event =>
      event.event.startsWith('index.work.')
      && (event.metadata?.workloadKind === 'query' || event.metadata?.workloadKind === 'backlinks')
    )).toBe(false)
    expect(JSON.stringify(events)).not.toContain('private search phrase')
    expect(events.every(event => sanitizeDiagnosticMetadata(event.metadata) !== null)).toBe(true)
    const buildSummary = events.find(event =>
      event.event === 'index.work.summary' && event.metadata?.workloadKind === 'build'
    )
    expect(buildSummary?.metadata).toMatchObject({
      filesProcessed: 2,
      bytesReadForValidation: expect.any(Number),
      readAvoidedCount: 0,
    })
    const buildQueueWaits = events
      .filter(event => event.event === 'index.work.summary' && event.metadata?.workloadKind === 'build')
      .map(event => Number(event.metadata?.queueWaitMs))
    expect(buildQueueWaits.some(wait => wait > 0)).toBe(true)
    const topKEvents = events.filter(event =>
      event.event === 'index.activity.window' && event.metadata?.selection === 'topK'
    )
    expect(topKEvents.length).toBeGreaterThan(0)
    const topKCounts = new Map<string, number>()
    for (const event of topKEvents) {
      expect(event.rawPath).toEqual(expect.any(String))
      expect(event.metadata).not.toHaveProperty('path')
      const operationId = event.operationId ?? ''
      topKCounts.set(operationId, (topKCounts.get(operationId) ?? 0) + 1)
    }
    expect([...topKCounts.values()].every(count => count <= 5)).toBe(true)
  })

  it('批量聚合正常反链查询而不逐次写生命周期', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-query-window-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'source.md'), '[目标](./target.md)')
    await writeFile(join(root, 'target.md'), '# 目标')
    const recordMainEvent = vi.fn()
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
      { recordMainEvent },
    )
    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)
    recordMainEvent.mockClear()

    // 这里只验证正常分支的计数聚合，不让并发 IO 的机器负载决定慢查询分类。
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    try {
      await Promise.all(Array.from({ length: 502 }, () => service.getBacklinks(root, 'target.md')))
      await service.detach(root, 'consumer')
    } finally {
      vi.useRealTimers()
    }

    const events = recordMainEvent.mock.calls.map(([event]) => event)
    const windows = events.filter(event => event.event === 'index.query.window')
    expect(windows).toHaveLength(6)
    expect(windows.reduce((sum, event) => sum + Number(event.metadata?.operationCount), 0)).toBe(502)
    expect(windows.every(event => event.metadata?.errorCount === 0 && event.metadata?.slowCount === 0), JSON.stringify(windows.map(event => event.metadata))).toBe(true)
    expect(events.some(event =>
      event.event.startsWith('index.work.') && event.metadata?.workloadKind === 'backlinks'
    )).toBe(false)
  })

  it('慢查询和失败查询仍记录完整异常生命周期', async () => {
    tempDir = await mkdtemp(join(join(process.cwd(), '.tmp'), 'mdv-index-query-anomaly-'))
    const root = join(tempDir, 'workspace')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'source.md'), '# Source\n\nneedle')
    const recordMainEvent = vi.fn()
    const service = new WorkspaceIndexService(
      new WorkspaceIndexStore(join(tempDir, 'storage')),
      new FakeWatcher() as unknown as WorkspaceWatchService,
      { recordMainEvent },
    )
    await service.attach(root, 'consumer')
    await service.waitUntilIdle(root)
    recordMainEvent.mockClear()

    const originalRead = (service as any).readIfCurrent.bind(service)
    vi.spyOn(service as any, 'readIfCurrent').mockImplementationOnce(async (...args: unknown[]) => {
      await new Promise(resolve => setTimeout(resolve, 110))
      return originalRead(...args)
    }).mockRejectedValueOnce(new Error('private failure text'))

    await expect(service.query(root, 'needle')).resolves.toHaveLength(1)
    await expect(service.query(root, 'needle')).rejects.toThrow('private failure text')
    await service.detach(root, 'consumer')

    const events = recordMainEvent.mock.calls.map(([event]) => event)
    const queryLifecycle = events.filter(event =>
      event.event.startsWith('index.work.') && event.metadata?.workloadKind === 'query'
    )
    expect(queryLifecycle.filter(event => event.event === 'index.work.start')).toHaveLength(2)
    expect(queryLifecycle.filter(event => event.event === 'index.work.summary')).toEqual([
      expect.objectContaining({ outcome: 'success', metadata: expect.objectContaining({ durationMs: expect.any(Number) }) }),
      expect.objectContaining({ outcome: 'error', metadata: expect.objectContaining({ errorCode: 'INDEX_WORK_FAILED' }) }),
    ])
    expect(queryLifecycle.filter(event => event.event === 'index.work.terminal')).toHaveLength(2)
    const aggregate = events.find(event => event.event === 'index.query.window')
    expect(aggregate?.metadata).toMatchObject({
      workloadKind: 'query',
      operationCount: 2,
      successCount: 1,
      errorCount: 1,
      slowCount: 1,
    })
    expect(JSON.stringify(events)).not.toContain('private failure text')
  })
})
