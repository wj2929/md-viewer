import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeRendererDiagnosticEvent } from '../../../shared/diagnostics'
import {
  recordFileIoClient,
  recordFileTerminal,
  recordFolderTreeReady,
  recordPostRenderSnapshot,
  recordPreviewSummary,
  startFileDiagnostic,
} from '../../src/utils/diagnostics'

describe('renderer diagnostics client', () => {
  const recordDiagnosticRendererEvent = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).api = { recordDiagnosticRendererEvent }
  })

  it('生成严格 schema 的 start、IPC 和唯一 terminal 事件', () => {
    const operation = startFileDiagnostic('user')
    recordFileIoClient(operation, 12, 'bypass-force-reload', 'success')
    recordFileTerminal(operation, 'success', { coreReadyMs: 25, panelKind: 'main' })
    recordFileTerminal(operation, 'error')

    const events = recordDiagnosticRendererEvent.mock.calls.map(([event]) => event)
    expect(events.map(event => event.event)).toEqual([
      'file.open.start',
      'file.io.client',
      'file.open.terminal',
    ])
    expect(events.every(event => sanitizeRendererDiagnosticEvent(event, event.observedUnixMs))).toBe(true)
    expect(events[0].operationId).toBe(events[2].operationId)
    expect(JSON.stringify(events)).not.toContain('/Users/')
  })

  it('每个 operation 只记录一次文件夹终态、预览摘要和渲染后快照', () => {
    const operationId = `folder_${crypto.randomUUID()}`
    const folderInput = {
      operationId,
      startedMonotonicMs: performance.now(),
      source: 'restore' as const,
      resultApplied: true,
      rootNodeCount: 3,
      outcome: 'success' as const,
    }

    recordFolderTreeReady(folderInput)
    recordFolderTreeReady(folderInput)
    recordPreviewSummary(operationId, { source: 'restore' })
    recordPreviewSummary(operationId, { source: 'restore' })
    recordPostRenderSnapshot(operationId, { source: 'restore' }, 'observed')
    recordPostRenderSnapshot(operationId, { source: 'restore' }, 'superseded')

    const events = recordDiagnosticRendererEvent.mock.calls.map(([event]) => event)
    expect(events.map(event => event.event)).toEqual([
      'folder.open.summary',
      'folder.open.terminal',
      'file.preview.summary',
      'file.preview.post-render',
    ])
    expect(events[0].metadata.source).toBe('restore')
  })
})
