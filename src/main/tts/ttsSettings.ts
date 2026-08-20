import {
  DEFAULT_EDGE_VOICE,
  defaultReadAloudSettings,
  isSupportedEdgeVoice,
  type ReadAloudSettings,
  type TtsProviderConfig,
  type TtsVoiceProfile,
} from '../../shared/ttsProviders'

const CUSTOM_ID = /^custom-tts-[a-z0-9-]{1,80}$/i
const PROFILE_ID = /^voice-profile-[a-z0-9-]{1,80}$/i
const AZURE_REGION = /^[a-z0-9-]{2,40}$/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function providerTarget(
  provider: Pick<TtsProviderConfig, 'type' | 'baseUrl' | 'region'>
): string | undefined {
  if (provider.type === 'openai') {
    return `openai:${normalizeOpenAiBaseUrl(provider.baseUrl)}`
  }
  if (provider.type === 'azure') {
    const region = provider.region?.trim().toLowerCase()
    return region ? `azure:${region}` : undefined
  }
  return undefined
}

export function validateReadAloudSettings(value: unknown): ReadAloudSettings {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    throw new Error('朗读设置格式无效')
  }
  if (value.providers.length < 2 || value.providers.length > 22) {
    throw new Error('朗读服务数量无效')
  }

  const providers = value.providers.map(validateProvider)
  const ids = new Set(providers.map((provider) => provider.id))
  if (ids.size !== providers.length) throw new Error('朗读服务 ID 重复')

  const system = providers.filter((provider) => provider.id === 'system')
  const edge = providers.filter((provider) => provider.id === 'edge')
  if (system.length !== 1 || system[0].type !== 'system') {
    throw new Error('系统朗读服务配置无效')
  }
  if (edge.length !== 1 || edge[0].type !== 'edge') {
    throw new Error('Edge 朗读服务配置无效')
  }

  const activeProviderId = readString(value.activeProviderId, '默认朗读服务', 100)
  if (!providers.some((provider) => provider.id === activeProviderId && provider.enabled)) {
    throw new Error('默认朗读服务不存在或已禁用')
  }
  if (
    typeof value.defaultRate !== 'number'
    || !Number.isFinite(value.defaultRate)
    || value.defaultRate < 0.5
    || value.defaultRate > 2
  ) {
    throw new Error('默认语速无效')
  }
  if (typeof value.fallbackToSystem !== 'boolean') {
    throw new Error('朗读 fallback 配置无效')
  }

  return {
    activeProviderId,
    defaultRate: value.defaultRate,
    fallbackToSystem: value.fallbackToSystem,
    providers,
  }
}

export function defaultValidatedReadAloudSettings(): ReadAloudSettings {
  return validateReadAloudSettings(defaultReadAloudSettings())
}

function validateProvider(value: unknown): TtsProviderConfig {
  if (!isRecord(value)) throw new Error('朗读服务格式无效')
  const id = readString(value.id, '朗读服务 ID', 100)
  const type = value.type
  if (type !== 'system' && type !== 'edge' && type !== 'openai' && type !== 'azure') {
    throw new Error('朗读服务类型无效')
  }
  if ((type === 'system' && id !== 'system') || (type === 'edge' && id !== 'edge')) {
    throw new Error('内建朗读服务 ID 无效')
  }
  if ((type === 'openai' || type === 'azure') && !CUSTOM_ID.test(id)) {
    throw new Error('付费朗读服务 ID 无效')
  }
  if (typeof value.enabled !== 'boolean') throw new Error('朗读服务启用状态无效')

  const provider: TtsProviderConfig = {
    id,
    type,
    name: readString(value.name, '朗读服务名称', 100),
    enabled: value.enabled,
  }
  const voice = readOptionalString(value.voice, '朗读音色', 200)
  if (voice) provider.voice = type === 'edge' && !isSupportedEdgeVoice(voice)
    ? DEFAULT_EDGE_VOICE
    : voice

  if (type === 'openai') {
    provider.baseUrl = normalizeOpenAiBaseUrl(readOptionalString(value.baseUrl, 'OpenAI 服务地址', 500))
    const legacyModel = readOptionalString(value.model, 'OpenAI 模型', 100) || 'tts-1'
    const legacyVoice = voice || 'alloy'
    const profiles = Array.isArray(value.profiles)
      ? value.profiles.map(validateVoiceProfile)
      : [{ id: 'voice-profile-default', name: '默认声音', model: legacyModel, voice: legacyVoice }]
    if (profiles.length < 1 || profiles.length > 50) throw new Error('声音方案数量无效')
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
      throw new Error('声音方案 ID 重复')
    }
    const activeProfileId = readOptionalString(value.activeProfileId, '默认声音方案', 100)
      || profiles[0].id
    if (!profiles.some((profile) => profile.id === activeProfileId)) {
      throw new Error('默认声音方案不存在')
    }
    provider.profiles = profiles
    provider.activeProfileId = activeProfileId
    delete provider.voice
  }
  if (type === 'azure') {
    const region = readOptionalString(value.region, 'Azure region', 40)
    if (region && !AZURE_REGION.test(region)) throw new Error('Azure region 无效')
    if (region) provider.region = region.toLowerCase()
  }
  return provider
}

function validateVoiceProfile(value: unknown): TtsVoiceProfile {
  if (!isRecord(value)) throw new Error('声音方案格式无效')
  const id = readString(value.id, '声音方案 ID', 100)
  if (!PROFILE_ID.test(id)) throw new Error('声音方案 ID 无效')
  return {
    id,
    name: readString(value.name, '声音方案名称', 100),
    model: readString(value.model, '声音方案模型', 100),
    voice: readString(value.voice, '声音方案音色', 200),
  }
}

function normalizeOpenAiBaseUrl(baseUrl?: string): string {
  const raw = baseUrl?.trim() || 'https://api.openai.com/v1'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('OpenAI 服务地址无效')
  }
  const localHttp = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('OpenAI 服务地址必须使用 HTTPS；本机地址可使用 HTTP')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('OpenAI 服务地址不能包含凭据、查询参数或片段')
  }
  return url.toString().replace(/\/$/, '')
}

function readString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label}无效`)
  }
  return value.trim()
}

function readOptionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return readString(value, label, maxLength)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
