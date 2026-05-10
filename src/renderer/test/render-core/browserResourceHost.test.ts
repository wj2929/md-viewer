import { describe, expect, it } from 'vitest'
import { createBrowserResourceHost } from '../../src/render-core/browserResourceHost'

describe('createBrowserResourceHost', () => {
  it('reads injected text by normalized relative path', async () => {
    const host = createBrowserResourceHost({
      resources: [
        {
          path: 'diagrams/a.excalidraw',
          kind: 'text',
          content: '{"type":"excalidraw"}',
          mediaType: 'application/json',
          size: 20,
        },
      ],
    })

    await expect(host.readText('./diagrams/a.excalidraw')).resolves.toBe('{"type":"excalidraw"}')
  })

  it('rejects missing resources with clear error', async () => {
    const host = createBrowserResourceHost({ resources: [] })

    await expect(host.readText('missing.excalidraw')).rejects.toThrow('Resource not found: missing.excalidraw')
  })

  it('reads binary resources from base64', async () => {
    const host = createBrowserResourceHost({
      resources: [
        {
          path: 'images/a.png',
          kind: 'binary',
          base64: 'aGVsbG8=',
          mediaType: 'image/png',
          size: 5,
        },
      ],
    })

    const bytes = new Uint8Array(await host.readBinary('images/a.png'))
    expect(new TextDecoder().decode(bytes)).toBe('hello')
  })

  it('resolves references relative to the markdown file', () => {
    const host = createBrowserResourceHost()

    expect(host.resolvePath('docs/readme.md', './images/a.png')).toBe('docs/images/a.png')
    expect(host.resolvePath('docs/readme.md', '../diagrams/a.excalidraw')).toBe('diagrams/a.excalidraw')
  })
})
