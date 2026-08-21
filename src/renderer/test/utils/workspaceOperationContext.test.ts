import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'
import {
  getActiveWorkspaceLifecycleKey,
  isActiveWorkspaceLifecycleKey,
} from '../../src/utils/workspaceOperationContext'

describe('workspaceOperationContext', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeWorkspaceId: 'workspace-a',
      workspaces: [{
        id: 'workspace-a',
        name: '工作区 A',
        primaryRoot: '/roots/a',
        lifecycleEpoch: 1,
      }],
      runtimes: {},
    })
  })

  it('在同一工作区 generation 中保留有效生命周期 key', () => {
    const key = getActiveWorkspaceLifecycleKey()

    expect(key).toEqual({
      workspaceId: 'workspace-a',
      lifecycleEpoch: 1,
      primaryRoot: '/roots/a',
    })
    expect(key && isActiveWorkspaceLifecycleKey(key)).toBe(true)
  })

  it('在 root 或 epoch 变化后拒绝旧生命周期 key', () => {
    const key = getActiveWorkspaceLifecycleKey()
    if (!key) throw new Error('预期存在工作区 key')

    useWorkspaceStore.setState({
      workspaces: [{
        id: 'workspace-a',
        name: '工作区 A',
        primaryRoot: '/roots/b',
        lifecycleEpoch: 2,
      }],
    })

    expect(isActiveWorkspaceLifecycleKey(key)).toBe(false)
  })

  it('在切换 active workspace 后拒绝前一工作区的 key', () => {
    const key = getActiveWorkspaceLifecycleKey()
    if (!key) throw new Error('预期存在工作区 key')

    useWorkspaceStore.setState({
      activeWorkspaceId: 'workspace-b',
      workspaces: [
        useWorkspaceStore.getState().workspaces[0],
        {
          id: 'workspace-b',
          name: '工作区 B',
          primaryRoot: '/roots/b',
          lifecycleEpoch: 1,
        },
      ],
    })

    expect(isActiveWorkspaceLifecycleKey(key)).toBe(false)
  })
})
