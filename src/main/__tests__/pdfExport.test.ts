import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import type { PdfWorkerRequest } from '../pdf/pdfExport'

vi.mock('electron', () => ({ app: { isPackaged: true, once: vi.fn() } }))
vi.mock('node:child_process', () => ({ spawn: vi.fn((_exe, args) => fakeSpawn(args)) }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

const layoutSha256 = 'a'.repeat(64)
let requests: PdfWorkerRequest[]
let roots: string[]
let active: number
let maximumActive: number
let nativeFailure: boolean
let totalPages: number
let respond: (request: PdfWorkerRequest, child: FakeChild) => Promise<void>
let exportPdfSnapshot: typeof import('../pdf/pdfExport').exportPdfSnapshot
let temporary: string

class FakeChild extends EventEmitter {
  pid: number | undefined = 12345
  closed = false
  exitOnlyOnKill = false
  root: string
  constructor(readonly args: string[]) {
    super()
    this.root = path.dirname(args.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length))
    roots.push(this.root)
    active++
    maximumActive = Math.max(maximumActive, active)
    queueMicrotask(() => this.message({ type: 'ready' }))
  }
  message(message: Record<string, unknown>): void {
    if (this.closed) return
    this.emit('message', { jobId: this.args.find(arg => arg.startsWith('--md-viewer-pdf-helper='))!.split('=')[1], ...message })
  }
  send(request: PdfWorkerRequest, callback: (error: Error | null) => void): void {
    requests.push(request)
    callback(null)
    void respond(request, this)
  }
  kill(): boolean {
    queueMicrotask(() => this.exitOnlyOnKill ? this.exitWithoutClose(1) : this.close(1))
    return true
  }
  exitWithoutClose(code: number): void {
    if (this.closed) return
    this.closed = true
    active--
    this.emit('disconnect')
    this.emit('exit', code)
  }
  close(code: number): void {
    if (this.closed) return
    this.closed = true
    active--
    this.emit('close', code)
  }
  fail(code: string): void {
    this.message({ type: 'part', layoutSha256, selfContained: true })
    this.message({ type: 'failure', code })
  }
  async complete(request: PdfWorkerRequest, withoutClose = false): Promise<void> {
    const range = request.operation === 'print' ? request.range : undefined
    if (range && range.start > totalPages) return this.fail('range')
    const pages = request.operation === 'merge' ? request.parts.reduce((sum, part) => sum + part.pages, 0) :
      range ? Math.min(range.end, totalPages) - range.start + 1 : totalPages
    const file = request.operation === 'merge' ? 'merged.pdf' : range ? `part-${range.start}-${range.end}.pdf` : 'whole.pdf'
    const bytes = Buffer.from(`%PDF-test ${request.jobId} ${file} ${pages}`)
    await writeFile(path.join(this.root, file), bytes)
    this.message({ type: 'complete', file, pages, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), layoutSha256, selfContained: true })
    if (withoutClose) this.exitWithoutClose(0)
    else this.close(0)
  }
}
function fakeSpawn(args: string[]): FakeChild { return new FakeChild(args) }

beforeEach(async () => {
  vi.resetModules()
  vi.mocked(app.once).mockClear()
  vi.mocked(rename).mockClear()
  temporary = await mkdtemp(path.join(tmpdir(), 'mdv-pdf-parent-test-'))
  requests = []
  roots = []
  active = 0
  maximumActive = 0
  nativeFailure = false
  totalPages = 1
  respond = async (request, child) => {
    if (request.operation === 'print' && !request.range && nativeFailure) child.fail('printing')
    else await child.complete(request)
  }
  ;({ exportPdfSnapshot } = await import('../pdf/pdfExport'))
})
afterEach(async () => {
  vi.useRealTimers()
  vi.mocked(rename).mockRestore()
  await rm(temporary, { recursive: true, force: true })
})
const output = (): string => path.join(temporary, 'report.pdf')
const run = (signal?: AbortSignal): Promise<unknown> => exportPdfSnapshot(output(), '<p>fixture</p>', 'fixture', signal)

