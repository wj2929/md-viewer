const MAX_CONCURRENT_REQUESTS = 2
const MAX_CACHE_ENTRIES = 150

interface QueuedRequest {
  key: string
  run: () => Promise<string>
  resolve: (value: string) => void
  reject: (reason?: unknown) => void
}

const queue: QueuedRequest[] = []
const inFlight = new Map<string, Promise<string>>()
const successCache = new Map<string, string>()
let activeRequests = 0

function rememberSuccess(key: string, svg: string): void {
  successCache.delete(key)
  successCache.set(key, svg)
  if (successCache.size <= MAX_CACHE_ENTRIES) return
  const oldestKey = successCache.keys().next().value
  if (oldestKey !== undefined) successCache.delete(oldestKey)
}

function drainQueue(): void {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && queue.length > 0) {
    const task = queue.shift()
    if (!task) return
    activeRequests += 1
    void Promise.resolve()
      .then(task.run)
      .then(svg => {
        rememberSuccess(task.key, svg)
        task.resolve(svg)
      })
      .catch(task.reject)
      .finally(() => {
        activeRequests -= 1
        inFlight.delete(task.key)
        drainQueue()
      })
  }
}

export function scheduleRemoteChartRequest(
  key: string,
  run: () => Promise<string>,
): Promise<string> {
  const cached = successCache.get(key)
  if (cached !== undefined) {
    successCache.delete(key)
    successCache.set(key, cached)
    return Promise.resolve(cached)
  }

  const existing = inFlight.get(key)
  if (existing) return existing

  const request = new Promise<string>((resolve, reject) => {
    queue.push({ key, run, resolve, reject })
    drainQueue()
  })
  inFlight.set(key, request)
  return request
}

export function createRemoteChartRequestKey(
  service: string,
  endpoint: string,
  typeOrFormat: string,
  source: string,
): string {
  return [service, endpoint.replace(/\/+$/, ''), typeOrFormat, source.trim()].join('\u001f')
}

export function clearRemoteChartResultCache(): void {
  successCache.clear()
}

export function clearRemoteChartRequestState(): void {
  queue.splice(0, queue.length)
  inFlight.clear()
  successCache.clear()
  activeRequests = 0
}

export function getRemoteChartRequestState(): {
  activeRequests: number
  queuedRequests: number
  inFlightRequests: number
  cachedResults: number
} {
  return {
    activeRequests,
    queuedRequests: queue.length,
    inFlightRequests: inFlight.size,
    cachedResults: successCache.size,
  }
}
