import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import chokidar from 'chokidar'
import { registerFileHandlers } from '../ipc/fileHandlers'
import { resetSecurity } from '../security'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({ id: 1 })),
    getAllWindows: vi.fn(() => [])
  },
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
    lstat: vi.fn(),
  }
})

const ctx = {
  store: { set: vi.fn() },
  // 读放宽分支（validateSenderReadPath）快路径失败时会遍历 所有窗口根 + 文件夹历史
  // + 最近文件 + 书签；非 macOS 平台易落到该分支，补齐全部被调 mock 避免崩。
  folderHistoryManager: { addFolder: vi.fn(), getHistory: vi.fn<() => any[]>(() => []) },
  appDataManager: {
    getRecentFiles: vi.fn<() => any[]>(() => []),
    getBookmarks: vi.fn<() => any[]>(() => [])
  },
  windowManager: {
    getWindowFolderPath: vi.fn<(id: number) => string | undefined>(() => '/docs'),
    getAllWindowFolderRoots: vi.fn<() => string[]>(() => [])
  }
}

const mockRealpath = vi.mocked(fs.realpath as unknown as (path: string) => Promise<string>)
const mockLstat = vi.mocked(fs.lstat as unknown as (path: string) => Promise<fs.Stats>)
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

// 发起窗口根目录集合：validateSenderPath 会对根做 realpath+stat(isDirectory)
const ROOT_PATHS = new Set(['/docs', '/Users/test/docs'])

function dirStat(): fs.Stats {
  return { isFile: () => false, isDirectory: () => true } as fs.Stats
}

/**
 * 为「单个文件目标」配置 realpath / stat：
 * 根目录（授权根）恒定解析为自身且视为目录，其余路径走传入的文件 stat 序列。
 * 保证 validateSenderPath 对根的校验通过，同时不改变各用例对文件 stat 的原始意图。
 *
 * options.realpathRejectsAfter：对非根路径，前 N 次 realpath 正常（供 validateSenderPath
 * 的包含性校验通过），第 N 次之后开始拒绝——用于模拟「校验通过后规范化再解析时失败」的降级路径。
 */
function withRoot(
  fileStats: fs.Stats[],
  options: { realpathRejectsAfter?: number } = {}
): void {
  let realpathCall = 0
  mockRealpath.mockImplementation(async (p: string) => {
    if (ROOT_PATHS.has(p)) return p
    const n = realpathCall
    realpathCall += 1
    if (options.realpathRejectsAfter !== undefined && n >= options.realpathRejectsAfter) {
      throw new Error('realpath failed')
    }
    return p
  })
  let call = 0
  mockStat.mockImplementation(async (p: string) => {
    if (ROOT_PATHS.has(p)) return dirStat()
    const stat = fileStats[Math.min(call, fileStats.length - 1)]
    call += 1
    return stat
  })
}

describe('Markdown editing file handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSecurity()
    ctx.windowManager.getWindowFolderPath.mockReturnValue('/docs')
    registerFileHandlers(ctx as any)
  })

  it('opens an editable Markdown file and authorizes only the sender window', async () => {
    withRoot([{ isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 1000 } as fs.Stats])
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
      revisionToken: '1000:12:327f031b25e00b1a',
    })

    withRoot([{ isFile: () => true, isDirectory: () => false, size: 18, mtimeMs: 1000 } as fs.Stats])
    await expect(saveEditable(eventFor(2), {
      canonicalPath: '/docs/a.md',
      content: '# Changed',
      expectedRevisionToken: '1000:12',
      force: false,
    })).rejects.toThrow('未授权编辑')
  })

  it('returns conflict when revision token differs before saving', async () => {
    withRoot([
      { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 1000 } as fs.Stats,
      { isFile: () => true, isDirectory: () => false, size: 20, mtimeMs: 2000 } as fs.Stats,
    ])
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
        diskRevisionToken: '2000:20:327f031b25e00b1a',
      },
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('allows saving when only file metadata changed but disk content is unchanged', async () => {
    withRoot([
      { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 1000 } as fs.Stats,
      { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 2000 } as fs.Stats,
      { isFile: () => true, isDirectory: () => false, size: 22, mtimeMs: 3000 } as fs.Stats,
    ])
    mockReadFile.mockResolvedValue('# A')

    const openEditable = handler<(event: any, filePath: string) => Promise<any>>('fs:openEditableMarkdown')
    const saveEditable = handler<(event: any, payload: any) => Promise<any>>('fs:saveEditableMarkdown')

    const opened = await openEditable(eventFor(1), '/docs/a.md')

    await expect(saveEditable(eventFor(1), {
      canonicalPath: '/docs/a.md',
      content: '# Changed',
      expectedRevisionToken: opened.revisionToken,
      force: false,
    })).resolves.toEqual({ success: true, mtimeMs: 3000, size: 22, revisionToken: '3000:22:2c30f987a9e44271' })
    expect(mockWriteFile).toHaveBeenCalledWith('/docs/a.md', '# Changed', 'utf-8')
  })

  it('saves when authorized and mtime matches', async () => {
    withRoot([
      { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 1000 } as fs.Stats,
      { isFile: () => true, isDirectory: () => false, size: 20, mtimeMs: 1000 } as fs.Stats,
      { isFile: () => true, isDirectory: () => false, size: 22, mtimeMs: 3000 } as fs.Stats,
    ])
    mockReadFile.mockResolvedValue('# A')

    const openEditable = handler<(event: any, filePath: string) => Promise<any>>('fs:openEditableMarkdown')
    const saveEditable = handler<(event: any, payload: any) => Promise<any>>('fs:saveEditableMarkdown')

    await openEditable(eventFor(1), '/docs/a.md')

    await expect(saveEditable(eventFor(1), {
      canonicalPath: '/docs/a.md',
      content: '# Changed',
      expectedRevisionToken: '1000:20',
      force: false,
    })).resolves.toEqual({ success: true, mtimeMs: 3000, size: 22, revisionToken: '3000:22:2c30f987a9e44271' })
    expect(mockWriteFile).toHaveBeenCalledWith('/docs/a.md', '# Changed', 'utf-8')
  })

  it('falls back to resolved path when realpath fails', async () => {
    // 按窗口根校验时 realpath 成功（call 0），随后 getBestEffortCanonicalPath 再次
    // 解析同一路径时失败（call 1），触发降级为 path.resolve。
    withRoot([{ isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 1000 } as fs.Stats], {
      realpathRejectsAfter: 1,
    })
    mockReadFile.mockResolvedValue('# A')

    const openEditable = handler<(event: any, filePath: string) => Promise<any>>('fs:openEditableMarkdown')

    await expect(openEditable(eventFor(1), '/docs/a.md')).resolves.toMatchObject({
      canonicalPath: path.resolve('/docs/a.md'),
      revisionToken: '1000:12:327f031b25e00b1a',
    })
  })

  it('recreates a directory watcher after the same window unwatches and watches again', async () => {
    mockRealpath.mockImplementation(async (p: string) => p)
    mockLstat.mockResolvedValue({ isDirectory: () => true } as fs.Stats)
    mockStat.mockResolvedValue({ isDirectory: () => true } as fs.Stats)
    ctx.windowManager.getWindowFolderPath.mockReturnValue('/Users/test/docs')
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
    mockRealpath.mockImplementation(async (p: string) => p)
    mockLstat.mockResolvedValue({ isDirectory: () => true } as fs.Stats)
    mockStat.mockResolvedValue({ isDirectory: () => true } as fs.Stats)
    ctx.windowManager.getWindowFolderPath.mockReturnValue('/Users/test/docs')
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
