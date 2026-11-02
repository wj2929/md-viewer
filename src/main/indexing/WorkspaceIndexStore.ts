import { createHash, createHmac, randomBytes, randomUUID } from 'crypto'
import { link, open, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import * as fs from 'fs-extra'
import * as path from 'path'
import type { IndexedDocument, WorkspaceIndexManifest } from './types'
import { WorkspaceIndexReclamation, type ReclamationGuard, type ReclamationPlan, type ReclamationResult } from './WorkspaceIndexReclamation'

export const INDEX_SCHEMA_VERSION = 2
export const INDEX_STORAGE_VERSION = 3
const MAX_SHARD_DOCUMENTS = 64
const MAX_SHARD_BYTES = 256 * 1024

type StableIndexedDocument = Omit<IndexedDocument, 'mtimeMs' | 'indexedAt'>
interface PackedShard {
  schemaVersion: number
  rootKey: string
  indexInstanceId: string
  documents: StableIndexedDocument[]
}
interface PackedRecord {
  key: string
  document: StableIndexedDocument
  mtimeMs: number
  indexedAt: number
}
interface PackedManifest extends WorkspaceIndexManifest {
  shards: Record<string, { hash: string; bytes: number; count: number }>
  documents: Array<WorkspaceIndexManifest['documents'][number] & { mtimeMs: number; indexedAt: number }>
}
const SECRET_FILE = 'installation.key'
const LOCK_RECOVERY_GRACE_MS = 30_000
const lockOperationQueues = new Map<string, Promise<void>>()
const activeLockOwners = new Set<string>()

export interface LoadedWorkspaceIndex {
  manifest: WorkspaceIndexManifest
  documents: IndexedDocument[]
}

export interface WorkspaceIndexLock {
  acquired: boolean
  isHeld: () => Promise<boolean>
  release: () => Promise<void>
}

export class WorkspaceIndexStore {
  private installationKey: Buffer | null = null
  private readonly reclamation: WorkspaceIndexReclamation

  constructor(private readonly storageRoot: string) {
    this.reclamation = new WorkspaceIndexReclamation(storageRoot)
  }

  previewReclamation(rootPath: string, rootFingerprint: string, guard: ReclamationGuard): Promise<ReclamationPlan | null> {
    return this.reclamation.preview(rootPath, rootFingerprint, guard)
  }

  executeReclamation(plan: ReclamationPlan, guard: ReclamationGuard): Promise<ReclamationResult> {
    return this.reclamation.execute(plan, guard)
  }

  async acquireLock(rootPath: string): Promise<WorkspaceIndexLock> {
    const rootKey = await this.rootKey(rootPath)
    const lockPath = path.join(this.rootDirectory(rootKey), 'writer.lock')
    await fs.ensureDir(path.dirname(lockPath))

    return withLockOperation(lockPath, async () => {
      const createLock = async (): Promise<WorkspaceIndexLock | null> => {
        const ownerId = randomUUID()
        try {
          const handle = await open(lockPath, 'wx', 0o600)
          try {
            await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: Date.now(), ownerId })}\n`, 'utf8')
            await handle.sync()
          } finally {
            await handle.close()
          }
          activeLockOwners.add(ownerId)
          let released = false
          return {
            acquired: true,
            isHeld: () => withLockOperation(lockPath, async () => (
              !released && activeLockOwners.has(ownerId) && await lockBelongsToOwner(lockPath, ownerId)
            )),
            release: () => withLockOperation(lockPath, async () => {
              if (released) return
              released = true
              try {
                if (await lockBelongsToOwner(lockPath, ownerId)) await fs.remove(lockPath)
              } finally {
                activeLockOwners.delete(ownerId)
              }
            }),
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          return null
        }
      }

      const firstAttempt = await createLock()
      if (firstAttempt) return firstAttempt
      const staleSnapshot = await readLockSnapshot(lockPath)
      if (!staleSnapshot) {
        return await createLock() ?? unavailableLock()
      }
      if (!isStaleLock(staleSnapshot) || !await recoverStaleLock(lockPath, staleSnapshot)) {
        return unavailableLock()
      }
      return await createLock() ?? unavailableLock()
    })
  }

  async rootKey(rootPath: string): Promise<string> {
    const key = await this.getInstallationKey()
    return createHmac('sha256', key).update('md-viewer:index-root:v1\0').update(rootPath).digest('hex')
  }

  async documentKey(rootKey: string, relativePath: string): Promise<string> {
    const key = await this.getInstallationKey()
    return createHmac('sha256', key)
      .update('md-viewer:index-document:v1\0')
      .update(rootKey)
      .update('\0')
      .update(relativePath)
      .digest('hex')
  }

  async load(rootPath: string, rootFingerprint: string): Promise<LoadedWorkspaceIndex | null> {
    const rootKey = await this.rootKey(rootPath)
    const rootDir = this.rootDirectory(rootKey)
    let generationId: string
    try { generationId = (await readFile(path.join(rootDir, 'CURRENT'), 'utf8')).trim() } catch { return null }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.loadGeneration(rootDir, rootKey, rootFingerprint, generationId)
      } catch (error) {
        if (attempt || (error as NodeJS.ErrnoException).code !== 'ENOENT') return null
        let latest: string
        try { latest = (await readFile(path.join(rootDir, 'CURRENT'), 'utf8')).trim() } catch { return null }
        if (latest === generationId) return null
        generationId = latest
      }
    }
    return null
  }

  private async loadGeneration(rootDir: string, rootKey: string, rootFingerprint: string,
    generationId: string): Promise<LoadedWorkspaceIndex | null> {
    if (!generationId || generationId === '.' || generationId === '..' || path.basename(generationId) !== generationId) return null
    const manifest = await fs.readJson(path.join(rootDir, 'generations', generationId, 'manifest.json')) as WorkspaceIndexManifest
    if (
      (manifest.schemaVersion !== INDEX_SCHEMA_VERSION && manifest.schemaVersion !== INDEX_STORAGE_VERSION) ||
      manifest.rootKey !== rootKey ||
      manifest.rootFingerprint !== rootFingerprint ||
      manifest.generationId !== generationId
    ) return null

    if (manifest.schemaVersion === INDEX_STORAGE_VERSION) {
      return await loadPacked(rootDir, manifest as PackedManifest)
    }
    const documents: IndexedDocument[] = []
    for (const entry of manifest.documents) {
      const document = await fs.readJson(path.join(rootDir, 'shards', entry.shardFile)) as IndexedDocument
      if (
        document.schemaVersion !== INDEX_SCHEMA_VERSION ||
        document.rootKey !== rootKey ||
        document.indexInstanceId !== manifest.indexInstanceId ||
        document.relativePath !== entry.relativePath ||
        document.revisionToken !== entry.revisionToken
      ) return null
      documents.push(document)
    }
    return { manifest, documents }
  }

  async commit(options: {
    rootPath: string
    rootFingerprint: string
    previousInstanceId?: string
    documents: readonly IndexedDocument[]
  }): Promise<WorkspaceIndexManifest> {
    const rootKey = await this.rootKey(options.rootPath)
    const rootDir = this.rootDirectory(rootKey)
    const generationId = randomUUID()
    const indexInstanceId = options.previousInstanceId ?? randomUUID()
    await fs.ensureDir(path.join(rootDir, 'shards'))
    await fs.ensureDir(path.join(rootDir, 'generations', generationId))

    const buckets = new Map<string, PackedRecord[]>()
    const names = new Set<string>()
    let yieldedAt = performance.now()
    const yieldIfNeeded = async (): Promise<void> => {
      if (performance.now() - yieldedAt >= 8) {
        await new Promise<void>(resolve => setImmediate(resolve))
        yieldedAt = performance.now()
      }
    }
    for (const source of options.documents) {
      await yieldIfNeeded()
      if (names.has(source.relativePath)) throw new Error('工作区索引文档重复')
      names.add(source.relativePath)
      const key = await this.documentKey(rootKey, source.relativePath)
      const { mtimeMs, indexedAt, ...stable } = source
      const record: PackedRecord = {
        key, mtimeMs, indexedAt,
        document: { ...stable, schemaVersion: INDEX_SCHEMA_VERSION, rootKey, indexInstanceId },
      }
      const bucket = key.slice(0, 2)
      const records = buckets.get(bucket)
      if (records) records.push(record)
      else buckets.set(bucket, [record])
    }
    const groups: Array<{ records: PackedRecord[]; shard: PackedShard }> = []
    const partition = (records: PackedRecord[], bit: number): void => {
      const shard: PackedShard = {
        schemaVersion: INDEX_STORAGE_VERSION, rootKey, indexInstanceId,
        documents: records.map(record => record.document),
      }
      if (records.length === 1 || (records.length <= MAX_SHARD_DOCUMENTS &&
        Buffer.byteLength(`${JSON.stringify(shard)}\n`) <= MAX_SHARD_BYTES)) {
        groups.push({ records, shard })
        return
      }
      if (bit === 256) throw new Error('工作区索引文档键冲突')
      const sides: [PackedRecord[], PackedRecord[]] = [[], []]
      for (const record of records) {
        const side = (parseInt(record.key[Math.floor(bit / 4)], 16) >> (3 - bit % 4)) & 1
        sides[side].push(record)
      }
      for (const side of sides) if (side.length) partition(side, bit + 1)
    }
    for (const records of buckets.values()) {
      partition(records.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0), 8)
      await yieldIfNeeded()
    }

    const documentEntries: PackedManifest['documents'] = []
    const shards: PackedManifest['shards'] = {}
    for (let offset = 0; offset < groups.length; offset += 8) {
      const batch = await Promise.allSettled(groups.slice(offset, offset + 8).map(async group => {
        const version = JSON.stringify([rootKey, indexInstanceId,
          group.records.map(record => [record.key, record.document.revisionToken])])
        const shardFile = `${sha256(version)}.json`
        const text = `${JSON.stringify(group.shard)}\n`
        await writeImmutableText(path.join(rootDir, 'shards', shardFile), text)
        return { group, shardFile, hash: sha256(text), bytes: Buffer.byteLength(text) }
      }))
      // Drain every writer before returning an error or publishing a manifest.
      for (const result of batch) {
        if (result.status === 'rejected') throw result.reason
        const { group, shardFile, hash, bytes } = result.value
        shards[shardFile] = { hash, bytes, count: group.records.length }
        for (const record of group.records) {
          documentEntries.push({
            relativePath: record.document.relativePath, revisionToken: record.document.revisionToken,
            shardFile, mtimeMs: record.mtimeMs, indexedAt: record.indexedAt,
          })
        }
      }
    }

    const manifest: PackedManifest = {
      schemaVersion: INDEX_STORAGE_VERSION,
      rootKey,
      rootFingerprint: options.rootFingerprint,
      indexInstanceId,
      generationId,
      createdAt: Date.now(),
      shards,
      documents: documentEntries.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    }
    await writeJsonDurably(path.join(rootDir, 'generations', generationId, 'manifest.json'), manifest)
    await writeAtomicText(path.join(rootDir, 'CURRENT'), `${generationId}\n`)
    return manifest
  }

  async inspectRootFingerprint(rootPath: string): Promise<string> {
    const stats = await stat(rootPath)
    return `${process.platform}:${String(stats.dev)}:${String(stats.ino)}`
  }

  private rootDirectory(rootKey: string): string {
    return path.join(this.storageRoot, 'v1', rootKey)
  }

  private async getInstallationKey(): Promise<Buffer> {
    if (this.installationKey) return this.installationKey
    await fs.ensureDir(this.storageRoot)
    const keyPath = path.join(this.storageRoot, SECRET_FILE)
    try {
      const key = await readFile(keyPath)
      if (key.length === 32) {
        this.installationKey = key
        return key
      }
    } catch {
      // 首次运行时创建安装级随机 key。
    }

    const key = randomBytes(32)
    try {
      await writeFile(keyPath, key, { flag: 'wx', mode: 0o600 })
      this.installationKey = key
      return key
    } catch {
      const existing = await readFile(keyPath)
      if (existing.length !== 32) throw new Error('工作区索引密钥格式无效')
      this.installationKey = existing
      return existing
    }
  }
}

interface WorkspaceIndexLockRecord {
  pid?: number
  startedAt?: number
  ownerId?: string
}

interface WorkspaceIndexLockSnapshot {
  raw: string
  record: WorkspaceIndexLockRecord | null
  mtimeMs: number
  dev: string
  ino: string
}

async function readLockRecord(lockPath: string): Promise<WorkspaceIndexLockRecord | null> {
  return (await readLockSnapshot(lockPath))?.record ?? null
}

async function readLockSnapshot(lockPath: string): Promise<WorkspaceIndexLockSnapshot | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(lockPath, 'r')
    const lockStats = await handle.stat()
    const raw = await handle.readFile('utf8')
    let record: WorkspaceIndexLockRecord | null = null
    try {
      const parsed = JSON.parse(raw) as WorkspaceIndexLockRecord
      if (parsed && typeof parsed === 'object') record = parsed
    } catch {
      // 损坏锁只有超过保护窗口后才允许回收。
    }
    return {
      raw,
      record,
      mtimeMs: lockStats.mtimeMs,
      dev: String(lockStats.dev),
      ino: String(lockStats.ino),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  } finally {
    await handle?.close()
  }
}

async function lockBelongsToOwner(lockPath: string, ownerId: string): Promise<boolean> {
  const record = await readLockRecord(lockPath)
  return record?.ownerId === ownerId
}

function isStaleLock(snapshot: WorkspaceIndexLockSnapshot): boolean {
  const { record } = snapshot
  if (!record || !Number.isInteger(record.pid) || (record.pid ?? 0) <= 0) {
    return Date.now() - snapshot.mtimeMs >= LOCK_RECOVERY_GRACE_MS
  }
  if (record.pid === process.pid) {
    return typeof record.ownerId === 'string' && !activeLockOwners.has(record.ownerId)
  }
  return !isProcessAlive(record.pid!)
}

async function recoverStaleLock(lockPath: string, snapshot: WorkspaceIndexLockSnapshot): Promise<boolean> {
  const snapshotId = createHash('sha256')
    .update(snapshot.raw)
    .update('\0').update(snapshot.dev)
    .update('\0').update(snapshot.ino)
    .digest('hex')
  const claimPath = `${lockPath}.recover-${snapshotId}`
  let claim: Awaited<ReturnType<typeof open>> | undefined
  try {
    claim = await open(claimPath, 'wx', 0o600)
    await claim.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`, 'utf8')
    await claim.sync()
  } catch (error) {
    await claim?.close()
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  await claim.close()

  try {
    const current = await readLockSnapshot(lockPath)
    if (!current || !sameLockSnapshot(current, snapshot) || !isStaleLock(current)) return false
    await fs.remove(lockPath)
    return true
  } finally {
    await fs.remove(claimPath)
  }
}

function sameLockSnapshot(left: WorkspaceIndexLockSnapshot, right: WorkspaceIndexLockSnapshot): boolean {
  return left.raw === right.raw && left.dev === right.dev && left.ino === right.ino
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    return true
  }
}

function unavailableLock(): WorkspaceIndexLock {
  return {
    acquired: false,
    isHeld: async () => false,
    release: async () => undefined,
  }
}

async function withLockOperation<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = lockOperationQueues.get(lockPath) ?? Promise.resolve()
  let unlock = (): void => undefined
  const gate = new Promise<void>(resolve => { unlock = resolve })
  const queued = previous.then(() => gate)
  lockOperationQueues.set(lockPath, queued)
  await previous
  try {
    return await operation()
  } finally {
    unlock()
    if (lockOperationQueues.get(lockPath) === queued) lockOperationQueues.delete(lockPath)
  }
}

async function loadPacked(rootDir: string, manifest: PackedManifest): Promise<LoadedWorkspaceIndex | null> {
  if (!manifest.shards || typeof manifest.shards !== 'object' || Array.isArray(manifest.shards) ||
    !Array.isArray(manifest.documents)) return null
  const byPath = new Map<string, { document: StableIndexedDocument; file: string }>()
  const files = Object.entries(manifest.shards)
  for (const [file, info] of files) {
    if (!/^[a-f0-9]{64}\.json$/.test(file) || !info ||
      !Number.isInteger(info.count) || info.count < 1 || info.count > MAX_SHARD_DOCUMENTS ||
      !Number.isSafeInteger(info.bytes) || info.bytes < 1 ||
      (info.bytes > MAX_SHARD_BYTES && info.count !== 1)) return null
    const bytes = await readFile(path.join(rootDir, 'shards', file))
    if (bytes.byteLength !== info.bytes || sha256(bytes) !== info.hash) return null
    const shard = JSON.parse(bytes.toString('utf8')) as PackedShard
    if (shard.schemaVersion !== INDEX_STORAGE_VERSION || shard.rootKey !== manifest.rootKey ||
      shard.indexInstanceId !== manifest.indexInstanceId || !Array.isArray(shard.documents) ||
      shard.documents.length !== info.count) return null
    for (const document of shard.documents) {
      if (document.schemaVersion !== INDEX_SCHEMA_VERSION || document.rootKey !== manifest.rootKey ||
        document.indexInstanceId !== manifest.indexInstanceId || byPath.has(document.relativePath)) return null
      byPath.set(document.relativePath, { document, file })
    }
  }
  const documents: IndexedDocument[] = []
  const usedFiles = new Set<string>()
  for (const entry of manifest.documents) {
    if (typeof entry.relativePath !== 'string' || !entry.relativePath ||
      path.posix.isAbsolute(entry.relativePath) || path.win32.isAbsolute(entry.relativePath) ||
      entry.relativePath.split(/[\\/]/).some(part => part === '..') ||
      !Number.isFinite(entry.mtimeMs) || !Number.isFinite(entry.indexedAt)) return null
    const found = byPath.get(entry.relativePath)
    if (!found || found.file !== entry.shardFile || found.document.revisionToken !== entry.revisionToken) return null
    byPath.delete(entry.relativePath)
    usedFiles.add(entry.shardFile)
    documents.push({ ...found.document, mtimeMs: entry.mtimeMs, indexedAt: entry.indexedAt })
  }
  if (byPath.size || usedFiles.size !== files.length) return null
  return { manifest, documents }
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

async function writeImmutableText(filePath: string, text: string): Promise<void> {
  const expected = Buffer.from(text, 'utf8')
  const compare = (existing: Buffer): void => {
    if (!existing.equals(expected)) throw new Error(`工作区索引分片冲突: ${path.basename(filePath)}`)
  }
  try {
    compare(await readFile(filePath))
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeDurableText(tempPath, text)
    try {
      await link(tempPath, filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      compare(await readFile(filePath))
    }
  } finally {
    await unlink(tempPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}

async function writeDurableText(filePath: string, content: string): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeJsonDurably(filePath: string, value: unknown): Promise<void> {
  await writeDurableText(filePath, `${JSON.stringify(value)}\n`)
}

async function writeAtomicText(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  await writeDurableText(tempPath, content)
  await rename(tempPath, filePath)
}
