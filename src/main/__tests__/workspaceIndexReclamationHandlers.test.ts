import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { registerWorkspaceIndexHandlers } from '../ipc/workspaceIndexHandlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
}))

const operation = { workspaceId: 'workspace-a', lifecycleEpoch: 3 }
const workspace = { id: 'workspace-a', lifecycleEpoch: 3, primaryRoot: '/workspace' }
const window = { id: 1, isDestroyed: vi.fn(() => false) }
const sender = { id: 9, isDestroyed: vi.fn(() => false) }
const execute = vi.fn()
const prepareReclamation = vi.fn()
const ctx = {
  workspaceIndexService: { prepareReclamation, attach: vi.fn() },
  windowManager: { getWorkspace: vi.fn() },
}
const summary = { generations: 2, files: 3, directories: 2, bytes: 4096, retainedGenerations: 2 }
const handle = () => vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'workspace-index:reclaim')![1]

beforeEach(() => {
  vi.clearAllMocks()
  window.isDestroyed.mockReturnValue(false)
  sender.isDestroyed.mockReturnValue(false)
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as any)
  ctx.windowManager.getWorkspace.mockReturnValue({ ...workspace })
  prepareReclamation.mockReset().mockResolvedValue({ summary, execute })
  execute.mockReset().mockResolvedValue({ status: 'completed', deletedFiles: 3, deletedBytes: 4096, deletedDirectories: 2, skippedFiles: 0, failedFiles: 0 })
  vi.mocked(dialog.showMessageBox).mockReset().mockResolvedValue({ response: 0, checkboxChecked: false })
  registerWorkspaceIndexHandlers(ctx as any)
})

describe('workspace index reclamation confirmation', () => {
  it('previews only the sender workspace and defaults to cancellation without attaching', async () => {
    const result = await handle()({ sender } as any, operation)
    expect(result.status).toBe('cancelled')
    expect(prepareReclamation).toHaveBeenCalledWith('/workspace', expect.any(Function))
    expect(ctx.workspaceIndexService.attach).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ defaultId: 0, cancelId: 0, buttons: ['取消', '清理旧索引'] }))
    const [, options] = vi.mocked(dialog.showMessageBox).mock.calls[0] as unknown as [unknown, { detail: string }]
    expect(options.detail).toContain('不删除源文档')
    expect(execute).not.toHaveBeenCalled()
  })

  it('executes only after explicit native confirmation', async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false })
    const result = await handle()({ sender } as any, operation)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ status: 'completed', deletedFiles: 3, deletedBytes: 4096 })
    expect(result.message).toContain('逻辑大小')
  })

  it.each(['epoch', 'root', 'closed'])('rejects %s changes while confirmation is open', async change => {
    vi.mocked(dialog.showMessageBox).mockImplementation(async () => {
      if (change === 'epoch') ctx.windowManager.getWorkspace.mockReturnValue({ ...workspace, lifecycleEpoch: 4 })
      if (change === 'root') ctx.windowManager.getWorkspace.mockReturnValue({ ...workspace, primaryRoot: '/other' })
      if (change === 'closed') window.isDestroyed.mockReturnValue(true)
      return { response: 1, checkboxChecked: false }
    })
    expect((await handle()({ sender } as any, operation)).status).toBe('stale')
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not ask for destructive confirmation for empty or unavailable cache', async () => {
    prepareReclamation.mockResolvedValueOnce(null).mockResolvedValueOnce({ summary: { ...summary, files: 0, directories: 0 }, execute })
    expect((await handle()({ sender } as any, operation)).status).toBe('empty')
    expect((await handle()({ sender } as any, operation)).status).toBe('empty')
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not let duplicate requests open concurrent confirmations', async () => {
    let finish!: (value: { response: number; checkboxChecked: boolean }) => void
    vi.mocked(dialog.showMessageBox).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const first = handle()({ sender } as any, operation)
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1))
    expect((await handle()({ sender } as any, operation)).status).toBe('busy')
    finish({ response: 0, checkboxChecked: false })
    await first
    expect(prepareReclamation).toHaveBeenCalledTimes(1)
  })

  it('keeps raw errors and paths out of renderer responses', async () => {
    prepareReclamation.mockRejectedValue(new Error('/private/secret/cache: raw error'))
    const result = await handle()({ sender } as any, operation)
    expect(result.status).toBe('invalid')
    expect(JSON.stringify(result)).not.toContain('/private')
    expect(execute).not.toHaveBeenCalled()
  })
})
