import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as os from 'os'
import * as fs from 'fs'
import { execFileSync } from 'child_process'
import { clipboard, ClipboardItem } from 'electron'

vi.mock('electron', () => ({
  clipboard: {
    read: vi.fn(), readText: vi.fn(), write: vi.fn(), writeText: vi.fn(), clear: vi.fn(),
  },
  ClipboardItem: class {
    readonly types: string[]
    constructor(private data: Record<string, string | Blob>) { this.types = Object.keys(data) }
    async getType(type: string) {
      const value = this.data[type]
      if (value === undefined) throw new Error('Missing format')
      return typeof value === 'string' ? new Blob([value]) : value
    }
  },
}))
vi.mock('os', () => ({ platform: vi.fn() }))
vi.mock('fs', () => ({ existsSync: vi.fn() }))
vi.mock('child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../security', () => ({
  isProtectedPath: vi.fn((path: string) => path.startsWith('/System') || path.startsWith('/usr')),
}))

import * as manager from '../clipboardManager'

const format = (name: string) => `electron application/osclipboard;format="${name}"`
function contents(type: string, value: string | Buffer) {
  const blob = typeof value === 'string' ? value : new Blob([new Uint8Array(value)])
  vi.mocked(clipboard.read).mockResolvedValue([new ClipboardItem({ [type]: blob })])
}
async function written(type: string): Promise<string> {
  const item = vi.mocked(clipboard.write).mock.calls.at(-1)![0][0]
  const blob = await item.getType(type)
  if (!('text' in blob)) throw new Error('Unexpected bookmark')
  return blob.text()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(os.platform).mockReturnValue('darwin')
  vi.mocked(fs.existsSync).mockReturnValue(true)
  vi.mocked(clipboard.read).mockResolvedValue([])
  vi.mocked(clipboard.readText).mockResolvedValue('')
  vi.mocked(clipboard.write).mockResolvedValue(undefined)
  vi.mocked(clipboard.writeText).mockResolvedValue(undefined)
})

