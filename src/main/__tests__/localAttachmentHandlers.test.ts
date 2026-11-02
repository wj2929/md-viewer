import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import { LOCAL_ATTACHMENT_TEXT_EXTENSIONS, MAX_LOCAL_ATTACHMENT_TEXT_SIZE } from '../../shared/localMedia'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn() },
}))
vi.mock('../ipc/senderSecurity', () => ({ validateSenderReadPath: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), stat: vi.fn(actual.stat) }
})
import { open, stat } from 'node:fs/promises'
import { validateSenderReadPath } from '../ipc/senderSecurity'
import { readLocalAttachment, openLocalAttachment, validateAttachmentReference } from '../ipc/localMediaHandlers'

let root = ''
async function fixture() {
  await mkdir(path.join(process.cwd(), '.tmp'), { recursive: true })
  root = await mkdtemp(path.join(process.cwd(), '.tmp', 'attachment-test-'))
  const source = path.join(root, 'notes', 'source.md')
  await mkdir(path.dirname(source))
  await writeFile(source, '# Source')
  const workspace = { id: 'owned', primaryRoot: root, lifecycleEpoch: 7 }
  const ctx = { windowManager: {
    getWindowByWebContentsId: vi.fn(() => ({ id: 3, isDestroyed: () => false })),
    listWorkspaces: vi.fn(() => [workspace]),
  } } as any
  const event = { sender: { id: 9, isDestroyed: () => false } } as Electron.IpcMainInvokeEvent
  vi.mocked(validateSenderReadPath).mockResolvedValue(source)
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ isDestroyed: () => false } as any)
  vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })
  vi.mocked(shell.openPath).mockResolvedValue('')
  return { ctx, event, source, workspace }
}
beforeEach(() => vi.clearAllMocks())
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = '' })

