// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import type { WorkspaceResourceRequest } from '../../shared/directoryBrowser'
import { LinkReadService } from '../linkReadService'
import { getLocalImageCapabilities, registerLocalImageProtocol } from '../localImageProtocol'
import { getLocalMediaCapabilities } from '../localMediaProtocol'
import { validateSenderReadPath } from '../ipc/senderSecurity'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() }, dialog: { showMessageBox: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() }, net: { fetch: vi.fn() },
}))
vi.mock('../ipc/senderSecurity', () => ({ validateSenderReadPath: vi.fn() }))

let temp = ''
beforeEach(() => vi.clearAllMocks())
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); temp = '' })
async function fixture() {
  await mkdir(path.join(process.cwd(), '.tmp'), { recursive: true })
  temp = await mkdtemp(path.join(process.cwd(), '.tmp', 'browser-resource-'))
  const root = path.join(temp, 'owned'), outside = path.join(temp, 'outside')
  await mkdir(root); await mkdir(outside)
  const workspace = { id: 'owned', primaryRoot: root, lifecycleEpoch: 2 }
  const window = { id: 3, isDestroyed: () => false }
  let active = 'owned', generation = 1
  const ctx = { windowManager: {
    getWindowByWebContentsId: (id: number) => id === 9 ? window : undefined,
    getWorkspace: (_id: number, id: string) => id === workspace.id ? workspace : undefined,
    getActiveWorkspaceId: () => active, getLinkReadActivationGeneration: () => generation,
    onLinkReadLifecycle: vi.fn(),
  } } as any
  const session = { protocol: { handle: vi.fn() } } as any
  const event = { sender: { id: 9, session, isDestroyed: () => false } } as Electron.IpcMainInvokeEvent
  const service = new LinkReadService(ctx)
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as any)
  vi.mocked(shell.openPath).mockResolvedValue('')
  let sequence = 0
  const request = (relativePath: string): WorkspaceResourceRequest => ({
    operation: { workspaceId: 'owned', lifecycleEpoch: 2 }, relativePath,
    leafId: `resource-${++sequence}`, requestId: `read-${sequence}`,
  })
  const write = (name: string, value: string | Uint8Array) => writeFile(path.join(root, name), value)
  const read = (name: string) => service.readWorkspaceResource(event, request(name))
  return { root, outside, workspace, window, service, event, session, request, write, read,
    leave() { active = 'other'; generation++ }, revoke() { workspace.lifecycleEpoch++ } }
}

