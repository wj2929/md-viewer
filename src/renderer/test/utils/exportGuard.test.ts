import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createExportGuard } from '../../src/utils/exportGuard'
import { useEditSessionStore } from '../../src/stores/editSessionStore'

describe('exportGuard', () => {
  beforeEach(() => {
    useEditSessionStore.getState().reset()
    vi.unstubAllGlobals()
  })

  it('allows export when the target has no dirty draft', async () => {
    const guard = createExportGuard({ toast: { error: vi.fn(), info: vi.fn() } })

    await expect(guard('/docs/a.md')).resolves.toBe(true)
  })

  it('blocks export when the target has a dirty draft', async () => {
    const toast = { error: vi.fn(), info: vi.fn() }
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/a.md',
      displayPath: '/docs/a.md',
      fileName: 'a.md',
      content: '# A',
      mtimeMs: 1000,
      size: 12,
      revisionToken: '1000:12',
    })
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')

    const guard = createExportGuard({ toast })

    await expect(guard('/docs/a.md')).resolves.toBe(false)
    expect(toast.error).toHaveBeenCalledWith('请先保存快速编辑草稿后再导出')
  })

  it('saves first and then allows export when saveBeforeExport is provided', async () => {
    const toast = { error: vi.fn(), info: vi.fn() }
    const saveBeforeExport = vi.fn().mockResolvedValue(undefined)
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/a.md',
      displayPath: '/docs/a.md',
      fileName: 'a.md',
      content: '# A',
      mtimeMs: 1000,
      size: 12,
      revisionToken: '1000:12',
    })
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')

    const guard = createExportGuard({ toast, saveBeforeExport })

    await expect(guard('/docs/a.md', { saveAndContinue: true })).resolves.toBe(true)
    expect(saveBeforeExport).toHaveBeenCalledWith('/real/docs/a.md')
  })

  it('prompts before saving and continuing export from a dirty draft', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const toast = { error: vi.fn(), info: vi.fn() }
    const saveBeforeExport = vi.fn().mockResolvedValue(undefined)
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/a.md',
      displayPath: '/docs/a.md',
      fileName: 'a.md',
      content: '# A',
      mtimeMs: 1000,
      size: 12,
      revisionToken: '1000:12',
    })
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')

    const guard = createExportGuard({ toast, saveBeforeExport })

    await expect(guard('/docs/a.md')).resolves.toBe(true)
    expect(window.confirm).toHaveBeenCalledWith('存在未保存的快速编辑草稿。是否先保存并继续导出？')
    expect(saveBeforeExport).toHaveBeenCalledWith('/real/docs/a.md')
  })

  it('cancels export when the user declines saving the dirty draft', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const toast = { error: vi.fn(), info: vi.fn() }
    const saveBeforeExport = vi.fn().mockResolvedValue(undefined)
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/a.md',
      displayPath: '/docs/a.md',
      fileName: 'a.md',
      content: '# A',
      mtimeMs: 1000,
      size: 12,
      revisionToken: '1000:12',
    })
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')

    const guard = createExportGuard({ toast, saveBeforeExport })

    await expect(guard('/docs/a.md')).resolves.toBe(false)
    expect(saveBeforeExport).not.toHaveBeenCalled()
  })
})
