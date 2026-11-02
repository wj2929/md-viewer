import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './fixtures/electron'

test('Edge 云希真实合成与原生音频静音播放，不降级系统声', async ({ page, electronApp, testDir }, info) => {
  test.skip(process.env.MD_VIEWER_EDGE_LIVE_E2E !== '1', '仅显式启用时向免费 Edge 服务发送自建短句')
  test.setTimeout(45000)
  await page.evaluate(async () => {
    const settings = await window.api.getReadAloudSettings()
    settings.activeProviderId = 'edge'
    settings.fallbackToSystem = true
    settings.providers.find(provider => provider.id === 'edge')!.voice = 'zh-CN-YunxiNeural'
    await window.api.updateReadAloudSettings(settings)
  })
  await page.reload()
  await expect(page.locator('.app')).toBeVisible()
  const file = join(testDir, '云希真实验证.md')
  writeFileSync(file, '# 云希验证\n\n这是云希中文朗读验证。')
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), file)
  await expect(page.locator('.markdown-body h1')).toHaveText('云希验证')
  await electronApp.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers
    const original = handlers.get('tts:synthesize')
    const rows: Array<{ voice: string; providerId: string; ok: boolean; kind?: string; bytes: number }> = []
    Object.assign(globalThis, { __edgeLiveRequests: rows })
    handlers.set('tts:synthesize', async (event: unknown, request: any) => {
      const result = await original(event, request)
      rows.push({ voice: request.voice, providerId: request.providerId, ok: result.ok, kind: result.kind,
        bytes: result.audioBase64 ? Buffer.from(result.audioBase64, 'base64').length : 0 })
      return result
    })
  })
  await page.evaluate(() => {
    const rows: Array<{ started: boolean; ended: boolean; error: boolean; duration?: number }> = []
    const state = { rows, systemSpeechCalls: 0 }
    Object.assign(window, { __edgeLivePlayback: state })
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      this.volume = 0
      const row = { started: false, ended: false, error: false, duration: undefined as number | undefined }
      rows.push(row)
      this.addEventListener('playing', () => { row.started = true })
      this.addEventListener('ended', () => { row.ended = true; row.duration = this.duration })
      this.addEventListener('error', () => { row.error = true })
      return play.call(this)
    }
    const speak = speechSynthesis.speak.bind(speechSynthesis)
    speechSynthesis.speak = utterance => {
      state.systemSpeechCalls++
      utterance.volume = 0
      speak(utterance)
    }
  })
  await page.getByRole('button', { name: '朗读', exact: true }).click()
  const controls = page.getByRole('group', { name: '朗读控制' })
  await expect(controls.getByRole('combobox', { name: 'Edge 音色' })).toHaveValue('zh-CN-YunxiNeural')
  await controls.getByRole('button', { name: '开始朗读' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__edgeLivePlayback.rows.filter((row: any) => row.ended).length), { timeout: 35000 }).toBe(2)
  const playback = await page.evaluate(() => (window as any).__edgeLivePlayback)
  const requests = await electronApp.evaluate(() => (globalThis as any).__edgeLiveRequests)
  await info.attach('edge-live-audio', { body: JSON.stringify({ playback, requests, volume: 0, nativePlayback: true, mockedSynthesis: false }), contentType: 'application/json' })
  expect(requests).toHaveLength(2)
  expect(requests.every((row: any) => row.ok && row.bytes > 1000 && row.voice === 'zh-CN-YunxiNeural' && row.providerId === 'edge')).toBe(true)
  expect(playback.systemSpeechCalls).toBe(0)
  expect(playback.rows.every((row: any) => row.started && row.ended && !row.error && row.duration > 0)).toBe(true)
  await expect(controls.locator('.read-aloud-fallback')).not.toBeVisible()
  await page.screenshot({ path: info.outputPath('edge-yunxi-live.png'), animations: 'disabled' })
})
