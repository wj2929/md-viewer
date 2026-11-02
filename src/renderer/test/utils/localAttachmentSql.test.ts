import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestAttachmentSqlFormat } from '../../src/utils/localAttachmentSql'

class TestWorker {
  static instances: TestWorker[] = []
  constructor() { TestWorker.instances.push(this) }
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: { preventDefault: () => void }) => void
  onmessageerror?: () => void
  terminate = vi.fn()
  postMessage = vi.fn()
}

beforeEach(() => {
  TestWorker.instances = []
  vi.stubGlobal('Worker', TestWorker)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('SQL格式化Worker生命周期', () => {
  it('完成后终止Worker，传入原文且只返回本次结果', async () => {
    const controller = new AbortController()
    const result = requestAttachmentSqlFormat('select 1;', controller.signal)
    const worker = TestWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith('select 1;')
    worker.onmessage?.({ data: { content: 'select\n  1;' } })
    await expect(result).resolves.toEqual({ content: 'select\n  1;' })
    expect(worker.terminate).toHaveBeenCalledOnce()
    controller.abort()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('取消会结束等待并终止Worker，迟到结果不再返回', async () => {
    const controller = new AbortController()
    const result = requestAttachmentSqlFormat('original', controller.signal)
    const worker = TestWorker.instances[0]
    controller.abort()
    worker.onmessage?.({ data: { content: 'late' } })
    await expect(result).resolves.toEqual({ content: 'original', reason: 'unavailable' })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('超时、运行错误或消息错误完整退回原文', async () => {
    vi.useFakeTimers()
    const timeout = requestAttachmentSqlFormat('timeout', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(timeout).resolves.toEqual({ content: 'timeout', reason: 'unavailable' })
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
    const failed = requestAttachmentSqlFormat('error', new AbortController().signal)
    const preventDefault = vi.fn()
    TestWorker.instances[1].onerror?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    await expect(failed).resolves.toEqual({ content: 'error', reason: 'unavailable' })
    const badMessage = requestAttachmentSqlFormat('message', new AbortController().signal)
    TestWorker.instances[2].onmessageerror?.()
    await expect(badMessage).resolves.toEqual({ content: 'message', reason: 'unavailable' })
    expect(TestWorker.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true)
  })

  it('已取消或超过UTF-8预算时不创建Worker', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(requestAttachmentSqlFormat('x', controller.signal)).resolves.toEqual({ content: 'x', reason: 'unavailable' })
    const source = '中'.repeat(44_000)
    await expect(requestAttachmentSqlFormat(source, new AbortController().signal)).resolves.toEqual({ content: source, reason: 'budget' })
    expect(TestWorker.instances).toHaveLength(0)
  })

  it('Worker无法创建时不抛错或丢失原文', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('fixture') } })
    await expect(requestAttachmentSqlFormat('source', new AbortController().signal)).resolves.toEqual({ content: 'source', reason: 'unavailable' })
  })
})
