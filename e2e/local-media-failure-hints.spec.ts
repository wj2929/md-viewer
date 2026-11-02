import { copyFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const fixtureDir = join(__dirname, 'fixtures', 'local-media')

test.describe('本地媒体必要失败提示', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(async () => {
      const settings = await window.api.getAppSettings()
      await window.api.updateAppSettings({
        diagnosticLogs: { ...settings.diagnosticLogs, enabled: false },
      })
    })
  })

  test('真实坏音视频提示失败，多 source 和有效对照仍可播放', async ({ electronApp, page, testDir }, testInfo) => {
    const workspace = join(testDir, 'media-failure-hints')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'broken.mp4'), 'not an mp4 file')
    writeFileSync(join(workspace, 'broken.mp3'), 'not an mp3 file')
    copyFileSync(join(fixtureDir, 'videos', 'demo.mp4'), join(workspace, 'valid.mp4'))
    copyFileSync(join(fixtureDir, 'audio', 'tone.mp3'), join(workspace, 'valid.mp3'))
    writeFileSync(join(workspace, 'media.md'), [
      '# 本地媒体终态提示',
      '<video src="broken.mp4" title="坏视频" controls preload="metadata"></video>',
      '<audio src="broken.mp3" title="坏音频" controls preload="metadata"></audio>',
      '<audio src="missing.mp3" title="缺失音频" controls></audio>',
      '<video src="valid.mp4" title="有效视频" controls muted></video>',
      '<audio src="valid.mp3" title="有效音频" controls></audio>',
      '<video title="多源视频" controls muted><source src="broken.mp4"><source src="valid.mp4"></video>',
      '<audio title="多源音频" controls><source src="missing.mp3"><source src="valid.mp3"></audio>',
    ].join('\n\n'))

    await openFolderViaIPC(electronApp, workspace)
    const notes = page.locator('.markdown-body .local-media-fallback')
    await expect(notes).toHaveCount(3, { timeout: 15_000 })
    for (const label of ['坏视频', '坏音频']) {
      const note = notes.filter({ hasText: label })
      await expect(note).toContainText('无法加载或播放本地媒体，文件可能无法读取或格式不受支持')
      await expect(note).toContainText('可尝试使用支持该格式的系统播放器打开原文件。')
    }
    await expect(notes.filter({ hasText: '缺失音频' }))
      .toContainText('无法访问本地媒体，请确认文件存在且可读取')
    expect((await notes.allTextContents()).join('\n')).not.toMatch(/127\.0\.0\.1|local-media:|\/asset\/|PIPELINE|ENOENT|\/Users\//)
    await expect(notes.locator('button, a')).toHaveCount(0)

    for (const label of ['有效视频', '有效音频', '多源视频', '多源音频']) {
      const player = page.locator('.markdown-body .local-media-player')
        .and(page.getByLabel(label, { exact: true }))
      await expect.poll(() => player.evaluate((element: HTMLMediaElement) => ({
        ready: element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
        error: element.error?.code ?? null,
      })), { timeout: 10_000 }).toEqual({ ready: true, error: null })
      await player.evaluate(async (element: HTMLMediaElement) => {
        element.muted = true
        await element.play()
      })
      await expect.poll(() => player.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(0)
      await player.evaluate((element: HTMLMediaElement) => element.pause())
    }
    await expect(notes).toHaveCount(3)
    await page.screenshot({ path: testInfo.outputPath('media-failure-hints.png'), fullPage: true })
  })

  test('preload none 的有效音视频等待期间不误报，仍可播放', async ({ electronApp, page, testDir }) => {
    const workspace = join(testDir, 'media-no-preload')
    mkdirSync(workspace)
    copyFileSync(join(fixtureDir, 'videos', 'demo.mp4'), join(workspace, 'valid.mp4'))
    copyFileSync(join(fixtureDir, 'audio', 'tone.mp3'), join(workspace, 'valid.mp3'))
    writeFileSync(join(workspace, 'media.md'), [
      '# 按需媒体',
      '<video src="valid.mp4" title="有效按需视频" controls preload="none"></video>',
      '<audio src="valid.mp3" title="有效按需音频" controls preload="none"></audio>',
    ].join('\n\n'))
    await openFolderViaIPC(electronApp, workspace)
    const players = page.locator('.markdown-body .local-media-player')
    await expect(players).toHaveCount(2)
    // 越过既有五秒失败检查；preload 只是浏览器提示，不假定 readyState 必须为零。
    await page.waitForTimeout(6_000)
    await expect(page.locator('.markdown-body .local-media-fallback')).toHaveCount(0)
    expect(await players.evaluateAll(elements => elements.map(element => {
      const media = element as HTMLMediaElement
      return { preload: media.preload, paused: media.paused, error: media.error?.code ?? null }
    }))).toEqual([
      { preload: 'none', paused: true, error: null },
      { preload: 'none', paused: true, error: null },
    ])
    for (const player of await players.all()) {
      await player.evaluate(async (media: HTMLMediaElement) => {
        media.muted = true
        await media.play()
      })
      await expect.poll(() => player.evaluate((media: HTMLMediaElement) => media.currentTime)).toBeGreaterThan(0)
      await player.evaluate((media: HTMLMediaElement) => media.pause())
    }
    await expect(page.locator('.markdown-body .local-media-fallback')).toHaveCount(0)
  })
})
