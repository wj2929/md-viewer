import { describe, expect, it } from 'vitest'
import {
  collectLocalResourceDependencies,
  isRefreshableLocalResourcePath,
  markdownDependsOnLocalResource,
} from '../resourceDependencies'

const MARKDOWN_PATH = '/workspace/docs/media.md'
const WORKSPACE_ROOT = '/workspace'

function depends(source: string, changedPath: string): boolean {
  return markdownDependsOnLocalResource(source, MARKDOWN_PATH, WORKSPACE_ROOT, changedPath)
}

describe('local resource dependencies', () => {
  it('quickly rejects workspace changes that cannot affect rendered resources', () => {
    expect(isRefreshableLocalResourcePath('/workspace/src/App.tsx')).toBe(false)
    expect(isRefreshableLocalResourcePath('/workspace/out/app.js')).toBe(false)
    expect(isRefreshableLocalResourcePath('/workspace/assets/POSTER.PNG')).toBe(true)
    expect(isRefreshableLocalResourcePath('/workspace/diagrams/flow.excalidraw')).toBe(true)
    expect(isRefreshableLocalResourcePath('/workspace/video/captions.vtt')).toBe(true)
  })

  it('collects rendered Markdown images and special diagram references', () => {
    expect(collectLocalResourceDependencies([
      '![poster](../assets/poster.png?raw=1#hero)',
      '![diagram](diagrams/process.bpmn)',
      '[download](files/archive.zip)',
    ].join('\n'))).toEqual([
      { ref: '../assets/poster.png?raw=1#hero', resolutionKind: 'markdown-relative' },
      { ref: 'diagrams/process.bpmn', resolutionKind: 'markdown-relative' },
    ])
  })

  it('collects HTML media sources, poster, source and track references', () => {
    const source = [
      '<video src="video/demo.mp4#t=1,2" poster="images/poster.png">',
      '  <source src="video/demo.webm" type="video/webm">',
      '  <track src="video/zh.vtt" kind="subtitles">',
      '</video>',
      '<audio src="audio/tone.mp3"></audio>',
    ].join('\n')

    expect(collectLocalResourceDependencies(source)).toEqual([
      { ref: 'video/demo.mp4#t=1,2', resolutionKind: 'markdown-relative' },
      { ref: 'images/poster.png', resolutionKind: 'markdown-relative' },
      { ref: 'video/demo.webm', resolutionKind: 'markdown-relative' },
      { ref: 'video/zh.vtt', resolutionKind: 'markdown-relative' },
      { ref: 'audio/tone.mp3', resolutionKind: 'markdown-relative' },
    ])
  })

  it('collects only Wiki embeds that read local resource content', () => {
    const source = [
      '![[images/poster.png|160x90]]',
      '![[video/demo.webm|320x180]]',
      '![[audio/tone.mp3|测试音频]]',
      '![[diagrams/board.excalidraw|图表]]',
      '![[note.md|文档卡片]]',
      '[[images/poster.png|普通链接]]',
    ].join('\n')

    expect(collectLocalResourceDependencies(source)).toEqual([
      { ref: 'images/poster.png', resolutionKind: 'workspace-wiki' },
      { ref: 'video/demo.webm', resolutionKind: 'workspace-wiki' },
      { ref: 'audio/tone.mp3', resolutionKind: 'workspace-wiki' },
      { ref: 'diagrams/board.excalidraw', resolutionKind: 'workspace-wiki' },
    ])
  })

  it('ignores resource-looking text inside inline and fenced code', () => {
    const source = [
      '`![[images/inline.png]]`',
      '```html',
      '<video src="video/fenced.mp4"></video>',
      '![[diagrams/fenced.excalidraw]]',
      '```',
      '<!-- <audio src="audio/commented.mp3"></audio> -->',
    ].join('\n')

    expect(collectLocalResourceDependencies(source)).toEqual([])
  })

  it('matches Markdown-relative resources without refreshing unrelated tabs', () => {
    const source = '<video src="../assets/demo.mp4#t=0.5,2.5" controls></video>'

    expect(depends(source, '/workspace/assets/demo.mp4')).toBe(true)
    expect(depends(source, '/workspace/other/demo.mp4')).toBe(false)
    expect(depends(source, '/workspace/assets/unrelated.mp4')).toBe(false)
  })

  it('matches Wiki local, workspace-root and basename candidates', () => {
    expect(depends('![[diagrams/board.excalidraw]]', '/workspace/docs/diagrams/board.excalidraw')).toBe(true)
    expect(depends('![[diagrams/board.excalidraw]]', '/workspace/diagrams/board.excalidraw')).toBe(true)
    expect(depends('![[board.excalidraw]]', '/workspace/archive/board.excalidraw')).toBe(true)
    expect(depends('![[board.excalidraw]]', '/workspace/archive/other.excalidraw')).toBe(false)
  })

  it('supports encoded and Markdown-escaped paths while rejecting invalid references', () => {
    expect(depends('![poster](../assets/poster%20wide.png)', '/workspace/assets/poster wide.png')).toBe(true)
    expect(depends('![poster](../assets/poster\\(wide\\).png)', '/workspace/assets/poster(wide).png')).toBe(true)
    expect(depends('![poster](../../../outside.png)', '/outside.png')).toBe(false)
    expect(depends('![poster](../assets/bad%ZZ.png)', '/workspace/assets/bad%ZZ.png')).toBe(false)
  })

  it('normalizes Windows paths case-insensitively', () => {
    expect(markdownDependsOnLocalResource(
      '![[Media\\Clip.MP4]]',
      'C:\\Vault\\Docs\\media.md',
      'C:\\Vault',
      'c:\\vault\\docs\\media\\clip.mp4',
    )).toBe(true)
  })
})
