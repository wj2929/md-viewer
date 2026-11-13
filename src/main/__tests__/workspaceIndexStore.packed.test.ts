import { createHash, randomUUID } from 'crypto'
import * as io from 'fs/promises'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INDEX_SCHEMA_VERSION, WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import type { IndexedDocument, WorkspaceIndexManifest } from '../indexing/types'
import { buildFullSha256Revision } from '../revisionToken'
import { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import type { WorkspaceWatchService } from '../watching/WorkspaceWatchService'

vi.mock('fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('fs/promises')>() }))

interface PackedManifest extends WorkspaceIndexManifest {
  shards: Record<string, { hash: string; bytes: number; count: number }>
}
let directory: string
let storage: string
let root: string
let store: WorkspaceIndexStore
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const document = (name: string, content = name): IndexedDocument => ({
  schemaVersion: INDEX_SCHEMA_VERSION, rootKey: '', indexInstanceId: '', relativePath: name,
  revisionToken: buildFullSha256Revision(content), mtimeMs: 1, indexedAt: 1,
  size: Buffer.byteLength(content), terms: { [content]: 1 }, headings: [], outboundLinks: [], lineCount: 1,
})
const options = (documents: IndexedDocument[], previousInstanceId?: string) => ({
  rootPath: root, rootFingerprint: 'fp', documents, previousInstanceId,
})
const manifestPath = (manifest: WorkspaceIndexManifest) => join(storage, 'v1', manifest.rootKey, 'generations', manifest.generationId, 'manifest.json')
const shardPath = (manifest: WorkspaceIndexManifest, file: string) => join(storage, 'v1', manifest.rootKey, 'shards', file)
const packed = async (manifest: WorkspaceIndexManifest): Promise<PackedManifest> => JSON.parse(await readFile(manifestPath(manifest), 'utf8'))

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mdv-packed-index-'))
  storage = join(directory, 'index'); root = join(directory, 'workspace')
  store = new WorkspaceIndexStore(storage)
})
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }) })

async function legacy(documents: IndexedDocument[], rootFingerprint = 'fp') {
  const rootKey = await store.rootKey(root), indexInstanceId = randomUUID(), generationId = randomUUID()
  const base = join(storage, 'v1', rootKey)
  await mkdir(join(base, 'shards'), { recursive: true })
  await mkdir(join(base, 'generations', generationId), { recursive: true })
  const entries: WorkspaceIndexManifest['documents'] = []
  for (const source of documents) {
    const file = `${await store.documentKey(rootKey, source.relativePath)}-${indexInstanceId}-${source.revisionToken.slice(-64)}.json`
    await writeFile(join(base, 'shards', file), JSON.stringify({ ...source, rootKey, indexInstanceId }))
    entries.push({ relativePath: source.relativePath, revisionToken: source.revisionToken, shardFile: file })
  }
  const manifest: WorkspaceIndexManifest = { schemaVersion: 2, rootKey, rootFingerprint, indexInstanceId, generationId, createdAt: 1, documents: entries }
  await writeFile(manifestPath(manifest), JSON.stringify(manifest))
  await writeFile(join(base, 'CURRENT'), generationId + '\n')
  return manifest
}

function forceBuckets() {
  vi.spyOn(store, 'documentKey').mockImplementation(async (_, name) =>
    (name.startsWith('cold') ? 'ff' : '00') + digest(name).slice(2))
}

