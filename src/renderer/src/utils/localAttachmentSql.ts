import type { SqlFormatResult } from './localAttachmentSqlFormat'

export type { SqlFormatResult }

export function requestAttachmentSqlFormat(source: string, signal: AbortSignal): Promise<SqlFormatResult> {
  if (signal.aborted) return Promise.resolve({ content: source, reason: 'unavailable' })
  if (source.length > 128 * 1024 || new TextEncoder().encode(source).length > 128 * 1024) {
    return Promise.resolve({ content: source, reason: 'budget' })
  }
  return new Promise(resolve => {
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let finished = false
    const finish = (result: SqlFormatResult) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      worker?.terminate()
      resolve(result)
    }
    const cancel = () => finish({ content: source, reason: 'unavailable' })
    try {
      worker = new Worker(new URL('../workers/attachmentSqlWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<SqlFormatResult>) => finish(event.data)
      worker.onerror = event => { event.preventDefault(); cancel() }
      worker.onmessageerror = cancel
      signal.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(cancel, 1500)
      worker.postMessage(source)
    } catch { cancel() }
  })
}
