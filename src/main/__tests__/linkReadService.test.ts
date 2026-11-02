import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { MAX_LOCAL_ATTACHMENT_TEXT_SIZE } from '../../shared/localMedia'
import type { LinkedReadRequest, PreparedLinkedDocument } from '../../shared/linkRead'

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn(), openPath: vi.fn() } }))
vi.mock('../ipc/senderSecurity', () => ({ validateSenderReadPath: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), stat: vi.fn(actual.stat) }
})
import { open } from 'node:fs/promises'
import { validateSenderReadPath } from '../ipc/senderSecurity'
import { validateSecurePathInBase } from '../security'
import { LinkReadService, validateClickedFilePath } from '../linkReadService'

let fixtureRoot = ''
beforeEach(() => vi.clearAllMocks())
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(open).mockImplementation(actual.open)
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = ''
})

async function fixture() {
  await mkdir(path.join(process.cwd(), '.tmp'), { recursive: true })
  fixtureRoot = await mkdtemp(path.join(process.cwd(), '.tmp', 'link-read-test-'))
  const root = path.join(fixtureRoot, 'owned')
  const outside = path.join(fixtureRoot, 'unopened')
  await mkdir(root)
  await mkdir(outside)
  const source = path.join(root, 'A.md')
  await writeFile(source, '# A')
  await writeFile(path.join(outside, 'B.md'), '# B\n\n[C](C.md)\n\n[SQL](query.sql)')
  await writeFile(path.join(outside, 'C.md'), '# C')
  await writeFile(path.join(outside, 'query.sql'), 'SELECT 9007199254740993123;\r\n')
  let generation = 1
  let active = 'owned'
  let workspace = { id: 'owned', primaryRoot: root, lifecycleEpoch: 7 }
  let lifecycle: (windowId: number, workspaceId: string | undefined, revoke: boolean) => void
  const window = { id: 3, isDestroyed: () => false }
  const ctx = { windowManager: {
    getWindowByWebContentsId: vi.fn((id: number) => id === 9 ? window : undefined),
    getWorkspace: vi.fn(() => workspace),
    listWorkspaces: vi.fn(() => [workspace]),
    getActiveWorkspaceId: vi.fn(() => active),
    getLinkReadActivationGeneration: vi.fn(() => generation),
    onLinkReadLifecycle: vi.fn(callback => { lifecycle = callback }),
  } } as any
  const event = { sender: { id: 9, isDestroyed: () => false } } as Electron.IpcMainInvokeEvent
  vi.mocked(validateSenderReadPath).mockImplementation(async (_ctx, _event, target) => validateSecurePathInBase(target, root))
  const service = new LinkReadService(ctx)
  let number = 0
  const request = (href: string, documentId?: string, filePath = source, leafId = 'single'): LinkedReadRequest => ({
    operation: { workspaceId: 'owned', lifecycleEpoch: 7 }, source: { filePath, documentId },
    href, leafId, requestId: `request-${++number}`,
  })
  const prepare = async (input: LinkedReadRequest) => {
    const result = await service.prepareDocument(event, input)
    expect(result.success).toBe(true)
    return result as PreparedLinkedDocument
  }
  const commit = async (result: PreparedLinkedDocument) => {
    expect(await service.commitDocument(event, result.batchId)).toEqual({ success: true })
    return result
  }
  return { root, outside, source, service, event, ctx, workspace, request, prepare, commit,
    activate(id: string) { active = id; generation++; lifecycle!(3, undefined, false) },
    replaceRegistry() { workspace = { ...workspace }; lifecycle!(3, undefined, true) },
    revoke() { workspace.lifecycleEpoch++; lifecycle!(3, 'owned', true) },
  }
}

