import { createHash, createHmac } from 'crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, rmdirSync, unlinkSync, type Stats } from 'fs'
import { lstat, open, opendir, realpath } from 'fs/promises'
import * as path from 'path'
import type { IndexedDocument, WorkspaceIndexManifest } from './types'

export type ReclamationGuard = () => Promise<void>
export type ReclamationErrorCode = 'stale' | 'busy' | 'budget' | 'invalid'
export class ReclamationError extends Error {
  constructor(readonly code: ReclamationErrorCode) {
    super({ stale: '索引预览已失效，请重新操作', busy: '当前工作区暂不可回收',
      budget: '本次无法在安全预算内完成回收', invalid: '无法确认索引完整性，未继续回收' }[code])
    this.name = 'ReclamationError'
  }
}
export interface ReclamationPlan {
  readonly summary: Readonly<{
    generations: number; files: number; bytes: number; directories: number; retainedGenerations: number
  }>
}
export interface ReclamationResult {
  status: 'completed' | 'partial'
  deletedFiles: number
  deletedBytes: number
  deletedDirectories: number
  skippedFiles: number
  failedFiles: number
}

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const GENERATION = new RegExp(`^${UUID}$`)
const HASH = /^[a-f0-9]{64}$/
const PACKED_FILE = /^[a-f0-9]{64}\.json$/
const LEGACY_FILE = new RegExp(`^[a-f0-9]{64}-${UUID}-[a-f0-9]{64}\\.json$`)
const LIMITS = { milliseconds: 30_000, manifestBytes: 32 * 1024 * 1024,
  readBytes: 512 * 1024 * 1024, entries: 100_000, candidates: 100_000, references: 2_000_000 }
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const identity = (s: Stats): string => `${s.dev}:${s.ino}`
const signature = (s: Stats): string => `${identity(s)}:${s.mode}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`
const invalid = (): never => { throw new ReclamationError('invalid') }
const stale = (): never => { throw new ReclamationError('stale') }
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

class Budget {
  private readonly started = performance.now()
  private lastYield = this.started
  private entries = 0
  private bytes = 0
  private references = 0
  private candidates = 0
  constructor(private readonly guard: ReclamationGuard) {}
  check(): void {
    if (performance.now() - this.started > LIMITS.milliseconds) throw new ReclamationError('budget')
  }
  count(kind: 'entries' | 'bytes' | 'references' | 'candidates', amount = 1): void {
    this.check()
    this[kind] += amount
    const maximum = kind === 'bytes' ? LIMITS.readBytes : LIMITS[kind]
    if (this[kind] > maximum) throw new ReclamationError('budget')
  }
  async checkpoint(): Promise<void> {
    this.check()
    if (performance.now() - this.lastYield >= 8) {
      await new Promise<void>(resolve => setImmediate(resolve))
      await this.guard()
      this.lastYield = performance.now()
      this.check()
    }
  }
}
interface FileSnapshot { name: string; signature: string; bytes: number; hash?: string }
interface GenerationSnapshot { id: string; identity: string; manifest?: FileSnapshot; removableDirectory: boolean }
interface PackedManifest extends WorkspaceIndexManifest {
  shards: Record<string, { hash: string; bytes: number; count: number }>
  documents: Array<WorkspaceIndexManifest['documents'][number] & { mtimeMs: number; indexedAt: number }>
}
interface Snapshot {
  rootPath: string
  rootFingerprint: string
  storage: string
  rootKey: string
  base: string
  directories: Map<string, string>
  current: FileSnapshot
  currentId: string
  fingerprint: string
  generations: GenerationSnapshot[]
  manifests: GenerationSnapshot[]
  shards: FileSnapshot[]
  emptyDirectories: GenerationSnapshot[]
  summary: ReclamationPlan['summary']
}

/** Manual maintenance only. Plans are single-use identities, never deserialized input. */
export class WorkspaceIndexReclamation {
  private readonly plans = new WeakMap<ReclamationPlan, Snapshot>()
  constructor(private readonly storageRoot: string) {}

