import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import { buildFullSha256Revision } from '../revisionToken'
import type { IndexedDocument } from '../indexing/types'

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
    expect(loaded?.documents.map(item => item.relativePath)).toEqual(['docs/a.md'])
    expect(await store.load(workspaceRoot, 'darwin:changed')).toBeNull()
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
