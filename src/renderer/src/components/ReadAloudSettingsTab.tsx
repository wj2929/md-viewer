/**
 * 设置 · 朗读 Tab
 * @module components/ReadAloudSettingsTab
 * @description 多 TTS provider 管理:默认服务 + 语速 + 失败退回开关 + provider 列表(增删改/测试连接)。
 * 单一状态源 = readAloudStore。付费 key 走主进程 safeStorage(tts:setKey),不落 AppSettings。
 * provider 卡片照 DOCX 服务块范式:baseUrl/region/apiKey(password)/测试连接。
 */

import React, { useState, useCallback } from 'react'
import { useReadAloudStore } from '../stores/readAloudStore'
import {
  DEFAULT_EDGE_VOICE,
  EDGE_ZH_VOICES,
  type TtsProviderConfig,
  type TtsVoiceProfile,
} from '../../../shared/ttsProviders'
import {
  loadSystemVoices,
  toSystemVoiceOptions,
  type SystemVoiceOption,
} from '../tts/engines/SystemSpeechEngine'

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

const VoiceProfileEditor: React.FC<{
  profile: TtsVoiceProfile
  index: number
  isActive: boolean
  onSave: (patch: Pick<TtsVoiceProfile, 'name' | 'model' | 'voice'>) => Promise<boolean>
  onRemove: () => Promise<boolean>
  canRemove: boolean
}> = ({ profile, index, isActive, onSave, onRemove, canRemove }) => {
  const [name, setName] = useState(profile.name)
  const [model, setModel] = useState(profile.model)
  const [voice, setVoice] = useState(profile.voice)
  const save = (): void => {
    const patch = { name: name.trim(), model: model.trim(), voice: voice.trim() }
    if (!patch.name || !patch.model || !patch.voice) return
    void onSave(patch)
  }
  return <div className="tts-voice-profile" role="group" aria-label={`声音方案 ${index + 1}`}>
    <div className="tts-voice-profile-title">
      <strong>声音方案 {index + 1}</strong>
      {isActive && <span className="tts-voice-profile-active">当前默认</span>}
      <button className="btn-secondary btn-sm" disabled={!canRemove} onClick={() => void onRemove()}>删除方案</button>
    </div>
    <div className="tts-voice-profile-fields">
      <label>
        <span>方案名称</span>
        <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
      </label>
      <label>
        <span>模型</span>
        <input className="settings-input" value={model} placeholder="tts-1" onChange={(e) => setModel(e.target.value)} onBlur={save} />
      </label>
      <label>
        <span>音色</span>
        <input className="settings-input" value={voice} placeholder="alloy" onChange={(e) => setVoice(e.target.value)} onBlur={save} />
      </label>
    </div>
  </div>
}

