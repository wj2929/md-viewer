/**
 * 设置 · 朗读 Tab
 * @module components/ReadAloudSettingsTab
 * @description 多 TTS provider 管理:默认服务 + 语速 + 失败退回开关 + provider 列表(增删改/测试连接)。
 * 单一状态源 = readAloudStore。付费 key 走主进程 safeStorage(tts:setKey),不落 AppSettings。
 * provider 卡片照 DOCX 服务块范式:baseUrl/region/apiKey(password)/测试连接。
 */

import React, { useState, useCallback } from 'react'
import { useReadAloudStore } from '../stores/readAloudStore'
import type { TtsProviderConfig } from '../../../shared/ttsProviders'

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

/** 单个付费 provider 卡片:名称/端点/region/key/测试连接/删除 */
const PaidProviderCard: React.FC<{ config: TtsProviderConfig }> = ({ config }) => {
  const updateProvider = useReadAloudStore((s) => s.updateProvider)
  const removeProvider = useReadAloudStore((s) => s.removeProvider)

  const [name, setName] = useState(config.name)
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? '')
  const [region, setRegion] = useState(config.region ?? '')
  const [voice, setVoice] = useState(config.voice ?? '')
  const [apiKey, setApiKey] = useState('') // 只在本次输入时持有,保存后清空(真实 key 在钥匙串)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')

  // 保存 key 到主进程钥匙串,更新 hasApiKey 布尔
  const saveKey = useCallback(async () => {
    if (!apiKey) return
    const res = await window.api.ttsSetKey(config.id, apiKey)
    if (res.ok) {
      updateProvider(config.id, { hasApiKey: res.hasKey })
      setApiKey('') // 存完清空输入框,不在渲染进程留存
    }
  }, [apiKey, config.id, updateProvider])

  const handleTest = useCallback(async () => {
    setTestStatus('testing')
    setTestMsg('')
    // 若刚输了新 key,先存再测
    if (apiKey) {
      const setRes = await window.api.ttsSetKey(config.id, apiKey)
      if (setRes.ok) {
        updateProvider(config.id, { hasApiKey: setRes.hasKey })
        setApiKey('')
      }
    }
    const res = await window.api.ttsTestProvider({
      providerId: config.id,
      type: config.type,
      baseUrl: baseUrl.trim() || undefined,
      region: region.trim() || undefined,
      voice: voice.trim() || undefined,
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
          title="删除此服务"
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

      <div className="setting-item setting-row">
        <label>音色</label>
        <input
          type="text"
          className="settings-input"
          value={voice}
          placeholder={config.type === 'openai' ? 'alloy' : 'zh-CN-XiaoxiaoNeural'}
          onChange={(e) => setVoice(e.target.value)}
          onBlur={() => updateProvider(config.id, { voice: voice.trim() || undefined })}
        />
      </div>

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
          onBlur={saveKey}
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
  const addProvider = useReadAloudStore((s) => s.addProvider)

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
          系统声(离线)与晓晓(edge 免费)为内置服务，不可删除。付费服务的 API Key 经系统钥匙串加密存储，不明文保存。
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
