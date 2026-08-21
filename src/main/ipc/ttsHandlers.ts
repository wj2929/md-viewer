/**
 * TTS IPC handlers
 * @module main/ipc/ttsHandlers
 * @description 朗读合成/取消/音色/测试/存key。渲染进程只传 opaque providerId 和播放参数,
 * provider 配置由主进程从 AppSettings 解析；apiKey 由 keyStore(safeStorage)自取,不经渲染进程。
 */

import { ipcMain } from 'electron'
import type { IPCContext } from './context'
import { synthesize, TtsSynthesisError, type SynthesizeRequest } from '../tts/ttsService'
import { EDGE_ZH_VOICES } from '../tts/EdgeAdapter'
import {
  providerTarget,
  validateReadAloudSettings,
} from '../tts/ttsSettings'
import { setProviderKey, deleteProviderKey, hasProviderKey, isEncryptionAvailable } from '../tts/keyStore'
import {
  defaultReadAloudSettings,
  findProviderConfig,
  type ReadAloudSettings,
  type TtsProviderType,
} from '../../shared/ttsProviders'

type InFlightReason = 'user-cancel' | 'timeout'
interface InFlightTask {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  reason?: InFlightReason
}

/** 进行中的合成任务:窗口 + requestId → 可取消且有截止时间的任务 */
const inFlight = new Map<string, InFlightTask>()
const SYNTHESIS_TIMEOUT_MS = 30_000
const PROVIDER_TEST_TIMEOUT_MS = 10_000

function createInFlightTask(timeoutMs: number): InFlightTask {
  const task: InFlightTask = {
    controller: new AbortController(),
    timer: undefined as unknown as ReturnType<typeof setTimeout>,
  }
  task.timer = setTimeout(() => {
    task.reason = 'timeout'
    task.controller.abort()
  }, timeoutMs)
  return task
}

function classifyTaskError(err: unknown, task: InFlightTask) {
  if ((err as Error).message === 'aborted' || (err as Error).name === 'AbortError') {
    if (task.reason === 'timeout') {
      return { ok: false as const, kind: 'network', message: '语音合成超时' }
    }
    return { ok: false as const, kind: 'aborted', message: '已取消' }
  }
  const kind = err instanceof TtsSynthesisError ? err.kind : 'unknown'
  return { ok: false as const, kind, message: (err as Error).message }
}

function requestKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`
}

function getReadAloudSettings(ctx: IPCContext): ReadAloudSettings {
  return validateReadAloudSettings(
    ctx.appDataManager.getSettings().readAloud ?? defaultReadAloudSettings()
  )
}

function resolveRequest(ctx: IPCContext, req: SynthesizeRequest): SynthesizeRequest {
  const settings = getReadAloudSettings(ctx)
  const provider = findProviderConfig(settings.providers, req.providerId)
  if (!provider || !provider.enabled || provider.type !== req.type || provider.type === 'system') {
    throw new TtsSynthesisError('config', '朗读服务不存在、已禁用或类型不匹配')
  }
  const activeProfile = provider.type === 'openai'
    ? provider.profiles?.find((profile) => profile.id === provider.activeProfileId)
    : undefined
  return {
    providerId: provider.id,
    type: provider.type,
    text: req.text,
    voice: activeProfile?.voice ?? provider.voice,
    rate: req.rate,
    baseUrl: provider.baseUrl,
    region: provider.region,
    model: activeProfile?.model ?? provider.model,
  }
}

function resolvePaidProvider(ctx: IPCContext, providerId: string) {
  const settings = getReadAloudSettings(ctx)
  const provider = findProviderConfig(settings.providers, providerId)
  if (!provider || !provider.enabled || (provider.type !== 'openai' && provider.type !== 'azure')) {
    throw new Error('付费朗读服务不存在、已禁用或类型不受支持')
  }
  return provider
}

function withKeyState(settings: ReadAloudSettings): ReadAloudSettings {
  return {
    ...settings,
    providers: settings.providers.map((provider) => {
      if (provider.type !== 'openai' && provider.type !== 'azure') return provider
      return {
        ...provider,
        hasApiKey: hasProviderKey(provider.id, providerTarget(provider)),
      }
    }),
  }
}

function isCustomProviderId(providerId: string): boolean {
  return /^custom-tts-[a-z0-9-]{1,80}$/i.test(providerId)
}

export function registerTtsHandlers(ctx: IPCContext): void {
  ipcMain.handle('tts:synthesize', async (event, req: SynthesizeRequest & { requestId: string }) => {
    const key = requestKey(event.sender.id, req.requestId)
    const previous = inFlight.get(key)
    if (previous) {
      previous.reason = 'user-cancel'
      previous.controller.abort()
      clearTimeout(previous.timer)
    }
    const task = createInFlightTask(SYNTHESIS_TIMEOUT_MS)
    inFlight.set(key, task)
    try {
      const result = await synthesize(resolveRequest(ctx, req), task.controller.signal)
      return { ok: true, ...result }
    } catch (err) {
      return classifyTaskError(err, task)
    } finally {
      clearTimeout(task.timer)
      if (inFlight.get(key) === task) inFlight.delete(key)
    }
  })

  ipcMain.handle('tts:cancel', (event, requestId: string) => {
    const key = requestKey(event.sender.id, requestId)
    const task = inFlight.get(key)
    if (task) {
      task.reason = 'user-cancel'
      task.controller.abort()
      clearTimeout(task.timer)
      inFlight.delete(key)
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
    const task = createInFlightTask(PROVIDER_TEST_TIMEOUT_MS)
    try {
      await synthesize({ ...resolveRequest(ctx, req), text: '测试' }, task.controller.signal)
      return { ok: true }
    } catch (err) {
      return classifyTaskError(err, task)
    } finally {
      clearTimeout(task.timer)
    }
  })

  ipcMain.handle('tts:getSettings', () => withKeyState(getReadAloudSettings(ctx)))

  ipcMain.handle('tts:updateSettings', (_, value: unknown) => {
    const next = validateReadAloudSettings(value)
    const previous = getReadAloudSettings(ctx)
    const previousById = new Map(previous.providers.map((provider) => [provider.id, provider]))

    const providers = next.providers.map((provider) => {
      if (provider.type !== 'openai' && provider.type !== 'azure') return provider
      const previousProvider = previousById.get(provider.id)
      const target = providerTarget(provider)
      if (!target || (previousProvider && providerTarget(previousProvider) !== target)) {
        deleteProviderKey(provider.id)
      }
      return { ...provider, hasApiKey: hasProviderKey(provider.id, target) }
    })
    for (const provider of previous.providers) {
      if (
        (provider.type === 'openai' || provider.type === 'azure')
        && !providers.some((candidate) => candidate.id === provider.id)
      ) {
        deleteProviderKey(provider.id)
      }
    }

    const settings = { ...next, providers }
    ctx.appDataManager.updateSettings({ readAloud: settings })
    return settings
  })

  ipcMain.handle('tts:setKey', (_, providerId: string, apiKey: string) => {
    try {
      if (!isCustomProviderId(providerId)) throw new Error('朗读服务 ID 无效')
      let target: string | undefined
      if (apiKey) {
        const provider = resolvePaidProvider(ctx, providerId)
        target = providerTarget(provider)
        if (!target) throw new Error('请先完成朗读服务地址或区域配置')
        setProviderKey(providerId, apiKey, target)
      } else {
        deleteProviderKey(providerId)
      }
      return { ok: true, hasKey: hasProviderKey(providerId, target) }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('tts:encryptionAvailable', () => isEncryptionAvailable())
}