describe('普通 Wiki 别名的安全读取', () => {
  function aliases(f: Awaited<ReturnType<typeof fixture>>, entries: Array<[string, string[]]>) {
    let current = true
    const snapshot = { rootPath: f.root, epoch: 1, ready: true, complete: true,
      documents: new Map(), metadata: new Map(), aliases: new Map(entries.map(([name, paths]) => [name, new Set(paths)])),
      isCurrent: () => current }
    f.ctx.workspaceIndexService = { getWikiSnapshot: vi.fn(() => snapshot) }
    return { snapshot, invalidate: () => { current = false } }
  }
  const wiki = (name: string) => `wiki:${encodeURIComponent(name)}`

  it('只在文件缺失时回落已保存别名，准备与提交保持根授权', async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, 'real.md'), '---\naliases: [Guide]\n---\n# Real')
    aliases(f, [['Guide', ['real.md']]])
    const prepared = await f.prepare(f.request(wiki('Guide')))
    expect(prepared.targetPath).toBe(path.join(f.root, 'real.md'))
    expect(prepared.access).toBe('root')
    expect(prepared.documentId).toBeUndefined()
    await f.commit(prepared)
  })
  it('索引外真实文件遮蔽别名，文件名歧义不回落', async () => {
    const f = await fixture()
    await mkdir(path.join(f.root, 'vendor'))
    await writeFile(path.join(f.root, 'vendor', 'Guide.md'), '# Vendor')
    await writeFile(path.join(f.root, 'real.md'), '---\naliases: Guide\n---')
    aliases(f, [['Guide', ['real.md']]])
    expect((await f.prepare(f.request(wiki('Guide')))).content).toBe('# Vendor')
    expect(f.ctx.workspaceIndexService.getWikiSnapshot).not.toHaveBeenCalled()
    await mkdir(path.join(f.root, 'dist'))
    await writeFile(path.join(f.root, 'dist', 'Guide.md'), '# Other')
    expect(await f.service.prepareDocument(f.event, f.request(wiki('Guide')))).toEqual({ success: false, code: 'wiki-ambiguous' })
  })
  it('重复、不完整和过期均不能悄悄选一个目标', async () => {
    const f = await fixture()
    const state = aliases(f, [['Guide', ['a.md', 'b.md']]])
    expect(await f.service.prepareDocument(f.event, f.request(wiki('Guide')))).toEqual({ success: false, code: 'wiki-ambiguous' })
    state.snapshot.ready = false
    expect(await f.service.prepareDocument(f.event, f.request(wiki('Guide')))).toEqual({ success: false, code: 'alias-updating' })
    state.snapshot.complete = false
    expect(await f.service.prepareDocument(f.event, f.request(wiki('Guide')))).toEqual({ success: false, code: 'alias-incomplete' })
    state.snapshot.ready = true; state.invalidate()
    expect(await f.service.prepareDocument(f.event, f.request(wiki('Guide')))).toEqual({ success: false, code: 'stale' })
  })
  it('重新检查实际读取的 alias，prepare 后 epoch 改变拒绝 commit', async () => {
    const f = await fixture()
    const state = aliases(f, [['Guide', ['real.md']]])
    await writeFile(path.join(f.root, 'real.md'), '# Alias removed without delivered event')
    expect(await f.service.prepareDocument(f.event, f.request(wiki('Guide')))).toEqual({ success: false, code: 'stale' })
    await writeFile(path.join(f.root, 'real.md'), '---\naliases: Guide\n---')
    const prepared = await f.prepare(f.request(wiki('Guide')))
    state.invalidate()
    expect(await f.service.commitDocument(f.event, prepared.batchId)).toEqual({ success: false, code: 'stale' })
  })
  it('使用 operation 根而非第一个包含 source 的工作区；嵌入不获别名', async () => {
    const f = await fixture()
    f.ctx.windowManager.listWorkspaces.mockReturnValue([{ id: 'overlap', primaryRoot: fixtureRoot }, f.workspace])
    await writeFile(path.join(f.root, 'real.md'), '---\naliases: Guide\n---')
    aliases(f, [['Guide', ['real.md']]])
    await f.prepare(f.request(wiki('Guide')))
    expect(f.ctx.workspaceIndexService.getWikiSnapshot).toHaveBeenCalledWith(f.root)
    expect(f.ctx.windowManager.listWorkspaces).not.toHaveBeenCalled()
    expect((await f.service.prepareDocument(f.event, { ...f.request(wiki('Guide')), rootOnly: true })).success).toBe(false)
  })
  it('点号 alias 可解析，真实同名附件遮蔽且可按附件读取', async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, 'real.md'), '---\naliases: [版本 1.0, 100%25]\n---')
    aliases(f, [['版本 1.0', ['real.md']], ['100%25', ['real.md']]])
    await f.prepare(f.request(wiki('版本 1.0')))
    await f.prepare(f.request(wiki('100%2525')))
    await mkdir(path.join(f.root, 'vendor'))
    await writeFile(path.join(f.root, 'vendor', '版本 1.0'), 'opaque resource')
    expect(await f.service.prepareDocument(f.event, f.request(wiki('版本 1.0')))).toEqual({ success: false, code: 'wiki-resource' })
    const attachment = await f.service.readAttachment(f.event, f.request(wiki('版本 1.0')))
    expect(attachment.kind).toBe('file')
    expect(attachment.resourceHandle).toBeTruthy()
  })
  it('文件名查找保留逻辑后缀，软链不能把附件冒充 Markdown', async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, 'data.sql'), 'SELECT 1;')
    await symlink(path.join(f.root, 'data.sql'), path.join(f.root, 'Guide.md'))
    expect(await f.service.prepareDocument(f.event, f.request(wiki('Guide')))).toEqual({ success: false, code: 'invalid-reference' })
    await writeFile(path.join(f.root, 'real.md'), '# Real')
    await symlink(path.join(f.root, 'real.md'), path.join(f.root, '版本 1.0'))
    expect(await f.service.prepareDocument(f.event, f.request(wiki('版本 1.0')))).toEqual({ success: false, code: 'wiki-resource' })
  })
  it('临时跨根只读来源不能借 alias 再扩张授权', async () => {
    const f = await fixture()
    aliases(f, [['Guide', ['real.md']]])
    const external = await f.commit(await f.prepare(f.request('../unopened/B.md')))
    expect(await f.service.prepareDocument(f.event, f.request(wiki('Guide'), external.documentId, external.targetPath)))
      .toEqual({ success: false, code: 'explicit-path-required' })
    expect(f.ctx.workspaceIndexService.getWikiSnapshot).not.toHaveBeenCalled()
  })
})

