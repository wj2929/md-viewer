import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { runWatchCommand } from '../cli/watchCommand'

let tempDir: string | null = null

async function createFixture(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-watch-'))
  await mkdir(path.join(tempDir, 'nested'))
  return tempDir
}

function createIo() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
  }
}

function events(stdout: string[]): Array<Record<string, unknown>> {
  return stdout.flatMap(chunk => chunk.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
}

afterEach(async () => {
  vi.useRealTimers()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('watchCommand', () => {
  it('输出 initial/ready/change/stopped 且每行都是独立 JSON', async () => {
    const root = await createFixture()
    const initialPath = path.join(root, 'initial.md')
    await writeFile(initialPath, '# Initial')
    const { io, stdout, stderr } = createIo()
    const running = runWatchCommand([root], { jsonl: true, 'max-events': '1' }, io)

    await waitFor(() => events(stdout).some(event => event.event === 'ready'))
    await writeFile(initialPath, '# Changed')
    const exitCode = await running
    const output = events(stdout)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(output.map(event => event.event)).toEqual(expect.arrayContaining(['initial', 'ready', 'changed', 'stopped']))
    expect(output.at(-1)).toMatchObject({ event: 'stopped', reason: 'max-events' })
    expect(output.every(event => event.schemaVersion === '1.0')).toBe(true)
    expect(output.map(event => event.sequence)).toEqual(output.map((_, index) => index + 1))
  })

  it('rename 同时保留 remove/add 原始事件并标记 inferred', async () => {
    const root = await createFixture()
    const oldPath = path.join(root, 'old.md')
    const newPath = path.join(root, 'new.md')
    await writeFile(oldPath, '# Old')
    const { io, stdout } = createIo()
    const running = runWatchCommand([root], { jsonl: true, 'max-events': '3' }, io)

    await waitFor(() => events(stdout).some(event => event.event === 'ready'))
    await rename(oldPath, newPath)
    await running
    const output = events(stdout)

    expect(output).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'removed', relativePath: 'old.md' }),
      expect.objectContaining({ event: 'added', relativePath: 'new.md' }),
      expect.objectContaining({ event: 'renamed', inferred: true, oldRelativePath: 'old.md', relativePath: 'new.md' }),
    ]))
  })

  it('timeout 正常关闭 watcher', async () => {
    const root = await createFixture()
    const { io, stdout } = createIo()
    const exitCode = await runWatchCommand([root], { jsonl: true, timeout: '80' }, io)

    expect(exitCode).toBe(0)
    expect(events(stdout).at(-1)).toMatchObject({ event: 'stopped', reason: 'timeout' })
  })

  it('缺少 --jsonl 或输入时输出结构化错误', async () => {
    const root = await createFixture()
    const withoutJsonl = createIo()
    expect(await runWatchCommand([root], {}, withoutJsonl.io)).toBe(2)
    expect(events(withoutJsonl.stdout)[0]).toMatchObject({ event: 'error', code: 'INVALID_ARGUMENT' })

    const withoutInput = createIo()
    expect(await runWatchCommand([], { jsonl: true }, withoutInput.io)).toBe(2)
    expect(events(withoutInput.stdout)[0]).toMatchObject({ event: 'error', code: 'INVALID_ARGUMENT' })
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for watch event')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
