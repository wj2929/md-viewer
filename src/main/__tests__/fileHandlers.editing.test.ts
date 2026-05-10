import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import chokidar from 'chokidar'
import { registerFileHandlers } from '../ipc/fileHandlers'
import { resetSecurity, setAllowedBasePath } from '../security'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}))

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      add: vi.fn(),
      close: vi.fn(),
      getWatched: vi.fn(() => ({})),
    })),
  },
}))

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra')
  return {
    ...actual,
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    pathExists: vi.fn(),
    realpath: vi.fn(),
  }
})

const ctx = {
  store: { set: vi.fn() },
  folderHistoryManager: { addFolder: vi.fn() },
}

const mockRealpath = vi.mocked(fs.realpath as unknown as (path: string) => Promise<string>)
const mockStat = vi.mocked(fs.stat as unknown as (path: string) => Promise<fs.Stats>)
const mockReadFile = vi.mocked(fs.readFile as unknown as (path: string, encoding: string) => Promise<string>)
const mockWriteFile = vi.mocked(fs.writeFile as unknown as (path: string, data: string, encoding: string) => Promise<void>)

function handler<T extends (...args: any[]) => any>(channel: string): T {
  const found = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!found) throw new Error(`Missing handler: ${channel}`)
  return found[1] as T
}

function eventFor(id: number) {
  return { sender: { id } }
}

