import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import { validateSenderReadPath } from '../ipc/senderSecurity'

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({ id: 1, isDestroyed: () => false })),
  },
}))

/**
 * validateSenderReadPath 读类放宽校验测试
 *
 * 验证：发起窗口、其他打开窗口及历史根内的文件通过；recent/bookmark
 * 业务记录不能扩大授权；完全未登记路径、受保护路径和 symlink 逃逸均拒绝。
 */

const temporaryRoots: string[] = []

async function makeDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-readpath-'))
  temporaryRoots.push(dir)
  return dir
}

interface Ctx {
  windowRoot: string
  otherWindowRoot: string
  historyRoot: string
  recentRoot: string
  unregisteredRoot: string
}

let dirs: Ctx
let bookmarkFile: string

function buildCtx() {
  return {
    windowManager: {
      getWindowFolderPath: vi.fn(() => dirs.windowRoot),
      getAllWindowFolderRoots: vi.fn(() => [dirs.windowRoot, dirs.otherWindowRoot]),
    },
    folderHistoryManager: {
      getHistory: vi.fn(async () => [{ id: 'h1', path: dirs.historyRoot, name: 'h', lastOpened: 1 }]),
    },
    appDataManager: {
      getRecentFiles: vi.fn(() => [
        { id: 'r1', path: path.join(dirs.recentRoot, 'r.md'), name: 'r.md', folderPath: dirs.recentRoot, lastOpened: 1 },
      ]),
      getBookmarks: vi.fn(() => [{ id: 'b1', filePath: bookmarkFile, fileName: 'bm.md', createdAt: 1, order: 0 }]),
    },
  } as any
}

const event = { sender: { id: 1 } } as any

beforeEach(async () => {
  const root = await makeDir()
  dirs = {
    windowRoot: path.join(root, 'win'),
    otherWindowRoot: path.join(root, 'other'),
    historyRoot: path.join(root, 'history'),
    recentRoot: path.join(root, 'recent'),
    unregisteredRoot: path.join(root, 'unregistered'),
  }
  await Promise.all(Object.values(dirs).map(d => fs.ensureDir(d)))
  // 书签指向一个不在任何根集合内的独立目录中的文件
  const bookmarkDir = path.join(root, 'bookmark-area')
  await fs.ensureDir(bookmarkDir)
  bookmarkFile = path.join(bookmarkDir, 'bm.md')
  await fs.writeFile(bookmarkFile, '# bookmark')

  for (const d of [dirs.windowRoot, dirs.otherWindowRoot, dirs.historyRoot, dirs.recentRoot, dirs.unregisteredRoot]) {
    await fs.writeFile(path.join(d, 'doc.md'), '# doc')
  }
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(temporaryRoots.splice(0).map(d => fs.remove(d)))
})

describe('validateSenderReadPath', () => {
  it('放行发起窗口根内的文件', async () => {
    const target = path.join(dirs.windowRoot, 'doc.md')
    await expect(validateSenderReadPath(buildCtx(), event, target)).resolves.toBe(await fs.realpath(target))
  })

  it('放行另一个已打开窗口根内的文件', async () => {
    const target = path.join(dirs.otherWindowRoot, 'doc.md')
    await expect(validateSenderReadPath(buildCtx(), event, target)).resolves.toBe(await fs.realpath(target))
  })

  it('放行文件夹历史根内的文件', async () => {
    const target = path.join(dirs.historyRoot, 'doc.md')
    await expect(validateSenderReadPath(buildCtx(), event, target)).resolves.toBe(await fs.realpath(target))
  })

  it('拒绝 recent.folderPath 单独登记的文件', async () => {
    const target = path.join(dirs.recentRoot, 'doc.md')
    await expect(validateSenderReadPath(buildCtx(), event, target)).rejects.toThrow('安全错误')
  })

  it('拒绝精确登记的书签文件（其目录不在任何根集合内）', async () => {
    await expect(validateSenderReadPath(buildCtx(), event, bookmarkFile)).rejects.toThrow('安全错误')
  })

  it('拒绝完全未登记文件夹内的文件', async () => {
    const target = path.join(dirs.unregisteredRoot, 'doc.md')
    await expect(validateSenderReadPath(buildCtx(), event, target)).rejects.toThrow('安全错误')
  })

  it('拒绝受保护路径（即使发起窗口根存在）', async () => {
    await expect(validateSenderReadPath(buildCtx(), event, path.join(os.homedir(), '.ssh', 'id_rsa')))
      .rejects.toThrow('安全错误')
  })

  it('拒绝通过 symlink 逃逸到未登记区的目标', async () => {
    // 在窗口根内放一个指向未登记目录的软链
    const link = path.join(dirs.windowRoot, 'escape')
    await fs.ensureSymlink(dirs.unregisteredRoot, link)
    const target = path.join(link, 'doc.md')
    await expect(validateSenderReadPath(buildCtx(), event, target)).rejects.toThrow('安全错误')
  })
})
