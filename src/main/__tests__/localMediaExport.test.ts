import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LOCAL_MEDIA_MARKER_ATTRIBUTE,
  encodeLocalResourceMarker,
  type CanonicalLocalMediaMarker,
} from '../../shared/localMedia'
import {
  materializeLocalMediaForDocxMarkdown,
  materializeLocalMediaForExport,
} from '../localMediaExport'

const marker: CanonicalLocalMediaMarker = {
  version: 1,
  kind: 'video',
  resolutionKind: 'markdown-relative',
  sources: [{ ref: 'videos/demo.mp4', mimeType: 'video/mp4' }],
  tracks: [],
  label: '演示',
  controls: true,
  muted: false,
  playsInline: true,
  preload: 'metadata',
  fullWidth: true,
}

const html = `<span class="local-media-placeholder" ${LOCAL_MEDIA_MARKER_ATTRIBUTE}="${encodeLocalResourceMarker(marker)}"></span>`

describe('localMediaExport', () => {
  it('materializes a linked HTML video without file or capability URLs', async () => {
    const result = await materializeLocalMediaForExport({
      html,
      outputPath: path.join('/workspace', 'exports', 'doc.html'),
      mode: 'linked-html',
      resolveMedia: async () => path.join('/workspace', 'videos', 'demo.mp4'),
    })

    expect(result.html).toContain('<video controls')
    expect(result.html).toContain('src="../videos/demo.mp4"')
    expect(result.html).not.toContain('local-media:')
    expect(result.html).not.toContain('file:')
    expect(result.linkedMedia).toBe(1)
  })

  it('rejects forged marker dimensions before building HTML attributes', async () => {
    const forgedMarker = {
      ...marker,
      dimensions: {
        width: '1" autoplay onloadedmetadata="alert(1)' as unknown as number,
        height: 90,
      },
    }
    const forgedHtml = `<span class="local-media-placeholder" ${LOCAL_MEDIA_MARKER_ATTRIBUTE}="${encodeLocalResourceMarker(forgedMarker)}"></span>`
    const result = await materializeLocalMediaForExport({
      html: forgedHtml,
      outputPath: path.join('/workspace', 'doc.html'),
      mode: 'linked-html',
      resolveMedia: async () => path.join('/workspace', 'videos', 'demo.mp4'),
    })

    expect(result.html).toContain('媒体引用无效')
    expect(result.html).not.toContain('<video')
    expect(result.html).not.toContain('autoplay')
    expect(result.warnings).toContain('LOCAL_MEDIA_INVALID')
  })

  it('preserves fallback sources and WebVTT tracks regardless of marker attribute order', async () => {
    const multiSourceMarker: CanonicalLocalMediaMarker = {
      ...marker,
      sources: [
        { ref: 'videos/demo.webm', mimeType: 'video/webm' },
        { ref: 'videos/demo.mp4', mimeType: 'video/mp4' },
      ],
      tracks: [{
        ref: 'captions/demo.vtt',
        kind: 'captions',
        srclang: 'zh-CN',
        label: '中文',
        default: true,
      }],
    }
    const markerFirstHtml = `<span ${LOCAL_MEDIA_MARKER_ATTRIBUTE}="${encodeLocalResourceMarker(multiSourceMarker)}" class="local-media-placeholder extra"></span>`
    const result = await materializeLocalMediaForExport({
      html: markerFirstHtml,
      outputPath: path.join('/workspace', 'exports', 'doc.html'),
      mode: 'linked-html',
      resolveMedia: async ref => path.join('/workspace', ref),
      resolveTrack: async ref => path.join('/workspace', ref),
    })

    expect(result.html).toContain('src="../videos/demo.webm" type="video/webm"')
    expect(result.html).toContain('src="../videos/demo.mp4" type="video/mp4"')
    expect(result.html).toContain('<track src="../captions/demo.vtt" kind="captions" srclang="zh-CN" label="中文" default>')
    expect(result.linkedMedia).toBe(1)
  })

  it('turns Wiki and raw HTML media into ordinary DOCX Markdown links outside code', async () => {
    const markdown = [
      '![[videos/demo.mp4#t=1,2|演示视频]]',
      '<audio src="audio/tone.mp3" controls></audio>',
      '`![[audio/inline.mp3]]`',
      '```html',
      '<video src="videos/code.mp4"></video>',
      '```',
    ].join('\n\n')
    const result = await materializeLocalMediaForDocxMarkdown({
      markdown,
      outputPath: path.join('/workspace', 'exports', 'doc.docx'),
      resolveMedia: async ref => path.join('/workspace', ref),
    })

    expect(result.markdown).toContain('[视频：演示视频](../videos/demo.mp4)')
    expect(result.markdown).toContain('[音频：audio/tone.mp3](../audio/tone.mp3)')
    expect(result.markdown).toContain('`![[audio/inline.mp3]]`')
    expect(result.markdown).toContain('<video src="videos/code.mp4"></video>')
    expect(result.linkedMedia).toBe(2)
  })

  it('embeds an authorized poster for PDF while keeping video static', async () => {
    const posterMarker = { ...marker, poster: 'images/poster.png' }
    const posterHtml = `<span class="local-media-placeholder" ${LOCAL_MEDIA_MARKER_ATTRIBUTE}="${encodeLocalResourceMarker(posterMarker)}"></span>`
    const result = await materializeLocalMediaForExport({
      html: posterHtml,
      outputPath: path.join('/workspace', 'doc.pdf'),
      mode: 'pdf-static',
      resolveMedia: async () => path.join('/workspace', 'videos', 'demo.mp4'),
      resolvePoster: async () => ({
        canonicalPath: path.join('/workspace', 'images', 'poster.png'),
        mimeType: 'image/png',
        base64: 'iVBORw0KGgo=',
      }),
    })

    expect(result.html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(result.html).toContain('视频未嵌入 PDF')
    expect(result.html).not.toContain('<video')
  })

  it('uses a static fallback for PDF', async () => {
    const result = await materializeLocalMediaForExport({
      html,
      outputPath: path.join('/workspace', 'doc.pdf'),
      mode: 'pdf-static',
      resolveMedia: async () => path.join('/workspace', 'videos', 'demo.mp4'),
    })

    expect(result.html).toContain('视频未嵌入 PDF')
    expect(result.html).not.toContain('<video')
  })
})