describe('Markdown editing file handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSecurity()
    setAllowedBasePath('/docs')
    registerFileHandlers(ctx as any)
  })

  it('opens an editable Markdown file and authorizes only the sender window', async () => {
    mockRealpath.mockResolvedValue('/docs/a.md')
    mockStat.mockResolvedValue({ isFile: () => true, size: 12, mtimeMs: 1000 } as fs.Stats)
    mockReadFile.mockResolvedValue('# A')

    const openEditable = handler<(event: any, filePath: string) => Promise<any>>('fs:openEditableMarkdown')
    const saveEditable = handler<(event: any, payload: any) => Promise<any>>('fs:saveEditableMarkdown')

    await expect(openEditable(eventFor(1), '/docs/a.md')).resolves.toEqual({
      canonicalPath: '/docs/a.md',
      displayPath: '/docs/a.md',
      fileName: 'a.md',
      content: '# A',
      mtimeMs: 1000,
      size: 12,
      revisionToken: '1000:12',
    })

    mockStat.mockResolvedValue({ isFile: () => true, size: 18, mtimeMs: 1000 } as fs.Stats)
    await expect(saveEditable(eventFor(2), {
      canonicalPath: '/docs/a.md',
      content: '# Changed',
      expectedRevisionToken: '1000:12',
      force: false,
    })).rejects.toThrow('未授权编辑')
  })

  it('returns conflict when revision token differs before saving', async () => {
    mockRealpath.mockResolvedValue('/docs/a.md')
    mockStat
      .mockResolvedValueOnce({ isFile: () => true, size: 12, mtimeMs: 1000 } as fs.Stats)
      .mockResolvedValueOnce({ isFile: () => true, size: 20, mtimeMs: 2000 } as fs.Stats)
    mockReadFile.mockResolvedValue('# A')

    const openEditable = handler<(event: any, filePath: string) => Promise<any>>('fs:openEditableMarkdown')
    const saveEditable = handler<(event: any, payload: any) => Promise<any>>('fs:saveEditableMarkdown')

    await openEditable(eventFor(1), '/docs/a.md')

    await expect(saveEditable(eventFor(1), {
      canonicalPath: '/docs/a.md',
      content: '# Changed',
      expectedRevisionToken: '1000:12',
      force: false,
    })).resolves.toEqual({
      success: false,
      conflict: {
        reason: 'revision_changed',
        diskRevisionToken: '2000:20',
      },
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('saves when authorized and mtime matches', async () => {
    mockRealpath.mockResolvedValue('/docs/a.md')
    mockStat
      .mockResolvedValueOnce({ isFile: () => true, size: 12, mtimeMs: 1000 } as fs.Stats)
      .mockResolvedValueOnce({ isFile: () => true, size: 20, mtimeMs: 1000 } as fs.Stats)
      .mockResolvedValueOnce({ isFile: () => true, size: 22, mtimeMs: 3000 } as fs.Stats)
    mockReadFile.mockResolvedValue('# A')

    const openEditable = handler<(event: any, filePath: string) => Promise<any>>('fs:openEditableMarkdown')
    const saveEditable = handler<(event: any, payload: any) => Promise<any>>('fs:saveEditableMarkdown')

    await openEditable(eventFor(1), '/docs/a.md')

    await expect(saveEditable(eventFor(1), {
      canonicalPath: '/docs/a.md',
      content: '# Changed',
      expectedRevisionToken: '1000:20',
      force: false,
    })).resolves.toEqual({ success: true, mtimeMs: 3000, size: 22, revisionToken: '3000:22' })
    expect(mockWriteFile).toHaveBeenCalledWith('/docs/a.md', '# Changed', 'utf-8')
  })

  it('falls back to resolved path when realpath fails', async () => {
    mockRealpath.mockRejectedValue(new Error('realpath failed'))
    mockStat.mockResolvedValue({ isFile: () => true, size: 12, mtimeMs: 1000 } as fs.Stats)
    mockReadFile.mockResolvedValue('# A')

    const openEditable = handler<(event: any, filePath: string) => Promise<any>>('fs:openEditableMarkdown')

    await expect(openEditable(eventFor(1), '/docs/a.md')).resolves.toMatchObject({
      canonicalPath: path.resolve('/docs/a.md'),
      revisionToken: '1000:12',
    })
  })

  it('recreates a directory watcher after the same window unwatches and watches again', async () => {
    setAllowedBasePath('/Users/test/docs')
    const watchFolder = handler<(event: any, folderPath: string) => Promise<any>>('fs:watchFolder')
    const unwatchFolder = handler<(event: any) => Promise<any>>('fs:unwatchFolder')
    const watch = vi.mocked(chokidar.watch)

    await expect(watchFolder(eventFor(1), '/Users/test/docs/project')).resolves.toEqual({ success: true })
    expect(watch).toHaveBeenCalledTimes(1)
    const firstWatcher = watch.mock.results[0].value

    await expect(unwatchFolder(eventFor(1))).resolves.toEqual({ success: true })
    expect(firstWatcher.close).toHaveBeenCalledTimes(1)

    await expect(watchFolder(eventFor(1), '/Users/test/docs/project')).resolves.toEqual({ success: true })
    expect(watch).toHaveBeenCalledTimes(2)
    await expect(unwatchFolder(eventFor(1))).resolves.toEqual({ success: true })
  })

  it('creates an individual watcher when an opened Markdown file is deeper than the directory watcher depth', async () => {
    setAllowedBasePath('/Users/test/docs')
    const watchFolder = handler<(event: any, folderPath: string) => Promise<any>>('fs:watchFolder')
    const unwatchFolder = handler<(event: any) => Promise<any>>('fs:unwatchFolder')
    const watchFile = handler<(event: any, filePath: string) => Promise<any>>('fs:watchFile')
    const watch = vi.mocked(chokidar.watch)

    await expect(watchFolder(eventFor(1), '/Users/test/docs/project')).resolves.toEqual({ success: true })
    await expect(watchFile(eventFor(1), '/Users/test/docs/project/a/b/c/deep.md')).resolves.toEqual({ success: true })

    expect(watch).toHaveBeenCalledTimes(2)
    expect(watch).toHaveBeenLastCalledWith('/Users/test/docs/project/a/b/c/deep.md', expect.objectContaining({
      ignoreInitial: true,
      persistent: true,
    }))
    await expect(unwatchFolder(eventFor(1))).resolves.toEqual({ success: true })
  })
})