describe('readFilesFromSystemClipboard', () => {
  it('macOS 保留原生文件列表读取', async () => {
    contents(format('NSFilenamesPboardType'), '<plist><array><string>/Users/test/one.md</string><string>/Users/test/two.txt</string></array></plist>')
    expect(await manager.readFilesFromSystemClipboard()).toEqual([
      { path: '/Users/test/one.md', exists: true, isAllowed: true, reason: undefined },
      { path: '/Users/test/two.txt', exists: true, isAllowed: true, reason: undefined },
    ])
  })

  it('原生 XML 路径中的特殊字符正确还原', async () => {
    contents(format('NSFilenamesPboardType'), '<string>/Users/test/A&amp;B&lt;测试&gt;.md</string>')
    expect((await manager.readFilesFromSystemClipboard())[0].path).toBe('/Users/test/A&B<测试>.md')
  })

  it('优先读取 URI 列表，忽略注释、远程主机和非文件 URL', async () => {
    contents('text/uri-list', '# comment\r\nfile:///Users/test/A%20B.md\r\nhttps://example.test/a\nfile://remote/share/a\nfile://localhost/Users/test/local.md')
    expect((await manager.readFilesFromSystemClipboard()).map(file => file.path))
      .toEqual(['/Users/test/A B.md', '/Users/test/local.md'])
    expect(clipboard.readText).not.toHaveBeenCalled()
  })

  it('保留 file URL 文本回退', async () => {
    vi.mocked(clipboard.readText).mockResolvedValue('file:///Users/test/file.md')
    expect((await manager.readFilesFromSystemClipboard())[0].path).toBe('/Users/test/file.md')
  })

  it('受保护路径不可粘贴，不存在文件带明确原因', async () => {
    contents('text/uri-list', 'file:///System/Library/file.txt\nfile:///Users/test/missing.md')
    vi.mocked(fs.existsSync).mockImplementation(path => path !== '/Users/test/missing.md')
    expect(await manager.readFilesFromSystemClipboard()).toEqual([
      { path: '/System/Library/file.txt', exists: true, isAllowed: false, reason: '受保护的系统路径' },
      { path: '/Users/test/missing.md', exists: false, isAllowed: false, reason: '文件不存在' },
    ])
  })

  it('Windows 读取 UTF-16LE 原生多文件列表', async () => {
    vi.mocked(os.platform).mockReturnValue('win32')
    contents(format('FileNameW'), Buffer.from('C:\\Users\\test\\one.md\0D:\\two.txt\0\0', 'utf16le'))
    expect((await manager.readFilesFromSystemClipboard()).map(file => file.path))
      .toEqual(['C:\\Users\\test\\one.md', 'D:\\two.txt'])
  })

  it('Windows URI 按 Windows 路径解码', async () => {
    vi.mocked(os.platform).mockReturnValue('win32')
    contents('text/uri-list', 'file:///C:/Users/test/A%20B.md')
    expect((await manager.readFilesFromSystemClipboard())[0].path).toBe('C:\\Users\\test\\A B.md')
  })

  it('Linux GNOME copy/cut 格式忽略动作头', async () => {
    vi.mocked(os.platform).mockReturnValue('linux')
    contents(format('x-special/gnome-copied-files'), 'cut\nfile:///home/user/a.md\nfile:///home/user/b.md\n')
    expect((await manager.readFilesFromSystemClipboard()).map(file => file.path))
      .toEqual(['/home/user/a.md', '/home/user/b.md'])
  })

  it.each(['darwin', 'win32', 'linux'] as const)('%s 空内容或普通文本返回空列表', async platform => {
    vi.mocked(os.platform).mockReturnValue(platform)
    expect(await manager.readFilesFromSystemClipboard()).toEqual([])
    vi.mocked(clipboard.readText).mockResolvedValue('普通文本')
    expect(await manager.readFilesFromSystemClipboard()).toEqual([])
  })

  it('异步读取拒绝后安全返回空列表', async () => {
    vi.mocked(clipboard.read).mockRejectedValueOnce(new Error('read failed'))
    expect(await manager.readFilesFromSystemClipboard()).toEqual([])
  })
})

