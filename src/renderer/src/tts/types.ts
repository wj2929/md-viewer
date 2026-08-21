/**
 * TTS 朗读功能类型定义
 * @module tts/types
 * @description v2.7.0 语音朗读。类型分层:静态能力(TtsProviderMeta)与运行时配置(TtsProviderConfig)分离。
 */

/** 内建 provider 类型 + 付费类型 */
export type TtsProviderType = 'system' | 'edge' | 'openai' | 'azure'

/** 朗读单元:句子文本 + 所属已渲染 DOM 元素 + 句子在元素内的字符偏移(用于精确高亮) */
export interface SpeechSegment {
  /** 句子纯文本 */
  text: string
  /** 所属块级 DOM 元素(滚动定位 + 高亮的宿主) */
  element: HTMLElement
  /** 源码行号(若有),用于"从这段开始"定位 */
  sourceLine?: number
  /** 句子在 element.textContent 中的起始字符偏移(高亮 Range 用) */
  charStart?: number
  /** 句子在 element.textContent 中的结束字符偏移 */
  charEnd?: number
}

/** 朗读状态机的 5 个状态 */
export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

/** 音色信息 */
export interface TtsVoice {
  /** 音色 id(传给引擎) */
  id: string
  /** 显示名 */
  name: string
  /** 语言标签,如 zh-CN */
  lang?: string
}

/**
 * 朗读引擎统一接口。
 * 消除"系统声走渲染进程 / edge+付费走主进程"的双路径污染:
 * useSpeech 只跟此接口交互,不感知底层是 speechSynthesis 还是主进程音频。
 */
export interface TtsEngine {
  /** 从指定段落索引开始播放整个队列 */
  play(segments: SpeechSegment[], startIndex: number): void
  /** 暂停 */
  pause(): void
  /** 恢复 */
  resume(): void
  /** 停止并清理(含 in-flight 取消、资源释放) */
  stop(): void
  /** 设置语速(0.5-2) */
  setRate(rate: number): void
  /** 某段开始朗读时回调(驱动高亮),参数为段落在队列中的索引 */
  onSegmentStart(cb: (index: number) => void): void
  /** 全部读完回调 */
  onEnd(cb: () => void): void
  /** 出错回调(驱动兜底 / 提示) */
  onError(cb: (error: TtsEngineError) => void): void
  /** 释放引擎(解绑事件、释放音频资源) */
  dispose(): void
}

/** 引擎错误分类:决定能否 fallback */
export interface TtsEngineError {
  /**
   * network: 网络/限流(可 fallback 到系统声)
   * config: key 错/配置错(fallback 无意义,应提示改配置)
   * unsupported: 环境不支持(如无系统语音)
   * unknown: 其它
   */
  kind: 'network' | 'config' | 'unsupported' | 'unknown'
  message: string
  /** 合成失败所对应的段索引，供 fallback 从该段精确接管 */
  segmentIndex?: number
}
