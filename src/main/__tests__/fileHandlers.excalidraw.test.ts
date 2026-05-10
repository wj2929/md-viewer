import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
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

function handler<T extends (...args: any[]) => any>(channel: string): T {
  const found = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!found) throw new Error(`Missing handler: ${channel}`)
  return found[1] as T
}

function fileStats(size: number): fs.Stats {
  return { isFile: () => true, size } as fs.Stats
}

function directoryStats(size = 0): fs.Stats {
  return { isFile: () => false, size } as fs.Stats
}

describe('Excalidraw file handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSecurity()
    setAllowedBasePath('/docs')
    registerFileHandlers(ctx as any)
  })

  it('reads a relative .excalidraw file from the Markdown file directory', async () => {
    mockRealpath.mockResolvedValue('/docs/notes/diagram.excalidraw')
    mockStat.mockResolvedValue(fileStats(18))
    mockReadFile.mockResolvedValue('{"type":"excalidraw"}')

    const readExcalidrawFile = handler<(event: any, payload: {
      markdownFilePath: string
      refPath: string
    }) => Promise<any>>('fs:readExcalidrawFile')

    await expect(readExcalidrawFile({}, {
      markdownFilePath: '/docs/notes/page.md',
      refPath: './diagram.excalidraw',
    })).resolves.toEqual({
      content: '{"type":"excalidraw"}',
      resolvedPath: '/docs/notes/diagram.excalidraw',
    })
    expect(mockRealpath).toHaveBeenCalledWith(path.resolve('/docs/notes/diagram.excalidraw'))
    expect(mockReadFile).toHaveBeenCalledWith('/docs/notes/diagram.excalidraw', 'utf-8')
  })

  it('rejects non-.excalidraw extensions', async () => {
    const readExcalidrawFile = handler<(event: any, payload: {
      markdownFilePath: string
      refPath: string
    }) => Promise<any>>('fs:readExcalidrawFile')

    await expect(readExcalidrawFile({}, {
      markdownFilePath: '/docs/notes/page.md',
      refPath: './diagram.svg',
    })).rejects.toThrow('只能读取 .excalidraw 文件')
    expect(mockRealpath).not.toHaveBeenCalled()
  })

  it('rejects URL references', async () => {
    const readExcalidrawFile = handler<(event: any, payload: {
      markdownFilePath: string
      refPath: string
    }) => Promise<any>>('fs:readExcalidrawFile')

    for (const refPath of [
      'https://example.com/diagram.excalidraw',
      'mailto:foo.excalidraw',
      'data:text/plain,abc.excalidraw',
    ]) {
      await expect(readExcalidrawFile({}, {
        markdownFilePath: '/docs/notes/page.md',
        refPath,
      })).rejects.toThrow('不支持 URL 形式的 .excalidraw 文件')
    }
    expect(mockRealpath).not.toHaveBeenCalled()
  })

  it('rejects realpath targets with non-.excalidraw extensions', async () => {
    mockRealpath.mockResolvedValue('/docs/secret.txt')

    const readExcalidrawFile = handler<(event: any, payload: {
      markdownFilePath: string
      refPath: string
    }) => Promise<any>>('fs:readExcalidrawFile')

    await expect(readExcalidrawFile({}, {
      markdownFilePath: '/docs/page.md',
      refPath: './link.excalidraw',
    })).rejects.toThrow('只能读取 .excalidraw 文件')
    expect(mockStat).not.toHaveBeenCalled()
  })

  it('rejects symlinks that escape allowedBasePath after realpath', async () => {
    mockRealpath.mockResolvedValue('/outside/diagram.excalidraw')

    const readExcalidrawFile = handler<(event: any, payload: {
      markdownFilePath: string
      refPath: string
    }) => Promise<any>>('fs:readExcalidrawFile')

    await expect(readExcalidrawFile({}, {
      markdownFilePath: '/docs/notes/page.md',
      refPath: './linked.excalidraw',
    })).rejects.toThrow('安全错误')
    expect(mockStat).not.toHaveBeenCalled()
  })

  it('rejects directories', async () => {
    mockRealpath.mockResolvedValue('/docs/notes/diagram.excalidraw')
    mockStat.mockResolvedValue(directoryStats())

    const readExcalidrawFile = handler<(event: any, payload: {
      markdownFilePath: string
      refPath: string
    }) => Promise<any>>('fs:readExcalidrawFile')

    await expect(readExcalidrawFile({}, {
      markdownFilePath: '/docs/notes/page.md',
      refPath: './diagram.excalidraw',
    })).rejects.toThrow('目标不是普通文件')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('rejects files larger than 1MB', async () => {
    mockRealpath.mockResolvedValue('/docs/notes/diagram.excalidraw')
    mockStat.mockResolvedValue(fileStats(1024 * 1024 + 1))

    const readExcalidrawFile = handler<(event: any, payload: {
      markdownFilePath: string
      refPath: string
    }) => Promise<any>>('fs:readExcalidrawFile')

    await expect(readExcalidrawFile({}, {
      markdownFilePath: '/docs/notes/page.md',
      refPath: './diagram.excalidraw',
    })).rejects.toThrow('Excalidraw 文件超过 1MB，未读取')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('reads an absolute .excalidraw path inside allowedBasePath', async () => {
    mockRealpath.mockResolvedValue('/docs/assets/diagram.excalidraw')
    mockStat.mockResolvedValue(fileStats(18))
    mockReadFile.mockResolvedValue('{"elements":[]}')

    const readExcalidrawFile = handler<(event: any, payload: {
      markdownFilePath: string
      refPath: string
    }) => Promise<any>>('fs:readExcalidrawFile')

    await expect(readExcalidrawFile({}, {
      markdownFilePath: '/docs/notes/page.md',
      refPath: '/docs/assets/diagram.excalidraw',
    })).resolves.toEqual({
      content: '{"elements":[]}',
      resolvedPath: '/docs/assets/diagram.excalidraw',
    })
    expect(mockRealpath).toHaveBeenCalledWith(path.resolve('/docs/assets/diagram.excalidraw'))
  })
})
