import { mkdirSync } from 'fs'
import { join } from 'path'
import { test, expect } from './fixtures/electron'

const OUT_DIR = join(process.cwd(), 'test-results', 'read-aloud-visual')

test.describe('语音服务声音方案', () => {
  test('新增声音方案后原方案与新方案都保留', async ({ page, electronApp }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1000, height: 800 })
    })

    await page.locator('.nav-settings-btn').click()
    await page.getByRole('tab', { name: '朗读' }).click()
    const panel = page.getByRole('tabpanel', { name: '朗读' })
    await panel.getByRole('button', { name: '+ 添加 OpenAI 服务' }).click()

    const card = panel.locator('.tts-provider-card').last()
    await expect(card.locator('.tts-voice-profile')).toHaveCount(1)
    await expect(card.getByRole('combobox', { name: /默认声音方案/ })).toHaveValue(/voice-profile-/)

    await card.getByRole('button', { name: '+ 添加声音方案' }).click()

    await expect(card.locator('.tts-voice-profile')).toHaveCount(2)
    await expect(card.getByRole('combobox', { name: /默认声音方案/ }).locator('option')).toHaveCount(2)
    await card.screenshot({ path: join(OUT_DIR, 'openai-two-voice-profiles.png') })
  })
})
