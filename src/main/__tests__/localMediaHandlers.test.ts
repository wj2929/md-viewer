import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Session } from 'electron'
import { shell } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}))
vi.mock('../ipc/senderSecurity', () => ({ validateSenderReadPath: vi.fn() }))

import { validateSenderReadPath } from '../ipc/senderSecurity'
import { issueLocalMediaUrl, readLocalWebVtt, revealLocalResource } from '../ipc/localMediaHandlers'
import { MAX_LOCAL_WEBVTT_SIZE } from '../../shared/localMedia'
import {
  MAX_LOCAL_MEDIA_CAPABILITIES_PER_SESSION,
  getLocalMediaCapabilities,
  revokeLocalMediaCapabilities,
} from '../localMediaProtocol'

let fixtureRoot: string | null = null

async function setupFixture() {
  const temporaryRoot = path.join(process.cwd(), '.tmp')
  await mkdir(temporaryRoot, { recursive: true })
  fixtureRoot = await mkdtemp(path.join(temporaryRoot, 'media-handler-test-'))
  const markdownPath = path.join(fixtureRoot, 'notes', 'source.md')
  await mkdir(path.dirname(markdownPath), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'notes', 'videos'), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'media'), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'captions'), { recursive: true })
  await writeFile(markdownPath, '# Source')
  await writeFile(path.join(fixtureRoot, 'notes', 'nearby.mp3'), 'nearby audio')
  await writeFile(path.join(fixtureRoot, 'notes', 'videos', 'nested.mp3'), 'nested nearby audio')
  await writeFile(path.join(fixtureRoot, 'media', 'sample.mp3'), 'audio bytes')
  await writeFile(path.join(fixtureRoot, 'captions', 'zh.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\n你好')

  const targetSession = {} as Session
  const event = { sender: { id: 9, session: targetSession } } as Electron.IpcMainInvokeEvent
  const ctx = {
    windowManager: {
      getWindowByWebContentsId: vi.fn(() => ({ id: 3 })),
      listWorkspaces: vi.fn(() => [{
        id: 'workspace-a',
        primaryRoot: fixtureRoot,
        lifecycleEpoch: 7,
      }]),
    },
  } as any
  vi.mocked(validateSenderReadPath).mockResolvedValue(markdownPath)
  return { ctx, event, markdownPath, targetSession }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = null
})