  async preview(rootPath: string, rootFingerprint: string, guard: ReclamationGuard): Promise<ReclamationPlan | null> {
    const snapshot = await this.scan(rootPath, rootFingerprint, guard)
    if (!snapshot) return null
    const plan = Object.freeze({ summary: Object.freeze(snapshot.summary) })
    this.plans.set(plan, snapshot)
    return plan
  }

  async execute(plan: ReclamationPlan, guard: ReclamationGuard): Promise<ReclamationResult> {
    const approved = this.plans.get(plan)
    if (!approved) return invalid()
    this.plans.delete(plan)
    await guard()
    let checked: Snapshot | null
    try { checked = await this.scan(approved.rootPath, approved.rootFingerprint, guard) } catch (error) {
      if (error instanceof ReclamationError && error.code === 'invalid') return stale()
      throw error
    }
    if (!checked || checked.fingerprint !== approved.fingerprint) return stale()
    const budget = new Budget(guard)
    const result: ReclamationResult = { status: 'completed', deletedFiles: 0, deletedBytes: 0,
      deletedDirectories: 0, skippedFiles: 0, failedFiles: 0 }
    const total = approved.summary.files + approved.summary.directories
    let attempted = 0
    const deletedManifests = new Set<string>()
    const critical = async (generation?: GenerationSnapshot): Promise<void> => {
      await budget.checkpoint()
      await guard()
      await this.assertDirectories(approved, generation)
      const pointer = await readChecked(path.join(approved.base, 'CURRENT'), budget, 128)
      if (pointer.snapshot.signature !== approved.current.signature || pointer.snapshot.hash !== approved.current.hash) stale()
      budget.check()
    }
    const removeFile = async (file: FileSnapshot, absolute: string, generation?: GenerationSnapshot): Promise<boolean> => {
      await critical(generation)
      const now = await statChecked(absolute)
      if (!now.isFile() || signature(now) !== file.signature) return stale()
      await guard()
      this.assertFinalSync(approved, budget, generation)
      let final: Stats
      try { final = lstatSync(absolute) } catch { return stale() }
      if (!final.isFile() || signature(final) !== file.signature) return stale()
      budget.check()
      attempted++
      try {
        unlinkSync(absolute)
        result.deletedFiles++
        result.deletedBytes += file.bytes
        return true
      } catch {
        result.failedFiles++
        return false
      }
    }
    try {
      for (const generation of approved.manifests) {
        if (await removeFile(generation.manifest!, path.join(approved.base, 'generations', generation.id, 'manifest.json'), generation)) {
          deletedManifests.add(generation.id)
        }
      }
      // Exactly one surviving-reference pass. Any incomplete pass stops all shard deletion.
      const references = await this.survivingReferences(approved, deletedManifests, budget, critical)
      for (const shard of approved.shards) {
        if (references.has(shard.name)) { result.skippedFiles++; attempted++; continue }
        await removeFile(shard, path.join(approved.base, 'shards', shard.name))
      }
      for (const generation of approved.emptyDirectories) {
        if (generation.manifest && !deletedManifests.has(generation.id)) {
          result.skippedFiles++; attempted++; continue
        }
        await critical(generation)
        const directory = path.join(approved.base, 'generations', generation.id)
        if ((await names(directory, budget)).length) { result.skippedFiles++; attempted++; continue }
        await guard()
        this.assertFinalSync(approved, budget, generation)
        budget.check()
        attempted++
        try { rmdirSync(directory); result.deletedDirectories++ } catch { result.failedFiles++ }
      }
    } catch (error) {
      if (!result.deletedFiles && !result.deletedDirectories) throw error
      result.status = 'partial'
      result.skippedFiles += total - attempted
    }
    if (result.failedFiles || result.skippedFiles) result.status = 'partial'
    return result
  }

