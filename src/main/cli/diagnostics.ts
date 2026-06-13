export interface DocxServiceStatus {
  ok: boolean
  url: string
  version?: string
  mode?: string
  error?: string
}

export function getRuntimeDiagnostics() {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  }
}

export async function checkDocxService(url: string): Promise<DocxServiceStatus> {
  const normalizedUrl = url.replace(/\/+$/, '')

  try {
    const response = await fetch(`${normalizedUrl}/healthz`)
    if (!response.ok) {
      return {
        ok: false,
        url: normalizedUrl,
        error: `HTTP ${response.status}`,
      }
    }

    const body = await response.json().catch(() => ({}))
    return {
      ok: true,
      url: normalizedUrl,
      version: typeof body.version === 'string' ? body.version : undefined,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
    }
  } catch (error) {
    return {
      ok: false,
      url: normalizedUrl,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