describe('本地附件读取与系统打开', () => {
  it('读取UTF-8/BOM/CRLF原始快照，HTML和大整数不解释，不创建capability', async () => {
    const { ctx, event, source } = await fixture()
    const raw = '{"id":9007199254740993123,"x":"<script>alert(1)</script>"}\r\n'
    await writeFile(path.join(root, 'notes', '中文 空格.JSON'), `\uFEFF${raw}`)
    expect(await readLocalAttachment(ctx, event, source, encodeURIComponent('中文 空格.JSON')))
      .toMatchObject({ kind: 'text', content: raw, canOpenExternally: true, extension: '.json' })
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })
  it('新脚本后缀不能经旧文本symlink取得系统打开；PDF别名不自动读文本', async () => {
    const { ctx, event, source } = await fixture()
    await writeFile(path.join(root, 'notes', 'old.txt'), 'fixture text')
    await symlink(path.join(root, 'notes', 'old.txt'), path.join(root, 'notes', 'new.sh'))
    await symlink(path.join(root, 'notes', 'old.txt'), path.join(root, 'notes', 'alias.pdf'))
    expect(await readLocalAttachment(ctx, event, source, 'new.sh'))
      .toMatchObject({ kind: 'text', canOpenExternally: false })
    expect(await openLocalAttachment(ctx, event, source, 'new.sh')).toMatchObject({ success: false })
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(await readLocalAttachment(ctx, event, source, 'alias.pdf')).toMatchObject({ kind: 'file' })
  })
  it('close等待期间owner epoch失效，不交付已解码正文', async () => {
    const { ctx, event, source, workspace } = await fixture()
    await writeFile(path.join(root, 'notes', 'late.txt'), '不得交付的正文')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args)
      const close = handle.close.bind(handle)
      handle.close = async () => { await close(); workspace.lifecycleEpoch++ }
      return handle
    })
    expect(await readLocalAttachment(ctx, event, source, 'late.txt')).toEqual({ kind: 'error', code: 'stale' })
  })
  it('最后一次路径stat等待期间owner失效，不能仅比较之前捕获的epoch', async () => {
    const { ctx, event, source, workspace } = await fixture()
    await writeFile(path.join(root, 'notes', 'last.txt'), '原始正文')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    let calls = 0
    vi.mocked(stat).mockImplementation(async (...args) => {
      const value = await actual.stat(...args)
      if (++calls === 4) workspace.lifecycleEpoch++
      return value
    })
    try {
      expect(await readLocalAttachment(ctx, event, source, 'last.txt')).toEqual({ kind: 'error', code: 'stale' })
    } finally { vi.mocked(stat).mockImplementation(actual.stat) }
  })

  it('5MiB完整允许，超限只返回元信息，不截断正文', async () => {
    const { ctx, event, source } = await fixture()
    await writeFile(path.join(root, 'notes', 'limit.txt'), Buffer.alloc(MAX_LOCAL_ATTACHMENT_TEXT_SIZE, 97))
    const result = await readLocalAttachment(ctx, event, source, 'limit.txt')
    expect(result.kind).toBe('text')
    if (result.kind === 'text') expect(result.content).toHaveLength(MAX_LOCAL_ATTACHMENT_TEXT_SIZE)
    await appendFile(path.join(root, 'notes', 'limit.txt'), 'a')
    expect(await readLocalAttachment(ctx, event, source, 'limit.txt'))
      .toMatchObject({ kind: 'file', notice: 'too-large', canOpenExternally: true })
  })
  it.each([[Buffer.from([0xff, 0xfe]), 'not-utf8'], [Buffer.from('a\0b'), 'binary']] as const)(
    '拒绝非UTF-8或二进制内容，只保留允许的辅助动作', async (bytes, notice) => {
      const { ctx, event, source } = await fixture()
      await writeFile(path.join(root, 'notes', 'bad.json'), bytes)
      expect(await readLocalAttachment(ctx, event, source, 'bad.json'))
        .toMatchObject({ kind: 'file', notice, canOpenExternally: true })
    },
  )
  it.each(['file:///etc/a.json', '/a.json', '../x.json?x=1', 'x.json#x', '%ff', '%252e%252e/out.json'])(
    '非法或不存在引用不交付正文: %s', async ref => {
      const { ctx, event, source } = await fixture()
      expect((await readLocalAttachment(ctx, event, source, ref)).kind).toBe('error')
    },
  )
  it('资源不能逃逸来源根、通过符号链接外跳或借历史根作为owner', async () => {
    const { ctx, event, source } = await fixture()
    const outside = path.join(root, '..', `${path.basename(root)}-outside.json`)
    try {
      await writeFile(outside, '{}')
      await symlink(outside, path.join(root, 'notes', 'out.json'))
      expect((await readLocalAttachment(ctx, event, source, 'out.json')).kind).toBe('error')
      ctx.windowManager.listWorkspaces.mockReturnValue([])
      expect(await readLocalAttachment(ctx, event, source, 'anything.json'))
        .toEqual({ kind: 'error', code: 'owner-missing' })
    } finally { await rm(outside, { force: true }) }
  })
  it('不读取受保护文件和目录，未知/执行类型不直接系统打开', async () => {
    const { ctx, event, source } = await fixture()
    await mkdir(path.join(root, '.aws'))
    await writeFile(path.join(root, '.aws', 'credentials.json'), '{}')
    expect((await readLocalAttachment(ctx, event, source, '../.aws/credentials.json')).kind).toBe('error')
    expect((await readLocalAttachment(ctx, event, source, '.')).kind).toBe('error')
    for (const name of ['x.exe', 'x.lnk', 'x.desktop']) {
      await writeFile(path.join(root, 'notes', name), 'not executed')
      expect(await readLocalAttachment(ctx, event, source, name))
        .toMatchObject({ kind: 'file', notice: 'unsupported', canOpenExternally: false })
      expect(await openLocalAttachment(ctx, event, source, name)).toMatchObject({ success: false })
    }
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(shell.openPath).not.toHaveBeenCalled()
  })
  it.each([...LOCAL_ATTACHMENT_TEXT_EXTENSIONS].filter(extension =>
    !['.json', '.txt', '.log', '.csv', '.yaml', '.yml'].includes(extension),
  ))('新增文本%s只预览、不获得系统执行能力', async extension => {
    const { ctx, event, source } = await fixture()
    const name = `preview${extension.toUpperCase()}`
    const content = 'SELECT 9007199254740993123;\r\n<script>not executed</script>'
    await writeFile(path.join(root, 'notes', name), content)
    expect(await readLocalAttachment(ctx, event, source, name))
      .toMatchObject({ kind: 'text', content, canOpenExternally: false, extension })
    expect(await openLocalAttachment(ctx, event, source, name)).toMatchObject({ success: false })
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(shell.openPath).not.toHaveBeenCalled()
  })
  it('默认取消；明确确认后才用实际已授权路径系统打开', async () => {
    const { ctx, event, source } = await fixture()
    const pdf = path.join(root, 'notes', 'safe.pdf')
    await writeFile(pdf, '%PDF-fixture')
    expect(await openLocalAttachment(ctx, event, source, 'safe.pdf')).toEqual({ success: false, cancelled: true })
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ defaultId: 0, cancelId: 0 }))
    expect(shell.openPath).not.toHaveBeenCalled()
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    expect(await openLocalAttachment(ctx, event, source, 'safe.pdf')).toEqual({ success: true })
    expect(shell.openPath).toHaveBeenCalledWith(pdf)
  })
  it.each(['epoch', 'replace', 'modify'] as const)('确认等待中%s变化拒绝执行', async change => {
    const { ctx, event, source, workspace } = await fixture()
    const target = path.join(root, 'notes', 'safe.pdf')
    await writeFile(target, '%PDF-fixture')
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(async () => {
      if (change === 'epoch') workspace.lifecycleEpoch++
      else if (change === 'replace') { await rm(target); await writeFile(target, '%PDF-other') }
      else await appendFile(target, 'changed')
      return { response: 1, checkboxChecked: false }
    })
    expect(await openLocalAttachment(ctx, event, source, 'safe.pdf')).toMatchObject({ success: false, code: 'stale' })
    expect(shell.openPath).not.toHaveBeenCalled()
  })
  it('读取中增长不返回部分正文，持有句柄总会关闭', async () => {
    const { ctx, event, source } = await fixture()
    const target = path.join(root, 'notes', 'grow.txt')
    await writeFile(target, 'before')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    let closed = false
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args)
      const original = handle.read.bind(handle)
      handle.read = (async (...readArgs: any[]) => {
        await appendFile(target, 'growth')
        return original(...readArgs as Parameters<typeof original>)
      }) as typeof handle.read
      const close = handle.close.bind(handle)
      handle.close = async () => { closed = true; await close() }
      return handle
    })
    expect(await readLocalAttachment(ctx, event, source, 'grow.txt')).toEqual({ kind: 'error', code: 'stale' })
    expect(closed).toBe(true)
  })
  it('系统应用错误只返回受控失败码', async () => {
    const { ctx, event, source } = await fixture()
    await writeFile(path.join(root, 'notes', 'safe.pdf'), '%PDF')
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    vi.mocked(shell.openPath).mockResolvedValueOnce('private path error')
    expect(await openLocalAttachment(ctx, event, source, 'safe.pdf')).toEqual({ success: false, code: 'unavailable' })
  })
})

describe('Windows附件引用词法守卫（非原生文件系统验证）', () => {
  it.each(['C:foo.json', 'C:\\foo.json', '\\\\host\\share\\foo.json', 'folder/foo.txt:stream.json',
    'NUL.json', 'COM1.txt', 'a./b.json', 'a /b.json', 'folder/LPT2.csv'])('拒绝%s', ref => {
    expect(() => validateAttachmentReference(ref, 'win32')).toThrow('invalid-reference')
  })
  it('允许普通中文/空格/相对父目录，不解码两次', () => {
    for (const ref of ['子目录/会议 01.json', '../data.json', 'a/%252e.json']) {
      expect(() => validateAttachmentReference(ref, 'win32')).not.toThrow()
    }
  })
})
