import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserSortStore as store } from '../../src/stores/browserSortStore'
import type { FileTreeSortSnapshot } from '../../../shared/fileTreeSort'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('independent workspace browser sort settings', () => {
  let receive: (snapshot: FileTreeSortSnapshot) => void
  let disconnect: (() => void) | undefined
  let snapshot: FileTreeSortSnapshot
  beforeEach(() => {
    snapshot = { value: { by: 'name', direction: 'asc' }, revision: 0 }
    store.setState({ value: snapshot.value, revision: -1, ready: false, saving: false, error: null, localChange: 0 })
    window.api = {
      getBrowserSort: vi.fn(async () => snapshot),
      onBrowserSortChanged: vi.fn(callback => { receive = callback; return vi.fn() }),
      updateAppSettings: vi.fn(async update => { snapshot = { value: update.browserSort!, revision: snapshot.revision + 1 }; receive(snapshot) }),
    } as unknown as Window['api']
  })
  afterEach(() => { disconnect?.(); disconnect = undefined })
  it('shares one subscription and rejects a late initial read', async () => {
    const initial = deferred<FileTreeSortSnapshot>()
    vi.mocked(window.api.getBrowserSort).mockReturnValueOnce(initial.promise)
    disconnect = store.getState().connect()
    const second = store.getState().connect()
    receive({ value: { by: 'size', direction: 'desc' }, revision: 2 })
    initial.resolve({ value: { by: 'name', direction: 'asc' }, revision: 0 })
    await initial.promise
    expect(store.getState().value.by).toBe('size')
    expect(window.api.onBrowserSortChanged).toHaveBeenCalledTimes(1)
    second()
  })
  it('saves only the sort preference and confirms the authoritative state', async () => {
    disconnect = store.getState().connect()
    await store.getState().reload()
    await expect(store.getState().save({ by: 'natural', direction: 'asc' })).resolves.toBe(true)
    expect(window.api.updateAppSettings).toHaveBeenCalledWith({ browserSort: { by: 'natural', direction: 'asc' } })
    expect(store.getState().localChange).toBe(1)
  })
  it('does not report success if the authoritative value belongs to another update', async () => {
    disconnect = store.getState().connect()
    await store.getState().reload()
    vi.mocked(window.api.updateAppSettings).mockResolvedValueOnce(undefined)
    receive({ value: { by: 'size', direction: 'desc' }, revision: 9 })
    await expect(store.getState().save({ by: 'natural', direction: 'asc' })).resolves.toBe(false)
    expect(store.getState().localChange).toBe(0)
    expect(store.getState().value.by).toBe('size')
    expect(store.getState().error).toContain('未确认')
  })

  it('does not roll back another window update when a local write fails', async () => {
    disconnect = store.getState().connect()
    await store.getState().reload()
    const writing = deferred<void>()
    vi.mocked(window.api.updateAppSettings).mockReturnValueOnce(writing.promise)
    const save = store.getState().save({ by: 'natural', direction: 'asc' })
    receive({ value: { by: 'modified', direction: 'desc' }, revision: 4 })
    writing.reject(new Error('write failed'))
    await expect(save).resolves.toBe(false)
    expect(store.getState().value.by).toBe('modified')
    expect(store.getState().saving).toBe(false)
    expect(store.getState().error).toContain('未确认')
  })
})
