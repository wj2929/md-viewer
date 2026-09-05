import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { registerFileHandlers } from '../ipc/fileHandlers'

const { validateSenderReadPath, glob } = vi.hoisted(() => ({
  validateSenderReadPath: vi.fn(),
  glob: vi.fn(),
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
vi.mock('glob', () => ({ glob }))

function handler<T extends (...args: any[]) => any>(channel: string): T {
  const registered = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!registered) throw new Error(`Missing handler: ${channel}`)
  return registered[1] as T
}

describe('read-only file handler authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateSenderReadPath.mockImplementation(async (_ctx, _event, inputPath: string) => inputPath)
    glob.mockResolvedValue([])
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

  it('合并同一 canonical root 的并发文件树扫描但逐次执行授权', async () => {
    let finishScan: ((paths: string[]) => void) | undefined
    glob.mockImplementationOnce(() => new Promise<string[]>((resolve) => { finishScan = resolve }))
    validateSenderReadPath.mockResolvedValue('/canonical/root')
    const readDir = handler<(event: any, path: string) => Promise<unknown[]>>('fs:readDir')

    const first = readDir({ sender: { id: 1 } }, '/alias-a')
    const second = readDir({ sender: { id: 2 } }, '/alias-b')
    await vi.waitFor(() => expect(glob).toHaveBeenCalledTimes(1))
    finishScan?.(['docs/a.md'])

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(validateSenderReadPath).toHaveBeenCalledTimes(2)
    expect(firstResult).toEqual(secondResult)
    expect(firstResult).toEqual([
      expect.objectContaining({ name: 'docs', isDirectory: true }),
    ])
  })

  it('扫描失败后清理 single-flight 以允许重试', async () => {
    validateSenderReadPath.mockResolvedValue('/canonical/root')
    glob.mockRejectedValueOnce(new Error('scan failed')).mockResolvedValueOnce(['retry.md'])
    const readDir = handler<(event: any, path: string) => Promise<unknown[]>>('fs:readDir')

    await expect(readDir({ sender: { id: 1 } }, '/root')).resolves.toEqual([])
    await expect(readDir({ sender: { id: 1 } }, '/root')).resolves.toEqual([
      expect.objectContaining({ name: 'retry.md', isDirectory: false }),
    ])
    expect(glob).toHaveBeenCalledTimes(2)
  })
})