/** 单个付费 provider 卡片:名称/端点/region/key/测试连接/删除 */
const PaidProviderCard: React.FC<{ config: TtsProviderConfig }> = ({ config }) => {
  const updateProvider = useReadAloudStore((s) => s.updateProvider)
  const addVoiceProfile = useReadAloudStore((s) => s.addVoiceProfile)
  const updateVoiceProfile = useReadAloudStore((s) => s.updateVoiceProfile)
  const removeVoiceProfile = useReadAloudStore((s) => s.removeVoiceProfile)
  const setActiveVoiceProfile = useReadAloudStore((s) => s.setActiveVoiceProfile)
  const removeProvider = useReadAloudStore((s) => s.removeProvider)

  const [name, setName] = useState(config.name)
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? '')
  const [region, setRegion] = useState(config.region ?? '')
  const [voice, setVoice] = useState(config.voice ?? '')
  const [apiKey, setApiKey] = useState('') // 只在本次输入时持有,保存后清空(真实 key 在钥匙串)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')

  // 先保存当前目标，再将 key 绑定到该目标
  const saveKey = useCallback(async (): Promise<boolean> => {
    if (!apiKey) return true
    const configSaved = await updateProvider(config.id, {
      baseUrl: baseUrl.trim() || undefined,
      region: region.trim() || undefined,
      voice: voice.trim() || undefined,
    })
    if (!configSaved) return false

    const res = await window.api.ttsSetKey(config.id, apiKey)
    if (!res.ok) return false

    const keyStateSaved = await updateProvider(config.id, { hasApiKey: res.hasKey })
    if (keyStateSaved) setApiKey('')
    return keyStateSaved
  }, [apiKey, baseUrl, region, voice, config.id, updateProvider])

  const handleTest = useCallback(async () => {
    setTestStatus('testing')
    setTestMsg('')
    const saved = await updateProvider(config.id, {
      baseUrl: baseUrl.trim() || undefined,
      region: region.trim() || undefined,
      voice: voice.trim() || undefined,
    })
    if (!saved) {
      setTestStatus('error')
      setTestMsg('朗读配置保存失败')
      return
    }

    // 若刚输了新 key,配置落盘后再绑定当前服务目标
    if (apiKey) {
      const setRes = await window.api.ttsSetKey(config.id, apiKey)
      if (!setRes.ok) {
        setTestStatus('error')
        setTestMsg(setRes.message || 'API Key 保存失败')
        return
      }
      const saved = await updateProvider(config.id, { hasApiKey: setRes.hasKey })
      if (!saved) {
        setTestStatus('error')
        setTestMsg('朗读配置保存失败')
        return
      }
      setApiKey('')
    }

    const res = await window.api.ttsTestProvider({
      providerId: config.id,
      type: config.type,
    })
    if (res.ok) {
      setTestStatus('success')
    } else {
      setTestStatus('error')
      setTestMsg(res.message || '测试失败')
    }
  }, [apiKey, baseUrl, region, voice, config.id, config.type, updateProvider])

  return (
    <div className="tts-provider-card">
      <div className="setting-item setting-row">
        <label>名称</label>
        <input
          type="text"
          className="settings-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => updateProvider(config.id, { name: name.trim() || config.name })}
        />
        <button
          className="btn-secondary btn-sm"
          onClick={() => removeProvider(config.id)}
        >
          删除
        </button>
      </div>

      <div className="setting-item setting-row">
        <label>服务地址</label>
        <input
          type="text"
          className="settings-input"
          value={baseUrl}
          placeholder={config.type === 'openai' ? 'https://api.openai.com/v1' : ''}
          onChange={(e) => {
            setBaseUrl(e.target.value)
            setTestStatus('idle')
          }}
          onBlur={() => updateProvider(config.id, { baseUrl: baseUrl.trim() || undefined })}
        />
      </div>
      {config.type === 'openai' && (
        <p className="setting-section-hint">填写 API 前缀，应用会调用 /audio/speech。</p>
      )}

      {config.type === 'azure' && (
        <div className="setting-item setting-row">
          <label>区域 (region)</label>
          <input
            type="text"
            className="settings-input"
            value={region}
            placeholder="eastasia"
            onChange={(e) => {
              setRegion(e.target.value)
              setTestStatus('idle')
            }}
            onBlur={() => updateProvider(config.id, { region: region.trim() || undefined })}
          />
        </div>
      )}

      {config.type === 'azure' && (
        <div className="setting-item setting-row">
          <label>音色</label>
          <input
            type="text"
            className="settings-input"
            value={voice}
            placeholder="zh-CN-XiaoxiaoNeural"
            onChange={(e) => setVoice(e.target.value)}
            onBlur={() => updateProvider(config.id, { voice: voice.trim() || undefined })}
          />
        </div>
      )}

      {config.type === 'openai' && (
        <div className="tts-voice-profiles">
          <div className="setting-item setting-row">
            <label>默认方案</label>
            <select
              className="settings-input"
              value={config.activeProfileId}
              onChange={(event) => void setActiveVoiceProfile(config.id, event.target.value)}
              aria-label={`${config.name}默认声音方案`}
            >
              {config.profiles?.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <button className="btn-secondary btn-sm" onClick={() => void addVoiceProfile(config.id)}>+ 添加声音方案</button>
          </div>
          {config.profiles?.map((profile, index) => (
            <VoiceProfileEditor
              key={profile.id}
              profile={profile}
              index={index}
              isActive={profile.id === config.activeProfileId}
              canRemove={(config.profiles?.length ?? 0) > 1}
              onSave={(patch) => updateVoiceProfile(config.id, profile.id, patch)}
              onRemove={() => removeVoiceProfile(config.id, profile.id)}
            />
          ))}
          <p className="setting-section-hint">模型和音色请按语音服务提供的文档填写。</p>
        </div>
      )}

      <div className="setting-item setting-row">
        <label>API Key</label>
        <input
          type="password"
          className="settings-input"
          style={{ width: 180 }}
          value={apiKey}
          placeholder={config.hasApiKey ? '已设置（重输可替换）' : '未设置'}
          onChange={(e) => {
            setApiKey(e.target.value)
            setTestStatus('idle')
          }}
          onBlur={(event) => {
            if (event.relatedTarget instanceof HTMLButtonElement) return
            void saveKey()
          }}
        />
        <button
          className="btn-secondary btn-sm"
          disabled={testStatus === 'testing'}
          onClick={handleTest}
        >
          {testStatus === 'testing' ? '测试中…' : '测试'}
        </button>
      </div>

      {testStatus === 'success' && <p className="setting-section-hint tts-test-ok">✓ 连接成功</p>}
      {testStatus === 'error' && (
        <p className="setting-section-hint tts-test-err">✗ {testMsg}</p>
      )}
    </div>
  )
}

