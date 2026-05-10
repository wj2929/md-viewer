import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createBrowserResourceHost } from '../../src/render-core/browserResourceHost'
import { RenderPreview } from '../../src/render-core/RenderPreview'

describe('RenderPreview', () => {
  it('renders markdown without Electron globals', () => {
    delete (window as unknown as { api?: unknown }).api
    delete (window as unknown as { electronAPI?: unknown }).electronAPI

    render(
      <RenderPreview
        content={'# 标题\n\n正文'}
        resourceHost={createBrowserResourceHost()}
      />
    )

    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByText('正文')).toBeInTheDocument()
  })
})
