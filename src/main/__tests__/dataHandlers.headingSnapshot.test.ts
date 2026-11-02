import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { MAX_LOCAL_ATTACHMENT_TEXT_SIZE } from '../../shared/localMedia'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() },
  shell: {}, app: {}, net: {},
}))
vi.mock('../ipc/senderSecurity', async importOriginal => ({
  ...await importOriginal<typeof import('../ipc/senderSecurity')>(), validateSenderReadPath: vi.fn(),
}))
vi.mock('../localResourceResolver', () => ({ resolveAuthorizedWorkspaceResource: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})
import { open } from 'node:fs/promises'
import { validateSenderReadPath } from '../ipc/senderSecurity'
import { resolveAuthorizedWorkspaceResource } from '../localResourceResolver'
import { registerDataHandlers } from '../ipc/dataHandlers'

let directory = ''
beforeEach(() => vi.clearAllMocks())
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(open).mockImplementation(actual.open)
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
})

async function fixture() {
  await mkdir(path.join(process.cwd(), '.tmp'), { recursive: true })
  directory = await mkdtemp(path.join(process.cwd(), '.tmp', 'heading-snapshot-'))
  const source = path.join(directory, 'A.md'), target = path.join(directory, 'B.md')
  await writeFile(source, '# A')
  await writeFile(target, '# B\n\n## Heading')
  const window = { id: 1, isDestroyed: () => false }
  const workspace = { id: 'owned', primaryRoot: directory, lifecycleEpoch: 1 }
  let generation = 1
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as any)
  vi.mocked(validateSenderReadPath).mockImplementation(async (_ctx, _event, value) => value)
  vi.mocked(resolveAuthorizedWorkspaceResource).mockResolvedValue({
    canonicalPath: target, canonicalRoot: directory, workspaceId: 'owned', lifecycleEpoch: 1, markdownPath: source,
  })
  registerDataHandlers({ windowManager: {
    getActiveWorkspaceId: () => 'owned', getWorkspace: () => workspace,
    getLinkReadActivationGeneration: () => generation,
  } } as any)
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'navigate:resolveMdLink')![1]
  const event = { sender: { id: 9, isDestroyed: () => false } } as Electron.IpcMainInvokeEvent
  return { target, resolve: (href: string) => handler(event, source, href), revoke: () => { generation++ } }
}

describe('旧标题定位的严格根授权快照', () => {
  it.each(['./B.md#heading', 'wiki:B.md%23heading'])('%s从有界安全正文计算标题', async href => {
    const f = await fixture()
    expect(await f.resolve(href)).toMatchObject({ success: true, targetLine: 3, headingId: 'heading' })
  })
  it.each(['./B.md#heading', 'wiki:B.md%23heading'])('%s不忽略预算、UTF-8或NUL失败', async href => {
    const f = await fixture()
    await writeFile(f.target, Buffer.alloc(MAX_LOCAL_ATTACHMENT_TEXT_SIZE + 1, 97))
    expect(await f.resolve(href)).toMatchObject({ success: false })
    expect(open).not.toHaveBeenCalled()
    for (const content of [Buffer.from([0xff]), Buffer.from('a\0b')]) {
      await writeFile(f.target, content)
      expect(await f.resolve(href)).toMatchObject({ success: false })
    }
  })
  it.each(['./B.md#heading', 'wiki:B.md%23heading'])('%s在fd.close后切工作区不能交付标题', async href => {
    const f = await fixture()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args), close = handle.close.bind(handle)
      handle.close = async () => { await close(); f.revoke() }
      return handle
    })
    expect(await f.resolve(href)).toMatchObject({ success: false })
  })
})
