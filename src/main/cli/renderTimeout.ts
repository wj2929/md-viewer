export const DEFAULT_HEADLESS_RENDER_TIMEOUT_MS = 120000

export function getHeadlessRenderTimeoutMs(flags: Record<string, string | boolean>): number {
  return parsePositiveInteger(flags['timeout-ms'])
    ?? parsePositiveInteger(flags.timeout)
    ?? DEFAULT_HEADLESS_RENDER_TIMEOUT_MS
}

function parsePositiveInteger(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
