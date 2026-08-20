import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../shortcuts', () => ({ registerWindowShortcuts: vi.fn() }))
vi.mock('../clipboardState', () => ({ clearClipboardState: vi.fn() }))
vi.mock('../workspaceTransferCoordinator', () => ({
  workspaceTransferCoordinator: { cancelForWindow: vi.fn(() => []) },
}))
vi.mock('../windowTransferCoordinator', () => ({
  windowTransferCoordinator: { cancelForWindow: vi.fn(() => []) },
}))
vi.mock('../localImageProtocol', () => ({
  registerLocalImageProtocol: vi.fn(),
  revokeLocalImageCapabilities: vi.fn(),
}))
vi.mock('../securityPolicy', () => ({ createContentSecurityPolicy: vi.fn(() => '') }))

import { WindowManager, type WorkspacePresentation } from '../windowManager'

function presentation(workspaceId: string, lifecycleEpoch = 1, label = workspaceId): WorkspacePresentation {
  return {
    workspaceId,
    lifecycleEpoch,
    label,
    isEmptyPlaceholder: false,
    hasMeaningfulState: true,
    tabCount: 1,
    activeTabName: `${label}.md`,
    tabNames: [`${label}.md`],
    hasSplit: false,
    hasDraft: false,
  }
}

describe('WindowManager workspace presentations', () => {
  let manager: WindowManager

  beforeEach(() => {
    manager = new WindowManager()
  })

  it('只应用与当前窗口工作区集合和 epoch 完全匹配的快照', () => {
    manager.createWorkspace(1, 'a', '/a')
    manager.createWorkspace(1, 'b', '/b', false)
    expect(manager.setWorkspacePresentations(1, [presentation('a'), presentation('b')])).toBe(true)

    expect(manager.setWorkspacePresentations(1, [presentation('a')])).toBe(false)
    expect(manager.setWorkspacePresentations(1, [presentation('a'), presentation('missing')])).toBe(false)
    expect(manager.setWorkspacePresentations(1, [presentation('a'), presentation('b', 2)])).toBe(false)
    expect(manager.getWorkspacePresentation(1, 'b')?.label).toBe('b')
  })

  it('整窗口转移时原子迁移展示摘要并保留目标摘要', () => {
    manager.createWorkspace(1, 'source-a', '/source-a')
    manager.createWorkspace(1, 'source-b', '/source-b', false)
    manager.createWorkspace(2, 'target', '/target')
    manager.setWorkspacePresentations(1, [presentation('source-a'), presentation('source-b')])
    manager.setWorkspacePresentations(2, [presentation('target')])

    const result = manager.transferWorkspaces(1, 2, [
      { workspaceId: 'source-a', lifecycleEpoch: 1, primaryRoot: '/source-a' },
      { workspaceId: 'source-b', lifecycleEpoch: 1, primaryRoot: '/source-b' },
    ], 'source-b')

    expect(manager.getWorkspacePresentation(2, 'target')?.label).toBe('target')
    for (const mapping of result.workspaces) {
      expect(manager.getWorkspacePresentation(1, mapping.sourceWorkspaceId)).toBeUndefined()
      expect(manager.getWorkspacePresentation(2, mapping.targetWorkspaceId)).toMatchObject({
        workspaceId: mapping.targetWorkspaceId,
        lifecycleEpoch: 2,
      })
    }
    expect(result.activeWorkspaceId).toBe('source-b')
  })

  it('工作区 ID 冲突时同步重映射展示摘要', () => {
    manager.createWorkspace(1, 'same', '/source')
    manager.createWorkspace(2, 'same', '/target')
    manager.setWorkspacePresentations(1, [presentation('same', 1, 'source')])
    manager.setWorkspacePresentations(2, [presentation('same', 1, 'target')])

    const result = manager.transferWorkspaces(1, 2, [
      { workspaceId: 'same', lifecycleEpoch: 1, primaryRoot: '/source' },
    ], 'same')
    const importedId = result.workspaces[0].targetWorkspaceId

    expect(importedId).not.toBe('same')
    expect(manager.getWorkspacePresentation(2, 'same')?.label).toBe('target')
    expect(manager.getWorkspacePresentation(2, importedId)).toMatchObject({
      workspaceId: importedId,
      lifecycleEpoch: 2,
      label: 'source',
    })
  })
})