describe('writeFilesToSystemClipboard', () => {
  it('macOS 通过 URI 列表写多个文件，保留特殊字符', async () => {
    expect(await manager.writeFilesToSystemClipboard(['/Users/test/A&B<测试>.md', '/Users/test/two.txt'])).toBe(true)
    expect(await written('text/uri-list')).toBe('file:///Users/test/A&B%3C%E6%B5%8B%E8%AF%95%3E.md\r\nfile:///Users/test/two.txt')
  })

  it('只写入存在的文件，空列表不触碰系统剪贴板', async () => {
    vi.mocked(fs.existsSync).mockImplementation(path => path === '/exists.md')
    expect(await manager.writeFilesToSystemClipboard(['/exists.md', '/missing.md'])).toBe(true)
    expect(await written('text/uri-list')).toBe('file:///exists.md')
    vi.mocked(clipboard.write).mockClear()
    expect(await manager.writeFilesToSystemClipboard(['/missing.md'])).toBe(false)
    expect(await manager.writeFilesToSystemClipboard([])).toBe(false)
    expect(clipboard.write).not.toHaveBeenCalled()
  })

  it.each([false, true])('Linux 保留 GNOME 文件动作 cut=%s', async cut => {
    vi.mocked(os.platform).mockReturnValue('linux')
    expect(await manager.writeFilesToSystemClipboard(['/home/user/file.md'], cut)).toBe(true)
    expect(await written('text/uri-list')).toBe('file:///home/user/file.md')
    expect(await written(format('x-special/gnome-copied-files')))
      .toBe(`${cut ? 'cut' : 'copy'}\nfile:///home/user/file.md\n`)
  })

  it.each([false, true])('Windows 保留 PowerShell 原生文件引用，路径不插入脚本 cut=%s', async cut => {
    vi.mocked(os.platform).mockReturnValue('win32')
    const paths = ['C:\\Users\\test\\quote\' file.md']
    expect(await manager.writeFilesToSystemClipboard(paths, cut)).toBe(true)
    const [command, args, options] = vi.mocked(execFileSync).mock.calls[0]
    expect(command).toBe('powershell.exe')
    expect(args).toContain('-Sta')
    expect(args!.at(-1)).toContain(`[byte[]]@(${cut ? 2 : 1}, 0, 0, 0)`)
    expect(args!.at(-1)).not.toContain(paths[0])
    expect(options).toMatchObject({ env: { MD_VIEWER_CLIPBOARD_PATHS: JSON.stringify(paths) } })
    expect(clipboard.write).not.toHaveBeenCalled()
  })

  it('Windows PowerShell 失败不伪装成功', async () => {
    vi.mocked(os.platform).mockReturnValue('win32')
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('ENOENT') })
    expect(await manager.writeFilesToSystemClipboard(['C:\\file.md'])).toBe(false)
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('异步写入拒绝返回失败，后续写仍可完成', async () => {
    vi.mocked(clipboard.write).mockRejectedValueOnce(new Error('write failed'))
    expect(await manager.writeFilesToSystemClipboard(['/one.md'])).toBe(false)
    expect(await manager.writeFilesToSystemClipboard(['/two.md'])).toBe(true)
  })

  it('文件/文本/清空按调用顺序完成，未完成文件写不会盖掉较新文本', async () => {
    let finish!: () => void
    vi.mocked(clipboard.write).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    const files = manager.writeFilesToSystemClipboard(['/old.md'])
    const text = manager.writeTextToSystemClipboard('/new.md')
    const clear = manager.clearSystemClipboard()
    await vi.waitFor(() => expect(clipboard.write).toHaveBeenCalledTimes(1))
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(clipboard.clear).not.toHaveBeenCalled()
    finish()
    expect(await files).toBe(true)
    expect(await text).toBe(true)
    await clear
    expect(clipboard.writeText).toHaveBeenCalledWith('/new.md')
    expect(vi.mocked(clipboard.writeText).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(clipboard.clear).mock.invocationCallOrder[0])
  })

  it('保存输入快照，连续 copy/cut 不读取后续篡改的数组', async () => {
    const paths = ['/one.md']
    const first = manager.writeFilesToSystemClipboard(paths)
    paths[0] = '/mutated.md'
    const second = manager.writeFilesToSystemClipboard(['/two.md'], true)
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    const item = vi.mocked(clipboard.write).mock.calls[0][0][0]
    expect(await (await item.getType('text/uri-list')).text()).toBe('file:///one.md')
    expect(await written('text/uri-list')).toBe('file:///two.md')
  })

  it('文本拒绝与清空异常均被处理，不阻断后续队列', async () => {
    vi.mocked(clipboard.writeText).mockRejectedValueOnce(new Error('write failed'))
    expect(await manager.writeTextToSystemClipboard('text')).toBe(false)
    vi.mocked(clipboard.clear).mockImplementationOnce(() => { throw new Error('clear failed') })
    await expect(manager.clearSystemClipboard()).resolves.toBeUndefined()
    expect(await manager.writeTextToSystemClipboard('recovered')).toBe(true)
  })
})

describe('hasFilesInSystemClipboard', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('%s 按可解析文件判断，不把任意原生数据当文件', async platform => {
    vi.mocked(os.platform).mockReturnValue(platform)
    expect(await manager.hasFilesInSystemClipboard()).toBe(false)
    vi.mocked(clipboard.readText).mockResolvedValue(platform === 'win32' ? 'file:///C:/file.md' : 'file:///path/file.md')
    expect(await manager.hasFilesInSystemClipboard()).toBe(true)
    vi.mocked(clipboard.read).mockRejectedValueOnce(new Error('read failed'))
    expect(await manager.hasFilesInSystemClipboard()).toBe(false)
  })
})
