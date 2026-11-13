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
const workspaceOperation = { workspaceId: 'security-workspace', lifecycleEpoch: 1 }

interface Fixture {
  root: string
  allowed: string
  outside: string
  sourceFile: string
  sourceDir: string
  sourceFileLink: string
  sourceDirLink: string
  destinationLink: string
}

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-file-handler-'))
  temporaryPaths.push(root)

  const allowed = path.join(root, 'allowed')
  const outside = path.join(root, 'outside')
  const sourceFile = path.join(allowed, 'source.md')
  const sourceDir = path.join(allowed, 'source-dir')
  const sourceFileLink = path.join(allowed, 'source-file-link.md')
  const sourceDirLink = path.join(allowed, 'source-dir-link')
  const destinationLink = path.join(allowed, 'destination-link')

  await fs.ensureDir(sourceDir)
  await fs.ensureDir(path.join(outside, 'outside-dir'))
  await fs.writeFile(sourceFile, 'allowed source')
  await fs.writeFile(path.join(sourceDir, 'nested.md'), 'allowed directory source')
  await fs.writeFile(path.join(outside, 'sentinel.txt'), 'must stay unchanged')
  await fs.writeFile(path.join(outside, 'outside-source.md'), 'outside file source')
  await fs.writeFile(path.join(outside, 'outside-dir', 'nested.md'), 'outside directory source')
  await fs.ensureSymlink(path.join(outside, 'outside-source.md'), sourceFileLink)
  await fs.ensureSymlink(path.join(outside, 'outside-dir'), sourceDirLink)
  await fs.ensureSymlink(outside, destinationLink)

  return {
    root,
    allowed,
    outside,
    sourceFile,
    sourceDir,
    sourceFileLink,
    sourceDirLink,
    destinationLink
  }
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

describe('copy and move symbolic link boundaries', () => {
  let fixture: Fixture

  beforeEach(async () => {
    vi.clearAllMocks()
    fixture = await createFixture()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1 } as Electron.BrowserWindow)

    registerFileHandlers({
      store: { set: vi.fn() },
      folderHistoryManager: { addFolder: vi.fn() },
      windowManager: {
        getWindowFolderPath: vi.fn(() => fixture.allowed),
        getWorkspace: vi.fn((_windowId: number, id: string) => id === workspaceOperation.workspaceId
          ? { id, lifecycleEpoch: 1, primaryRoot: fixture.allowed } : undefined)
      }
    } as any)
  })

  const operations = [
    {
      channel: 'fs:copyFile',
      source: (current: Fixture) => current.sourceFileLink,
      normalSource: (current: Fixture) => current.sourceFile,
      destinationName: 'copied.md'
    },
    {
      channel: 'fs:copyDir',
      source: (current: Fixture) => current.sourceDirLink,
      normalSource: (current: Fixture) => current.sourceDir,
      destinationName: 'copied-dir'
    },
    {
      channel: 'fs:moveFile',
      source: (current: Fixture) => current.sourceFileLink,
      normalSource: (current: Fixture) => current.sourceFile,
      destinationName: 'moved.md'
    }
  ]

  it.each(operations)('$channel 正常根内操作可成功，安全测试不是上下文缺失的假阳性', async operation => {
    const destination = path.join(fixture.allowed, operation.destinationName)
    const result = await getHandler(operation.channel)(
      createEvent(), operation.normalSource(fixture), destination, workspaceOperation
    )
    expect(result).toBe(destination)
    const contentPath = operation.channel === 'fs:copyDir' ? path.join(destination, 'nested.md') : destination
    expect(await fs.readFile(contentPath, 'utf8')).toBe(operation.channel === 'fs:copyDir'
      ? 'allowed directory source' : 'allowed source')
    expect(await fs.pathExists(operation.normalSource(fixture))).toBe(operation.channel !== 'fs:moveFile')
  })

  it.each(operations)('$channel rejects a symbolic-link source outside the window root', async operation => {
    const invoke = getHandler<(event: Electron.IpcMainInvokeEvent, source: string, destination: string, context: typeof workspaceOperation) => Promise<string>>(
      operation.channel
    )
    const destination = path.join(fixture.allowed, operation.destinationName)

    await expect(invoke(createEvent() as Electron.IpcMainInvokeEvent, operation.source(fixture), destination, workspaceOperation))
      .rejects.toThrow('安全错误')

    await expect(fs.pathExists(destination)).resolves.toBe(false)
    await expect(fs.readFile(path.join(fixture.outside, 'sentinel.txt'), 'utf-8')).resolves.toBe('must stay unchanged')
  })

  it('rename rejects a path-bearing name instead of escaping the source directory', async () => {
    const rename = getHandler<(event: Electron.IpcMainInvokeEvent, oldPath: string, newName: string, context: typeof workspaceOperation) => Promise<string>>(
      'fs:rename'
    )
    const escapedPath = path.join(fixture.root, 'escaped.md')

    await expect(rename(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceFile, '../escaped.md', workspaceOperation))
      .rejects.toThrow('新名称必须是单个文件或目录名称')

    await expect(fs.pathExists(escapedPath)).resolves.toBe(false)
    await expect(fs.pathExists(fixture.sourceFile)).resolves.toBe(true)
  })

  it('copyDir rejects a nested symbolic link even when the directory starts inside the window root', async () => {
    const invoke = getHandler<(event: Electron.IpcMainInvokeEvent, source: string, destination: string, context: typeof workspaceOperation) => Promise<string>>(
      'fs:copyDir'
    )
    const nestedLink = path.join(fixture.sourceDir, 'outside-link')
    const destination = path.join(fixture.allowed, 'copied-dir')
    await fs.ensureSymlink(path.join(fixture.outside, 'outside-dir'), nestedLink)

    await expect(invoke(createEvent() as Electron.IpcMainInvokeEvent, fixture.sourceDir, destination, workspaceOperation))
      .rejects.toThrow('不支持复制或移动包含符号链接的目录')

    await expect(fs.pathExists(destination)).resolves.toBe(false)
    await expect(fs.readFile(path.join(fixture.outside, 'sentinel.txt'), 'utf-8')).resolves.toBe('must stay unchanged')
  })

  it.each(operations)('$channel rejects a destination below a symbolic link outside the window root', async operation => {
    const invoke = getHandler<(event: Electron.IpcMainInvokeEvent, source: string, destination: string, context: typeof workspaceOperation) => Promise<string>>(
      operation.channel
    )
    const escapedDestination = path.join(fixture.destinationLink, operation.destinationName)
    const outsideDestination = path.join(fixture.outside, operation.destinationName)
    const source = operation.normalSource(fixture)

    await expect(invoke(createEvent() as Electron.IpcMainInvokeEvent, source, escapedDestination, workspaceOperation))
      .rejects.toThrow('安全错误')

    await expect(fs.pathExists(outsideDestination)).resolves.toBe(false)
    await expect(fs.pathExists(source)).resolves.toBe(true)
    await expect(fs.readFile(path.join(fixture.outside, 'sentinel.txt'), 'utf-8')).resolves.toBe('must stay unchanged')
  })
})
