import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const MEDIA_FIXTURE_DIR = join(__dirname, 'fixtures', 'local-media')
const COMPATIBLE_EXCALIDRAW_FIXTURE = join(
  __dirname,
  'fixtures',
  'excalidraw',
  'compatible-no-type.excalidraw',
)
const LOCAL_MEDIA_RESPONSE_URL = /^http:\/\/127\.0\.0\.1:\d+\/mdv-[A-Za-z0-9_-]+\//
const LOCAL_MEDIA_SOURCE_URL = /^http:\/\/127\.0\.0\.1:\d+\/mdv-[A-Za-z0-9_-]+\/asset\/[A-Za-z0-9_-]{43}\?instance=\d+$/

interface MediaSnapshot {
  tag: string
  readyState: number
  errorCode: number | null
  currentTime: number
  duration: number
  paused: boolean
  width: number
  height: number
  widthAttribute: string | null
  heightAttribute: string | null
  style: string | null
  poster: string | null
  sources: string[]
  tracks: Array<{ src: string, readyState: number, cueCount: number }>
}

async function mediaSnapshot(page: Page): Promise<MediaSnapshot[]> {
  return page.locator('.markdown-body').evaluate(root => (
    [...root.querySelectorAll<HTMLMediaElement>('video, audio')].map(media => ({
      tag: media.tagName,
      readyState: media.readyState,
      errorCode: media.error?.code ?? null,
      currentTime: media.currentTime,
      duration: media.duration,
      paused: media.paused,
      width: media.clientWidth,
      height: media.clientHeight,
      widthAttribute: media.getAttribute('width'),
      heightAttribute: media.getAttribute('height'),
      style: media.getAttribute('style'),
      poster: media instanceof HTMLVideoElement ? media.poster : null,
      sources: [...media.querySelectorAll<HTMLSourceElement>('source')].map(source => source.src),
      tracks: [...media.querySelectorAll<HTMLTrackElement>('track')].map(track => ({
        src: track.src,
        readyState: track.readyState,
        cueCount: track.track.cues?.length ?? 0,
      })),
    }))
  ))
}

async function mockSaveDialog(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, targetPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: targetPath })
  }, filePath)
}

async function triggerExport(
  electronApp: ElectronApplication,
  channel: 'markdown:export-html' | 'markdown:export-pdf',
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, exportChannel) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send(exportChannel)
  }, channel)
}

async function continuePreflightIfShown(page: Page): Promise<void> {
  const overlay = page.locator('.preflight-overlay')
  const shown = await overlay.waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false)
  if (!shown) return
  await page.locator('.preflight-actions .export-task-btn-primary').click()
  await overlay.waitFor({ state: 'hidden' })
}

async function waitForFile(filePath: string): Promise<void> {
  await expect.poll(() => existsSync(filePath), { timeout: 20_000 }).toBe(true)
}

function copyMediaFixture(targetDir: string): void {
  cpSync(MEDIA_FIXTURE_DIR, targetDir, { recursive: true })
  cpSync(
    COMPATIBLE_EXCALIDRAW_FIXTURE,
    join(targetDir, 'diagrams', 'compatible-no-type.excalidraw'),
  )
  const markdownPath = join(targetDir, 'media.md')
  writeFileSync(
    markdownPath,
    readFileSync(markdownPath, 'utf8').replace(
      '../excalidraw/compatible-no-type.excalidraw',
      'diagrams/compatible-no-type.excalidraw',
    ),
  )
}

