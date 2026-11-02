import { createHash, randomUUID } from 'crypto'
import * as io from 'fs/promises'
import * as syncIO from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import type { IndexedDocument, WorkspaceIndexManifest } from '../indexing/types'

vi.mock('fs', async original => ({ ...await original<typeof import('fs')>() }))
vi.mock('fs/promises', async original => ({ ...await original<typeof import('fs/promises')>() }))
let directory: string, storage: string, root: string, store: WorkspaceIndexStore
const guard = async (): Promise<void> => undefined
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const doc = (value: string): IndexedDocument => ({
  schemaVersion: 2, rootKey: '', indexInstanceId: '', relativePath: 'a.md',
  revisionToken: `sha256:${digest(value)}`, mtimeMs: 1, indexedAt: 1,
  size: value.length, terms: { [value]: 1 }, headings: [], outboundLinks: [], lineCount: 1,
})
const base = (m: WorkspaceIndexManifest) => join(storage, 'v1', m.rootKey)
const manifestFile = (m: WorkspaceIndexManifest) => join(base(m), 'generations', m.generationId, 'manifest.json')
async function commit(value: string, previousInstanceId?: string) {
  const m = await store.commit({ rootPath: root, rootFingerprint: 'fp', documents: [doc(value)], previousInstanceId })
  // Deterministic ordering independent of filesystem clock resolution.
  m.createdAt = ++sequence
  await io.writeFile(manifestFile(m), JSON.stringify(m))
  return m
}
let sequence = 0
beforeEach(async () => {
  directory = await io.mkdtemp(join(tmpdir(), 'mdv-reclamation-'))
  storage = join(directory, 'index'); root = join(directory, 'source')
  await io.mkdir(root)
  await io.writeFile(join(root, 'a.md'), 'source must survive')
  store = new WorkspaceIndexStore(storage); sequence = 0
})
afterEach(async () => { vi.restoreAllMocks(); await io.rm(directory, { recursive: true, force: true }) })

