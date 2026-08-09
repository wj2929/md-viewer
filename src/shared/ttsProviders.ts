/**
 * TTS provider 共享定义(主进程 + 渲染进程共用)
 * @module shared/ttsProviders
 * @description 类型分层:静态能力元数据 vs 运行时用户配置(照 OpenMAIC 模式)。
 */

export type TtsProviderType = 'system' | 'edge' | 'openai' | 'azure'

/** 静态能力元数据(内建注册表) */
export interface TtsProviderMeta {
  type: TtsProviderType
  /** 是否需要 apiKey */
  requiresApiKey: boolean
  /** 是否需要联网 */
  requiresNetwork: boolean
  /** 默认端点(付费/本地) */
  defaultBaseUrl?: string
  /** 是否内建不可删 */
  builtin: boolean
}

/** 运行时用户配置(存 AppSettings;apiKey 不落这里,走 safeStorage) */
export interface TtsProviderConfig {
  /** opaque id;内建 'system'/'edge';自定义 'custom-tts-<uuid>' */
  id: string
  type: TtsProviderType
  /** 显示名 */
  name: string
  /** 付费/本地端点 */
  baseUrl?: string
  /** Azure region */
  region?: string
  /** 选中音色 */
  voice?: string
  /** 模型(openai) */
  model?: string
  enabled: boolean
  /** 是否已设置 apiKey(真实 key 在 safeStorage) */
  hasApiKey?: boolean
}

/** 朗读全局设置 */
export interface ReadAloudSettings {
  activeProviderId: string
  defaultRate: number
  fallbackToSystem: boolean
  /** 用户配置的 provider(含内建 system/edge) */
  providers: TtsProviderConfig[]
}

/** 内建 provider 元数据(不可删) */
export const BUILTIN_TTS_META: Record<string, TtsProviderMeta> = {
  system: { type: 'system', requiresApiKey: false, requiresNetwork: false, builtin: true },
  edge: { type: 'edge', requiresApiKey: false, requiresNetwork: true, builtin: true },
}

/** 付费 provider 类型的默认元数据(用户添加时套用) */
export const PAID_TTS_META: Record<'openai' | 'azure', TtsProviderMeta> = {
  openai: {
    type: 'openai',
    requiresApiKey: true,
    requiresNetwork: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    builtin: false,
  },
  azure: {
    type: 'azure',
    requiresApiKey: true,
    requiresNetwork: true,
    builtin: false,
  },
}

/** 默认朗读设置:内建 system + edge,默认用 edge */
export function defaultReadAloudSettings(): ReadAloudSettings {
  return {
    activeProviderId: 'edge',
    defaultRate: 1,
    fallbackToSystem: true,
    providers: [
      { id: 'system', type: 'system', name: '系统声（离线）', enabled: true },
      { id: 'edge', type: 'edge', name: '晓晓（edge 免费）', enabled: true, voice: 'zh-CN-XiaoxiaoNeural' },
    ],
  }
}

/**
 * provider guard:安全查配置(防原型链污染)。
 * providerId 来自持久化配置,可能是 'toString'/'constructor' 等原型键。
 */
export function findProviderConfig(
  providers: TtsProviderConfig[],
  id: string
): TtsProviderConfig | undefined {
  if (!Array.isArray(providers)) return undefined
  return providers.find((p) => Object.prototype.hasOwnProperty.call(p, 'id') && p.id === id)
}
