// @vitest-environment node

import * as io from 'fs/promises'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INDEX_SCHEMA_VERSION, INDEX_STORAGE_VERSION, WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import { buildFullSha256Revision } from '../revisionToken'
import type { IndexedDocument } from '../indexing/types'

vi.mock('fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('fs/promises')>() }))

let tempDir: string | null = null

function document(relativePath: string, content: string): IndexedDocument {
  return {
    schemaVersion: 1,
    rootKey: '',
    indexInstanceId: '',
    relativePath,
    revisionToken: buildFullSha256Revision(content),
    mtimeMs: 1,
    size: Buffer.byteLength(content),
    indexedAt: 1,
    headings: [],
    outboundLinks: [],
    terms: { content: 1 },
    lineCount: 1,
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('WorkspaceIndexStore', () => {
  it('用安装级 HMAC key 派生 root/document key 并提交 CURRENT generation', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-store-'))
    const storageRoot = join(tempDir, 'index')
    const workspaceRoot = join(tempDir, 'workspace')
    const store = new WorkspaceIndexStore(storageRoot)

    const rootKey = await store.rootKey(workspaceRoot)
    const documentKey = await store.documentKey(rootKey, 'docs/a.md')
    expect(rootKey).toMatch(/^[a-f0-9]{64}$/)
    expect(documentKey).toMatch(/^[a-f0-9]{64}$/)
    expect(documentKey).not.toBe(rootKey)

    const manifest = await store.commit({
      rootPath: workspaceRoot,
      rootFingerprint: 'darwin:1:2',
      documents: [document('docs/a.md', '# A')],
    })
    const current = await readFile(join(storageRoot, 'v1', rootKey, 'CURRENT'), 'utf8')
    expect(current.trim()).toBe(manifest.generationId)
    expect(await stat(join(storageRoot, 'installation.key'))).toMatchObject({ size: 32 })

    const loaded = await store.load(workspaceRoot, 'darwin:1:2')
    expect(manifest.schemaVersion).toBe(INDEX_STORAGE_VERSION)
    expect(loaded?.manifest.schemaVersion).toBe(INDEX_STORAGE_VERSION)
    expect(loaded?.documents).toEqual([
      expect.objectContaining({
        relativePath: 'docs/a.md',
        schemaVersion: INDEX_SCHEMA_VERSION,
      }),
    ])
    expect(await store.load(workspaceRoot, 'darwin:changed')).toBeNull()
  })

  it('拒绝旧 schema，以便新增 Wiki 链接语义时触发重建', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-schema-'))
    const storageRoot = join(tempDir, 'index')
    const root = join(tempDir, 'workspace')
    const store = new WorkspaceIndexStore(storageRoot)
    const manifest = await store.commit({
      rootPath: root,
      rootFingerprint: 'darwin:1:2',
      documents: [document('a.md', '[[Target]]')],
    })
    const rootKey = await store.rootKey(root)
    const manifestPath = join(
      storageRoot,
      'v1',
      rootKey,
      'generations',
      manifest.generationId,
      'manifest.json',
    )
    const staleManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    staleManifest.schemaVersion = INDEX_SCHEMA_VERSION - 1
    await writeFile(manifestPath, JSON.stringify(staleManifest))

    expect(await store.load(root, 'darwin:1:2')).toBeNull()
  })

  it('同一 root 的第二个 writer 进入只读锁状态', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-lock-'))
    const root = join(tempDir, 'workspace')
    const first = new WorkspaceIndexStore(join(tempDir, 'index'))
    const second = new WorkspaceIndexStore(join(tempDir, 'index'))

    const firstLock = await first.acquireLock(root)
    expect(firstLock.acquired).toBe(true)
    expect((await second.acquireLock(root)).acquired).toBe(false)
    await firstLock.release()
    const nextLock = await second.acquireLock(root)
    expect(nextLock.acquired).toBe(true)
    await nextLock.release()
  })

  it('进程异常退出后自动回收失效的 writer lock', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-stale-lock-'))
    const storageRoot = join(tempDir, 'index')
    const root = join(tempDir, 'workspace')
    const store = new WorkspaceIndexStore(storageRoot)
    const rootKey = await store.rootKey(root)
    const lockDir = join(storageRoot, 'v1', rootKey)
    const lockPath = join(lockDir, 'writer.lock')
    await mkdir(lockDir, { recursive: true })
    await writeFile(lockPath, `${JSON.stringify({ pid: 999999, startedAt: 1 })}\n`)

    const lock = await store.acquireLock(root)
    expect(lock.acquired).toBe(true)
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({
      pid: process.pid,
      ownerId: expect.any(String),
    })

    await lock.release()
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('同一进程并发回收失效锁时只产生一个 writer', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-stale-race-'))
    const storageRoot = join(tempDir, 'index')
    const root = join(tempDir, 'workspace')
    const seed = new WorkspaceIndexStore(storageRoot)
    const rootKey = await seed.rootKey(root)
    const lockDir = join(storageRoot, 'v1', rootKey)
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'writer.lock'), `${JSON.stringify({ pid: 999999, startedAt: 1 })}\n`)

    const locks = await Promise.all(
      Array.from({ length: 16 }, () => new WorkspaceIndexStore(storageRoot).acquireLock(root))
    )
    expect(locks.filter(lock => lock.acquired)).toHaveLength(1)
    await Promise.all(locks.map(lock => lock.release()))
  })

  it('冷重建相同 revision 时生成与新 index instance 匹配的分片', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-instance-'))
    const store = new WorkspaceIndexStore(join(tempDir, 'index'))
    const root = join(tempDir, 'workspace')
    const first = await store.commit({
      rootPath: root,
      rootFingerprint: 'darwin:1:2',
      documents: [document('a.md', '# A')],
    })
    const second = await store.commit({
      rootPath: root,
      rootFingerprint: 'darwin:1:2',
      documents: [document('a.md', '# A')],
    })

    expect(second.indexInstanceId).not.toBe(first.indexInstanceId)
    expect(await store.load(root, 'darwin:1:2')).toMatchObject({
      manifest: { indexInstanceId: second.indexInstanceId },
      documents: [{ indexInstanceId: second.indexInstanceId }],
    })
  })

  it('相同稳定内容直接复用分片，不创建临时文件或执行分片 sync', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-reuse-'))
    const store = new WorkspaceIndexStore(join(tempDir, 'index'))
    const root = join(tempDir, 'workspace')
    const options = { rootPath: root, rootFingerprint: 'darwin:1:2', documents: [document('a.md', '# A')] }
    const first = await store.commit(options)
    const open = vi.spyOn(io, 'open')
    const second = await store.commit({
      ...options, previousInstanceId: first.indexInstanceId,
      documents: [{ ...options.documents[0], mtimeMs: 2, indexedAt: 2 }],
    })
    expect(open.mock.calls.filter(([file]) => String(file).includes('/shards/'))).toEqual([])
    expect(second.documents.map(({ relativePath, revisionToken, shardFile }) => ({ relativePath, revisionToken, shardFile })))
      .toEqual(first.documents.map(({ relativePath, revisionToken, shardFile }) => ({ relativePath, revisionToken, shardFile })))
    expect((await store.load(root, options.rootFingerprint))?.documents).toEqual([
      expect.objectContaining({ mtimeMs: 2, indexedAt: 2 }),
    ])
  })

  it.each(['shard', 'manifest', 'current'] as const)('%s 失败保留旧 CURRENT，重试后可加载新内容', async stage => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-publish-failure-'))
    const storage = join(tempDir, 'index')
    const store = new WorkspaceIndexStore(storage)
    const root = join(tempDir, 'workspace')
    const first = await store.commit({ rootPath: root, rootFingerprint: 'fp', documents: [document('a.md', '# Before')] })
    const current = join(storage, 'v1', first.rootKey, 'CURRENT')
    const nativeOpen = io.open
    const nativeRename = io.rename
    let injected = false
    vi.spyOn(io, 'open').mockImplementation(async (...args) => {
      const file = String(args[0])
      if (!injected && ((stage === 'shard' && file.includes('/shards/')) || (stage === 'manifest' && file.endsWith('/manifest.json')))) {
        injected = true
        throw Object.assign(new Error('injected write failure'), { code: 'EIO' })
      }
      return nativeOpen(...args)
    })
    vi.spyOn(io, 'rename').mockImplementation(async (...args) => {
      if (!injected && stage === 'current' && String(args[1]) === current) {
        injected = true
        throw Object.assign(new Error('injected publish failure'), { code: 'EIO' })
      }
      return nativeRename(...args)
    })
    const next = { rootPath: root, rootFingerprint: 'fp', previousInstanceId: first.indexInstanceId, documents: [document('a.md', '# After')] }
    await expect(store.commit(next)).rejects.toMatchObject({ code: 'EIO' })
    expect((await readFile(current, 'utf8')).trim()).toBe(first.generationId)
    expect((await store.load(root, 'fp'))?.documents[0].revisionToken).toBe(buildFullSha256Revision('# Before'))
    await store.commit(next)
    expect((await new WorkspaceIndexStore(storage).load(root, 'fp'))?.documents[0].revisionToken).toBe(buildFullSha256Revision('# After'))
  })

  it('分片写失败也等待该批全部在途写入结束，且不启动后一批', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-writer-drain-'))
    const storage = join(tempDir, 'index')
    const store = new WorkspaceIndexStore(storage)
    const root = join(tempDir, 'workspace')
    const seed = await store.commit({ rootPath: root, rootFingerprint: 'fp', documents: [] })
    vi.spyOn(store, 'documentKey').mockImplementation(async (_, name) =>
      parseInt(name, 10).toString(16).padStart(2, '0') + '0'.repeat(62))
    let opened = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const nativeOpen = io.open
    let waiting = 0
    vi.spyOn(io, 'open').mockImplementation(async (...args) => {
      if (String(args[0]).includes('/shards/')) {
        if (++opened === 1) throw new Error('injected shard failure')
        waiting++
        await gate
      }
      return nativeOpen(...args)
    })
    let finished = false
    const work = store.commit({ rootPath: root, rootFingerprint: 'fp', previousInstanceId: seed.indexInstanceId,
      documents: Array.from({ length: 16 }, (_, i) => document(`${i}.md`, `# ${i}`)),
    }).then(() => undefined, error => error).finally(() => { finished = true })
    try {
      await vi.waitFor(() => expect(waiting).toBe(7))
      expect(finished).toBe(false)
    } finally { release(); await work }
    expect(await work).toBeInstanceOf(Error)
    expect(opened).toBe(8)
    expect(waiting).toBe(7)
    expect((await store.load(root, 'fp'))?.manifest.generationId).toBe(seed.generationId)
  })

  it('存在但内容冲突的分片不覆盖，也不发布新 CURRENT', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-shard-conflict-'))
    const store = new WorkspaceIndexStore(join(tempDir, 'index'))
    const root = join(tempDir, 'workspace')
    const source = document('a.md', '# A')
    const first = await store.commit({ rootPath: root, rootFingerprint: 'fp', documents: [source] })
    await expect(store.commit({ rootPath: root, rootFingerprint: 'fp', previousInstanceId: first.indexInstanceId,
      documents: [{ ...source, terms: { corrupted: 9 } }],
    })).rejects.toThrow('分片冲突')
    const loaded = await store.load(root, 'fp')
    expect(loaded?.manifest.generationId).toBe(first.generationId)
    expect(loaded?.documents[0].terms).toEqual(source.terms)
  })

  it('损坏 CURRENT 或 shard header 时拒绝热加载', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdv-index-corrupt-'))
    const store = new WorkspaceIndexStore(join(tempDir, 'index'))
    const root = join(tempDir, 'workspace')
    const manifest = await store.commit({
      rootPath: root,
      rootFingerprint: 'darwin:1:2',
      documents: [document('a.md', '# A')],
    })
    const rootKey = await store.rootKey(root)
    const rootDir = join(tempDir, 'index', 'v1', rootKey)
    await writeFile(join(rootDir, 'CURRENT'), '../escape\n')
    expect(await store.load(root, 'darwin:1:2')).toBeNull()

    await writeFile(join(rootDir, 'CURRENT'), `${manifest.generationId}\n`)
    const shardPath = join(rootDir, 'shards', manifest.documents[0].shardFile)
    const shard = JSON.parse(await readFile(shardPath, 'utf8'))
    shard.relativePath = '../outside.md'
    await writeFile(shardPath, JSON.stringify(shard))
    expect(await store.load(root, 'darwin:1:2')).toBeNull()
  })
})