describe('localMediaHandlers', () => {
  it('issues and reuses a session-scoped capability with fixed MIME and workspace epoch', async () => {
    const { ctx, event, markdownPath, targetSession } = await setupFixture()
    const first = await issueLocalMediaUrl(
      ctx, event, markdownPath, '../media/sample.mp3', 'audio', 'markdown-relative',
    )
    const second = await issueLocalMediaUrl(
      ctx, event, markdownPath, '../media/sample.mp3', 'audio', 'markdown-relative',
    )

    expect(first).toBe(second)
    expect(first).toMatch(/^local-media:\/\/asset\/[A-Za-z0-9_-]{43}$/)
    const capabilities = getLocalMediaCapabilities(targetSession)
    expect(capabilities.size).toBe(1)
    expect([...capabilities.values()][0]).toMatchObject({
      workspaceId: 'workspace-a', lifecycleEpoch: 7, kind: 'audio', mimeType: 'audio/mpeg',
    })
    revokeLocalMediaCapabilities(targetSession)
  })

  it('enforces media kind, workspace containment and the per-session token limit', async () => {
    const { ctx, event, markdownPath, targetSession } = await setupFixture()
    await expect(issueLocalMediaUrl(
      ctx, event, markdownPath, '../media/sample.mp3', 'video', 'markdown-relative',
    )).rejects.toThrow('不支持的本地媒体类型')
    await expect(issueLocalMediaUrl(
      ctx, event, markdownPath, '../../../outside.mp3', 'audio', 'markdown-relative',
    )).rejects.toThrow('本地资源不存在或不在工作区内')

    const capabilities = getLocalMediaCapabilities(targetSession)
    for (let index = 0; index < MAX_LOCAL_MEDIA_CAPABILITIES_PER_SESSION; index += 1) {
      capabilities.set(String(index), {
        canonicalPath: `/unrelated/${index}.mp3`,
        canonicalRoot: fixtureRoot!,
        workspaceId: 'workspace-a',
        lifecycleEpoch: 7,
        kind: 'audio',
        mimeType: 'audio/mpeg',
        expiresAt: Date.now() + 60_000,
      })
    }
    await expect(issueLocalMediaUrl(
      ctx, event, markdownPath, '../media/sample.mp3', 'audio', 'markdown-relative',
    )).rejects.toThrow('数量超过当前窗口限制')
    revokeLocalMediaCapabilities(targetSession)
  })

  it('coalesces concurrent Wiki basename resolution and reuses one capability', async () => {
    const { ctx, event, markdownPath, targetSession } = await setupFixture()
    const urls = await Promise.all(Array.from({ length: 8 }, () => issueLocalMediaUrl(
      ctx, event, markdownPath, 'sample.mp3', 'audio', 'workspace-wiki',
    )))

    expect(new Set(urls).size).toBe(1)
    expect(getLocalMediaCapabilities(targetSession).size).toBe(1)
    revokeLocalMediaCapabilities(targetSession)
  })

  it('resolves Wiki media by nearby file and rejects ambiguous basenames', async () => {
    const { ctx, event, markdownPath, targetSession } = await setupFixture()
    const nearby = await issueLocalMediaUrl(
      ctx, event, markdownPath, 'nearby.mp3', 'audio', 'workspace-wiki',
    )
    expect(nearby).toMatch(/^local-media:\/\/asset\//)

    await mkdir(path.join(fixtureRoot!, 'one'), { recursive: true })
    await mkdir(path.join(fixtureRoot!, 'two'), { recursive: true })
    await writeFile(path.join(fixtureRoot!, 'one', 'duplicate.mp3'), 'one')
    await writeFile(path.join(fixtureRoot!, 'two', 'duplicate.mp3'), 'two')
    await expect(issueLocalMediaUrl(
      ctx, event, markdownPath, 'duplicate.mp3', 'audio', 'workspace-wiki',
    )).rejects.toThrow('目标不唯一')
    revokeLocalMediaCapabilities(targetSession)
  })

  it('resolves Wiki paths with directories relative to the source before the workspace root', async () => {
    const { ctx, event, markdownPath, targetSession } = await setupFixture()
    const url = await issueLocalMediaUrl(
      ctx, event, markdownPath, 'videos/nested.mp3', 'audio', 'workspace-wiki',
    )

    expect(url).toMatch(/^local-media:\/\/asset\//)
    expect([...getLocalMediaCapabilities(targetSession).values()][0]?.canonicalPath)
      .toBe(path.join(fixtureRoot!, 'notes', 'videos', 'nested.mp3'))
    revokeLocalMediaCapabilities(targetSession)
  })

  it('reveals only a resource resolved inside the sender workspace', async () => {
    const { ctx, event, markdownPath } = await setupFixture()
    await expect(revealLocalResource(
      ctx, event, markdownPath, 'media/sample.mp3', 'workspace-wiki',
    )).resolves.toEqual({ success: true })
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path.join(fixtureRoot!, 'media', 'sample.mp3'))

    await expect(revealLocalResource(
      ctx, event, markdownPath, '../../../outside.pdf', 'workspace-wiki',
    )).rejects.toThrow('本地资源不存在或不在工作区内')
    expect(shell.showItemInFolder).toHaveBeenCalledTimes(1)
  })

  it('reads only bounded, UTF-8 WebVTT files with a WEBVTT header', async () => {
    const { ctx, event, markdownPath } = await setupFixture()
    await expect(readLocalWebVtt(
      ctx, event, markdownPath, '../captions/zh.vtt', 'markdown-relative',
    )).resolves.toContain('WEBVTT')

    await writeFile(path.join(fixtureRoot!, 'captions', 'bad.vtt'), Buffer.from([0xff, 0xfe]))
    await expect(readLocalWebVtt(
      ctx, event, markdownPath, '../captions/bad.vtt', 'markdown-relative',
    )).rejects.toThrow('UTF-8')
    await writeFile(path.join(fixtureRoot!, 'captions', 'wrong.vtt'), 'not webvtt')
    await expect(readLocalWebVtt(
      ctx, event, markdownPath, '../captions/wrong.vtt', 'markdown-relative',
    )).rejects.toThrow('不是有效的 WebVTT')

    const maximum = Buffer.alloc(MAX_LOCAL_WEBVTT_SIZE, 0x20)
    Buffer.from('WEBVTT').copy(maximum)
    await writeFile(path.join(fixtureRoot!, 'captions', 'maximum.vtt'), maximum)
    await expect(readLocalWebVtt(
      ctx, event, markdownPath, '../captions/maximum.vtt', 'markdown-relative',
    )).resolves.toHaveLength(MAX_LOCAL_WEBVTT_SIZE)

    const oversized = Buffer.alloc(MAX_LOCAL_WEBVTT_SIZE + 1, 0x20)
    Buffer.from('WEBVTT').copy(oversized)
    await writeFile(path.join(fixtureRoot!, 'captions', 'oversized.vtt'), oversized)
    await expect(readLocalWebVtt(
      ctx, event, markdownPath, '../captions/oversized.vtt', 'markdown-relative',
    )).rejects.toThrow('超过大小限制')
  })
})
