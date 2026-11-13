import { describe, expect, it } from 'vitest'
import type { PersistedDiagnosticEvent, PreviewDiagnosticState } from '../../../shared/diagnostics'
import { inspectPreviewReadiness } from '../../../../e2e/fixtures/previewReadiness'

type Event = Parameters<typeof inspectPreviewReadiness>[0][number]
const start: Event = { event: 'file.open.start', processInstanceId: 'renderer_self', processSeq: 1, operationId: 'file_self_12345678', metadata: { source: 'restore' } }
const read: Event = { ...start, event: 'file.io.client', processSeq: 2, outcome: 'success' }
function state(value: PreviewDiagnosticState, sequence = 3, id = 'preview_self_12345678'): Event {
  return { event: 'file.preview.state', processInstanceId: start.processInstanceId, processSeq: sequence,
    metadata: { previewInstanceId: id, relatedOperationId: start.operationId!, previewState: value } }
}

describe('preview readiness evidence', () => {
  it.each(['awaiting-choice', 'source-ready', 'preview-ready'] as const)('显式 %s 和读取成功可就绪', value => {
    expect(inspectPreviewReadiness([start, read, state(value)], 1).ready).toBe(true)
  })

  it.each(['loading-approval', 'render-requested', 'dom-committed', 'awaiting-visibility', 'preview-core-ready', 'unmounted'] as const)('%s 不能冒充完成', value => {
    expect(inspectPreviewReadiness([start, read, state(value)], 1).ready).toBe(false)
  })

  it('读取成功、旧预览事件或空集都不能补判未知状态', () => {
    expect(inspectPreviewReadiness([], 1).ready).toBe(false)
    expect(inspectPreviewReadiness([start, read], 1).ready).toBe(false)
    const old = { ...start, event: 'file.preview.post-render' as PersistedDiagnosticEvent['event'], processSeq: 3 }
    expect(inspectPreviewReadiness([start, read, old], 1).ready).toBe(false)
    expect(inspectPreviewReadiness([start, state('awaiting-choice')], 1).ready).toBe(false)
  })

  it('按序号取最新状态，卸载/重置后旧 ready 不再有效', () => {
    expect(inspectPreviewReadiness([start, read, state('preview-ready', 8), state('render-requested', 9)], 1).ready).toBe(false)
    expect(inspectPreviewReadiness([start, read, state('unmounted', 10), state('preview-ready', 8)], 1).ready).toBe(false)
    expect(inspectPreviewReadiness([start, read, state('unmounted', 10), state('source-ready', 11)], 1).ready).toBe(true)
  })

  it('同文档多个可见实例须全部就绪，关闭一个后不会遮住另一个 pending', () => {
    const first = state('awaiting-choice', 3)
    const second = state('render-requested', 4, 'preview_other_12345678')
    expect(inspectPreviewReadiness([start, read, first, second], 1).ready).toBe(false)
    expect(inspectPreviewReadiness([start, read, first, second, state('unmounted', 5)], 1).ready).toBe(false)
    expect(inspectPreviewReadiness([start, read, first, second, state('source-ready', 6, 'preview_other_12345678')], 1).ready).toBe(true)
  })

  it('不能借另一个 renderer 的同名 operation/instance 交叉满足证据', () => {
    const foreign = { ...state('awaiting-choice'), processInstanceId: 'renderer_other' }
    expect(inspectPreviewReadiness([start, read, foreign], 1).ready).toBe(false)
    const extra = { ...start, processInstanceId: 'renderer_other' }
    expect(inspectPreviewReadiness([start, read, state('awaiting-choice'), extra], 2).ready).toBe(false)
    expect(inspectPreviewReadiness([start, read, state('awaiting-choice')], 2).ready).toBe(false)
  })
})