  private async scan(rootPath: string, rootFingerprint: string, guard: ReclamationGuard): Promise<Snapshot | null> {
    const budget = new Budget(guard)
    await guard()
    // Do not call rootKey(): normal rootKey creates installation.key on a cold cache.
    let storageStats: Stats
    try { storageStats = await lstat(this.storageRoot) } catch (error) {
      if (missing(error)) return null
      return invalid()
    }
    if (!storageStats.isDirectory() || storageStats.isSymbolicLink()) return invalid()
    const storage = await safe(() => realpath(this.storageRoot))
    if (identity(await statChecked(storage)) !== identity(storageStats)) return stale()
    const keyPath = path.join(storage, 'installation.key')
    let key: Awaited<ReturnType<typeof readChecked>>
    try { key = await readChecked(keyPath, budget, 32, true) } catch (error) {
      if (missing(error)) return null
      throw error
    }
    if (key.bytes.length !== 32) return invalid()
    const rootKey = createHmac('sha256', key.bytes).update('md-viewer:index-root:v1\0').update(rootPath).digest('hex')
    const base = path.join(storage, 'v1', rootKey)
    const directories = new Map<string, string>([[storage, identity(storageStats)]])
    for (const directory of [path.join(storage, 'v1'), base]) {
      let stats: Stats
      try { stats = await lstat(directory) } catch (error) {
        if (missing(error)) return null
        return invalid()
      }
      if (!stats.isDirectory() || stats.isSymbolicLink()) return invalid()
      directories.set(directory, identity(stats))
    }
    let pointer: Awaited<ReturnType<typeof readChecked>>
    try { pointer = await readChecked(path.join(base, 'CURRENT'), budget, 128, true) } catch (error) {
      if (missing(error)) return null
      throw error
    }
    const currentId = pointer.bytes.toString('utf8').trim()
    if (!GENERATION.test(currentId)) return invalid()
    for (const directory of [path.join(base, 'generations'), path.join(base, 'shards')]) {
      const stats = await statChecked(directory)
      if (!stats.isDirectory() || stats.isSymbolicLink()) return invalid()
      directories.set(directory, identity(stats))
    }
    const fingerprint = createHash('sha256')
    const record = (value: unknown): void => { fingerprint.update(JSON.stringify(value)).update('\n') }
    record([...directories]); record(key.snapshot); record(pointer.snapshot)
    const generations: GenerationSnapshot[] = []
    let current: WorkspaceIndexManifest | undefined, newest: WorkspaceIndexManifest | undefined
    for (const id of await names(path.join(base, 'generations'), budget)) {
      await budget.checkpoint()
      if (!GENERATION.test(id)) return invalid()
      const directory = path.join(base, 'generations', id)
      const stats = await statChecked(directory)
      if (!stats.isDirectory() || stats.isSymbolicLink()) return invalid()
      const entries = await names(directory, budget)
      const generation: GenerationSnapshot = { id, identity: identity(stats), removableDirectory: entries.length === 0 }
      record([id, generation.identity, entries])
      if (!entries.includes('manifest.json')) {
        if (entries.length) return invalid()
      } else {
        // Never remove the only manifest from a mixed-content directory: doing so
        // would turn a retryable generation into an unknown, permanently blocked orphan.
        if (entries.length !== 1) return invalid()
        const { manifest, snapshot } = await readManifest(directory, rootKey, rootFingerprint, id, budget)
        generation.manifest = snapshot
        generation.removableDirectory = entries.length === 1
        record(snapshot)
        if (id === currentId) current = manifest
        else if (!newest || manifest.createdAt > newest.createdAt ||
          (manifest.createdAt === newest.createdAt && id > newest.generationId)) newest = manifest
      }
      generations.push(generation)
    }
    if (!current) return invalid()
    const retained = [current, ...(newest ? [newest] : [])]
    const references = new Set<string>()
    await validateRetained(base, retained, references, budget)
    const shards: FileSnapshot[] = []
    for (const name of await names(path.join(base, 'shards'), budget)) {
      await budget.checkpoint()
      if (!PACKED_FILE.test(name) && !LEGACY_FILE.test(name)) continue
      const stats = await statChecked(path.join(base, 'shards', name))
      if (!stats.isFile() || stats.isSymbolicLink()) return invalid()
      const snapshot = { name, signature: signature(stats), bytes: stats.size }
      record(snapshot)
      if (!references.has(name)) { budget.count('candidates'); shards.push(snapshot) }
    }
    const keep = new Set(retained.map(m => m.generationId))
    const manifests = generations.filter(g => g.manifest && !keep.has(g.id))
    const emptyDirectories = generations.filter(g => g.removableDirectory && !keep.has(g.id))
    budget.count('candidates', manifests.length + emptyDirectories.length)
    const summary = { generations: manifests.length, files: manifests.length + shards.length,
      bytes: manifests.reduce((sum, g) => sum + g.manifest!.bytes, 0) + shards.reduce((sum, s) => sum + s.bytes, 0),
      directories: emptyDirectories.length, retainedGenerations: keep.size }
    const snapshot: Snapshot = { rootPath, rootFingerprint, storage, rootKey, base, directories,
      current: pointer.snapshot, currentId, fingerprint: fingerprint.digest('hex'), generations, manifests,
      shards, emptyDirectories, summary }
    await guard()
    await this.assertDirectories(snapshot)
    const finalPointer = await readChecked(path.join(base, 'CURRENT'), budget, 128)
    if (finalPointer.snapshot.signature !== pointer.snapshot.signature || finalPointer.snapshot.hash !== pointer.snapshot.hash) stale()
    budget.check()
    return snapshot
  }

