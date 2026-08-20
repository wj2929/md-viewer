import { describe, expect, it } from 'vitest'
import { WindowTransferCoordinator } from '../windowTransferCoordinator'

const plan = [
  { workspaceId: 'a', sourceLifecycleEpoch: 1, primaryRoot: '/a' },
  { workspaceId: 'b', sourceLifecycleEpoch: 2, primaryRoot: '/b' },
]
const snapshot = (workspaceId: string, lifecycleEpoch: number, primaryRoot: string) => ({
  workspaceId, name: workspaceId, lifecycleEpoch, primaryRoot,
  tabs: [], activeTabId: null, splitState: { root: null, activeLeafId: '' },
})

describe('WindowTransferCoordinator', () => {
  it('只有完整 batch 才能交给目标窗口', () => {
    const coordinator = new WindowTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, sourceActiveWorkspaceId: 'b', workspaces: plan })
    expect(() => coordinator.submitSnapshots(transfer.nonce, 1, [snapshot('a', 1, '/a')])).toThrow('不完整')
    coordinator.submitSnapshots(transfer.nonce, 1, [snapshot('a', 1, '/a'), snapshot('b', 2, '/b')])
    expect(coordinator.getSnapshotsForTarget(transfer.nonce, 2)).toHaveLength(2)
  })

  it('拒绝重复、额外和 epoch 不匹配的 snapshots', () => {
    const duplicate = new WindowTransferCoordinator()
    const first = duplicate.begin({ sourceWindowId: 1, targetWindowId: 2, sourceActiveWorkspaceId: null, workspaces: plan })
    expect(() => duplicate.submitSnapshots(first.nonce, 1, [snapshot('a', 1, '/a'), snapshot('a', 1, '/a')])).toThrow('重复')

    const stale = new WindowTransferCoordinator()
    const second = stale.begin({ sourceWindowId: 1, targetWindowId: 2, sourceActiveWorkspaceId: null, workspaces: plan })
    expect(() => stale.submitSnapshots(second.nonce, 1, [snapshot('a', 1, '/a'), snapshot('b', 3, '/b')])).toThrow('计划不匹配')
  })

  it('取消后释放来源与目标窗口 reservation', () => {
    const coordinator = new WindowTransferCoordinator()
    const transfer = coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, sourceActiveWorkspaceId: null, workspaces: plan })
    expect(() => coordinator.begin({ sourceWindowId: 1, targetWindowId: 3, sourceActiveWorkspaceId: null, workspaces: plan })).toThrow('正在处理')
    coordinator.cancelForParticipant(transfer.nonce, 2)
    expect(() => coordinator.begin({ sourceWindowId: 1, targetWindowId: 2, sourceActiveWorkspaceId: null, workspaces: plan })).not.toThrow()
  })
})