describe('工作区目录资源只读入口', () => {
  it('无需 Markdown 来源；相对路径中的中文、空格、#、? 和 % 原样读取', async () => {
    const f = await fixture()
    const name = process.platform === 'win32' ? '中文 #%.json' : '中文 #?%.json'
    await f.write(name, '{"ok":true}')
    const result = await f.read(name)
    expect(result).toMatchObject({ kind: 'text', content: '{"ok":true}', relativePath: name, canOpenExternally: true })
    if (process.platform === 'win32') {
      for (const invalid of ['中文 #?%.json', 'nul.txt']) {
        expect(await f.read(invalid)).toMatchObject({ kind: 'error' })
      }
    }
    expect(validateSenderReadPath).not.toHaveBeenCalled()
  })
  it.each(['../outside/a.txt', '/etc/passwd', 'C:/a.txt', 'a\\b.txt', 'a//b', './a', '', 'a\0b', 'https:x'])('拒绝非规范或伪造目标 %j', async name => {
    const f = await fixture()
    expect(await f.read(name)).toMatchObject({ kind: 'error' })
    expect(shell.openPath).not.toHaveBeenCalled()
  })
  it('只读取普通文件；不跟随根内/根外链接或链接目录，不读取受保护路径', async () => {
    const f = await fixture()
    await f.write('a.txt', 'safe'); await writeFile(path.join(f.outside, 'out.txt'), 'outside')
    await symlink(path.join(f.root, 'a.txt'), path.join(f.root, 'alias.txt'))
    await symlink(f.outside, path.join(f.root, 'linked'))
    await mkdir(path.join(f.root, '.ssh')); await writeFile(path.join(f.root, '.ssh/key.txt'), 'synthetic')
    for (const name of ['alias.txt', 'linked/out.txt', '.ssh/key.txt', '.ssh']) expect(await f.read(name)).toMatchObject({ kind: 'error' })
  })
  it('HTML、SVG 和脚本只给源码，不签发图片或系统打开资格', async () => {
    const f = await fixture()
    for (const name of ['page.html', 'drawing.svg', 'script.js']) {
      await f.write(name, '<script>synthetic</script>')
      const result = await f.read(name)
      expect(result).toMatchObject({ kind: 'text', content: '<script>synthetic</script>', canOpenExternally: false })
      expect(result.preview).toBeUndefined()
      expect(await f.service.openWorkspaceResource(f.event, result.resourceHandle!)).toMatchObject({ success: false })
    }
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(shell.openPath).not.toHaveBeenCalled()
  })
  it('严格 UTF-8、二进制和 5MiB 检查保留信息卡，不截断内容', async () => {
    const f = await fixture()
    await f.write('nul-bytes.txt', new Uint8Array([65, 0, 66]))
    await f.write('bad.txt', new Uint8Array([0xff]))
    await f.write('huge.txt', new Uint8Array(5 * 1024 * 1024 + 1).fill(65))
    for (const [name, notice] of [['nul-bytes.txt', 'binary'], ['bad.txt', 'not-utf8'], ['huge.txt', 'too-large']]) {
      expect(await f.read(name)).toMatchObject({ kind: 'file', notice })
    }
  })
  it('未知文本须显式请求且绑定原 handle，压缩包不提供文本读取', async () => {
    const f = await fixture()
    await f.write('README', 'plain'); await f.write('archive.zip', 'not really a zip')
    const request = f.request('README')
    const first = await f.service.readWorkspaceResource(f.event, request)
    expect(first).toMatchObject({ kind: 'file', canViewAsText: true })
    expect(await f.service.readWorkspaceResource(f.event, request, true, first.resourceHandle)).toMatchObject({ kind: 'text', content: 'plain' })
    const archive = await f.read('archive.zip')
    expect(archive).toMatchObject({ kind: 'file', canViewAsText: false, canOpenExternally: false })
  })
  it('普通图片 capability 取图时仍复核工作区，旧图片契约不变', async () => {
    const f = await fixture()
    await f.write('picture.png', new Uint8Array([137, 80, 78, 71]))
    const result = await f.read('picture.png')
    expect(result.preview?.kind).toBe('image')
    const capability = [...getLocalImageCapabilities(f.session).values()][0]
    expect(capability.workspace).toMatchObject({ canonicalRoot: f.root, workspaceId: 'owned', lifecycleEpoch: 2 })
    await expect(capability.workspace!.validate()).resolves.toBeUndefined()
    f.revoke()
    await expect(capability.workspace!.validate()).rejects.toThrow('stale')
    registerLocalImageProtocol(f.session)
    const handler = f.session.protocol.handle.mock.calls[0][1]
    expect((await handler({ method: 'GET', url: result.preview!.url })).status).not.toBe(200)
  })
  it('作用域图片通过受限文件描述符读取；文件变化或handle释放后拒绝取图', async () => {
    const f = await fixture()
    const bytes = new Uint8Array([137, 80, 78, 71])
    await f.write('picture.png', bytes)
    const result = await f.read('picture.png')
    registerLocalImageProtocol(f.session)
    const handler = f.session.protocol.handle.mock.calls[0][1]
    const response = await handler({ method: 'GET', url: result.preview!.url })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    await f.write('picture.png', new Uint8Array([1, 2, 3, 4, 5]))
    expect((await handler({ method: 'GET', url: result.preview!.url })).status).not.toBe(200)
    const next = await f.read('picture.png')
    f.service.release(f.event, [next.resourceHandle!])
    expect((await handler({ method: 'GET', url: next.preview!.url })).status).not.toBe(200)
  })

  it('音视频签发复用根/epoch 限制；释放临时 handle 不误撤销同窗媒体 token', async () => {
    const f = await fixture()
    await f.write('clip.mp4', new Uint8Array([1, 2, 3]))
    const result = await f.read('clip.mp4')
    expect(result.preview?.kind).toBe('video')
    const capabilities = getLocalMediaCapabilities(f.session)
    expect([...capabilities.values()][0]).toMatchObject({ canonicalRoot: f.root, workspaceId: 'owned', lifecycleEpoch: 2, kind: 'video' })
    f.service.release(f.event, [result.resourceHandle!])
    expect(capabilities.size).toBe(1)
  })
  it('系统打开默认取消；确认期间切工作区、变更文件或释放 handle 均不能打开', async () => {
    const f = await fixture()
    await f.write('file.pdf', 'synthetic pdf')
    const first = await f.read('file.pdf')
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0 } as any)
    expect(await f.service.openWorkspaceResource(f.event, first.resourceHandle!)).toMatchObject({ success: false, cancelled: true })
    expect(dialog.showMessageBox).toHaveBeenCalledWith(f.window, expect.objectContaining({ defaultId: 0, cancelId: 0 }))
    vi.mocked(dialog.showMessageBox).mockImplementation(async () => { f.revoke(); return { response: 1 } as any })
    expect(await f.service.openWorkspaceResource(f.event, first.resourceHandle!)).toMatchObject({ success: false })
    expect(shell.openPath).not.toHaveBeenCalled()
  })
  it('确认后检查文件快照，外部sender不能定位持有者资源', async () => {
    const f = await fixture()
    await f.write('file.pdf', 'synthetic pdf')
    const result = await f.read('file.pdf')
    vi.mocked(dialog.showMessageBox).mockImplementation(async () => { await f.write('file.pdf', 'changed'); return { response: 1 } as any })
    expect(await f.service.openWorkspaceResource(f.event, result.resourceHandle!)).toMatchObject({ success: false })
    expect(await f.service.revealResource({ sender: { id: 88, isDestroyed: () => false } } as any, result.resourceHandle!)).toMatchObject({ success: false })
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })
  it('显式确认后只打开受控目标；外部工具失败会返回失败', async () => {
    const f = await fixture()
    await f.write('file.pdf', 'synthetic pdf')
    const result = await f.read('file.pdf')
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1 } as any)
    expect(await f.service.openWorkspaceResource(f.event, result.resourceHandle!)).toEqual({ success: true })
    expect(shell.openPath).toHaveBeenCalledWith(path.join(f.root, 'file.pdf'))
    vi.mocked(shell.openPath).mockResolvedValueOnce('synthetic application failure')
    expect(await f.service.openWorkspaceResource(f.event, result.resourceHandle!)).toEqual({ success: false, code: 'unavailable' })
  })
  it('并发系统打开只有一个确认，确认期间释放handle后不能执行', async () => {
    const f = await fixture()
    await f.write('file.pdf', 'synthetic pdf')
    const result = await f.read('file.pdf')
    let answer!: (value: any) => void
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
    const pending = f.service.openWorkspaceResource(f.event, result.resourceHandle!)
    expect(await f.service.openWorkspaceResource(f.event, result.resourceHandle!)).toEqual({ success: false, code: 'busy' })
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledOnce())
    f.service.release(f.event, [result.resourceHandle!])
    answer({ response: 1 })
    expect(await pending).toMatchObject({ success: false })
    expect(shell.openPath).not.toHaveBeenCalled()
  })
  it('操作的 workspace/epoch 必须属于当前 sender，离开后旧 handle 失效', async () => {
    const f = await fixture()
    await f.write('safe.txt', 'safe')
    const result = await f.read('safe.txt')
    expect(await f.service.readWorkspaceResource(f.event, { ...f.request('safe.txt'), operation: { workspaceId: 'other', lifecycleEpoch: 2 } })).toMatchObject({ kind: 'error', code: 'stale' })
    f.leave()
    expect(await f.service.revealResource(f.event, result.resourceHandle!)).toMatchObject({ success: false })
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })
})