describe('点击链接的精确文件读取', () => {
  it('磁盘没有指定块也可安全 prepare，只传 block ID，由实际显示草稿预检', async () => {
    const f = await fixture()
    const prepared = await f.prepare(f.request('../unopened/B.md#^draft-only'))
    expect(prepared.blockId).toBe('draft-only')
    expect(prepared).not.toHaveProperty('targetLine')
    expect(prepared).not.toHaveProperty('headingId')
    await f.commit(prepared)
  })
  it('rootOnly只限缩：外部目标在open前拒绝；根内返回不签发文档许可', async () => {
    const f = await fixture()
    expect(await f.service.prepareDocument(f.event, { ...f.request('../unopened/B.md'), rootOnly: true }))
      .toEqual({ success: false, code: 'unavailable' })
    expect(open).not.toHaveBeenCalled()
    const b = await f.commit(await f.prepare(f.request('../unopened/B.md')))
    const back = await f.prepare({ ...f.request(f.source, b.documentId, b.targetPath), rootOnly: true })
    expect(back).toMatchObject({ access: 'root', content: '# A' })
    expect(back).not.toHaveProperty('documentId')
    await f.commit(back)
  })
  it('rootOnly在fd.close等待及commit前失去根授权均拒绝，不退回单文件许可', async () => {
    const f = await fixture()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args)
      const close = handle.close.bind(handle)
      handle.close = async () => { await close(); vi.mocked(validateSenderReadPath).mockRejectedValue(new Error('denied')) }
      return handle
    })
    expect(await f.service.prepareDocument(f.event, { ...f.request('A.md'), rootOnly: true }))
      .toEqual({ success: false, code: 'unavailable' })
    vi.mocked(validateSenderReadPath).mockImplementation(async (_ctx, _event, target) => validateSecurePathInBase(target, f.root))
    const prepared = await f.prepare({ ...f.request('A.md'), rootOnly: true })
    vi.mocked(validateSenderReadPath).mockRejectedValue(new Error('denied'))
    expect(await f.service.commitDocument(f.event, prepared.batchId)).toMatchObject({ success: false })
    expect(prepared).not.toHaveProperty('documentId')
  })
  it('请求名与canonical类型都复核，二进制别名不读取且新后缀别名无系统打开资格', async () => {
    const f = await fixture()
    await symlink(path.join(f.outside, 'query.sql'), path.join(f.outside, 'alias.pdf'))
    const binaryAlias = await f.service.readAttachment(f.event, f.request('../unopened/alias.pdf'))
    expect(binaryAlias).toMatchObject({ kind: 'file', canViewAsText: false, canOpenExternally: false })
    expect(open).not.toHaveBeenCalled()
    await writeFile(path.join(f.root, 'old.txt'), 'old text')
    await symlink(path.join(f.root, 'old.txt'), path.join(f.root, 'new.sh'))
    expect(await f.service.readAttachment(f.event, f.request('./new.sh')))
      .toMatchObject({ kind: 'text', canOpenExternally: false })
    await symlink(path.join(f.outside, 'B.md'), path.join(f.outside, 'alias.sql'))
    expect(await f.service.prepareDocument(f.event, f.request('../unopened/alias.sql')))
      .toMatchObject({ success: false, code: 'invalid-reference' })
  })
  it.each(['growth', 'truncate', 'replace'] as const)('同一次读取内%s不交付正文或标题', async mutation => {
    const f = await fixture()
    const target = path.join(f.outside, 'B.md')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args), read = handle.read.bind(handle)
      handle.read = (async (...readArgs: any[]) => {
        const result = await (read as any)(...readArgs)
        if (mutation === 'growth') await appendFile(target, '\nchanged')
        else if (mutation === 'truncate') await writeFile(target, '# Short')
        else {
          const next = path.join(f.outside, 'replacement.md')
          await writeFile(next, '# Replaced')
          await rename(next, target)
        }
        return result
      }) as typeof handle.read
      return handle
    })
    expect(await f.service.prepareDocument(f.event, f.request('../unopened/B.md#b')))
      .toMatchObject({ success: false, code: 'stale' })
  })
  it('commit根授权最后一次await期间文件改变，不能确认旧快照', async () => {
    const f = await fixture()
    const target = path.join(f.root, 'B.md')
    await writeFile(target, '# Root B')
    const prepared = await f.prepare(f.request('./B.md'))
    let changed = false
    vi.mocked(validateSenderReadPath).mockImplementation(async (_ctx, _event, value) => {
      const canonical = await validateSecurePathInBase(value, f.root)
      if (value === target && !changed) { changed = true; await appendFile(target, '\nChanged during authorization') }
      return canonical
    })
    expect(await f.service.commitDocument(f.event, prepared.batchId)).toEqual({ success: false, code: 'stale' })
  })
  it('A→未授权B→C和SQL；不借给通用读，不需要外部目录owner', async () => {
    const f = await fixture()
    const b = await f.commit(await f.prepare(f.request('../unopened/B.md#b')))
    expect(b).toMatchObject({ access: 'linked-readonly', targetLine: 1, headingId: 'b' })
    expect(b.documentId).toBeTruthy()
    expect(await f.service.readAttachment(f.event, f.request('query.sql', b.documentId, b.targetPath)))
      .toMatchObject({ kind: 'text', content: 'SELECT 9007199254740993123;\r\n', canOpenExternally: false })
    const c = await f.commit(await f.prepare(f.request('C.md', b.documentId, b.targetPath)))
    expect(c.targetPath).toBe(path.join(f.outside, 'C.md'))
    await expect(validateSenderReadPath(f.ctx, f.event, b.targetPath)).rejects.toThrow()
    expect(f.ctx.windowManager.listWorkspaces()).toHaveLength(1)
    expect(shell.openPath).not.toHaveBeenCalled()
  })
  it('待提交凭据不能作来源；取消批次不激活权限', async () => {
    const f = await fixture()
    const b = await f.prepare(f.request('../unopened/B.md'))
    expect(await f.service.prepareDocument(f.event, f.request('C.md', b.documentId, b.targetPath, 'second')))
      .toMatchObject({ success: false, code: 'stale' })
    f.service.release(f.event, [b.batchId])
    expect(await f.service.commitDocument(f.event, b.batchId)).toMatchObject({ success: false, code: 'stale' })
  })
  it('同路径正常修改与atomic replace可刷新，替换成symlink不迁移许可', async () => {
    const f = await fixture()
    const b = await f.commit(await f.prepare(f.request('../unopened/B.md')))
    await writeFile(b.targetPath, '# Updated')
    let refresh = await f.service.prepareDocumentRefresh(f.event, { workspaceId: 'owned', lifecycleEpoch: 7 }, b.documentId!, 'single', 'refresh-1')
    expect(refresh).toMatchObject({ success: true, content: '# Updated', documentId: b.documentId })
    await f.commit(refresh as PreparedLinkedDocument)
    const replacement = path.join(f.outside, 'replacement.md')
    await writeFile(replacement, '# Atomic')
    await rename(replacement, b.targetPath)
    refresh = await f.service.prepareDocumentRefresh(f.event, { workspaceId: 'owned', lifecycleEpoch: 7 }, b.documentId!, 'single', 'refresh-2')
    expect(refresh).toMatchObject({ success: true, content: '# Atomic' })
    await f.commit(refresh as PreparedLinkedDocument)
    await rm(b.targetPath)
    await symlink(path.join(f.outside, 'C.md'), b.targetPath)
    expect(await f.service.prepareDocumentRefresh(f.event, { workspaceId: 'owned', lifecycleEpoch: 7 }, b.documentId!, 'single', 'refresh-3'))
      .toMatchObject({ success: false, code: 'stale' })
  })
  it('切走再切回保留已提交文档，旧请求不能复活', async () => {
    const f = await fixture()
    const b = await f.commit(await f.prepare(f.request('../unopened/B.md')))
    const c = await f.prepare(f.request('C.md', b.documentId, b.targetPath))
    f.activate('other')
    f.activate('owned')
    expect(await f.service.commitDocument(f.event, c.batchId)).toMatchObject({ success: false, code: 'stale' })
    expect(await f.service.prepareDocumentRefresh(f.event, { workspaceId: 'owned', lifecycleEpoch: 7 }, b.documentId!, 'single', 'new-generation'))
      .toMatchObject({ success: true, documentId: b.documentId })
  })
  it('相同id/epoch/root的registry重建仍撤销旧凭据', async () => {
    const f = await fixture()
    const b = await f.commit(await f.prepare(f.request('../unopened/B.md')))
    f.replaceRegistry()
    expect(await f.service.prepareDocument(f.event, f.request('C.md', b.documentId, b.targetPath)))
      .toMatchObject({ success: false, code: 'stale' })
  })
  it('释放一个文档不误撤另一个仍被visit持有的文档', async () => {
    const f = await fixture()
    const b = await f.commit(await f.prepare(f.request('../unopened/B.md')))
    const c = await f.commit(await f.prepare(f.request('C.md', b.documentId, b.targetPath)))
    f.service.release(f.event, [c.documentId!])
    expect(await f.service.prepareDocumentRefresh(f.event, { workspaceId: 'owned', lifecycleEpoch: 7 }, b.documentId!, 'single', 'return-B'))
      .toMatchObject({ success: true, documentId: b.documentId })
  })
  it('close等待中失权不交付正文；准备后改变文件也不能提交', async () => {
    const f = await fixture()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args)
      const close = handle.close.bind(handle)
      handle.close = async () => { await close(); f.revoke() }
      return handle
    })
    expect(await f.service.prepareDocument(f.event, f.request('../unopened/B.md')))
      .toMatchObject({ success: false, code: 'stale' })
  })
  it('prepare和commit之间文件修改拒绝；旧取消不取消新请求', async () => {
    const f = await fixture()
    const input = f.request('../unopened/B.md')
    const b = await f.prepare(input)
    await appendFile(b.targetPath, '\nChanged')
    expect(await f.service.commitDocument(f.event, b.batchId)).toMatchObject({ success: false, code: 'stale' })
    const newer = await f.prepare(f.request('../unopened/C.md'))
    f.service.cancel(f.event, input.operation, input.leafId, input.requestId)
    await f.commit(newer)
  })
  it('未知和无后缀只在显式动作后读取，精确定位不传目标路径', async () => {
    const f = await fixture()
    await writeFile(path.join(f.outside, 'README'), 'Unknown plain text')
    let result = await f.service.readAttachment(f.event, f.request('../unopened/README'))
    expect(result).toMatchObject({ kind: 'file', canViewAsText: true, notice: 'unsupported' })
    expect(result).not.toHaveProperty('content')
    const handle = result.resourceHandle!
    expect(await f.service.revealResource(f.event, handle)).toEqual({ success: true })
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path.join(f.outside, 'README'))
    result = await f.service.readAttachment(f.event, f.request('../unopened/README'), true, handle)
    expect(result).toMatchObject({ kind: 'text', content: 'Unknown plain text', canOpenExternally: false })
    f.service.release(f.event, [result.resourceHandle!])
    expect(await f.service.revealResource(f.event, result.resourceHandle!)).toMatchObject({ success: false, code: 'stale' })
  })
  it.each(['.pdf', '.png', '.exe'])('已知二进制%s不提供显式文本兜底', async extension => {
    const f = await fixture()
    await writeFile(path.join(f.outside, `binary${extension}`), 'Even valid UTF-8')
    const result = await f.service.readAttachment(f.event, f.request(`../unopened/binary${extension}`))
    expect(result).toMatchObject({ kind: 'file', canViewAsText: false, canOpenExternally: false })
    expect(await f.service.readAttachment(f.event, f.request(`../unopened/binary${extension}`), true, result.resourceHandle))
      .toMatchObject({ kind: 'error', code: 'invalid-reference' })
  })
  it('MD标题定位也受5MiB/UTF-8/NUL限制', async () => {
    const f = await fixture()
    const target = path.join(f.outside, 'budget.md')
    await writeFile(target, Buffer.alloc(MAX_LOCAL_ATTACHMENT_TEXT_SIZE, 97))
    expect((await f.prepare(f.request('../unopened/budget.md'))).content).toHaveLength(MAX_LOCAL_ATTACHMENT_TEXT_SIZE)
    await appendFile(target, 'x')
    expect(await f.service.prepareDocument(f.event, f.request('../unopened/budget.md#heading')))
      .toMatchObject({ success: false, code: 'too-large' })
    await writeFile(target, Buffer.from([0xff]))
    expect(await f.service.prepareDocument(f.event, f.request('../unopened/budget.md#heading')))
      .toMatchObject({ success: false, code: 'not-utf8' })
    await writeFile(target, 'a\0b')
    expect(await f.service.prepareDocument(f.event, f.request('../unopened/budget.md#heading')))
      .toMatchObject({ success: false, code: 'binary' })
  })
  it('保护路径及其symlink不能借显式文本绕过，非法协议编码拒绝', async () => {
    const f = await fixture()
    await writeFile(path.join(f.outside, '.env'), 'fixture-only')
    await symlink(path.join(f.outside, '.env'), path.join(f.outside, 'alias.sql'))
    for (const href of ['../unopened/.env', '../unopened/alias.sql', 'file:///anything.sql', '%ff']) {
      expect((await f.service.readAttachment(f.event, f.request(href))).kind).toBe('error')
    }
  })
  it('明确Wiki路径连续打开，外部名称Wiki不扫描父目录', async () => {
    const f = await fixture()
    const b = await f.commit(await f.prepare(f.request(`wiki:${encodeURIComponent('../unopened/B.md')}`)))
    await f.commit(await f.prepare(f.request(`wiki:${encodeURIComponent('./C')}`, b.documentId, b.targetPath)))
    expect(await f.service.prepareDocument(f.event, f.request(`wiki:${encodeURIComponent('C')}`, b.documentId, b.targetPath)))
      .toMatchObject({ success: false, code: 'explicit-path-required' })
  })
  it('本机绝对目标可用；伪造document id不能作来源', async () => {
    const f = await fixture()
    await f.commit(await f.prepare(f.request(path.join(f.outside, 'B.md'))))
    expect(await f.service.prepareDocument(f.event, f.request('C.md', 'forged', path.join(f.outside, 'B.md'))))
      .toMatchObject({ success: false, code: 'stale' })
  })
})

describe('专用路径词法（Windows非原生验证）', () => {
  it.each(['C:/Docs/B.md', 'D:\\Docs\\B.md', '../other/B.md', './会议 01.sql'])('允许本机明确路径%s', value => {
    expect(() => validateClickedFilePath(value, 'win32')).not.toThrow()
  })
  it.each(['C:relative.md', '//host/share/B.md', '\\\\host\\share\\B.md', 'NUL.sql', 'docs/x.sql:stream',
    'file:///C:/B.md', 'javascript:x.md', 'a./B.md', 'docs/COM1.sql'])('拒绝%s', value => {
    expect(() => validateClickedFilePath(value, 'win32')).toThrow('invalid-reference')
  })
})