  /** No JS yield between these final checks and unlinkSync/rmdirSync. This closes
   * in-process guard interleaving, not arbitrary hostile same-UID external rename
   * races (Node has no directory-relative unlinkat API). Only small CURRENT reads
   * and fixed-depth metadata checks are synchronous; history scans remain async. */
  private assertFinalSync(snapshot: Snapshot, budget: Budget, generation?: GenerationSnapshot): void {
    let descriptor: number | undefined
    try {
      const verifyDirectory = (directory: string, expected: string | undefined): void => {
        const stats = lstatSync(directory)
        if (!stats.isDirectory() || stats.isSymbolicLink() || identity(stats) !== expected) stale()
      }
      verifyDirectory(this.storageRoot, snapshot.directories.get(snapshot.storage))
      for (const [directory, expected] of snapshot.directories) verifyDirectory(directory, expected)
      if (generation) verifyDirectory(path.join(snapshot.base, 'generations', generation.id), generation.identity)
      const pointer = path.join(snapshot.base, 'CURRENT')
      const before = lstatSync(pointer)
      if (!before.isFile() || signature(before) !== snapshot.current.signature || before.size > 128) stale()
      budget.count('bytes', before.size)
      descriptor = openSync(pointer, constants.O_RDONLY | constants.O_NOFOLLOW)
      if (signature(fstatSync(descriptor)) !== snapshot.current.signature) stale()
      const bytes = Buffer.alloc(before.size + 1)
      let length = 0
      while (length < bytes.length) {
        const read = readSync(descriptor, bytes, length, bytes.length - length, length)
        if (!read) break
        length += read
      }
      if (length !== before.size || hash(bytes.subarray(0, length)) !== snapshot.current.hash ||
        signature(fstatSync(descriptor)) !== snapshot.current.signature ||
        signature(lstatSync(pointer)) !== snapshot.current.signature) stale()
      budget.check()
    } catch (error) {
      if (error instanceof ReclamationError) throw error
      stale()
    } finally { if (descriptor !== undefined) closeSync(descriptor) }
  }

  private async assertDirectories(snapshot: Snapshot, generation?: GenerationSnapshot): Promise<void> {
    // storageRoot may have been renamed or replaced since its canonical path was obtained.
    const original = await statChecked(this.storageRoot)
    if (!original.isDirectory() || original.isSymbolicLink() || identity(original) !== snapshot.directories.get(snapshot.storage)) stale()
    for (const [directory, expected] of snapshot.directories) {
      const stats = await statChecked(directory)
      if (!stats.isDirectory() || stats.isSymbolicLink() || identity(stats) !== expected) stale()
    }
    if (generation) {
      const stats = await statChecked(path.join(snapshot.base, 'generations', generation.id))
      if (!stats.isDirectory() || stats.isSymbolicLink() || identity(stats) !== generation.identity) stale()
    }
  }

