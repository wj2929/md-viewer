import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearRemoteChartRequestState,
  createRemoteChartRequestKey,
  getRemoteChartRequestState,
  scheduleRemoteChartRequest,
} from '../../src/utils/remoteChartRequestScheduler'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('remoteChartRequestScheduler', () => {
  afterEach(() => clearRemoteChartRequestState())

  it('limits requests to two and advances the FIFO queue after completion', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const third = deferred<string>()
    const started: string[] = []
    let peak = 0
    const run = (name: string, task: ReturnType<typeof deferred<string>>) => async () => {
      started.push(name)
      peak = Math.max(peak, getRemoteChartRequestState().activeRequests)
      return task.promise
    }

    const a = scheduleRemoteChartRequest('a', run('a', first))
    const b = scheduleRemoteChartRequest('b', run('b', second))
    const c = scheduleRemoteChartRequest('c', run('c', third))
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']))

    first.resolve('<svg>a</svg>')
    await vi.waitFor(() => expect(started).toEqual(['a', 'b', 'c']))
    second.resolve('<svg>b</svg>')
    third.resolve('<svg>c</svg>')

    await expect(Promise.all([a, b, c])).resolves.toEqual(['<svg>a</svg>', '<svg>b</svg>', '<svg>c</svg>'])
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('deduplicates in-flight work and reuses only successful cached results', async () => {
    const request = deferred<string>()
    const run = vi.fn(() => request.promise)
    const first = scheduleRemoteChartRequest('same', run)
    const duplicate = scheduleRemoteChartRequest('same', run)
    expect(duplicate).toBe(first)
    request.resolve('<svg>ok</svg>')
    await expect(first).resolves.toBe('<svg>ok</svg>')

    await expect(scheduleRemoteChartRequest('same', run)).resolves.toBe('<svg>ok</svg>')
    expect(run).toHaveBeenCalledTimes(1)

    const failing = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('<svg>retry</svg>')
    await expect(scheduleRemoteChartRequest('failure', failing)).rejects.toThrow('offline')
    await expect(scheduleRemoteChartRequest('failure', failing)).resolves.toBe('<svg>retry</svg>')
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it('continues the queue after a request fails', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const started: string[] = []
    const failed = scheduleRemoteChartRequest('failed', async () => {
      started.push('failed')
      return first.promise
    })
    const active = scheduleRemoteChartRequest('active', async () => {
      started.push('active')
      return second.promise
    })
    const queued = scheduleRemoteChartRequest('queued', async () => {
      started.push('queued')
      return '<svg>queued</svg>'
    })

    await vi.waitFor(() => expect(started).toEqual(['failed', 'active']))
    first.reject(new Error('timeout'))
    await expect(failed).rejects.toThrow('timeout')
    await vi.waitFor(() => expect(started).toContain('queued'))
    second.resolve('<svg>active</svg>')
    await expect(Promise.all([active, queued])).resolves.toEqual(['<svg>active</svg>', '<svg>queued</svg>'])
  })

  it('isolates cache keys by service endpoint, type and source', () => {
    expect(createRemoteChartRequestKey('plantuml', 'https://a.example/', 'plantuml', 'A -> B'))
      .not.toBe(createRemoteChartRequestKey('plantuml', 'https://b.example', 'plantuml', 'A -> B'))
    expect(createRemoteChartRequestKey('kroki', 'https://a.example', 'graphviz', 'A -> B'))
      .not.toBe(createRemoteChartRequestKey('kroki', 'https://a.example', 'd2', 'A -> B'))
  })
})
