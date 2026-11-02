import { describe, expect, it } from 'vitest'
import {
  classifyWikiResource,
  localMediaMimeType,
  parseLocalMediaDimensions,
  parseLocalMediaReference,
  parseMediaTimeFragment,
} from '../localMedia'
import { parseWikiReferenceAt } from '../markdown/obsidianSyntax'

describe('local media semantics', () => {
  it('classifies the supported Obsidian resource formats', () => {
    expect(classifyWikiResource('clip.mp4')).toBe('video')
    expect(classifyWikiResource('clip.webm')).toBe('video')
    expect(classifyWikiResource('voice.ogg')).toBe('audio')
    expect(classifyWikiResource('image.avif')).toBe('image')
    expect(classifyWikiResource('Note')).toBe('markdown')
    expect(classifyWikiResource('component.mdx')).toBe('attachment')
    expect(classifyWikiResource('report.pdf')).toBe('document')
    expect(localMediaMimeType('clip.mp4', 'video')).toBe('video/mp4')
    expect(localMediaMimeType('clip.mp4', 'audio')).toBeNull()
  })

  it('parses dimensions and media fragments within their limits', () => {
    expect(parseLocalMediaDimensions('640x360')).toEqual({ width: 640, height: 360 })
    expect(parseLocalMediaDimensions('4096')).toEqual({ width: 4096 })
    expect(parseLocalMediaDimensions('4097')).toBeNull()
    expect(parseMediaTimeFragment('t=01:02,90.5')).toEqual({
      start: 62,
      end: 90.5,
      normalized: 't=62,90.5',
    })
    expect(parseMediaTimeFragment('t=20,10')).toBeNull()
    expect(parseLocalMediaReference('media/a.mp4#t=2,4')).toEqual({
      path: 'media/a.mp4',
      time: { start: 2, end: 4, normalized: 't=2,4' },
    })
  })

  it('parses wiki links, embeds, labels and dimensions', () => {
    expect(parseWikiReferenceAt('[[Guide#Install|安装]]', 0)?.reference).toMatchObject({
      isEmbed: false,
      path: 'Guide',
      fragment: 'Install',
      fragmentKind: 'heading',
      pipe: '安装',
      displayText: '安装',
    })
    expect(parseWikiReferenceAt('![[media/demo.mp4#t=2,4|640x360]]', 0)?.reference).toMatchObject({
      isEmbed: true,
      resourceKind: 'video',
      dimensions: { width: 640, height: 360 },
      mediaTime: { start: 2, end: 4 },
    })
    expect(parseWikiReferenceAt('![[images/a.png|替代文本]]', 0)?.reference).toMatchObject({
      resourceKind: 'image',
      displayText: '替代文本',
    })
  })

  it('does not parse escaped, malformed or multiline references', () => {
    expect(parseWikiReferenceAt('\\[[Guide]]', 1)).toBeNull()
    expect(parseWikiReferenceAt('[[Guide', 0)).toBeNull()
    expect(parseWikiReferenceAt('[[a\nb]]', 0)).toBeNull()
  })
})
