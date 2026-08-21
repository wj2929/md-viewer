import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { registerFileHandlers } from '../ipc/fileHandlers'

const { validateSenderReadPath } = vi.hoisted(() => ({
  validateSenderReadPath: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1 })), },
  dialog: { showOpenDialog: vi.fn() },
}))

vi.mock('../ipc/senderSecurity', () => ({
  getSenderFolderRoot: vi.fn(() => '/authorized'),
  validateSenderPath: vi.fn(),
  validateSenderReadPath,
}))

vi.mock('chokidar', () => ({ default: { watch: vi.fn() } }))

function handler<T extends (...args: any[]) => any>(channel: string): T {
  const registered = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!registered) throw new Error(`Missing handler: ${channel}`)
  return registered[1] as T
}

describe('read-only file handler authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerFileHandlers({
      windowManager: { getWindowFolderPath: vi.fn(() => '/authorized') },
      folderHistoryManager: { addFolder: vi.fn() },
      store: { set: vi.fn() },
    } as any)
  })

  it('returns an empty preview when sender authorization rejects the path', async () => {
    validateSenderReadPath.mockRejectedValueOnce(new Error('安全错误：未授权'))

    const readPreview = handler<(event: any, path: string) => Promise<string>>('fs:readFilePreview')
    await expect(readPreview({ sender: { id: 1 } }, '/untrusted/secret.md')).resolves.toBe('')
    expect(validateSenderReadPath).toHaveBeenCalledWith(expect.anything(), expect.anything(), '/untrusted/secret.md')
  })

  it('rejects search reads when sender authorization rejects the path', async () => {
    validateSenderReadPath.mockRejectedValueOnce(new Error('安全错误：未授权'))
    const searchReadFile = handler<(event: any, path: string) => Promise<string>>('search:readFile')

    await expect(searchReadFile({ sender: { id: 1 } }, '/untrusted/secret.md')).rejects.toThrow('安全错误')
    expect(validateSenderReadPath).toHaveBeenCalledWith(expect.anything(), expect.anything(), '/untrusted/secret.md')
  })

  it('rejects search directory scans before globbing an unauthorized directory', async () => {
    validateSenderReadPath.mockRejectedValueOnce(new Error('安全错误：未授权'))
    const searchReadDir = handler<(event: any, path: string) => Promise<unknown[]>>('search:readDir')

    await expect(searchReadDir({ sender: { id: 1 } }, '/untrusted')).rejects.toThrow('安全错误')
  })
})