describe('WorkspaceIndexStore packed format', () => {
  it('新存储格式与分析版本分离，多个文档共用一片并只sync一次', async () => {
    forceBuckets()
    const sync = vi.fn()
    const nativeOpen = io.open
    vi.spyOn(io, 'open').mockImplementation(async (...args) => {
      const handle = await nativeOpen(...args), original = handle.sync.bind(handle)
      handle.sync = async () => { sync(String(args[0])); return original() }
      return handle
    })
    const sources = [document('a.md'), document('b.md')]
    const manifest = await store.commit(options(sources)), disk = await packed(manifest)
    expect(manifest.schemaVersion).toBe(3)
    expect(INDEX_SCHEMA_VERSION).toBe(2)
    expect(Object.keys(disk.shards)).toHaveLength(1)
    expect(sync.mock.calls.filter(([file]) => file.includes(`${sep}shards${sep}`))).toHaveLength(1)
    expect(sync).toHaveBeenCalledTimes(3)
    const loaded = await store.load(root, 'fp')
    expect(loaded?.documents).toEqual(sources.map(source => ({ ...source, rootKey: manifest.rootKey, indexInstanceId: manifest.indexInstanceId })))
  })

  it('只读加载v2不转换，自然提交写v3且保留旧代和原锁', async () => {
    const source = document('a.md'), old = await legacy([source])
    const before = await readFile(join(storage, 'v1', old.rootKey, 'CURRENT'), 'utf8')
    expect((await store.load(root, 'fp'))?.manifest.schemaVersion).toBe(2)
    expect(await readFile(join(storage, 'v1', old.rootKey, 'CURRENT'), 'utf8')).toBe(before)
    const lock = await store.acquireLock(root)
    try {
      expect((await new WorkspaceIndexStore(storage).acquireLock(root)).acquired).toBe(false)
      const next = await store.commit(options([document('a.md', 'changed')], old.indexInstanceId))
      expect(next.schemaVersion).toBe(3)
      expect(await readFile(manifestPath(old), 'utf8')).toContain(old.generationId)
      expect((await store.load(root, 'fp'))?.documents[0].revisionToken).toBe(buildFullSha256Revision('changed'))
    } finally { await lock.release() }
  })

  it('服务层挂载及无变化刷新不转换v2，实际内容变化才提交v3', async () => {
    await mkdir(root)
    root = await io.realpath(root)
    const content = '# Title\n\nmarker'
    await writeFile(join(root, 'a.md'), content)
    const fingerprint = await store.inspectRootFingerprint(root)
    const old = await legacy([document('a.md', content)], fingerprint)
    const commits = vi.spyOn(store, 'commit')
    const watcher = { attachIndexConsumer: vi.fn(), detachIndexConsumer: vi.fn() }
    const service = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)
    await service.attach(root, 'consumer')
    try {
      await service.waitUntilIdle(root)
      await service.rebuild(root)
      expect(commits).not.toHaveBeenCalled()
      expect((await store.load(root, fingerprint))?.manifest.generationId).toBe(old.generationId)
      await writeFile(join(root, 'a.md'), '# Changed\n\npackedneedle')
      await service.rebuild(root)
      expect(commits).toHaveBeenCalledTimes(1)
      expect((await store.load(root, fingerprint))?.manifest.schemaVersion).toBe(3)
      expect(await service.query(root, 'packedneedle')).toEqual([
        expect.objectContaining({ relativePath: 'a.md' }),
      ])
      await service.rebuild(root)
      expect(commits).toHaveBeenCalledTimes(1)
    } finally { await service.detach(root, 'consumer') }
  })

  it.each(['shard-sync', 'link', 'current-sync'] as const)('%s失败保留旧代并可重试', async stage => {
    const first = await store.commit(options([document('a.md')]))
    const nativeOpen = io.open, nativeLink = io.link
    let injected = false
    const fail = (): never => { injected = true; throw Object.assign(new Error('injected failure'), { code: 'EIO' }) }
    vi.spyOn(io, 'open').mockImplementation(async (...args) => {
      const handle = await nativeOpen(...args), file = String(args[0])
      if (!injected && ((stage === 'shard-sync' && file.includes(`${sep}shards${sep}`)) ||
        (stage === 'current-sync' && file.includes(`${sep}CURRENT.`)))) handle.sync = async () => fail()
      return handle
    })
    vi.spyOn(io, 'link').mockImplementation(async (...args) => {
      if (!injected && stage === 'link') fail()
      return nativeLink(...args)
    })
    const next = options([document('a.md', 'changed')], first.indexInstanceId)
    await expect(store.commit(next)).rejects.toMatchObject({ code: 'EIO' })
    expect(injected).toBe(true)
    expect((await store.load(root, 'fp'))?.manifest.generationId).toBe(first.generationId)
    await store.commit(next)
    expect((await store.load(root, 'fp'))?.documents[0].revisionToken).toBe(next.documents[0].revisionToken)
  })

  it('65条局部分裂，不影响其他桶；移除新增条目后复用旧片', async () => {
    forceBuckets()
    const docs = [...Array.from({ length: 64 }, (_, i) => document(`hot-${i}.md`)), document('cold.md')]
    const first = await store.commit(options(docs)), initial = await packed(first)
    const next = await store.commit(options([...docs, document('hot-new.md')], first.indexInstanceId))
    expect(Object.keys(initial.shards)).toHaveLength(2)
    expect(Object.keys((await packed(next)).shards)).toHaveLength(3)
    expect(next.documents.find(d => d.relativePath === 'cold.md')?.shardFile).toBe(first.documents.find(d => d.relativePath === 'cold.md')?.shardFile)
    const merged = await store.commit(options(docs, first.indexInstanceId))
    expect(Object.keys((await packed(merged)).shards).sort()).toEqual(Object.keys(initial.shards).sort())
  })

  it('编码字节上限包含Unicode，超大单条不截断', async () => {
    forceBuckets()
    const docs = [document('a.md', '中'.repeat(50000)), document('b.md', '文'.repeat(50000)), document('huge.md', '😀'.repeat(80000))]
    const manifest = await store.commit(options(docs)), disk = await packed(manifest)
    expect(Object.values(disk.shards).every(s => s.count <= 64 && (s.bytes <= 256 * 1024 || s.count === 1))).toBe(true)
    expect(Object.values(disk.shards).some(s => s.bytes > 256 * 1024 && s.count === 1)).toBe(true)
    const loaded = await store.load(root, 'fp')
    expect(loaded?.documents.map(d => d.terms)).toEqual(docs.map(d => d.terms))
  })

  it('增删改名及空快照均可完整加载，旧物理片不清理', async () => {
    const first = await store.commit(options([document('a.md'), document('b.md')]))
    const next = [document('renamed.md'), document('new.md')]
    await store.commit(options(next, first.indexInstanceId))
    expect((await store.load(root, 'fp'))?.documents.map(d => d.relativePath)).toEqual(['new.md', 'renamed.md'])
    await store.commit(options([], first.indexInstanceId))
    expect((await store.load(root, 'fp'))?.documents).toEqual([])
    expect(await readdir(join(storage, 'v1', first.rootKey, 'shards'))).toContain(first.documents[0].shardFile)
  })

  it('重复文档不发布不完整代', async () => {
    const first = await store.commit(options([])), doc = document('a.md')
    await expect(store.commit(options([doc, doc], first.indexInstanceId))).rejects.toThrow()
    expect((await store.load(root, 'fp'))?.manifest.generationId).toBe(first.generationId)
  })

  it('非法UTF-8不能通过解码替换字符冒充原始分片字节', async () => {
    const sources = [document('a.md', '�')]
    const first = await store.commit(options(sources))
    const file = shardPath(first, first.documents[0].shardFile)
    const bytes = await readFile(file)
    const offset = bytes.indexOf(Buffer.from('�'))
    expect(offset).toBeGreaterThanOrEqual(0)
    await writeFile(file, Buffer.concat([bytes.subarray(0, offset), Buffer.from([0xff]), bytes.subarray(offset + 3)]))
    expect(await store.load(root, 'fp')).toBeNull()
    await expect(store.commit(options(sources, first.indexInstanceId))).rejects.toThrow('分片冲突')
  })

  it.each(['bytes', 'hash', 'count', 'duplicate', 'missing', 'path', 'time'] as const)('manifest %s 损坏整代拒绝', async fault => {
    const manifest = await store.commit(options([document('a.md')])), disk = await packed(manifest)
    const [file] = Object.keys(disk.shards)
    if (fault === 'bytes') disk.shards[file].bytes++
    if (fault === 'hash') disk.shards[file].hash = '0'.repeat(64)
    if (fault === 'count') disk.shards[file].count++
    if (fault === 'duplicate') disk.documents.push(disk.documents[0])
    if (fault === 'missing') disk.documents = []
    if (fault === 'path') disk.shards = { '../outside.json': disk.shards[file] }
    if (fault === 'time') Object.assign(disk.documents[0], { mtimeMs: null })
    await writeFile(manifestPath(manifest), JSON.stringify(disk))
    expect(await store.load(root, 'fp')).toBeNull()
  })

  it.each(['schema', 'root', 'instance', 'revision', 'relative', 'duplicate'] as const)('片内容 %s 即使摘要同步改变仍拒绝', async fault => {
    const manifest = await store.commit(options([document('a.md')])), disk = await packed(manifest)
    const [file] = Object.keys(disk.shards)
    const payload = JSON.parse(await readFile(shardPath(manifest, file), 'utf8')) as {
      schemaVersion: number; documents: IndexedDocument[]
    }
    if (fault === 'schema') payload.schemaVersion = 99
    if (fault === 'root') payload.documents[0].rootKey = 'wrong'
    if (fault === 'instance') payload.documents[0].indexInstanceId = 'wrong'
    if (fault === 'revision') payload.documents[0].revisionToken = 'wrong'
    if (fault === 'relative') payload.documents[0].relativePath = '../outside.md'
    if (fault === 'duplicate') payload.documents.push(payload.documents[0])
    const text = JSON.stringify(payload) + '\n'
    await writeFile(shardPath(manifest, file), text)
    Object.assign(disk.shards[file], { hash: digest(text), bytes: Buffer.byteLength(text), count: payload.documents.length })
    await writeFile(manifestPath(manifest), JSON.stringify(disk))
    expect(await store.load(root, 'fp')).toBeNull()
  })
})