test.describe('本地音视频与 Obsidian 嵌入', () => {
  test.beforeEach(async ({ electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true)
    })
  })

  test('安全加载、播放、时间片段、字幕、尺寸与清理均可用', async ({
    electronApp,
    page,
    testDir,
  }, testInfo) => {
    const workspace = join(testDir, 'local-media')
    const contentRoot = join(workspace, 'docs', 'probe')
    mkdirSync(contentRoot, { recursive: true })
    copyMediaFixture(contentRoot)
    const plainPath = join(contentRoot, 'plain.md')
    writeFileSync(plainPath, '# Plain document\n\nNo media here.')

    const protocolResponses: Array<{
      url: string
      status: number
      headers: Record<string, string>
    }> = []
    page.on('response', response => {
      if (response.url().startsWith('local-media:') || LOCAL_MEDIA_RESPONSE_URL.test(response.url())) {
        protocolResponses.push({
          url: response.url(),
          status: response.status(),
          headers: response.headers(),
        })
      }
    })

    await page.evaluate(() => {
      const probe = { created: [] as string[], revoked: [] as string[], types: {} as Record<string, string> }
      const target = window as unknown as {
        __mdMediaBlobProbe: typeof probe
      }
      target.__mdMediaBlobProbe = probe
      const createObjectURL = URL.createObjectURL.bind(URL)
      const revokeObjectURL = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = blob => {
        const url = createObjectURL(blob)
        probe.created.push(url)
        probe.types[url] = blob.type
        return url
      }
      URL.revokeObjectURL = url => {
        probe.revoked.push(url)
        revokeObjectURL(url)
      }
    })

    await openFolderViaIPC(electronApp, workspace)
    await page.locator('.tab', { hasText: 'media.md' }).waitFor({ state: 'visible' })
    await expect(page.locator('.markdown-body video')).toHaveCount(4)
    await expect(page.locator('.markdown-body audio')).toHaveCount(3)
    await expect(page.locator('.markdown-body img')).toHaveCount(3)
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll<HTMLImageElement>('.markdown-body img')]
      return images.length === 3 && images.every(image => image.complete && image.naturalWidth > 0)
    }, undefined, { timeout: 10_000 })
    await expect(page.locator('.bpmn-wrapper .bpmn-container svg')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.excalidraw-wrapper')).toHaveCount(2)
    await expect(page.locator('.excalidraw-wrapper .excalidraw-container svg')).toHaveCount(2, { timeout: 15_000 })
    await page.waitForFunction(() => {
      const media = [...document.querySelectorAll<HTMLMediaElement>('.markdown-body video, .markdown-body audio')]
      return media.length === 7 && media.every(element => (
        !element.error && element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      ))
    }, undefined, { timeout: 15_000 })
    await page.waitForFunction(() => {
      const track = document.querySelector<HTMLTrackElement>('.markdown-body video track')
      return track?.readyState === HTMLTrackElement.LOADED && (track.track.cues?.length ?? 0) > 0
    }, undefined, { timeout: 10_000 })
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>('.markdown-body video')
      return Boolean(video && video.currentTime >= 0.45 && video.currentTime <= 0.8)
    }, undefined, { timeout: 10_000 })

    const initial = await mediaSnapshot(page)
    expect(initial).toHaveLength(7)
    expect(initial.every(media => media.errorCode === null && media.readyState >= 3)).toBe(true)
    expect(initial[0]).toMatchObject({
      tag: 'VIDEO',
      poster: expect.stringMatching(/^data:image\/png;base64,/),
    })
    expect(initial[0].currentTime).toBeGreaterThanOrEqual(0.45)
    expect(initial[0].currentTime).toBeLessThanOrEqual(0.8)
    expect(initial[0].tracks).toEqual([
      expect.objectContaining({
        src: expect.stringMatching(/^blob:/),
        readyState: 2,
        cueCount: 1,
      }),
    ])
    expect(initial[1]).toMatchObject({
      tag: 'VIDEO',
      widthAttribute: null,
      heightAttribute: null,
      style: 'width: 100%;',
    })
    expect(initial[1].duration).toBeGreaterThanOrEqual(2.9)
    expect(initial[1].duration).toBeLessThanOrEqual(3.1)
    expect(initial[2]).toMatchObject({
      tag: 'VIDEO',
      width: 320,
      height: 180,
      widthAttribute: '320',
      heightAttribute: '180',
      style: null,
    })
    expect(initial[2].tracks).toEqual([
      expect.objectContaining({
        src: expect.stringMatching(/^blob:/),
      }),
    ])
    expect(initial[3]).toMatchObject({
      tag: 'VIDEO',
      width: 240,
      height: 135,
      widthAttribute: '240',
      heightAttribute: '135',
      style: null,
    })
    expect(initial.slice(4)).toEqual([
      expect.objectContaining({ tag: 'AUDIO', width: 640, height: 54 }),
      expect.objectContaining({ tag: 'AUDIO', width: 640, height: 54 }),
      expect.objectContaining({ tag: 'AUDIO', width: 640, height: 54 }),
    ])
    const localImages = await page.locator('.markdown-body img').evaluateAll(images => images.map(image => ({
      src: image.src,
      width: image.clientWidth,
      height: image.clientHeight,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    })))
    expect(localImages).toHaveLength(3)
    expect(localImages.every(image => (
      image.src.startsWith('local-image://asset/')
      && image.width === 160
      && image.height === 90
      && image.naturalWidth === 320
      && image.naturalHeight === 180
    ))).toBe(true)
    await expect(page.locator('.local-media-fallback')).toHaveCount(0)

    const sourceUrls = initial.flatMap(media => media.sources)
    expect(sourceUrls).toHaveLength(8)
    expect(new Set(sourceUrls).size).toBe(8)
    for (const sourceUrl of sourceUrls) {
      expect(sourceUrl).toMatch(LOCAL_MEDIA_SOURCE_URL)
    }
    const sourceBases = sourceUrls.map(sourceUrl => sourceUrl.split('?')[0])
    expect(sourceBases[0]).toBe(sourceBases[4])
    expect(sourceBases[1]).toBe(sourceBases[2])
    expect(sourceBases[0]).toBe(sourceBases[3])
    expect(sourceBases[5]).toBe(sourceBases[6])
    expect(sourceBases[5]).toBe(sourceBases[7])

    const playback = await page.locator('.markdown-body').evaluate(async root => {
      const media = [...root.querySelectorAll<HTMLMediaElement>('video, audio')]
      const firstVideo = media[0]
      const firstStart = firstVideo.currentTime
      await firstVideo.play()
      const fragmentStopped = await new Promise<boolean>(resolve => {
        const deadline = window.setTimeout(() => resolve(false), 5_000)
        const check = (): void => {
          if (firstVideo.paused && firstVideo.currentTime >= 2.45) {
            window.clearTimeout(deadline)
            resolve(true)
          } else {
            window.setTimeout(check, 50)
          }
        }
        check()
      })

      const fragmentEnd = firstVideo.currentTime
      const advanced = [firstVideo.currentTime > firstStart]
      for (const element of media.slice(1)) {
        const before = element.currentTime
        await element.play()
        await new Promise(resolve => window.setTimeout(resolve, 450))
        advanced.push(element.currentTime > before + 0.1)
        element.pause()
      }

      const seekResults: Array<{
        before: number
        target: number
        after: number
        seeking: boolean
        readyState: number
        networkState: number
      }> = []
      for (const element of media) {
        const before = element.currentTime
        const seekTarget = Math.abs(before - 1.5) < 0.2 ? 1 : 1.5
        element.currentTime = seekTarget
        const deadline = performance.now() + 3_000
        while (
          performance.now() < deadline
          && (element.seeking || Math.abs(element.currentTime - seekTarget) > 0.15)
        ) {
          await new Promise(resolve => window.setTimeout(resolve, 25))
        }
        seekResults.push({
          before,
          target: seekTarget,
          after: element.currentTime,
          seeking: element.seeking,
          readyState: element.readyState,
          networkState: element.networkState,
        })
      }
      return {
        advanced,
        fragmentStopped,
        fragmentEnd,
        seekResults,
      }
    })
    expect(playback.advanced).toEqual([true, true, true, true, true, true, true])
    expect(playback.fragmentStopped).toBe(true)
    expect(playback.fragmentEnd).toBeGreaterThanOrEqual(2.45)
    expect(playback.fragmentEnd).toBeLessThanOrEqual(2.8)
    expect(
      playback.seekResults.every(result => (
        !result.seeking
        && Math.abs(result.after - result.target) <= 0.15
      )),
      JSON.stringify(playback.seekResults),
    ).toBe(true)

    await expect.poll(() => protocolResponses.some(response => response.status === 206), {
      timeout: 5_000,
    }).toBe(true)
    const rangedResponse = protocolResponses.find(response => response.status === 206)
    expect(rangedResponse?.headers['accept-ranges']).toBe('bytes')
    expect(rangedResponse?.headers['content-range']).toMatch(/^bytes \d+-\d+\/\d+$/)
    expect(rangedResponse?.headers['cache-control']).toBe('no-store')
    expect(rangedResponse?.headers['x-content-type-options']).toBe('nosniff')
    expect(protocolResponses.some(response => response.headers['content-type'] === 'video/webm')).toBe(true)
    expect(protocolResponses.some(response => response.headers['content-type'] === 'video/mp4')).toBe(true)
    expect(protocolResponses.some(response => response.headers['content-type'] === 'audio/mpeg')).toBe(true)

    const outsideBody = await page.locator('.markdown-body').evaluate(root => {
      const body = root.getBoundingClientRect()
      return [...root.querySelectorAll<HTMLElement>(
        'video.local-media-player, audio.local-media-player, img, .bpmn-wrapper, .excalidraw-wrapper',
      )].flatMap((element, index) => {
        const rect = element.getBoundingClientRect()
        return rect.left < body.left - 1 || rect.right > body.right + 1
          ? [{ index, tag: element.tagName, left: rect.left, right: rect.right, bodyLeft: body.left, bodyRight: body.right }]
          : []
      })
    })
    expect(outsideBody).toEqual([])

    await page.locator('.markdown-body video').nth(0).screenshot({
      path: testInfo.outputPath('html-video-with-subtitles.png'),
    })
    await page.locator('.markdown-body video').nth(1).screenshot({
      path: testInfo.outputPath('html-mp4.png'),
    })
    await page.locator('.markdown-body video').nth(2).screenshot({
      path: testInfo.outputPath('wiki-video-sized.png'),
    })
    await page.locator('.markdown-body audio').nth(0).screenshot({
      path: testInfo.outputPath('html-audio.png'),
    })
    await page.locator('.markdown-body audio').nth(1).screenshot({
      path: testInfo.outputPath('wiki-audio.png'),
    })
    await page.locator('.markdown-body img').nth(1).screenshot({
      path: testInfo.outputPath('wiki-avif.png'),
    })
    await page.locator('.bpmn-wrapper').screenshot({
      path: testInfo.outputPath('wiki-bpmn.png'),
    })
    await page.locator('.excalidraw-wrapper').first().screenshot({
      path: testInfo.outputPath('wiki-excalidraw.png'),
    })
    await page.locator('.excalidraw-wrapper').nth(1).screenshot({
      path: testInfo.outputPath('wiki-excalidraw-compatible.png'),
    })

    const blobProbe = await page.evaluate(() => (
      (window as unknown as {
        __mdMediaBlobProbe: { created: string[], revoked: string[], types: Record<string, string> }
      }).__mdMediaBlobProbe
    ))
    await testInfo.attach('all-blob-types', { body: JSON.stringify(blobProbe), contentType: 'application/json' })
    const createdBlobUrls = blobProbe.created
    expect(createdBlobUrls.length).toBeGreaterThanOrEqual(2)
    // 内容重渲染可以重建字幕，但旧 Blob 必须释放，同时存活的字幕仍只能有两个。
    expect(createdBlobUrls.filter(url => !blobProbe.revoked.includes(url))).toHaveLength(2)

    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), plainPath)
    await page.locator('.tab', { hasText: 'plain.md' }).waitFor({ state: 'visible' })
    await expect(page.locator('.markdown-body video, .markdown-body audio')).toHaveCount(0)
    await expect.poll(async () => page.evaluate(() => {
      const probe = (window as unknown as {
        __mdMediaBlobProbe: { created: string[], revoked: string[] }
      }).__mdMediaBlobProbe
      return probe.created.every(url => probe.revoked.includes(url))
    })).toBe(true)
  })

  test('深层 Markdown 引用的 Excalidraw 变化时自动刷新预览', async ({
    electronApp,
    page,
    testDir,
  }, testInfo) => {
    const workspaceRoot = join(testDir, 'deep-watch-workspace')
    const fixtureRoot = join(workspaceRoot, 'project', 'docs', 'nested', 'fixtures')
    mkdirSync(join(fixtureRoot, 'excalidraw'), { recursive: true })
    cpSync(MEDIA_FIXTURE_DIR, join(fixtureRoot, 'local-media'), { recursive: true })
    const markdownPath = join(fixtureRoot, 'local-media', 'media.md')
    const excalidrawPath = join(fixtureRoot, 'excalidraw', 'compatible-no-type.excalidraw')
    cpSync(COMPATIBLE_EXCALIDRAW_FIXTURE, excalidrawPath)
    const original = readFileSync(excalidrawPath, 'utf8')
    const originalLabel = '按兼容模式渲染'
    const updatedLabel = '自动刷新验证已生效'
    const browserErrors: string[] = []
    const resourceFailures: Array<{ url: string; error?: string; resourceType: string; blobMime?: string }> = []
    const mainStderr: string[] = []
    await page.evaluate(() => {
      const types = new Map<string, string>()
      ;(window as any).__watchBlobTypes = types
      const create = URL.createObjectURL.bind(URL)
      URL.createObjectURL = blob => {
        const url = create(blob)
        types.set(url, blob instanceof Blob ? blob.type : 'media-source')
        return url
      }
    })
    page.on('requestfailed', async request => {
      const url = new URL(request.url())
      const label = url.protocol === 'file:' ? `file://…/${url.pathname.split('/').pop()}`
        : /^https?:$/.test(url.protocol) ? `${url.protocol}//${url.hostname}${url.pathname}` : `${url.protocol}<redacted>`
      const blobMime = url.protocol === 'blob:' ? await page.evaluate(value => (window as any).__watchBlobTypes.get(value), request.url()).catch(() => undefined) : undefined
      resourceFailures.push({ url: label, error: request.failure()?.errorText, resourceType: request.resourceType(), blobMime })
    })
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', error => browserErrors.push(error.message))
    electronApp.process().stderr?.on('data', chunk => mainStderr.push(String(chunk)))

    try {
      await electronApp.evaluate(({ dialog }, rootPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rootPath] })
      }, workspaceRoot)
      const activation = await page.evaluate(() => window.api.openFolder())
      if (!activation) throw new Error('测试工作区打开失败')
      await electronApp.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('restore-folder', payload)
      }, activation)
      await page.waitForSelector('.file-tree-container', { timeout: 10_000 })
      const activeRoot = await page.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        return bootstrap.workspaces.find(workspace => workspace.id === bootstrap.activeWorkspaceId)?.primaryRoot
      })
      expect(activeRoot).toBe(workspaceRoot)
      await electronApp.evaluate(({ BrowserWindow }, filePath) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('open-specific-file', filePath)
      }, markdownPath)

      await expect(page.locator('.tab.active', { hasText: 'media.md' })).toBeVisible()
      await expect(page.locator('.excalidraw-wrapper')).toHaveCount(2, { timeout: 15_000 })
      const compatibleSvg = page.locator('.excalidraw-wrapper').nth(1).locator('.excalidraw-container svg')
      await expect(compatibleSvg).toContainText(originalLabel)
      await expect.poll(async () => {
        const bootstrap = await page.evaluate(() => window.api.getWorkspaceBootstrap())
        const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
        return page.evaluate(async ({ id, lifecycleEpoch }) => (
          await window.api.getWatchStatus(id, lifecycleEpoch)
        ).state, workspace)
      }).toBe('healthy')

      writeFileSync(excalidrawPath, original.replaceAll(originalLabel, updatedLabel))
      await expect(compatibleSvg).toContainText(updatedLabel, { timeout: 15_000 })
      await expect(compatibleSvg).not.toContainText(originalLabel)
      await page.locator('.excalidraw-wrapper').nth(1).screenshot({
        path: testInfo.outputPath('excalidraw-auto-refresh-updated.png'),
      })

      writeFileSync(excalidrawPath, original)
      await expect(compatibleSvg).toContainText(originalLabel, { timeout: 15_000 })
      await expect(compatibleSvg).not.toContainText(updatedLabel)
      const unexpectedBrowserErrors = browserErrors.filter(message => !(
        message.includes("Loading the font 'https://esm.sh/@excalidraw/excalidraw@0.18.1/")
        && message.includes('Content Security Policy')
      ))
      expect(unexpectedBrowserErrors).toEqual([])
    } finally {
      if (readFileSync(excalidrawPath, 'utf8') !== original) writeFileSync(excalidrawPath, original)
      await testInfo.attach('browser-errors', {
        body: browserErrors.join('\n') || '(none)',
        contentType: 'text/plain',
      })
      await testInfo.attach('failed-resource-urls', { body: JSON.stringify(resourceFailures), contentType: 'application/json' })
      await testInfo.attach('main-stderr', {
        body: mainStderr.join('') || '(none)',
        contentType: 'text/plain',
      })
    }
  })

  test('切换工作区后重新签发媒体 capability 并恢复播放器', async ({
    electronApp,
    page,
    testDir,
  }) => {
    const mediaWorkspace = join(testDir, 'media-workspace-lifecycle')
    const contentRoot = join(mediaWorkspace, 'docs', 'probe')
    mkdirSync(contentRoot, { recursive: true })
    copyMediaFixture(contentRoot)
    const plainWorkspace = join(testDir, 'plain-workspace-lifecycle')
    mkdirSync(plainWorkspace, { recursive: true })
    writeFileSync(join(plainWorkspace, 'plain.md'), '# Plain workspace')

    await openFolderViaIPC(electronApp, mediaWorkspace)
    await expect(page.locator('.tab.active', { hasText: 'media.md' })).toBeVisible()
    await expect(page.locator('.markdown-body video')).toHaveCount(4)
    await page.waitForFunction(() => {
      const media = [...document.querySelectorAll<HTMLMediaElement>('.markdown-body video, .markdown-body audio')]
      return media.length === 7 && media.every(element => (
        !element.error && element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      ))
    }, undefined, { timeout: 15_000 })
    const firstSources = await page.locator('.markdown-body source').evaluateAll(sources => (
      sources.map(source => source.src)
    ))

    await openFolderViaIPC(electronApp, plainWorkspace)
    await expect(page.locator('.tab.active', { hasText: 'plain.md' })).toBeVisible()
    await expect(page.locator('.markdown-body')).toContainText('Plain workspace')

    await openFolderViaIPC(electronApp, mediaWorkspace)
    await expect(page.locator('.tab.active', { hasText: 'media.md' })).toBeVisible()
    await expect(page.locator('.markdown-body video')).toHaveCount(4)
    await page.waitForFunction(() => {
      const media = [...document.querySelectorAll<HTMLMediaElement>('.markdown-body video, .markdown-body audio')]
      return media.length === 7 && media.every(element => (
        !element.error && element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      ))
    }, undefined, { timeout: 15_000 })
    const secondSources = await page.locator('.markdown-body source').evaluateAll(sources => (
      sources.map(source => source.src)
    ))

    expect(secondSources).toHaveLength(8)
    expect(secondSources).not.toEqual(firstSources)
    await expect(page.locator('.local-media-fallback')).toHaveCount(0)
  })

  test('不可解码媒体稳定降级且不回退裸文件 URL', async ({
    electronApp,
    page,
    testDir,
  }) => {
    const workspace = join(testDir, 'bad-codec')
    mkdirSync(workspace, { recursive: true })
    const markdownPath = join(workspace, 'bad.md')
    writeFileSync(markdownPath, '# Bad codec\n\n<audio src="broken.mp3" controls></audio>')
    writeFileSync(join(workspace, 'broken.mp3'), 'not an audio stream')

    await openFolderViaIPC(electronApp, workspace)
    await page.locator('.tab', { hasText: 'bad.md' }).waitFor({ state: 'visible' })
    await page.locator('.markdown-body audio').evaluate(async audio => {
      try {
        await Promise.race([
          audio.play(),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 3_000)),
        ])
      } catch {
        // 解码错误会由播放器 error 事件转换成稳定 fallback。
      }
    })
    const fallback = page.locator('.local-media-fallback')
    await expect(fallback).toBeVisible({ timeout: 15_000 })
    await expect(fallback).toContainText('无法加载或播放本地媒体，文件可能无法读取或格式不受支持：broken.mp3')
    await expect(fallback).toContainText('可尝试使用支持该格式的系统播放器打开原文件。')
    await expect(page.locator('.markdown-body audio')).toHaveCount(0)
    const html = await page.locator('.markdown-body').innerHTML()
    expect(html).not.toContain('local-media://')
    expect(html).not.toContain('file://')
    expect(html).not.toContain(workspace)
  })

  test('GUI HTML 保留相对媒体链接且 PDF 使用静态降级', async ({
    electronApp,
    page,
    testDir,
  }) => {
    const workspace = join(testDir, 'local-media-export')
    const contentRoot = join(workspace, 'docs', 'probe')
    mkdirSync(contentRoot, { recursive: true })
    copyMediaFixture(contentRoot)
    const outputDir = join(contentRoot, 'exports')
    mkdirSync(outputDir, { recursive: true })
    const htmlPath = join(outputDir, 'media.html')
    const pdfPath = join(outputDir, 'media.pdf')

    await openFolderViaIPC(electronApp, workspace)
    await page.locator('.tab', { hasText: 'media.md' }).waitFor({ state: 'visible' })
    await expect(page.locator('.markdown-body video')).toHaveCount(4)

    await mockSaveDialog(electronApp, htmlPath)
    await triggerExport(electronApp, 'markdown:export-html')
    await continuePreflightIfShown(page)
    await waitForFile(htmlPath)

    const html = readFileSync(htmlPath, 'utf8')
    expect(html).toContain('<source src="../videos/demo.webm#t=0.5,2.5" type="video/webm">')
    expect(html).toContain('<source src="../videos/demo.mp4" type="video/mp4">')
    expect(html).toContain('<track src="../videos/zh.vtt" kind="subtitles" srclang="zh-CN" label="中文" default>')
    expect(html).toContain('poster="../images/poster.png"')
    expect(html).toContain('<source src="../audio/tone.mp3" type="audio/mpeg">')
    expect(html).toContain('data:image/avif;base64,')
    expect(html).toContain('data:image/bmp;base64,')
    expect(html).toContain('class="bpmn-wrapper"')
    expect(html).toContain('class="excalidraw-container"')
    expect(html).not.toContain('bpmn-file-placeholder')
    expect(html).not.toContain('excalidraw-file-placeholder')
    expect(html).not.toContain('local-media:')
    expect(html).not.toContain('file:')
    expect(html).not.toContain(workspace)

    await mockSaveDialog(electronApp, pdfPath)
    await triggerExport(electronApp, 'markdown:export-pdf')
    await continuePreflightIfShown(page)
    await waitForFile(pdfPath)

    const pdf = readFileSync(pdfPath)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(statSync(pdfPath).size).toBeGreaterThan(1000)
    expect(pdf.toString('latin1')).not.toContain('local-media://')
    expect(pdf.toString('latin1')).not.toContain(workspace)
  })
})