describe('manual index reclamation', () => {
  it('does not create a key or storage for absent indexes', async () => {
    expect(await store.previewReclamation(root, 'fp', guard)).toBeNull()
    await expect(io.stat(storage)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains CURRENT plus newest other generation and only removes approved files', async () => {
    const old = await commit('old'), retained = await commit('retained'), current = await commit('current')
    const key = await io.readFile(join(storage, 'installation.key'))
    const pointer = await io.readFile(join(base(old), 'CURRENT'))
    await io.writeFile(join(base(old), 'shards', 'unknown.tmp'), 'keep')
    const plan = await store.previewReclamation(root, 'fp', guard)
    expect(plan?.summary).toMatchObject({ generations: 1, files: 2, directories: 1, retainedGenerations: 2 })
    const result = await store.executeReclamation(plan!, guard)
    expect(result).toMatchObject({ status: 'completed', deletedFiles: 2, deletedDirectories: 1, skippedFiles: 0, failedFiles: 0 })
    await expect(io.stat(manifestFile(old))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await io.readFile(manifestFile(retained), 'utf8')).toContain(retained.generationId)
    expect((await store.load(root, 'fp'))?.manifest.generationId).toBe(current.generationId)
    expect(await io.readFile(join(base(old), 'CURRENT'))).toEqual(pointer)
    expect(await io.readFile(join(storage, 'installation.key'))).toEqual(key)
    expect(await io.readFile(join(root, 'a.md'), 'utf8')).toBe('source must survive')
    expect(await io.readFile(join(base(old), 'shards', 'unknown.tmp'), 'utf8')).toBe('keep')
    expect((await store.previewReclamation(root, 'fp', guard))?.summary.files).toBe(0)
  })

  it('rejects stale and forged plans without deleting anything', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    const plan = await store.previewReclamation(root, 'fp', guard)
    await expect(store.executeReclamation({ ...plan! }, guard)).rejects.toMatchObject({ code: 'invalid' })
    await commit('new')
    await expect(store.executeReclamation(plan!, guard)).rejects.toMatchObject({ code: 'stale' })
    expect(await io.readFile(manifestFile(old), 'utf8')).toContain(old.generationId)
  })

  it('protects shared references when an old manifest cannot be deleted', async () => {
    const old = await commit('shared'), shared = await commit('shared', old.indexInstanceId)
    await commit('retained'); await commit('current')
    const plan = await store.previewReclamation(root, 'fp', guard)
    const unlink = syncIO.unlinkSync
    vi.spyOn(syncIO, 'unlinkSync').mockImplementation(file => {
      if (String(file).endsWith(`/${old.generationId}/manifest.json`)) throw Object.assign(new Error('private path'), { code: 'EACCES' })
      return unlink(file)
    })
    const result = await store.executeReclamation(plan!, guard)
    expect(result.status).toBe('partial')
    expect(result.failedFiles).toBe(1)
    expect(await io.readFile(join(base(old), 'shards', old.documents[0].shardFile), 'utf8')).toContain('shared')
    await expect(io.stat(manifestFile(shared))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers empty generation directories left by interrupted deletion', async () => {
    const current = await commit('current')
    const empty = join(base(current), 'generations', randomUUID())
    await io.mkdir(empty)
    const plan = await store.previewReclamation(root, 'fp', guard)
    expect(plan?.summary).toMatchObject({ files: 0, directories: 1 })
    expect(await store.executeReclamation(plan!, guard)).toMatchObject({ deletedDirectories: 1, status: 'completed' })
  })

  it('blocks corrupt manifests, missing-manifest content and symlinked shard directories', async () => {
    const current = await commit('current')
    const bad = join(base(current), 'generations', randomUUID())
    await io.mkdir(bad)
    await io.writeFile(join(bad, 'manifest.json'), '{')
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
    await io.unlink(join(bad, 'manifest.json'))
    await io.writeFile(join(bad, 'unknown.tmp'), 'keep')
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
    await io.unlink(join(bad, 'unknown.tmp'))
    await io.rename(join(base(current), 'shards'), join(base(current), 'saved-shards'))
    await io.symlink(join(base(current), 'saved-shards'), join(base(current), 'shards'))
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('retains a newer unpublished full snapshot rather than assuming previous publication', async () => {
    const old = await commit('old'), current = await commit('current'), unpublished = await commit('unpublished')
    await io.writeFile(join(base(current), 'CURRENT'), current.generationId + '\n')
    const plan = await store.previewReclamation(root, 'fp', guard)
    await store.executeReclamation(plan!, guard)
    await expect(io.stat(manifestFile(old))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await io.readFile(manifestFile(unpublished), 'utf8')).toContain(unpublished.generationId)
    expect((await store.load(root, 'fp'))?.manifest.generationId).toBe(current.generationId)
  })

  it('validates the chosen newest generation instead of silently falling back', async () => {
    await commit('old'); const newest = await commit('newest'), current = await commit('current')
    await io.writeFile(join(base(newest), 'shards', newest.documents[0].shardFile), '{}')
    const unlink = vi.spyOn(syncIO, 'unlinkSync')
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
    expect(unlink).not.toHaveBeenCalled()
    expect((await store.load(root, 'fp'))?.manifest.generationId).toBe(current.generationId)
  })

  it('rejects traversal references and unsupported manifests', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    const disk = JSON.parse(await io.readFile(manifestFile(old), 'utf8'))
    await io.writeFile(manifestFile(old), JSON.stringify({ ...disk, schemaVersion: 99 }))
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
    disk.documents[0].shardFile = '../CURRENT'
    await io.writeFile(manifestFile(old), JSON.stringify(disk))
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('rejects changes to approved shard identity even when CURRENT is unchanged', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    const plan = await store.previewReclamation(root, 'fp', guard)
    await io.writeFile(join(base(old), 'shards', old.documents[0].shardFile), 'replaced')
    const unlink = vi.spyOn(syncIO, 'unlinkSync')
    await expect(store.executeReclamation(plan!, guard)).rejects.toMatchObject({ code: 'stale' })
    expect(unlink).not.toHaveBeenCalled()
  })

  it('propagates a guard rejection before deletion, and reports partial after a removed manifest', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    const rejection = new Error('authority revoked')
    const initial = await store.previewReclamation(root, 'fp', guard)
    await expect(store.executeReclamation(initial!, async () => { throw rejection })).rejects.toBe(rejection)
    const plan = await store.previewReclamation(root, 'fp', guard)
    let revoked = false
    const original = syncIO.unlinkSync
    vi.spyOn(syncIO, 'unlinkSync').mockImplementation(file => { original(file); revoked = true })
    const result = await store.executeReclamation(plan!, async () => { if (revoked) throw rejection })
    expect(result).toMatchObject({ status: 'partial', deletedFiles: 1, deletedDirectories: 0 })
    expect(await io.readFile(join(base(old), 'shards', old.documents[0].shardFile), 'utf8')).toContain('old')
    vi.restoreAllMocks()
    const next = await store.previewReclamation(root, 'fp', guard)
    expect(next?.summary).toMatchObject({ generations: 0, files: 1, directories: 1 })
    expect(await store.executeReclamation(next!, guard)).toMatchObject({ status: 'completed', deletedDirectories: 1 })
  })

  it('checks guard after the final candidate stat, before unlink', async () => {
    await commit('old'); await commit('other'); await commit('current')
    const plan = await store.previewReclamation(root, 'fp', guard)
    const unlink = vi.spyOn(syncIO, 'unlinkSync'), original = io.lstat
    let revoked = false, verificationDone = false
    const open = io.open
    vi.spyOn(io, 'open').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/CURRENT')) verificationDone = true
      return open(...args)
    })
    // Revoke on a late lstat of the candidate; guard must not rely only on batch entry.
    let reads = 0
    vi.spyOn(io, 'lstat').mockImplementation(async (...args) => {
      const stats = await original(...args)
      if (verificationDone && String(args[0]).endsWith('/manifest.json') && ++reads > 6) revoked = true
      return stats
    })
    await expect(store.executeReclamation(plan!, async () => { if (revoked) throw new Error('revoked') })).rejects.toThrow('revoked')
    expect(unlink).not.toHaveBeenCalled()
  })

  it('stops all shard cleanup if the one surviving-reference pass cannot finish', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    const plan = await store.previewReclamation(root, 'fp', guard)
    const originalUnlink = syncIO.unlinkSync, originalOpen = io.opendir
    let deleted = false
    vi.spyOn(syncIO, 'unlinkSync').mockImplementation(file => { originalUnlink(file); deleted = true })
    vi.spyOn(io, 'opendir').mockImplementation(async (...args) => {
      if (deleted && String(args[0]).endsWith('/generations')) throw Object.assign(new Error('private'), { code: 'EIO' })
      return originalOpen(...args)
    })
    expect(await store.executeReclamation(plan!, guard)).toMatchObject({ status: 'partial', deletedFiles: 1 })
    expect(await io.readFile(join(base(old), 'shards', old.documents[0].shardFile), 'utf8')).toContain('old')
  })

  it('deduplicates reads of shared retained packed shards', async () => {
    const first = await commit('same'); await commit('same', first.indexInstanceId)
    const original = io.open, reads: string[] = []
    vi.spyOn(io, 'open').mockImplementation(async (...args) => {
      if (String(args[0]).includes('/shards/')) reads.push(String(args[0]))
      return original(...args)
    })
    expect((await store.previewReclamation(root, 'fp', guard))?.summary.files).toBe(0)
    expect(reads).toHaveLength(1)
  })

  it('accepts mixed v2/v3 while checking v2 document correspondence', async () => {
    const rootKey = await store.rootKey(root), indexInstanceId = randomUUID(), generationId = randomUUID()
    const source = doc('legacy')
    const file = `${await store.documentKey(rootKey, source.relativePath)}-${indexInstanceId}-${digest('legacy')}.json`
    const legacy: WorkspaceIndexManifest = { schemaVersion: 2, rootKey, rootFingerprint: 'fp', indexInstanceId,
      generationId, createdAt: 0, documents: [{ relativePath: source.relativePath, revisionToken: source.revisionToken, shardFile: file }] }
    await io.mkdir(join(base(legacy), 'generations', generationId), { recursive: true })
    await io.mkdir(join(base(legacy), 'shards'), { recursive: true })
    await io.writeFile(join(base(legacy), 'shards', file), JSON.stringify({ ...source, rootKey, indexInstanceId }))
    await io.writeFile(manifestFile(legacy), JSON.stringify(legacy))
    await commit('current')
    expect((await store.previewReclamation(root, 'fp', guard))?.summary.retainedGenerations).toBe(2)
    await io.writeFile(join(base(legacy), 'shards', file), JSON.stringify({ ...source, rootKey, indexInstanceId, relativePath: 'wrong.md' }))
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('enforces single-manifest and cumulative-read budgets using fake metadata, without large files', async () => {
    const current = await commit('current'), original = io.lstat
    const unlink = vi.spyOn(syncIO, 'unlinkSync')
    const spy = vi.spyOn(io, 'lstat').mockImplementation(async (...args) => {
      const stats = await original(...args)
      if (String(args[0]).endsWith('/manifest.json')) stats.size = 32 * 1024 * 1024 + 1
      return stats
    })
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'budget' })
    spy.mockImplementation(async (...args) => {
      const stats = await original(...args)
      if (String(args[0]).endsWith(current.documents[0].shardFile)) stats.size = 512 * 1024 * 1024
      return stats
    })
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'budget' })
    expect(unlink).not.toHaveBeenCalled()
  })

  it('enforces the phase deadline before deletion and stops partially after deletion', async () => {
    await commit('old'); await commit('other'); await commit('current')
    const nativeNow = performance.now.bind(performance)
    let shift = 0
    vi.spyOn(performance, 'now').mockImplementation(() => nativeNow() + shift)
    await expect(store.previewReclamation(root, 'fp', async () => { shift += 30_001 })).rejects.toMatchObject({ code: 'budget' })
    shift = 0
    const plan = await store.previewReclamation(root, 'fp', guard)
    const original = syncIO.unlinkSync
    vi.spyOn(syncIO, 'unlinkSync').mockImplementation(file => { original(file); shift += 30_001 })
    expect(await store.executeReclamation(plan!, guard)).toMatchObject({ status: 'partial', deletedFiles: 1 })
  })

  it('enforces reference and bounded enumeration budgets without materializing historical data', async () => {
    await commit('current')
    const parse = JSON.parse
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((...args) => {
      const value = parse(...args)
      if (value?.generationId) value.documents = new Array(2_000_001)
      return value
    })
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'budget' })
    parseSpy.mockRestore()
    const original = io.opendir
    const close = vi.fn(async () => undefined)
    vi.spyOn(io, 'opendir').mockImplementation(async (...args) => {
      if (!String(args[0]).endsWith('/generations')) return original(...args)
      let count = 0
      return { read: async () => ++count <= 100_001 ? { name: 'same' } : null, close } as unknown as Awaited<ReturnType<typeof io.opendir>>
    })
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'budget' })
    expect(close).toHaveBeenCalled()
  })

  it('retries one complete load only on missing shard plus changed CURRENT', async () => {
    const old = await commit('old'), current = await commit('current')
    await io.writeFile(join(base(old), 'CURRENT'), old.generationId + '\n')
    const original = io.readFile
    let misses = 0
    vi.spyOn(io, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith(old.documents[0].shardFile)) {
        misses++
        await io.writeFile(join(base(old), 'CURRENT'), current.generationId + '\n')
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      return original(...args)
    })
    const loaded = await store.load(root, 'fp')
    expect(loaded?.manifest.generationId).toBe(current.generationId)
    expect(loaded?.documents).toHaveLength(1)
    expect(loaded?.documents[0].revisionToken).toBe(doc('current').revisionToken)
    expect(misses).toBe(1)
  })

  it('never retries corrupt shards or returns documents from a failed attempt', async () => {
    const old = await commit('old'), current = await commit('current')
    await io.writeFile(join(base(old), 'CURRENT'), old.generationId + '\n')
    const original = io.readFile
    let currentReads = 0
    vi.spyOn(io, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/CURRENT')) currentReads++
      if (String(args[0]).endsWith(old.documents[0].shardFile)) {
        await io.writeFile(join(base(old), 'CURRENT'), current.generationId + '\n')
        return Buffer.from('{}') as never
      }
      return original(...args)
    })
    expect(await store.load(root, 'fp')).toBeNull()
    expect(currentReads).toBe(1)
  })


  it('limits a missing-shard reader to two complete attempts even if CURRENT changes again', async () => {
    const first = await commit('first'), second = await commit('second'), third = await commit('third')
    await io.writeFile(join(base(first), 'CURRENT'), first.generationId + '\n')
    const original = io.readFile
    let misses = 0
    vi.spyOn(io, 'readFile').mockImplementation(async (...args) => {
      const name = String(args[0])
      const next = name.endsWith(first.documents[0].shardFile) ? second : name.endsWith(second.documents[0].shardFile) ? third : null
      if (next) {
        misses++
        await io.writeFile(join(base(first), 'CURRENT'), next.generationId + '\n')
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      return original(...args)
    })
    expect(await store.load(root, 'fp')).toBeNull()
    expect(misses).toBe(2)
  })

  it('keeps a missing shard as cache miss when CURRENT has not changed', async () => {
    const current = await commit('current')
    await io.unlink(join(base(current), 'shards', current.documents[0].shardFile))
    const original = io.readFile
    let attempts = 0
    vi.spyOn(io, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith(current.documents[0].shardFile)) attempts++
      return original(...args)
    })
    expect(await store.load(root, 'fp')).toBeNull()
    expect(attempts).toBe(1)
  })

  it('rejects symlinked generations and formal files, preserves unknown temporary files', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    const shard = join(base(old), 'shards', old.documents[0].shardFile)
    await io.rename(shard, shard + '.tmp')
    await io.symlink(shard + '.tmp', shard)
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
    await io.unlink(shard)
    await io.rename(shard + '.tmp', shard)
    const generation = join(base(old), 'generations', old.generationId)
    await io.rename(generation, join(directory, 'saved-generation'))
    await io.symlink(join(directory, 'saved-generation'), generation)
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('does not follow symlinked storage roots or intermediate v1 directories', async () => {
    await commit('current')
    await io.rename(storage, join(directory, 'saved-index'))
    await io.symlink(join(directory, 'saved-index'), storage)
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
    await io.unlink(storage)
    await io.rename(join(directory, 'saved-index'), storage)
    await io.rename(join(storage, 'v1'), join(storage, 'saved-v1'))
    await io.symlink(join(storage, 'saved-v1'), join(storage, 'v1'))
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('keeps failed shard deletions recoverable on the next explicit invocation', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    const plan = await store.previewReclamation(root, 'fp', guard)
    const original = syncIO.unlinkSync
    vi.spyOn(syncIO, 'unlinkSync').mockImplementation(file => {
      if (String(file).endsWith(old.documents[0].shardFile)) throw Object.assign(new Error('private'), { code: 'EACCES' })
      return original(file)
    })
    expect(await store.executeReclamation(plan!, guard)).toMatchObject({ status: 'partial', failedFiles: 1, deletedFiles: 1 })
    vi.restoreAllMocks()
    const remaining = await store.previewReclamation(root, 'fp', guard)
    expect(remaining?.summary).toMatchObject({ generations: 0, files: 1, directories: 0 })
    expect(await store.executeReclamation(remaining!, guard)).toMatchObject({ status: 'completed', deletedFiles: 1 })
  })

  it('rejects oversize execution verification before any unlink', async () => {
    await commit('old'); await commit('other'); await commit('current')
    const plan = await store.previewReclamation(root, 'fp', guard)
    const original = io.lstat, unlink = vi.spyOn(syncIO, 'unlinkSync')
    vi.spyOn(io, 'lstat').mockImplementation(async (...args) => {
      const stats = await original(...args)
      if (String(args[0]).endsWith('/manifest.json')) stats.size = 32 * 1024 * 1024 + 1
      return stats
    })
    await expect(store.executeReclamation(plan!, guard)).rejects.toMatchObject({ code: 'budget' })
    expect(unlink).not.toHaveBeenCalled()
  })

  it('measures bounded historical scans with fixed document count and yields the event loop', async () => {
    const documentCount = 64
    const current = await store.commit({ rootPath: root, rootFingerprint: 'fp',
      documents: Array.from({ length: documentCount }, (_, i) => ({ ...doc(`fixed-${i}`), relativePath: `doc-${i}.md` })) })
    const originalOpen = io.open, originalParse = JSON.parse
    let bytes = 0, references = 0, peakHeap = 0
    vi.spyOn(io, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      const read = handle.read.bind(handle)
      handle.read = (async (...readArgs: Parameters<typeof read>) => {
        const result = await read(...readArgs)
        bytes += result.bytesRead
        peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
        return result
      }) as typeof handle.read
      return handle
    })
    vi.spyOn(JSON, 'parse').mockImplementation((...args) => {
      const result = originalParse(...args)
      if (result?.generationId) references += result.documents.length
      return result
    })
    for (const count of [10, 100, 500]) {
      const names = await io.readdir(join(base(current), 'generations'))
      for (let i = names.length; i < count; i++) {
        const generationId = randomUUID()
        const historical = { ...current, generationId, createdAt: i }
        await io.mkdir(join(base(current), 'generations', generationId))
        await io.writeFile(manifestFile(historical), JSON.stringify(historical))
      }
      bytes = 0; references = 0; peakHeap = process.memoryUsage().heapUsed
      const beforeHeap = peakHeap, started = performance.now()
      let yielded = false
      const tick = setImmediate(() => { yielded = true })
      const pending = store.previewReclamation(root, 'fp', guard)
      const enqueued = performance.now()
      const queued = pending.then(() => performance.now() - enqueued)
      const plan = await pending
      const duration = performance.now() - started
      const queuedWait = await queued
      clearImmediate(tick)
      expect(plan?.summary.generations).toBe(count - 2)
      expect(references).toBe(count * documentCount)
      expect(yielded).toBe(true)
      expect(duration).toBeLessThan(30_000)
      console.info('reclamation synthetic scan', JSON.stringify({ generations: count, documentsPerGeneration: documentCount,
        durationMs: Math.round(duration), queuedContinuationWaitMs: Math.round(queuedWait), bytesRead: bytes,
        references, peakHeapMiB: +(peakHeap / 1048576).toFixed(2), sampledHeapGrowthMiB: +((peakHeap - beforeHeap) / 1048576).toFixed(2) }))
    }
  })


  it('blocks a valid old manifest mixed with unknown content before creating an orphan directory', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    await io.writeFile(join(base(old), 'generations', old.generationId, 'unknown.tmp'), 'keep')
    await expect(store.previewReclamation(root, 'fp', guard)).rejects.toMatchObject({ code: 'invalid' })
    expect(await io.readFile(manifestFile(old), 'utf8')).toContain(old.generationId)
  })

  it('rechecks the directory chain after the final asynchronous guard before unlink', async () => {
    const old = await commit('old'); await commit('other'); await commit('current')
    const plan = await store.previewReclamation(root, 'fp', guard)
    const outside = join(directory, 'outside'), generation = join(base(old), 'generations', old.generationId)
    await io.mkdir(outside)
    await io.copyFile(manifestFile(old), join(outside, 'manifest.json'))
    const expected = await io.readFile(join(outside, 'manifest.json'))
    const original = io.lstat
    let candidateStats = 0, swapped = false
    vi.spyOn(io, 'lstat').mockImplementation(async (...args) => {
      const stats = await original(...args)
      if (String(args[0]).endsWith(`/${old.generationId}/manifest.json`)) candidateStats++
      return stats
    })
    await expect(store.executeReclamation(plan!, async () => {
      if (candidateStats >= 3 && !swapped) {
        swapped = true
        await io.rename(generation, join(directory, 'saved-generation'))
        await io.symlink(outside, generation)
      }
    })).rejects.toMatchObject({ code: 'stale' })
    expect(swapped).toBe(true)
    expect(await io.readFile(join(outside, 'manifest.json'))).toEqual(expected)
  })

})