describe('isolated PDF parent', () => {
  it('returns the whole native output unchanged without merge and cleans its own directory', async () => {
    const result = await run()
    expect(result).toMatchObject({ type: 'pdf', path: output() })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ operation: 'print' })
    expect(await readFile(output(), 'utf8')).toContain('whole.pdf 1')
    await expect(readdir(roots[0])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('settles an unexpected disconnect and exit without close, preserves the target and recovers its queue', async () => {
    await writeFile(output(), 'existing target')
    respond = async (_request, child) => child.exitWithoutClose(1)
    await expect(run()).rejects.toMatchObject({ code: 'startup' })
    expect(await readFile(output(), 'utf8')).toBe('existing target')
    expect(active).toBe(0)
    respond = async (request, child) => child.complete(request)
    await expect(run()).resolves.toMatchObject({ type: 'pdf' })
    expect(requests).toHaveLength(2)
  })

  it('accepts a complete result followed by disconnect and exit without close', async () => {
    respond = async (request, child) => child.complete(request, true)
    await expect(run()).resolves.toMatchObject({ type: 'pdf' })
    expect(await readFile(output(), 'utf8')).toContain('whole.pdf 1')
    expect(active).toBe(0)
    await expect(readdir(roots[0])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('drains an in-flight complete message after exit instead of rejecting it prematurely', async () => {
    respond = async (request, child) => {
      child.emit('exit', 0)
      await child.complete(request, true)
    }
    await expect(run()).resolves.toMatchObject({ type: 'pdf' })
    expect(active).toBe(0)
  })

  it('bounds IPC draining when exit has neither disconnect nor close', async () => {
    vi.useFakeTimers()
    respond = async (_request, child) => {
      child.closed = true
      active--
      child.emit('exit', 1)
    }
    const expectation = expect(run()).rejects.toMatchObject({ code: 'startup' })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(1_000)
    await expectation
    expect(active).toBe(0)
  })

  it.each([1, 16, 17, 32, 33])('recovers %i pages with contiguous ranges and strict EOF at exact boundaries', async pages => {
    nativeFailure = true
    totalPages = pages
    await run()
    const merge = requests.at(-1)!
    expect(merge.operation).toBe('merge')
    if (merge.operation !== 'merge') throw new Error('missing merge')
    expect(merge.parts.reduce((sum, part) => sum + part.pages, 0)).toBe(pages)
    expect(merge.parts.map(part => part.start)).toEqual(Array.from({ length: Math.ceil(pages / 16) }, (_, i) => i * 16 + 1))
    expect(requests.length).toBe(Math.ceil(pages / 16) + 2 + (pages % 16 === 0 ? 1 : 0))
    expect(maximumActive).toBe(1)
  })

  it('halves only the failed range, never skips a page, and uses fresh helpers', async () => {
    totalPages = 9
    respond = async (request, child) => {
      if (request.operation === 'print' && (!request.range || request.range.end - request.range.start >= 4)) child.fail('printing')
      else await child.complete(request)
    }
    await run()
    expect(requests.filter(request => request.operation === 'print').map(request => request.operation === 'print' ? request.range : null)).toEqual([
      undefined, { start: 1, end: 16 }, { start: 1, end: 8 }, { start: 1, end: 4 }, { start: 5, end: 8 }, { start: 9, end: 12 },
    ])
    expect(active).toBe(0)
  })

  it.each(['printing', 'range', 'snapshot', 'merge', 'layout'])('does not treat a first-range %s failure as EOF; preserves existing target', async code => {
    await writeFile(output(), 'existing target')
    respond = async (request, child) => {
      if (request.operation === 'print' && !request.range) child.fail('printing')
      else child.fail(code)
    }
    await expect(run()).rejects.toBeInstanceOf(Error)
    expect(await readFile(output(), 'utf8')).toBe('existing target')
    expect(requests.some(request => request.operation === 'merge')).toBe(false)
    expect(active).toBe(0)
  })

  it('does not swallow ordinary Printing failed after a successful prefix', async () => {
    totalPages = 16
    respond = async (request, child) => {
      if (request.operation === 'print' && (!request.range || request.range.start > 16)) child.fail('printing')
      else await child.complete(request)
    }
    await expect(run()).rejects.toMatchObject({ code: 'printing' })
    expect(requests.at(-1)).toMatchObject({ range: { start: 17, end: 17 } })
  })

  it('refuses remote snapshots after whole print failure without trying partial content', async () => {
    respond = async (_request, child) => {
      child.message({ type: 'part', layoutSha256, selfContained: false })
      child.message({ type: 'failure', code: 'printing' })
    }
    await expect(run()).rejects.toMatchObject({ code: 'remote' })
    expect(requests).toHaveLength(1)
  })

  it('rejects a changed layout and recovers its application queue after rejection', async () => {
    respond = async (request, child) => {
      if (request.operation === 'print' && !request.range) child.fail('printing')
      else child.fail('layout')
    }
    await expect(run()).rejects.toMatchObject({ code: 'layout' })
    respond = async (request, child) => child.complete(request)
    await expect(run()).resolves.toMatchObject({ type: 'pdf' })
  })

  it('serializes concurrent tasks without mixing job IDs, files or results', async () => {
    await Promise.all(Array.from({ length: 3 }, (_, i) => exportPdfSnapshot(path.join(temporary, `${i}.pdf`), `input-${i}`, `${i}`)))
    expect(maximumActive).toBe(1)
    expect(new Set(requests.map(request => request.jobId)).size).toBe(3)
    expect(new Set(roots).size).toBe(3)
    for (let i = 0; i < 3; i++) expect(await readFile(path.join(temporary, `${i}.pdf`), 'utf8')).toContain(requests[i].jobId)
  })

  it('cancels queued tasks immediately and terminates only the active owned child', async () => {
    let firstChild: FakeChild | undefined
    respond = async (_request, child) => { firstChild = child }
    const activeController = new AbortController()
    const first = run(activeController.signal)
    const firstExpectation = expect(first).rejects.toMatchObject({ code: 'aborted' })
    await vi.waitFor(() => expect(firstChild).toBeDefined())
    const queuedController = new AbortController()
    const second = run(queuedController.signal)
    queuedController.abort()
    await expect(second).rejects.toMatchObject({ code: 'aborted' })
    expect(requests).toHaveLength(1)
    firstChild!.exitOnlyOnKill = true
    activeController.abort()
    await firstExpectation
    respond = async (request, child) => child.complete(request)
    await run()
    expect(requests).toHaveLength(2)
    expect(active).toBe(0)
  })

  it('does not start queued helpers while the application is quitting', async () => {
    respond = async () => undefined
    const first = run()
    const firstResult = expect(first).rejects.toMatchObject({ code: 'aborted' })
    const second = run()
    const secondResult = expect(second).rejects.toMatchObject({ code: 'aborted' })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const quit = (vi.mocked(app.once).mock.calls as unknown as [string, () => void][]).find(([event]) => event === 'will-quit')![1]
    quit()
    await Promise.all([firstResult, secondResult])
    expect(requests).toHaveLength(1)
    expect(active).toBe(0)
  })

  it('times out a silent printing helper instead of treating silence as success', async () => {
    vi.useFakeTimers()
    respond = async () => undefined
    const task = run()
    const expectation = expect(task).rejects.toMatchObject({ code: 'timeout' })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(60_000)
    await expectation
    expect(active).toBe(0)
  })

  it('times out a silent helper whose termination emits exit but never close', async () => {
    vi.useFakeTimers()
    respond = async (_request, child) => { child.exitOnlyOnKill = true }
    const expectation = expect(run()).rejects.toMatchObject({ code: 'timeout' })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(60_000)
    await expectation
    expect(active).toBe(0)
  })

  it('handles a spawn error without waiting for a nonexistent process exit', async () => {
    respond = async (_request, child) => {
      child.pid = undefined
      child.closed = true
      active--
      child.emit('error', new Error('spawn failed'))
    }
    await expect(run()).rejects.toMatchObject({ code: 'startup' })
    expect(active).toBe(0)
  })

  it('shares one total deadline across recovery rather than resetting it for each segment', async () => {
    let now = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    totalPages = 33
    respond = async (request, child) => {
      if (request.operation === 'print' && !request.range) return child.fail('printing')
      if (request.operation === 'print') now = request.range!.start === 1 ? 100_000 : 200_000
      await child.complete(request)
    }
    try {
      await expect(run()).rejects.toMatchObject({ code: 'timeout' })
      expect(requests).toHaveLength(3)
      expect(requests.some(request => request.operation === 'merge')).toBe(false)
    } finally { clock.mockRestore() }
  })

  it('starts the deadline on dequeue, so a waiting export survives an earlier overdue task', async () => {
    let now = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    respond = async (request, child) => {
      if (requests.length === 1) now = 200_000
      await child.complete(request)
    }
    try {
      const first = run()
      const second = exportPdfSnapshot(path.join(temporary, 'second.pdf'), '<p>second</p>', 'second')
      await expect(first).rejects.toMatchObject({ code: 'timeout' })
      await expect(second).resolves.toMatchObject({ type: 'pdf' })
      expect(requests).toHaveLength(2)
    } finally { clock.mockRestore() }
  })

  it('validates the private response identity before accepting file data', async () => {
    respond = async (_request, child) => child.message({ type: 'complete', jobId: 'wrong' })
    await expect(run()).rejects.toMatchObject({ code: 'snapshot' })
  })

  it('preserves the original on atomic-save failure and removes only its temporary sibling', async () => {
    await writeFile(output(), 'existing target')
    vi.mocked(rename).mockRejectedValueOnce(new Error('/private/sensitive-path write failure'))
    await expect(run()).rejects.toMatchObject({ code: 'save', message: expect.not.stringContaining('sensitive-path') })
    expect(await readFile(output(), 'utf8')).toBe('existing target')
    expect(await readdir(temporary)).toEqual(['report.pdf'])
  })
})
