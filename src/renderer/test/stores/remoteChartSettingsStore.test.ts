import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteChartSettingsStore } from '../../src/stores/remoteChartSettingsStore'

describe('remoteChartSettingsStore', () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      getAppSettings: vi.fn().mockResolvedValue({}),
      updateAppSettings: vi.fn().mockResolvedValue(undefined),
    }
    useRemoteChartSettingsStore.setState({
      hydration: 'loading',
      autoRenderRemoteCharts: true,
      approvedDocuments: {},
    })
  })

  it('treats a missing legacy setting as enabled', async () => {
    await useRemoteChartSettingsStore.getState().hydrate()
    expect(useRemoteChartSettingsStore.getState()).toMatchObject({
      hydration: 'ready',
      autoRenderRemoteCharts: true,
    })
  })

  it('fails closed when settings cannot be read', async () => {
    vi.mocked(window.api.getAppSettings).mockRejectedValueOnce(new Error('unavailable'))
    await useRemoteChartSettingsStore.getState().hydrate()
    expect(useRemoteChartSettingsStore.getState()).toMatchObject({
      hydration: 'failed',
      autoRenderRemoteCharts: false,
    })
  })

  it('clears document approvals when disabled and rolls back a failed save', async () => {
    useRemoteChartSettingsStore.setState({
      hydration: 'ready',
      autoRenderRemoteCharts: true,
      approvedDocuments: { 'file:/docs/a.md': true },
    })
    expect(await useRemoteChartSettingsStore.getState().setAutoRenderRemoteCharts(false)).toBe(true)
    expect(useRemoteChartSettingsStore.getState().approvedDocuments).toEqual({})

    vi.mocked(window.api.updateAppSettings).mockRejectedValueOnce(new Error('disk full'))
    expect(await useRemoteChartSettingsStore.getState().setAutoRenderRemoteCharts(true)).toBe(false)
    expect(useRemoteChartSettingsStore.getState().autoRenderRemoteCharts).toBe(false)
  })
})