  private async survivingReferences(snapshot: Snapshot, deleted: Set<string>, budget: Budget,
    critical: (generation?: GenerationSnapshot) => Promise<void>): Promise<Set<string>> {
    await critical()
    const references = new Set<string>()
    const known = new Map(snapshot.generations.map(g => [g.id, g]))
    const ids = await names(path.join(snapshot.base, 'generations'), budget)
    if (ids.length !== known.size) return stale()
    for (const id of ids) {
      await budget.checkpoint()
      const generation = known.get(id)
      if (!generation) return stale()
      await this.assertDirectories(snapshot, generation)
      const directory = path.join(snapshot.base, 'generations', id)
      const entries = await names(directory, budget)
      if (!entries.includes('manifest.json')) {
        if (generation.manifest && !deleted.has(id)) return stale()
        if (entries.length && !deleted.has(id)) return invalid()
        continue
      }
      if (deleted.has(id) || !generation.manifest) return stale()
      if (entries.length !== 1) return invalid()
      const { manifest, snapshot: actual } = await readManifest(directory, snapshot.rootKey, snapshot.rootFingerprint, id, budget)
      if (actual.signature !== generation.manifest.signature || actual.hash !== generation.manifest.hash) return stale()
      for (const entry of manifest.documents) references.add(entry.shardFile)
    }
    await critical()
    return references
  }
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) {
    if (error instanceof ReclamationError) throw error
    return invalid()
  }
}
async function statChecked(file: string): Promise<Stats> { return safe(() => lstat(file)) }
async function names(directory: string, budget: Budget): Promise<string[]> {
  const result: string[] = []
  const handle = await safe(() => opendir(directory))
  try {
    for (;;) {
      const entry = await safe(() => handle.read())
      if (!entry) break
      budget.count('entries')
      result.push(entry.name)
      await budget.checkpoint()
    }
  } finally { await safe(() => handle.close()) }
  return result.sort()
}
async function readChecked(file: string, budget: Budget, maximum = LIMITS.readBytes, allowMissing = false): Promise<{ bytes: Buffer; snapshot: FileSnapshot }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const before = await lstat(file)
    if (!before.isFile() || before.isSymbolicLink()) return invalid()
    if (before.size > maximum) throw new ReclamationError('budget')
    budget.count('bytes', before.size)
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    if (signature(await handle.stat()) !== signature(before)) return stale()
    // A bounded read also prevents a concurrent append from defeating the stat-based budget.
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      budget.check()
      const read = await handle.read(bytes, length, bytes.length - length, length)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    if (length !== before.size || signature(await handle.stat()) !== signature(before) ||
      signature(await lstat(file)) !== signature(before)) return stale()
    const content = bytes.subarray(0, length)
    return { bytes: content, snapshot: { name: path.basename(file), signature: signature(before), bytes: length, hash: hash(content) } }
  } catch (error) {
    if (error instanceof ReclamationError || (allowMissing && missing(error))) throw error
    return invalid()
  } finally { if (handle) await safe(() => handle!.close()) }
}

