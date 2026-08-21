import { describe, expect, it } from 'vitest'
import {
  reconcileSplitState,
  type SplitState,
} from '../../src/utils/splitTree'

const state: SplitState = {
  root: {
    type: 'split',
    id: 'split-1',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
    second: {
      type: 'split',
      id: 'split-2',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'leaf', id: 'leaf-b', tabId: 'tab-b' },
      second: { type: 'leaf', id: 'leaf-c', tabId: 'tab-c' },
    },
  },
  activeLeafId: 'leaf-b',
}

describe('reconcileSplitState', () => {
  it('移除关闭 Tab 的叶子并收缩单子树', () => {
    const result = reconcileSplitState(state, new Set(['tab-a', 'tab-c']))

    expect(result).toEqual({
      root: {
        type: 'split',
        id: 'split-1',
        direction: 'horizontal',
        ratio: 0.5,
        first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
        second: { type: 'leaf', id: 'leaf-c', tabId: 'tab-c' },
      },
      activeLeafId: 'leaf-a',
    })
  })

  it('所有 Tab 关闭后清空分屏状态', () => {
    expect(reconcileSplitState(state, new Set())).toEqual({
      root: null,
      activeLeafId: '',
    })
  })

  it('保留仍有效的活动叶子', () => {
    const result = reconcileSplitState(state, new Set(['tab-b', 'tab-c']))

    expect(result.activeLeafId).toBe('leaf-b')
  })
})
