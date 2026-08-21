import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import { registerFileHandlers } from '../ipc/fileHandlers'
import { resetSecurity } from '../security'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn(() => [])
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() }
}))

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      add: vi.fn(),
      close: vi.fn(),
      getWatched: vi.fn(() => ({}))
    }))
  }
}))

const temporaryPaths: string[] = []

const OPERATION = { workspaceId: 'workspace-a', lifecycleEpoch: 1 }

interface Fixture {
  root: string
  sourceRoot: string // 发起窗口根（源所在）
  targetRoot: string // 目标历史根（跨根）
  sourceFile: string
  sourceDir: string
}

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-move-to-'))
  temporaryPaths.push(root)

  const sourceRoot = path.join(root, 'sourceRoot')
  const targetRoot = path.join(root, 'targetRoot')
  const sourceFile = path.join(sourceRoot, 'note.md')
  const sourceDir = path.join(sourceRoot, 'folder')

  await fs.ensureDir(sourceRoot)
  await fs.ensureDir(path.join(targetRoot, 'sub'))
  await fs.ensureDir(sourceDir)
  await fs.writeFile(sourceFile, 'hello')
  await fs.writeFile(path.join(sourceDir, 'inner.md'), 'inner')

  return { root, sourceRoot, targetRoot, sourceFile, sourceDir }
}

afterEach(async () => {
  resetSecurity()
  await Promise.all(temporaryPaths.splice(0).map(directory => fs.remove(directory)))
})

function getHandler<T extends (...args: any[]) => any>(channel: string): T {
  const registration = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!registration) throw new Error(`Missing handler: ${channel}`)
  return registration[1] as T
}

function createEvent() {
  return { sender: { id: 7 } }
}

describe('fs:moveFileToFolder 跨根移动安全边界', () => {
  let fixture: Fixture
  let resolveHistoryFolder: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    fixture = await createFixture()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1 } as Electron.BrowserWindow)

    // 默认：targetHistoryId 'valid' 解析到 targetRoot，其余解析失败
    resolveHistoryFolder = vi.fn(async (id: string) =>
      id === 'valid' ? await fs.realpath(fixture.targetRoot) : null
    )

    registerFileHandlers({
      store: { set: vi.fn() },
      folderHistoryManager: { addFolder: vi.fn(), resolveHistoryFolder },
      windowManager: {
        getWindowFolderPath: vi.fn(() => fixture.sourceRoot),
        getAllWindowFolderRoots: vi.fn(() => [fixture.sourceRoot]),
        getWorkspace: vi.fn(() => ({ ...OPERATION, primaryRoot: fixture.sourceRoot })),
      }
    } as any)
  })

  function invokeMove() {
    return getHandler<
      (event: Electron.IpcMainInvokeEvent, src: string, targetHistoryId: string, subRelPath: string | undefined, operation: typeof OPERATION) => Promise<string>
    >('fs:moveFileToFolder')
  }

  it('把文件跨根移动到目标历史根', async () => {
    const move = invokeMove()
    const dest = await move(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceFile, 'valid', undefined, OPERATION)

    expect(await fs.pathExists(dest)).toBe(true)
    expect(await fs.pathExists(fixture.sourceFile)).toBe(false)
    expect(path.dirname(dest)).toBe(await fs.realpath(fixture.targetRoot))
  })

  it('把文件移动到目标根的子目录（subRelPath）', async () => {
    const move = invokeMove()
    const dest = await move(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceFile, 'valid', 'sub', OPERATION)

    const expectedDir = path.join(await fs.realpath(fixture.targetRoot), 'sub')
    expect(await fs.pathExists(dest)).toBe(true)
    expect(path.dirname(dest)).toBe(expectedDir)
  })

  it('把目录（含子文件）整棵跨根移动', async () => {
    const move = invokeMove()
    const dest = await move(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceDir, 'valid', undefined, OPERATION)

    expect(await fs.pathExists(path.join(dest, 'inner.md'))).toBe(true)
    expect(await fs.pathExists(fixture.sourceDir)).toBe(false)
  })

  it('subRelPath 含 ../ 逃出历史根 → 拒绝，源保留', async () => {
    const move = invokeMove()
    await expect(
      move(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceFile, 'valid', '../sourceRoot', OPERATION)
    ).rejects.toThrow('安全错误')

    expect(await fs.pathExists(fixture.sourceFile)).toBe(true)
  })

  it('非法/失效 historyId → resolveHistoryFolder 返回 null → 拒绝', async () => {
    const move = invokeMove()
    await expect(
      move(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceFile, 'bogus', undefined, OPERATION)
    ).rejects.toThrow('目标目录无效')

    expect(await fs.pathExists(fixture.sourceFile)).toBe(true)
  })

  it('目标已存在同名 → 拒绝，源保留（overwrite:false）', async () => {
    await fs.writeFile(path.join(fixture.targetRoot, 'note.md'), 'existing')
    const move = invokeMove()
    await expect(
      move(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceFile, 'valid', undefined, OPERATION)
    ).rejects.toThrow('目标文件已存在')

    expect(await fs.pathExists(fixture.sourceFile)).toBe(true)
    expect(await fs.readFile(path.join(fixture.targetRoot, 'note.md'), 'utf-8')).toBe('existing')
  })

  it('源不在发起窗口根且未授权 → 拒绝', async () => {
    const move = invokeMove()
    const outsideSource = path.join(fixture.targetRoot, 'foreign.md')
    await fs.writeFile(outsideSource, 'foreign')

    await expect(
      move(createEvent() as Electron.IpcMainInvokeEvent, outsideSource, 'valid', undefined, OPERATION)
    ).rejects.toThrow('安全错误')
  })

  it('目标解析到源自身/子目录 → isSameOrChildPath 拒绝', async () => {
    // 目标历史根解析为源目录本身：移动源目录到自身应被拒
    resolveHistoryFolder.mockImplementation(async (id: string) =>
      id === 'valid' ? await fs.realpath(fixture.sourceDir) : null
    )
    const move = invokeMove()
    await expect(
      move(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceDir, 'valid', undefined, OPERATION)
    ).rejects.toThrow('自身或子目录')

    expect(await fs.pathExists(fixture.sourceDir)).toBe(true)
  })
})
