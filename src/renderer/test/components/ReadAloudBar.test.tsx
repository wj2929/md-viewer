import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultReadAloudSettings } from '../../../shared/ttsProviders'

const mocks = vi.hoisted(() => ({
  speech: {
    status: 'playing',
    currentIndex: 0,
    total: 2,
    error: null as { kind: string; message: string } | null,
    detachedFromFollow: false,
    fellBackToSystem: false,
  },
  play: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  reattachFollow: vi.fn(),
  playFromSourceLine: vi.fn(),
  setActiveProvider: vi.fn(),
  setDefaultRate: vi.fn(),
  setSystemVoice: vi.fn(),
  setEdgeVoice: vi.fn(),
}))

let settings = defaultReadAloudSettings()

vi.mock('../../src/hooks/useSpeech', () => ({
  useSpeech: () => ({
    ...mocks.speech,
    play: mocks.play,
    pause: mocks.pause,
    resume: mocks.resume,
    stop: mocks.stop,
    reattachFollow: mocks.reattachFollow,
    playFromSourceLine: mocks.playFromSourceLine,
  }),
}))

vi.mock('../../src/stores/readAloudStore', () => ({
  useReadAloudStore: (selector: (state: unknown) => unknown) => selector({
    settings,
    loaded: true,
    setActiveProvider: mocks.setActiveProvider,
    setDefaultRate: mocks.setDefaultRate,
    setSystemVoice: mocks.setSystemVoice,
    setEdgeVoice: mocks.setEdgeVoice,
  }),
}))

vi.mock('../../src/tts/engines/SystemSpeechEngine', () => ({
  loadSystemVoices: vi.fn().mockReturnValue(new Promise(() => {})),
  toSystemVoiceOptions: vi.fn().mockReturnValue([]),
}))

import ReadAloudBar from '../../src/components/ReadAloudBar'

function renderBar(filePath = '/tmp/a.md') {
  const containerRef = { current: document.createElement('div') }
  return render(<ReadAloudBar containerRef={containerRef} filePath={filePath} />)
}

function expandAndGetTimer(): HTMLSelectElement {
  fireEvent.click(screen.getByRole('button', { name: '朗读' }))
  return screen.getByRole('combobox', { name: '睡眠定时停止' })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  settings = defaultReadAloudSettings()
  Object.assign(mocks.speech, {
    status: 'playing',
    currentIndex: 0,
    total: 2,
    error: null,
    detachedFromFollow: false,
    fellBackToSystem: false,
  })
  window.api = {
    ...window.api,
    ttsListVoices: vi.fn().mockReturnValue(new Promise(() => {})),
    onReadAloudFromLine: vi.fn().mockReturnValue(vi.fn()),
    onShortcutToggleReadAloud: vi.fn().mockReturnValue(vi.fn()),
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ReadAloudBar 睡眠定时与音色', () => {
  it('加载中点击主按钮取消合成而不是重新开始', () => {
    mocks.speech.status = 'loading'
    renderBar()
    mocks.stop.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '朗读' }))
    fireEvent.click(screen.getByRole('button', { name: '取消合成' }))

    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('直接展示配置错误且不使用原生 title 提示', () => {
    mocks.speech.error = { kind: 'config', message: '缺少 API Key' }
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: '朗读' }))

    expect(screen.getByRole('alert')).toHaveTextContent('缺少 API Key')
    expect(document.querySelector('[title]')).toBeNull()
  })

  it('同文件内容替换时停止旧朗读', () => {
    mocks.speech.status = 'playing'
    const containerRef = { current: document.createElement('div') }
    const view = render(
      <ReadAloudBar containerRef={containerRef} filePath="/tmp/a.md" contentKey="# 旧内容" />
    )
    mocks.stop.mockClear()

    view.rerender(
      <ReadAloudBar containerRef={containerRef} filePath="/tmp/a.md" contentKey="# 新内容" />
    )

    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('无活跃朗读时禁用睡眠定时', () => {
    mocks.speech.status = 'idle'
    renderBar()

    expect(expandAndGetTimer()).toBeDisabled()
  })

  it('5 分钟到期停止朗读', () => {
    renderBar()
    mocks.stop.mockClear()
    fireEvent.change(expandAndGetTimer(), { target: { value: '5' } })

    const visibleCountdown = screen.getByText('剩余 05:00')
    expect(visibleCountdown).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('定时停止剩余 5 分钟')).toHaveAttribute('aria-live', 'polite')
    act(() => vi.advanceTimersByTime(5 * 60_000))

    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('取消定时停止')).not.toBeInTheDocument()
  })

  it('取消定时后不会迟到停止', () => {
    renderBar()
    mocks.stop.mockClear()
    fireEvent.change(expandAndGetTimer(), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '取消定时停止' }))
    act(() => vi.advanceTimersByTime(5 * 60_000))

    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('重新设定时清除旧 deadline', () => {
    renderBar()
    mocks.stop.mockClear()
    const timer = expandAndGetTimer()
    fireEvent.change(timer, { target: { value: '5' } })
    fireEvent.change(timer, { target: { value: '10' } })

    act(() => vi.advanceTimersByTime(5 * 60_000))
    expect(mocks.stop).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(5 * 60_000))
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('手动停止同时取消定时', () => {
    renderBar()
    mocks.stop.mockClear()
    fireEvent.change(expandAndGetTimer(), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '停止朗读' }))
    act(() => vi.advanceTimersByTime(5 * 60_000))

    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('切文件和卸载都会清除已有定时', () => {
    const view = renderBar()
    mocks.stop.mockClear()
    fireEvent.change(expandAndGetTimer(), { target: { value: '5' } })
    view.rerender(<ReadAloudBar containerRef={{ current: document.createElement('div') }} filePath="/tmp/b.md" />)
    expect(mocks.stop).toHaveBeenCalledTimes(1)

    mocks.stop.mockClear()
    fireEvent.change(screen.getByRole('combobox', { name: '睡眠定时停止' }), { target: { value: '5' } })
    view.unmount()
    act(() => vi.advanceTimersByTime(5 * 60_000))
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('系统声显示系统音色且改选前停止', () => {
    settings = { ...settings, activeProviderId: 'system' }
    renderBar()
    mocks.stop.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '朗读' }))
    fireEvent.change(screen.getByRole('combobox', { name: '系统音色' }), {
      target: { value: '' },
    })

    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.setSystemVoice).toHaveBeenCalledWith(undefined)
    expect(screen.queryByRole('combobox', { name: 'Edge 音色' })).not.toBeInTheDocument()
  })
})
