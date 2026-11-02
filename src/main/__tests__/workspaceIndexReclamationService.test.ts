import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import type { WorkspaceWatchService } from '../watching/WorkspaceWatchService'

let directory: string
let root: string
let storage: string
let store: WorkspaceIndexStore
let service: WorkspaceIndexService
const watcher = { attachIndexConsumer: vi.fn(), detachIndexConsumer: vi.fn() }

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mdv-reclamation-service-'))
  root = join(directory, 'workspace')
  storage = join(directory, 'storage')
  await mkdir(root)
  root = await realpath(root)
  await writeFile(join(root, 'note.md'), '# title\n\nsearchable initial')
  store = new WorkspaceIndexStore(storage)
  service = new WorkspaceIndexService(store, watcher as unknown as WorkspaceWatchService)
})
afterEach(async () => {
  await service.detach(root, 'consumer')
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})
async function seed() {
  await service.attach(root, 'consumer')
  await service.waitUntilIdle(root)
  for (let i = 0; i < 3; i++) {
    await writeFile(join(root, 'note.md'), `# title\n\nsearchable revision ${i}`)
    await service.rebuild(root)
  }
}
async function generations() {
  return readdir(join(storage, 'v1', await store.rootKey(root), 'generations'))
}

describe('queued index reclamation', () => {
  it('does not attach, create a cache or scan documents just to preview', async () => {
    const attach = vi.spyOn(service, 'attach')
    await expect(service.prepareReclamation(root, () => {})).rejects.toMatchObject({ code: 'busy' })
    expect(attach).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual(['workspace'])
  })

  it('keeps preview read-only, then reclaims without changing current data or search', async () => {
    await seed()
    const before = await generations()
    const source = await readFile(join(root, 'note.md'))
    const authorize = vi.fn()
    const prepared = await service.prepareReclamation(root, authorize)
    expect(await generations()).toEqual(before)
    expect(prepared?.summary.generations).toBe(2)
    const result = await prepared!.execute()
    expect(result.status).toBe('completed')
    expect(await generations()).toHaveLength(2)
    expect(await readFile(join(root, 'note.md'))).toEqual(source)
    expect(await service.query(root, 'searchable')).toHaveLength(1)
    expect(service.getStatus(root).state).toBe('ready')
    expect(authorize).toHaveBeenCalled()
  })

  it('does not hold the queue during confirmation and rejects a changed preview', async () => {
    await seed()
    const prepared = await service.prepareReclamation(root, () => {})
    await writeFile(join(root, 'note.md'), '# title\n\nsearchable newest')
    await service.rebuild(root)
    const before = await generations()
    await expect(prepared!.execute()).rejects.toMatchObject({ code: 'stale' })
    expect(await generations()).toEqual(before)
    expect(service.getStatus(root).state).toBe('ready')
    await service.rebuild(root)
    expect(await service.query(root, 'newest')).toHaveLength(1)
  })

  it('rechecks authority before an approved operation can delete anything', async () => {
    await seed()
    let valid = true
    const prepared = await service.prepareReclamation(root, () => { if (!valid) throw new Error('expired') })
    const before = await generations()
    valid = false
    await expect(prepared!.execute()).rejects.toThrow('expired')
    expect(await generations()).toEqual(before)
    await service.rebuild(root)
    expect(service.getStatus(root).state).toBe('ready')
  })

  it('invalidates an operation after its runtime is detached', async () => {
    await seed()
    const prepared = await service.prepareReclamation(root, () => {})
    const before = await generations()
    await service.detach(root, 'consumer')
    await expect(prepared!.execute()).rejects.toMatchObject({ code: 'stale' })
    expect(await generations()).toEqual(before)
  })

  it('rejects a workspace directory replaced under the same path while awaiting confirmation', async () => {
    await seed()
    const prepared = await service.prepareReclamation(root, () => {})
    const before = await generations()
    await rename(root, `${root}-original`)
    await mkdir(root)
    await expect(prepared!.execute()).rejects.toMatchObject({ code: 'stale' })
    expect(await generations()).toEqual(before)
    expect(await readdir(root)).toEqual([])
    expect(await readFile(join(`${root}-original`, 'note.md'), 'utf8')).toContain('searchable')
  })

  it('does not clean when another process owns the writer lease', async () => {
    const owner = await store.acquireLock(root)
    try {
      await service.attach(root, 'consumer')
      await service.waitUntilIdle(root)
      expect(service.getStatus(root).state).toBe('read-only')
      await expect(service.prepareReclamation(root, () => {})).rejects.toMatchObject({ code: 'busy' })
      expect(await service.query(root, 'searchable')).toHaveLength(1)
    } finally { await owner.release() }
  })

  it('keeps subsequent queued indexing usable after maintenance failure', async () => {
    await seed()
    const prepared = await service.prepareReclamation(root, () => {})
    vi.spyOn(store, 'executeReclamation').mockRejectedValueOnce(new Error('injected maintenance failure'))
    await expect(prepared!.execute()).rejects.toThrow('injected')
    await writeFile(join(root, 'note.md'), '# title\n\nsearchable recovered')
    await service.rebuild(root)
    expect(service.getStatus(root).state).toBe('ready')
    expect(await service.query(root, 'recovered')).toHaveLength(1)
  })
})
