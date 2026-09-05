import { createHash, createHmac, randomBytes, randomUUID } from 'crypto'
import { link, open, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import * as fs from 'fs-extra'
import * as path from 'path'
import type { IndexedDocument, WorkspaceIndexManifest } from './types'

const INDEX_SCHEMA_VERSION = 1
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

  constructor(private readonly storageRoot: string) {}

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
    try {
      const generationId = (await readFile(path.join(rootDir, 'CURRENT'), 'utf8')).trim()
      if (!generationId || path.basename(generationId) !== generationId) return null
      const manifest = await fs.readJson(path.join(rootDir, 'generations', generationId, 'manifest.json')) as WorkspaceIndexManifest
      if (
        manifest.schemaVersion !== INDEX_SCHEMA_VERSION ||
        manifest.rootKey !== rootKey ||
        manifest.rootFingerprint !== rootFingerprint ||
        manifest.generationId !== generationId
      ) return null

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
    } catch {
      return null
    }
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

    const documentEntries: WorkspaceIndexManifest['documents'] = []
    for (const source of options.documents) {
      const document: IndexedDocument = {
        ...source,
        schemaVersion: INDEX_SCHEMA_VERSION,
        rootKey,
        indexInstanceId,
      }
      const shardKey = await this.documentKey(rootKey, document.relativePath)
      const shardFile = `${shardKey}-${indexInstanceId}-${document.revisionToken.slice(-64)}.json`
      const shardPath = path.join(rootDir, 'shards', shardFile)
      await writeJsonImmutably(shardPath, document)
      documentEntries.push({
        relativePath: document.relativePath,
        revisionToken: document.revisionToken,
        shardFile,
      })
    }

    const manifest: WorkspaceIndexManifest = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      rootKey,
      rootFingerprint: options.rootFingerprint,
      indexInstanceId,
      generationId,
      createdAt: Date.now(),
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

async function writeJsonImmutably(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeJsonDurably(tempPath, value)
    try {
      await link(tempPath, filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = JSON.parse(await readFile(filePath, 'utf8')) as unknown
      if (stableShardJson(existing) !== stableShardJson(value)) {
        throw new Error(`工作区索引分片冲突: ${path.basename(filePath)}`)
      }
    }
  } finally {
    await unlink(tempPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}

function stableShardJson(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value)
  const { mtimeMs: _mtimeMs, indexedAt: _indexedAt, ...stable } = value as Record<string, unknown>
  return JSON.stringify(stable)
}

async function writeJsonDurably(filePath: string, value: unknown): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeAtomicText(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  const handle = await open(tempPath, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tempPath, filePath)
}
