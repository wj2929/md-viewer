import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './fixtures/electron'

type NativeSpeechRow = { text: string; lang: string; voiceLang?: string; requestedAt: number; started: boolean; ended: boolean; error?: string }

for (const systemVoice of ['', '语舒', 'fixture-unavailable-voice']) {
  test(`真实系统语音静音验证中文与英文回退：${systemVoice || 'auto'}`, async ({ page, electronApp, testDir }, info) => {
    let selectedVoiceLanguage: string | undefined
    const read = () => page.evaluate(() => (window as any).__nativeLanguageSpeech as NativeSpeechRow[] | undefined)
    try {
      await page.evaluate(async voice => {
        const settings = await window.api.getReadAloudSettings()
        settings.activeProviderId = 'edge'
        settings.fallbackToSystem = true
        settings.providers.find(provider => provider.id === 'system')!.voice = voice || undefined
        settings.providers.find(provider => provider.id === 'edge')!.voice = 'zh-CN-YunxiNeural'
        await window.api.updateReadAloudSettings(settings)
      }, systemVoice)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('.app')).toBeVisible()
      const path = join(testDir, '中文系统回退.md')
      writeFileSync(path, '# 中文测试\n\n这是中文语音测试。\n\nHello world.')
      await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), path)
      await expect(page.locator('.markdown-body h1')).toHaveText('中文测试')
      await expect.poll(() => page.evaluate(() => speechSynthesis.getVoices().filter(voice => voice.lang === 'zh-CN').length)).toBeGreaterThan(0)
      selectedVoiceLanguage = await page.evaluate(id => speechSynthesis.getVoices().find(voice => voice.voiceURI === id || voice.name === id)?.lang, systemVoice)
      await electronApp.evaluate(({ ipcMain }) => {
        const failures: number[] = []
        ;(globalThis as any).__speechOfflineFailures = failures
        ;(ipcMain as any)._invokeHandlers.set('tts:synthesize', async () => {
          failures.push(Date.now())
          return { ok: false, kind: 'network', message: 'self-fixture offline' }
        })
      })
      await page.evaluate(() => {
        const rows: NativeSpeechRow[] = []
        Object.assign(window, { __nativeLanguageSpeech: rows })
        const speak = speechSynthesis.speak.bind(speechSynthesis)
        Object.defineProperty(speechSynthesis, 'speak', { configurable: true, value: (utterance: SpeechSynthesisUtterance) => {
          const row: NativeSpeechRow = { text: utterance.text, lang: utterance.lang, voiceLang: utterance.voice?.lang, requestedAt: Date.now(), started: false, ended: false }
          rows.push(row)
          utterance.volume = 0
          utterance.addEventListener('start', () => { row.started = true })
          utterance.addEventListener('end', () => { row.ended = true })
          utterance.addEventListener('error', event => { row.error = event.error })
          speak(utterance)
        } })
      })
      await page.getByRole('button', { name: '朗读', exact: true }).click()
      const controls = page.getByRole('group', { name: '朗读控制' })
      await expect(controls.getByRole('combobox', { name: 'Edge 音色' })).toHaveValue('zh-CN-YunxiNeural')
      await controls.getByRole('button', { name: '开始朗读' }).click()
      await expect.poll(async () => (await read() ?? []).filter(row => row.ended).length, { timeout: 20000 }).toBe(3)
      const rows = (await read())!
      const failures = await electronApp.evaluate(() => (globalThis as any).__speechOfflineFailures as number[])
      expect(failures.length).toBeGreaterThan(0)
      expect(failures[0]).toBeLessThanOrEqual(rows[0].requestedAt)
      // 有效显式音色保持用户选择；零音量下 start 仅作诊断，end/no-error 才是完成契约。
      const languages = selectedVoiceLanguage ? Array(3).fill(selectedVoiceLanguage) : ['zh-CN', 'zh-CN', 'en-US']
      expect(rows.map(row => row.lang)).toEqual(languages)
      expect(rows[0].lang).toBe('zh-CN')
      expect(rows[1].lang).toBe('zh-CN')
      expect(rows.every(row => row.ended && !row.error)).toBe(true)
      expect(rows.map(row => row.voiceLang)).toEqual(languages)
      await page.screenshot({ path: info.outputPath('native-language-fallback.png'), animations: 'disabled' })
    } finally {
      const rows = await read()
      const failures = await electronApp.evaluate(() => (globalThis as any).__speechOfflineFailures)
      await info.attach('native-speech-events', { body: JSON.stringify({ systemVoice, selectedVoiceLanguage, rows, failures, volume: 0, networkInjected: true }), contentType: 'application/json' })
    }
  })
}
