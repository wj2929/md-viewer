import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFolderSearchSettingsStore as store } from '../../src/stores/folderSearchSettingsStore'

const getSettings = vi.fn()
const updateSettings = vi.fn()
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('folderSearchSettingsStore', () => {
  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue({})
    updateSettings.mockReset().mockResolvedValue(undefined)
    window.api = { ...window.api, getAppSettings: getSettings, updateAppSettings: updateSettings }
    store.setState({ hydration: 'idle', enabled: false, pending: null, saving: false, hasLoaded: false, error: null, revision: 0 })
  })

  it.each([undefined, 'true', 1, null, false])('旧设置 %s 按关闭解释，读取不回写', async value => {
    getSettings.mockResolvedValue({ folderPinyinSearchEnabled: value })
    store.getState().load()
    await flush()
    expect(store.getState()).toMatchObject({ hydration: 'ready', enabled: false })
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('只保存布尔字段，保存期间展示意图而非已保存值', async () => {
    store.getState().load()
    await flush()
    const save = deferred<void>()
    updateSettings.mockReturnValue(save.promise)
    const saving = store.getState().setEnabled(true)
    expect(store.getState()).toMatchObject({ enabled: false, pending: true, saving: true })
    expect(await store.getState().setEnabled(false)).toBe(false)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ folderPinyinSearchEnabled: true })
    save.resolve()
    expect(await saving).toBe(true)
    expect(store.getState()).toMatchObject({ enabled: true, pending: null, saving: false })
  })

  it('读取失败不覆盖已保存缓存，也不写 false', async () => {
    store.setState({ enabled: true, hasLoaded: true, hydration: 'ready' })
    getSettings.mockRejectedValue(new Error('fixture read failure'))
    store.getState().load()
    await flush()
    expect(store.getState()).toMatchObject({ enabled: true, hydration: 'failed', error: '读取失败，请重新打开' })
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it.each([true, false])('保存失败恢复此前值 %s', async previous => {
    store.setState({ enabled: previous, hasLoaded: true, hydration: 'ready' })
    updateSettings.mockRejectedValue(new Error('fixture disk full'))
    expect(await store.getState().setEnabled(!previous)).toBe(false)
    expect(store.getState()).toMatchObject({ enabled: previous, pending: null, saving: false, error: '设置未保存，请重试' })
  })

  it('取消已关闭面板的读取，重开重新读取', async () => {
    const read = deferred<object>()
    getSettings.mockReturnValueOnce(read.promise)
    const cancel = store.getState().load()
    cancel()
    read.resolve({ folderPinyinSearchEnabled: true })
    await flush()
    expect(store.getState().enabled).toBe(false)
    store.getState().load()
    await flush()
    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(store.getState().hydration).toBe('ready')
  })

  it('较早读取不覆盖较新成功保存，关闭面板不取消保存', async () => {
    store.setState({ hydration: 'ready', hasLoaded: true })
    const save = deferred<void>()
    updateSettings.mockReturnValueOnce(save.promise)
    const saving = store.getState().setEnabled(true)
    const read = deferred<object>()
    getSettings.mockReturnValueOnce(read.promise)
    const cancel = store.getState().load()
    save.resolve()
    await saving
    cancel()
    read.resolve({ folderPinyinSearchEnabled: false })
    await flush()
    expect(store.getState()).toMatchObject({ enabled: true, saving: false, hydration: 'ready' })
  })

  it('多次读取只接受最新响应，包括旧错误', async () => {
    const old = deferred<object>()
    getSettings.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ folderPinyinSearchEnabled: true })
    store.getState().load()
    store.getState().load()
    await flush()
    old.reject(new Error('late failure'))
    await flush()
    expect(store.getState()).toMatchObject({ hydration: 'ready', enabled: true, error: null })
  })
})
