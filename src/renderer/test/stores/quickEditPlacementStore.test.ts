import { beforeEach, describe, expect, it } from 'vitest'
import { useQuickEditPlacementStore } from '../../src/stores/quickEditPlacementStore'

const target = {
  filePath: '/docs/a.md',
  tabId: 'tab-a',
  leafId: 'leaf-a',
  canonicalPath: '/real/docs/a.md',
  mode: 'document' as const,
}

describe('quickEditPlacementStore', () => {
  beforeEach(() => {
    useQuickEditPlacementStore.getState().reset()
  })

  it('tracks drawer placement by leaf without owning draft content', () => {
    useQuickEditPlacementStore.getState().openPlacement(target)

    expect(useQuickEditPlacementStore.getState().placements['leaf-a']).toEqual(target)
    expect(useQuickEditPlacementStore.getState().getPlacementForLeaf('leaf-a')).toEqual(target)
    expect(useQuickEditPlacementStore.getState().getPlacementForLeaf('leaf-b')).toBeNull()
  })

  it('closes one leaf placement without clearing other leaves', () => {
    useQuickEditPlacementStore.getState().openPlacement(target)
    useQuickEditPlacementStore.getState().openPlacement({
      ...target,
      leafId: 'leaf-b',
      tabId: 'tab-b',
    })

    useQuickEditPlacementStore.getState().closePlacement('leaf-a')

    expect(useQuickEditPlacementStore.getState().getPlacementForLeaf('leaf-a')).toBeNull()
    expect(useQuickEditPlacementStore.getState().getPlacementForLeaf('leaf-b')?.tabId).toBe('tab-b')
  })

  it('tracks scroll sync state independently by placement key', () => {
    useQuickEditPlacementStore.getState().setScrollSyncEnabled('leaf-a', true)
    useQuickEditPlacementStore.getState().setScrollSyncEnabled('leaf-b', false)

    expect(useQuickEditPlacementStore.getState().isScrollSyncEnabled('leaf-a')).toBe(true)
    expect(useQuickEditPlacementStore.getState().isScrollSyncEnabled('leaf-b')).toBe(false)
    expect(useQuickEditPlacementStore.getState().isScrollSyncEnabled('single')).toBe(false)
  })

  it('clears scroll sync state when a placement closes or resets', () => {
    useQuickEditPlacementStore.getState().openPlacement(target)
    useQuickEditPlacementStore.getState().setScrollSyncEnabled('leaf-a', true)

    useQuickEditPlacementStore.getState().closePlacement('leaf-a')

    expect(useQuickEditPlacementStore.getState().getPlacementForLeaf('leaf-a')).toBeNull()
    expect(useQuickEditPlacementStore.getState().isScrollSyncEnabled('leaf-a')).toBe(false)

    useQuickEditPlacementStore.getState().openPlacement(target)
    useQuickEditPlacementStore.getState().setScrollSyncEnabled('leaf-a', true)
    useQuickEditPlacementStore.getState().reset()

    expect(useQuickEditPlacementStore.getState().isScrollSyncEnabled('leaf-a')).toBe(false)
  })
})
