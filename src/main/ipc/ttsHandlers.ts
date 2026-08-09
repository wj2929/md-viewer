/**
 * TTS IPC handlers
 * @module main/ipc/ttsHandlers
 * @description 朗读合成/取消/音色/测试/存key。渲染进程只传 opaque providerId + 非敏感配置,
 * apiKey 由主进程从 keyStore(safeStorage)自取,不经渲染进程。
 */

import { ipcMain } from 'electron'
import { synthesize, TtsSynthesisError, type SynthesizeRequest } from '../tts/ttsService'
import { EDGE_ZH_VOICES } from '../tts/EdgeAdapter'
import { setProviderKey, deleteProviderKey, hasProviderKey, isEncryptionAvailable } from '../tts/keyStore'
import type { TtsProviderType } from '../../shared/ttsProviders'

/** 进行中的合成任务:requestId → AbortController(供 tts:cancel 取消) */
const inFlight = new Map<string, AbortController>()

export function registerTtsHandlers(): void {
  ipcMain.handle('tts:synthesize', async (_, req: SynthesizeRequest & { requestId: string }) => {
    const controller = new AbortController()
    inFlight.set(req.requestId, controller)
    try {
      const result = await synthesize(req, controller.signal)
      return { ok: true, ...result }
    } catch (err) {
      if ((err as Error).message === 'aborted') {
        return { ok: false, kind: 'aborted', message: '已取消' }
      }
      const kind = err instanceof TtsSynthesisError ? err.kind : 'unknown'
      return { ok: false, kind, message: (err as Error).message }
    } finally {
      inFlight.delete(req.requestId)
    }
  })

  ipcMain.handle('tts:cancel', (_, requestId: string) => {
    const controller = inFlight.get(requestId)
    if (controller) {
      controller.abort()
      inFlight.delete(requestId)
    }
    return { ok: true }
  })

  ipcMain.handle('tts:listVoices', (_, type: TtsProviderType) => {
    // 第一期:edge 返回内建中文音色表;其它类型由渲染进程处理(system)或后续接入
    if (type === 'edge') return EDGE_ZH_VOICES
    return []
  })

  /** 测试连接 = 合成一句短音(照 OpenMAIC「测试=合成一句」),不落地 */
  ipcMain.handle('tts:testProvider', async (_, req: SynthesizeRequest) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      await synthesize({ ...req, text: '测试' }, controller.signal)
      return { ok: true }
    } catch (err) {
      const kind = err instanceof TtsSynthesisError ? err.kind : 'unknown'
      return { ok: false, kind, message: (err as Error).message }
    } finally {
      clearTimeout(timer)
    }
  })

  ipcMain.handle('tts:setKey', (_, providerId: string, apiKey: string) => {
    try {
      if (apiKey) setProviderKey(providerId, apiKey)
      else deleteProviderKey(providerId)
      return { ok: true, hasKey: hasProviderKey(providerId) }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('tts:encryptionAvailable', () => isEncryptionAvailable())
}
