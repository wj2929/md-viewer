// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'os'
import path from 'path'
import type { PersistedDiagnosticEvent } from '../../shared/diagnostics'
import {
  createDiagnosticsBundle,
  sanitizeBundleEvent,
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
  it('相邻TTS本地主密钥及密文文件不进入诊断包', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-diagnostics-local-key-'))
    const folder = path.join(tempDir, 'tts-local')
    await mkdir(folder, { mode: 0o700 })
    const master = randomBytes(32)
    const cipher = 'CANARY_TTS_CIPHERTEXT_DO_NOT_EXPORT'
    await writeFile(path.join(folder, 'master.key'), master, { mode: 0o600 })
    await writeFile(path.join(folder, 'keys.json'), JSON.stringify({ cipher }), { mode: 0o600 })
    const input = fixture() as DiagnosticsBundleInput & Record<string, unknown>
    input.masterKey = master.toString('base64')
    input.localKeyStore = { cipher }
    const output = path.join(tempDir, 'diagnostics.zip')
    await createDiagnosticsBundle(output, input)
    const zip = new AdmZip(await readFile(output))
    expect(zip.getEntries().map(entry => entry.entryName).sort()).toEqual([
      'README.txt', 'diagnostics.json', 'performance-events.jsonl',
    ])
    for (const entry of zip.getEntries()) {
      const content = entry.getData()
      expect(content.includes(master)).toBe(false)
      expect(content.toString()).not.toContain(master.toString('base64'))
      expect(content.toString()).not.toContain(cipher)
    }
  })

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
    const raw = await readFile(output)
    const zip = new AdmZip(raw)
    const names = zip.getEntries().map(entry => entry.entryName).sort()
    const diagnostics = zip.readAsText('diagnostics.json')

    expect(result.entries.sort()).toEqual(['README.txt', 'diagnostics.json', 'performance-events.jsonl'])
    expect(names).toEqual(['README.txt', 'diagnostics.json', 'performance-events.jsonl'])
    expect(raw.includes(Buffer.from(SECRET_BODY))).toBe(false)
    expect(raw.includes(Buffer.from(SECRET_KEY))).toBe(false)
    expect(raw.includes(Buffer.from(SECRET_PATH))).toBe(false)
    expect(diagnostics).not.toContain(SECRET_URL)
  })

  it('session-only token 不会跨 boot 误关联', () => {
    const event: PersistedDiagnosticEvent = {
      schemaVersion: 1,
      event: 'file.io.summary',
      observedUnixMs: 1_700_000_000_000,
      monotonicMs: 42,
      processRole: 'main',
      processInstanceId: 'main_12345678',
      processSeq: 1,
      writerRecordedUnixMs: 1_700_000_000_001,
      bootId: 'boot_aabbccddeeff',
      tokenScope: 'session-only',
      pathToken: 'path_aabbccddeeff001122334455',
    }
    const key = Buffer.alloc(32, 7)
    const first = sanitizeBundleEvent(event, key)
    const second = sanitizeBundleEvent({ ...event, bootId: 'boot_001122334455' }, key)

    expect(first?.pathToken).toMatch(/^path_[a-f0-9]{24}$/)
    expect(second?.pathToken).toMatch(/^path_[a-f0-9]{24}$/)
    expect(first?.pathToken).not.toBe(second?.pathToken)
  })

  it('事件使用 bundle-local token，且导出摘要明确截断范围', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-diagnostics-events-'))
    const localToken = 'path_aabbccddeeff001122334455'
    const event: PersistedDiagnosticEvent = {
      schemaVersion: 1,
      event: 'file.io.summary',
      observedUnixMs: 1_700_000_000_000,
      monotonicMs: 42,
      processRole: 'main',
      processInstanceId: 'main_12345678',
      processSeq: 1,
      writerRecordedUnixMs: 1_700_000_000_001,
      bootId: 'boot_aabbccddeeff',
      tokenScope: 'installation',
      pathToken: localToken,
      outcome: 'success',
      metadata: { readWallMs: 12 },
    }
    const eventLog = {
      snapshot: {
        events: [event, { ...event, processSeq: 2, bootId: 'boot_001122334455' }],
        totalBytes: 512,
        invalidLines: 1,
        truncated: true,
        omittedFiles: 3,
        oldestEventUnixMs: event.observedUnixMs,
        newestEventUnixMs: event.observedUnixMs,
      },
      health: {
        eventsAccepted: 2,
        eventsWritten: 2,
        invalidEvents: 0,
        droppedEvents: 0,
        bytesWritten: 512,
        batchCount: 1,
        appendP95Ms: 1,
        appendMaxMs: 1,
        queueLagP95Ms: 2,
        queueLagMaxMs: 2,
        maxQueueBytes: 512,
        cleanupDurationMs: 0,
        destinationFallbacks: 0,
        writerWriteActive: false,
      },
    }
    const firstPath = path.join(tempDir, 'first.zip')
    const secondPath = path.join(tempDir, 'second.zip')

    expect(sanitizeBundleEvent(event, Buffer.alloc(32, 3))).not.toBeNull()
    await createDiagnosticsBundle(firstPath, fixture(), eventLog)
    await createDiagnosticsBundle(secondPath, fixture(), eventLog)
    const firstZip = new AdmZip(await readFile(firstPath))
    const secondZip = new AdmZip(await readFile(secondPath))
    const firstEventText = firstZip.readAsText('performance-events.jsonl')
    const firstEvents = firstEventText.trim().split('\n').map(line => JSON.parse(line))
    const secondEvents = secondZip.readAsText('performance-events.jsonl').trim().split('\n').map(line => JSON.parse(line))
    const summary = JSON.parse(firstZip.readAsText('diagnostics.json')).performanceEvents

    expect(firstEvents).toHaveLength(2)
    expect(firstEvents[0].pathToken).toMatch(/^path_[a-f0-9]{24}$/)
    expect(firstEvents[0].pathToken).toBe(firstEvents[1].pathToken)
    expect(firstEvents[0].pathToken).not.toBe(localToken)
    expect(secondEvents[0].pathToken).not.toBe(firstEvents[0].pathToken)
    expect(summary).toMatchObject({
      count: 2,
      truncated: true,
      omittedFiles: 3,
      invalidLines: 1,
      eventCounts: { 'file.io.summary': 2 },
      abnormalities: {
        errorEvents: 0,
        timeoutEvents: 0,
        unmatchedStarts: 0,
        slowFileOpens: 0,
        slowFolderOpens: 0,
        slowIndexWork: 0,
        rendererStalls: 0,
      },
      queryAggregation: { windows: 0, operations: 0, errors: 0, slow: 0 },
      writer: { scope: 'currentBoot' },
    })
  })

  it('诊断摘要直接标出慢操作、长任务、查询异常和未闭合 operation', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-diagnostics-summary-'))
    const base: PersistedDiagnosticEvent = {
      schemaVersion: 1,
      event: 'file.open.start',
      observedUnixMs: 1_700_000_000_000,
      monotonicMs: 10,
      processRole: 'renderer',
      processInstanceId: 'renderer_12345678',
      processSeq: 1,
      writerRecordedUnixMs: 1_700_000_000_001,
      bootId: 'boot_aabbccddeeff',
      tokenScope: 'installation',
    }
    const events: PersistedDiagnosticEvent[] = [
      { ...base, operationId: 'file_12345678' },
      {
        ...base,
        event: 'file.open.terminal',
        processSeq: 2,
        operationId: 'file_12345678',
        outcome: 'success',
        metadata: { durationMs: 1200 },
      },
      {
        ...base,
        event: 'file.preview.post-render',
        processSeq: 3,
        operationId: 'file_12345678',
        outcome: 'observed',
        metadata: { maxLongTaskMs: 10246 },
      },
      {
        ...base,
        event: 'index.query.window',
        processRole: 'main',
        processInstanceId: 'main_12345678',
        processSeq: 4,
        metadata: {
          workloadKind: 'backlinks', operationCount: 502,
          successCount: 501, errorCount: 1, slowCount: 2,
          durationP50Ms: 0.1, durationP95Ms: 0.2, durationMaxMs: 120,
        },
      },
      {
        ...base,
        event: 'index.work.start',
        processRole: 'main',
        processInstanceId: 'main_12345678',
        processSeq: 5,
        operationId: 'index_unclosed1',
        metadata: { workloadKind: 'build', indexBuildId: 'index_unclosed1' },
      },
    ]
    const outputPath = path.join(tempDir, 'summary.zip')
    await createDiagnosticsBundle(outputPath, fixture(), {
      snapshot: {
        events,
        totalBytes: 4096,
        invalidLines: 0,
        truncated: false,
        omittedFiles: 0,
        oldestEventUnixMs: base.observedUnixMs,
        newestEventUnixMs: base.observedUnixMs,
      },
      health: {
        eventsAccepted: events.length,
        eventsWritten: events.length,
        invalidEvents: 0,
        droppedEvents: 0,
        bytesWritten: 4096,
        batchCount: 1,
        appendP95Ms: 1,
        appendMaxMs: 1,
        queueLagP95Ms: 2,
        queueLagMaxMs: 2,
        maxQueueBytes: 4096,
        cleanupDurationMs: 0,
        destinationFallbacks: 0,
        writerWriteActive: false,
      },
    })

    const zip = new AdmZip(await readFile(outputPath))
    const summary = JSON.parse(zip.readAsText('diagnostics.json')).performanceEvents
    expect(summary).toMatchObject({
      abnormalities: {
        errorEvents: 0,
        timeoutEvents: 0,
        unmatchedStarts: 1,
        slowFileOpens: 1,
        slowFolderOpens: 0,
        slowIndexWork: 0,
        rendererStalls: 1,
      },
      maximaMs: { fileOpen: 1200, rendererLongTask: 10246 },
      queryAggregation: { windows: 1, operations: 502, errors: 1, slow: 2 },
    })
  })
})
