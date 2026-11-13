import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import type { WorkspaceWatchService } from '../watching/WorkspaceWatchService'

let directory: string

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  directory = await mkdtemp(join(process.cwd(), '.tmp', 'mdv-index-shutdown-'))
  await mkdir(join(directory, 'workspace'))
  await writeFile(join(directory, 'workspace', 'fixture.md'), '# Fixture')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function createService() {
  const store = new WorkspaceIndexStore(join(directory, 'storage'))
  const watcher = {
    getIndexCoverage: () => ({ token: 'test', complete: true }),
    attachIndexConsumer: vi.fn(),
    detachIndexConsumer: vi.fn(),
  }
  const service = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)
  return { store, watcher, service, root: join(directory, 'workspace') }
}

describe('WorkspaceIndexService shutdown', () => {
  it('等待所有消费者的索引队列和锁释放，且关闭期间不再附加新消费者', async () => {
    const { store, watcher, service, root } = createService()
    const acquire = vi.spyOn(store, 'acquireLock')
    await service.attach(root, 'first')
    await service.attach(root, 'second')
    await service.waitUntilIdle(root)
    const lock = await acquire.mock.results[0].value
    const release = lock.release.bind(lock)
    const entered = deferred(), gate = deferred()
    const releaseSpy = vi.spyOn(lock, 'release').mockImplementation(async () => {
      entered.resolve()
      await gate.promise
      await release()
    })
    let work: Promise<void> | undefined
    try {
      work = service.shutdown()
      expect(service.shutdown()).toBe(work)
      await entered.promise
      let finished = false
      void work.then(() => { finished = true })
      expect(await service.attach(root, 'late')).toMatchObject({ state: 'detached' })
      expect(finished).toBe(false)
      expect(acquire).toHaveBeenCalledTimes(1)
      gate.resolve()
      await work
      expect(releaseSpy).toHaveBeenCalledTimes(1)
      expect(watcher.detachIndexConsumer).toHaveBeenCalledTimes(2)
      expect(service.getStatus(root).state).toBe('detached')
      const nextOwner = await store.acquireLock(root)
      expect(nextOwner.acquired).toBe(true)
      await nextOwner.release()
    } finally {
      gate.resolve()
      await work
      await release()
    }
  })

  it('等待已经开始的初始化，再释放其锁而不是留下晚到的 runtime', async () => {
    const { store, watcher, service, root } = createService()
    const acquire = store.acquireLock.bind(store)
    const entered = deferred(), gate = deferred()
    const acquireSpy = vi.spyOn(store, 'acquireLock').mockImplementation(async path => {
      entered.resolve()
      await gate.promise
      return acquire(path)
    })
    const attaching = service.attach(root, 'initializing')
    let work: Promise<void> | undefined
    try {
      await entered.promise
      work = service.shutdown()
      let finished = false
      void work.then(() => { finished = true })
      await Promise.resolve()
      expect(finished).toBe(false)
      gate.resolve()
      expect(await attaching).toMatchObject({ state: 'detached' })
      await work
      expect(service.getStatus(root).state).toBe('detached')
      expect(acquireSpy).toHaveBeenCalledTimes(1)
      expect(watcher.detachIndexConsumer).toHaveBeenCalledTimes(1)
      const nextOwner = await acquire(root)
      expect(nextOwner.acquired).toBe(true)
      await nextOwner.release()
    } finally {
      gate.resolve()
      await attaching
      await work
    }
  })

  it('在已有提交完成前不释放锁，关闭完成后所有根都可重新取得写锁', async () => {
    const { store, service, root } = createService()
    const commit = store.commit.bind(store)
    const entered = deferred(), gate = deferred()
    vi.spyOn(store, 'commit').mockImplementation(async (...args) => {
      entered.resolve()
      await gate.promise
      return commit(...args)
    })
    const otherRoot = join(directory, 'other')
    await mkdir(otherRoot)
    await writeFile(join(otherRoot, 'other.md'), '# Other')
    await service.attach(root, 'window')
    await service.attach(otherRoot, 'other-window')
    let work: Promise<void> | undefined
    try {
      await entered.promise
      work = service.shutdown()
      let finished = false
      void work.then(() => { finished = true })
      await Promise.resolve()
      expect(finished).toBe(false)
      const contender = await store.acquireLock(root)
      expect(contender.acquired).toBe(false)
      await contender.release()
      gate.resolve()
      await work
      for (const path of [root, otherRoot]) {
        expect(service.getStatus(path).state).toBe('detached')
        const nextOwner = await store.acquireLock(path)
        expect(nextOwner.acquired).toBe(true)
        await nextOwner.release()
      }
    } finally {
      gate.resolve()
      await work
    }
  })

  it.each(['query', 'backlinks'] as const)('退出等待已经在读取文件的 %s 请求完成，并拒绝新查询', async kind => {
    const { store, service, root } = createService()
    const acquire = vi.spyOn(store, 'acquireLock')
    await writeFile(join(root, 'fixture.md'), '# Fixture\n\n[Target](./target.md)')
    await writeFile(join(root, 'target.md'), '# Target')
    await service.attach(root, 'window')
    await service.waitUntilIdle(root)
    const lock = await acquire.mock.results[0].value
    const release = lock.release.bind(lock)
    vi.spyOn(lock, 'release').mockResolvedValue(undefined)
    const entered = deferred(), gate = deferred()
    const reader = service as unknown as { readIfCurrent: () => Promise<string> }
    const read = vi.spyOn(reader, 'readIfCurrent').mockImplementation(async () => {
      entered.resolve()
      await gate.promise
      return '# Fixture\n\n[Target](./target.md)'
    })
    const querying = kind === 'query' ? service.query(root, 'fixture') : service.getBacklinks(root, 'target.md')
    let work: Promise<void> | undefined
    try {
      await entered.promise
      work = service.shutdown()
      let finished = false
      void work.then(() => { finished = true })
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(finished).toBe(false)
      await expect(service.query(root, 'fixture')).rejects.toThrow('工作区索引未附加')
      await expect(service.getBacklinks(root, 'target.md')).rejects.toThrow('工作区索引未附加')
      gate.resolve()
      await Promise.all([work, querying])
      expect(read).toHaveBeenCalledTimes(1)
      expect(service.getDiagnosticActivity()).toMatchObject({ activeIndexBuilds: 0, activeIndexReads: 0 })
    } finally {
      gate.resolve()
      await querying
      await work
      read.mockRestore()
      await release()
    }
  })

  it('等待窗口关闭已经发起的 detach，不重复释放同一把锁', async () => {
    const { store, service, root } = createService()
    const acquire = vi.spyOn(store, 'acquireLock')
    await service.attach(root, 'window')
    await service.waitUntilIdle(root)
    const lock = await acquire.mock.results[0].value
    const release = lock.release.bind(lock)
    const entered = deferred(), gate = deferred()
    const releaseSpy = vi.spyOn(lock, 'release').mockImplementation(async () => {
      entered.resolve()
      await gate.promise
      await release()
    })
    const detaching = service.detach(root, 'window')
    let work: Promise<void> | undefined
    try {
      await entered.promise
      work = service.shutdown()
      let finished = false
      void work.then(() => { finished = true })
      await Promise.resolve()
      expect(finished).toBe(false)
      gate.resolve()
      await Promise.all([work, detaching])
      expect(releaseSpy).toHaveBeenCalledTimes(1)
      expect(service.getStatus(root).state).toBe('detached')
    } finally {
      gate.resolve()
      await detaching
      await work
      await release()
    }
  })
})