function relativeName(value: unknown): value is string {
  return typeof value === 'string' && !!value && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) &&
    !value.includes('\0') && !value.split(/[\\/]/).some(part => part === '..' || part === '.')
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
async function readManifest(directory: string, rootKey: string, rootFingerprint: string, id: string, budget: Budget): Promise<{ manifest: WorkspaceIndexManifest; snapshot: FileSnapshot }> {
  const read = await readChecked(path.join(directory, 'manifest.json'), budget, LIMITS.manifestBytes)
  let value: unknown
  try { value = JSON.parse(read.bytes.toString('utf8')) } catch { return invalid() }
  if (!object(value) || (value.schemaVersion !== 2 && value.schemaVersion !== 3) || value.rootKey !== rootKey ||
    value.rootFingerprint !== rootFingerprint || value.generationId !== id || typeof value.indexInstanceId !== 'string' ||
    !GENERATION.test(value.indexInstanceId) || !Number.isFinite(value.createdAt) || (value.createdAt as number) < 0 ||
    !Array.isArray(value.documents)) return invalid()
  budget.count('references', value.documents.length)
  const paths = new Set<string>(), files = new Map<string, number>()
  for (const entry of value.documents) {
    if (!object(entry) || !relativeName(entry.relativePath) || paths.has(entry.relativePath) ||
      typeof entry.revisionToken !== 'string' || !entry.revisionToken || typeof entry.shardFile !== 'string' ||
      !(value.schemaVersion === 3 ? PACKED_FILE : LEGACY_FILE).test(entry.shardFile)) return invalid()
    if (value.schemaVersion === 3 && (!Number.isFinite(entry.mtimeMs) || !Number.isFinite(entry.indexedAt))) return invalid()
    paths.add(entry.relativePath)
    files.set(entry.shardFile, (files.get(entry.shardFile) ?? 0) + 1)
  }
  if (value.schemaVersion === 3) {
    if (!object(value.shards)) return invalid()
    const entries = Object.entries(value.shards)
    if (entries.length !== files.size) return invalid()
    for (const [file, info] of entries) {
      if (!PACKED_FILE.test(file) || !object(info) || typeof info.hash !== 'string' || !HASH.test(info.hash) ||
        !Number.isSafeInteger(info.bytes) || (info.bytes as number) < 1 || !Number.isInteger(info.count) ||
        (info.count as number) < 1 || (info.count as number) > 64 || files.get(file) !== info.count ||
        ((info.bytes as number) > 256 * 1024 && info.count !== 1)) return invalid()
    }
  } else if ([...files.values()].some(count => count !== 1)) return invalid()
  budget.check()
  return { manifest: value as unknown as WorkspaceIndexManifest, snapshot: read.snapshot }
}

/** Cache only correspondence metadata, not historical shard JSON/document bodies. */
async function validateRetained(base: string, manifests: WorkspaceIndexManifest[], references: Set<string>, budget: Budget): Promise<void> {
  const cache = new Map<string, { hash: string; bytes: number; schema: number; instance: string;
    documents: Map<string, string> }>()
  for (const manifest of manifests) {
    const entries = new Map<string, Map<string, string>>()
    for (const entry of manifest.documents) {
      let documents = entries.get(entry.shardFile)
      if (!documents) { documents = new Map(); entries.set(entry.shardFile, documents) }
      documents.set(entry.relativePath, entry.revisionToken)
    }
    for (const [file, expected] of entries) {
      await budget.checkpoint()
      references.add(file)
      let checked = cache.get(file)
      if (!checked) {
        const read = await readChecked(path.join(base, 'shards', file), budget)
        let value: unknown
        try { value = JSON.parse(read.bytes.toString('utf8')) } catch { return invalid() }
        if (!object(value) || value.schemaVersion !== manifest.schemaVersion || value.rootKey !== manifest.rootKey ||
          value.indexInstanceId !== manifest.indexInstanceId) return invalid()
        const documents = manifest.schemaVersion === 3 ? value.documents : [value]
        if (!Array.isArray(documents)) return invalid()
        const correspondence = new Map<string, string>()
        for (const document of documents as IndexedDocument[]) {
          if (!object(document) || document.schemaVersion !== 2 || document.rootKey !== manifest.rootKey ||
            document.indexInstanceId !== manifest.indexInstanceId || !relativeName(document.relativePath) ||
            typeof document.revisionToken !== 'string' || correspondence.has(document.relativePath)) return invalid()
          correspondence.set(document.relativePath, document.revisionToken)
        }
        checked = { hash: read.snapshot.hash!, bytes: read.bytes.length, schema: manifest.schemaVersion,
          instance: manifest.indexInstanceId, documents: correspondence }
        cache.set(file, checked)
      }
      if (checked.schema !== manifest.schemaVersion || checked.instance !== manifest.indexInstanceId ||
        checked.documents.size !== expected.size) return invalid()
      if (manifest.schemaVersion === 3) {
        const info = (manifest as PackedManifest).shards[file]
        if (checked.hash !== info.hash || checked.bytes !== info.bytes || checked.documents.size !== info.count) return invalid()
      }
      for (const [name, revision] of expected) if (checked.documents.get(name) !== revision) return invalid()
    }
  }
}