const ReadAloudSettingsTab: React.FC = () => {
  const settings = useReadAloudStore((s) => s.settings)
  const setActiveProvider = useReadAloudStore((s) => s.setActiveProvider)
  const setDefaultRate = useReadAloudStore((s) => s.setDefaultRate)
  const setFallbackToSystem = useReadAloudStore((s) => s.setFallbackToSystem)
  const setSystemVoice = useReadAloudStore((s) => s.setSystemVoice)
  const setEdgeVoice = useReadAloudStore((s) => s.setEdgeVoice)
  const addProvider = useReadAloudStore((s) => s.addProvider)
  const [systemVoices, setSystemVoices] = useState<SystemVoiceOption[]>([])
  const [edgeVoices, setEdgeVoices] = useState<Array<{ id: string; name: string; lang?: string }>>(
    [...EDGE_ZH_VOICES]
  )

  React.useEffect(() => {
    let active = true
    loadSystemVoices().then((voices) => {
      if (active) setSystemVoices(toSystemVoiceOptions(voices))
    })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    const listVoices = window.api.ttsListVoices
    if (typeof listVoices !== 'function') return
    let active = true
    listVoices('edge')
      .then((voices) => {
        if (active && voices.length > 0) setEdgeVoices(voices)
      })
      .catch(() => { /* 使用内建声线表 */ })
    return () => { active = false }
  }, [])

  const systemProvider = settings.providers.find((provider) => provider.id === 'system')
  const edgeProvider = settings.providers.find((provider) => provider.id === 'edge')
  const paidProviders = settings.providers.filter((p) => p.type === 'openai' || p.type === 'azure')

  return (
    <>
      <section className="settings-section">
        <h3>朗读</h3>
        <div className="setting-item setting-row">
          <label>默认服务</label>
          <select
            className="settings-input"
            value={settings.activeProviderId}
            onChange={(e) => setActiveProvider(e.target.value)}
          >
            {settings.providers
              .filter((p) => p.enabled)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>

        {settings.activeProviderId === 'system' && systemProvider && (
          <div className="setting-item setting-row">
            <label>系统音色</label>
            <select
              className="settings-input"
              value={systemProvider.voice || ''}
              onChange={(e) => setSystemVoice(e.target.value || undefined)}
              aria-label="系统音色"
            >
              <option value="">系统默认音色</option>
              {systemProvider.voice && !systemVoices.some((voice) => voice.id === systemProvider.voice) && (
                <option value={systemProvider.voice}>已不可用（将使用系统默认）</option>
              )}
              {systemVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name}（{voice.lang}）</option>
              ))}
            </select>
          </div>
        )}

        {settings.activeProviderId === 'edge' && edgeProvider && (
          <div className="setting-item setting-row">
            <label>Edge 音色</label>
            <select
              className="settings-input"
              value={edgeProvider.voice || DEFAULT_EDGE_VOICE}
              onChange={(e) => setEdgeVoice(e.target.value)}
              aria-label="Edge 音色"
            >
              {edgeVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="setting-item setting-row">
          <label>默认语速</label>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.25}
            value={settings.defaultRate}
            onChange={(e) => setDefaultRate(Number(e.target.value))}
          />
          <span>{settings.defaultRate.toFixed(2)}x</span>
        </div>

        <div className="setting-item setting-row">
          <label>当前服务失败时自动退回系统声</label>
          <label className="setting-switch">
            <input
              type="checkbox"
              checked={settings.fallbackToSystem}
              onChange={(e) => setFallbackToSystem(e.target.checked)}
            />
            <span className="switch-slider"></span>
          </label>
        </div>
        <p className="setting-section-hint">
          开启后，联网服务(edge / 付费)断网或失效时会自动改用离线系统声，朗读不中断。
        </p>
      </section>

      <section className="settings-section">
        <h3>语音服务</h3>
        <p className="setting-section-hint">
          系统声（离线）与 Edge 免费为内置服务，不可删除。付费服务的 API Key 经系统钥匙串加密存储，不明文保存。
        </p>

        {paidProviders.map((p) => (
          <PaidProviderCard key={p.id} config={p} />
        ))}

        <div className="setting-item setting-row" style={{ marginTop: 8 }}>
          <button className="btn-secondary btn-sm" onClick={() => addProvider('openai')}>
            + 添加 OpenAI 服务
          </button>
          <button className="btn-secondary btn-sm" onClick={() => addProvider('azure')}>
            + 添加 Azure 服务
          </button>
        </div>
      </section>
    </>
  )
}

export default ReadAloudSettingsTab
