import { describe, expect, it } from 'vitest'
import { WorkspaceTransferCoordinator } from '../workspaceTransferCoordinator'

const snapshot = {
  workspaceId: 'workspace-a',
  name: '小说正文',
  primaryRoot: '/docs/novel',
  lifecycleEpoch: 1,
  tabs: [],
  activeTabId: null,
  splitState: { root: null, activeLeafId: '' },
}

describe('WorkspaceTransferCoordinator', () => {
  it('requires source submission before the target can read the snapshot', () => {
    const coordinator = new WorkspaceTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })

    expect(() => coordinator.getSnapshotForTarget(transfer.nonce, 2)).toThrow('尚未就绪')
    coordinator.markSourceRequested(transfer.nonce, 1)
    coordinator.submitSnapshot(transfer.nonce, 1, snapshot)
    expect(coordinator.getSnapshotForTarget(transfer.nonce, 2)).toEqual(snapshot)
  })

  it('rejects a snapshot from a different source window', () => {
    const coordinator = new WorkspaceTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })

    expect(() => coordinator.submitSnapshot(transfer.nonce, 3, snapshot)).toThrow('来源不匹配')
  })

  it('rejects a duplicated snapshot and malformed split trees', () => {
    const coordinator = new WorkspaceTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })

    coordinator.markSourceRequested(transfer.nonce, 1)
    coordinator.submitSnapshot(transfer.nonce, 1, snapshot)
    expect(() => coordinator.submitSnapshot(transfer.nonce, 1, snapshot)).toThrow('已提交')

    const invalidTransfer = coordinator.begin({ sourceWindowId: 3, targetWindowId: 4, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })
    coordinator.markSourceRequested(invalidTransfer.nonce, 3)
    expect(() => coordinator.submitSnapshot(invalidTransfer.nonce, 3, {
      ...snapshot,
      tabs: [{ id: 'tab-a', filePath: '/docs/novel/a.md' }],
      activeTabId: 'tab-a',
      splitState: {
        activeLeafId: 'leaf-a',
        root: { type: 'leaf', id: 'leaf-a', tabId: 'unknown-tab' },
      },
    })).toThrow('分屏标签无效')
  })

  it('rejects invalid split ratios and active leaf references', () => {
    const coordinator = new WorkspaceTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })

    coordinator.markSourceRequested(transfer.nonce, 1)
    expect(() => coordinator.submitSnapshot(transfer.nonce, 1, {
      ...snapshot,
      tabs: [{ id: 'tab-a', filePath: '/docs/novel/a.md' }],
      activeTabId: 'tab-a',
      splitState: {
        activeLeafId: 'missing',
        root: {
          type: 'split', id: 'split-a', direction: 'horizontal', ratio: 0.9,
          first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
          second: { type: 'leaf', id: 'leaf-b', tabId: 'tab-a' },
        },
      },
    })).toThrow('分屏无效')
  })

  it('reserves a source workspace and target window until cancellation', () => {
    const coordinator = new WorkspaceTransferCoordinator()
    const first = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })

    expect(() => coordinator.begin({ sourceWindowId: 1, targetWindowId: 3, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })).toThrow('正在转移中')
    expect(() => coordinator.begin({ sourceWindowId: 4, targetWindowId: 2, workspaceId: 'workspace-b', sourceLifecycleEpoch: 1 })).toThrow('目标窗口')

    coordinator.cancelForParticipant(first.nonce, 1)
    expect(() => coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })).not.toThrow()
  })

  it('rejects a snapshot whose epoch changed after transfer began', () => {
    const coordinator = new WorkspaceTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })
    coordinator.markSourceRequested(transfer.nonce, 1)

    expect(() => coordinator.submitSnapshot(transfer.nonce, 1, { ...snapshot, lifecycleEpoch: 2 })).toThrow('epoch')
  })

  it('rejects a cancellation from a non-participant', () => {
    const coordinator = new WorkspaceTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })

    expect(() => coordinator.cancelForParticipant(transfer.nonce, 3)).toThrow('无权')
  })
  it('consumes the transfer only after target completion', () => {
    const coordinator = new WorkspaceTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, workspaceId: 'workspace-a', sourceLifecycleEpoch: 1 })
    coordinator.markSourceRequested(transfer.nonce, 1)
    coordinator.submitSnapshot(transfer.nonce, 1, snapshot)

    expect(() => coordinator.completeForTarget(transfer.nonce, 2)).toThrow('尚未确认')
    coordinator.markTargetReady(transfer.nonce, 2)
    expect(coordinator.completeForTarget(transfer.nonce, 2).workspaceId).toBe('workspace-a')
    coordinator.commitForTarget(transfer.nonce, 2)
    expect(() => coordinator.getSnapshotForTarget(transfer.nonce, 2)).toThrow('超时或不存在')
  })
})
