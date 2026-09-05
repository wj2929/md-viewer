import { afterEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import {
  createDiagnosticsBundle,
  sanitizeBundleInput,
  type DiagnosticsBundleInput,
} from '../diagnostics/DiagnosticsService'

let tempDir: string | null = null

const SECRET_PATH = '/Users/private-user/Knowledge/secret-plan.md'
const SECRET_BODY = 'CANARY_MARKDOWN_BODY_DO_NOT_EXPORT'
const SECRET_KEY = 'sk-CANARY-API-KEY-DO-NOT-EXPORT'
const SECRET_URL = 'https://user:pass@example.test/v1?token=CANARY_QUERY#secret'

function fixture(): DiagnosticsBundleInput {
  return {
    app: {
      version: '2.8.0', electron: '39.2.7', node: '22.0.0', chrome: '140', platform: 'darwin', arch: 'arm64',
    },
    packaging: {
      packaged: true,
      runtimeDependencyCheck: 'passed',
      resourceCheck: 'passed',
      localeCheck: 'passed',
      fontCheck: 'passed',
    },
    index: {
      state: 'ready', generation: 3, indexedDocuments: 4, totalDocuments: 4, pendingDocuments: 0, errors: 0,
    },
    session: { schemaVersion: 1, windows: 1, workspaces: 2, tabs: 3, splitLeaves: 2 },
    docx: { configured: true, reachable: true, status: 'ok', version: '1.2.3' },
    tts: {
      providers: [
        { type: 'system', enabled: true, hasApiKey: false },
        { type: 'openai', enabled: true, hasApiKey: true },
      ],
    },
    errors: [{ category: 'read-failed', code: 'EACCES', path: SECRET_PATH }],
  }
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('DiagnosticsService', () => {
  it('仅输出字段白名单并对路径使用 bundle-local token', () => {
    const input = fixture() as DiagnosticsBundleInput & Record<string, unknown>
    input.markdownBody = SECRET_BODY
    input.apiKey = SECRET_KEY
    input.serverUrl = SECRET_URL

    const first = sanitizeBundleInput(input, Buffer.alloc(32, 1))
    const second = sanitizeBundleInput(input, Buffer.alloc(32, 2))
    const serialized = JSON.stringify(first)

    expect(serialized).not.toContain(SECRET_PATH)
    expect(serialized).not.toContain('secret-plan.md')
    expect(serialized).not.toContain(SECRET_BODY)
    expect(serialized).not.toContain(SECRET_KEY)
    expect(serialized).not.toContain(SECRET_URL)
    expect(first).not.toHaveProperty('markdownBody')
    expect(first).not.toHaveProperty('apiKey')
    expect(first).not.toHaveProperty('serverUrl')
    expect((first.errors as any[])[0].pathToken).toMatch(/^path_[a-f0-9]{24}$/)
    expect((first.errors as any[])[0].pathToken).not.toBe((second.errors as any[])[0].pathToken)
    expect(first.tts).toEqual({
      providerCounts: { system: 1, edge: 0, openai: 1, azure: 0 },
      enabled: 2,
      paidProvidersWithApiKey: 1,
    })
  })

  it('生成固定 entry 的 ZIP 且原始字节不含 canary', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-diagnostics-'))
    const output = path.join(tempDir, 'diagnostics.zip')
    const input = fixture() as DiagnosticsBundleInput & Record<string, unknown>
    input.markdownBody = SECRET_BODY
    input.apiKey = SECRET_KEY
    input.serverUrl = SECRET_URL

    const result = await createDiagnosticsBundle(output, input)
    const zip = new AdmZip(output)
    const names = zip.getEntries().map(entry => entry.entryName).sort()
    const raw = await readFile(output)
    const diagnostics = zip.readAsText('diagnostics.json')

    expect(result.entries.sort()).toEqual(['README.txt', 'diagnostics.json'])
    expect(names).toEqual(['README.txt', 'diagnostics.json'])
    expect(raw.includes(Buffer.from(SECRET_BODY))).toBe(false)
    expect(raw.includes(Buffer.from(SECRET_KEY))).toBe(false)
    expect(raw.includes(Buffer.from(SECRET_PATH))).toBe(false)
    expect(diagnostics).not.toContain(SECRET_URL)
  })
})
