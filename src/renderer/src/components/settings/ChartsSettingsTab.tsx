import { useEffect, useMemo, useRef, useState } from 'react'
import type { RendererDefinition, RendererTarget, RendererTargetCapability, RendererType } from '../../renderers/types'
import { builtinRendererDefinitions } from '../../renderers/builtin'
import { VirtualizedMarkdown } from '../VirtualizedMarkdown'
import type {
  ChartExamplesStatus,
  InstallChartExamplesResult,
} from '../../../../shared/chartExamples'
import { chartStarterTemplates, chartTemplateMarkdown, getTemplatesForRenderer } from './chartStarterTemplates'
import { useRemoteChartSettingsStore } from '../../stores/remoteChartSettingsStore'
import type { ChartsSettingsView, EditorInsertionSession } from './chartSettingsTypes'
import './ChartsSettingsTab.css'

type CapabilityColumn = {
  key: RendererTarget
  label: string
}

type NetworkFilter = '全部' | '纯离线' | '需要服务'

interface ChartsSettingsTabProps {
  initialView: ChartsSettingsView
  insertionSession?: EditorInsertionSession
  onCloseSettings: () => void
  onOpenChartExamples: () => Promise<InstallChartExamplesResult>
}

const CAPABILITY_COLUMNS: CapabilityColumn[] = [
  { key: 'preview', label: '应用预览' },
  { key: 'html', label: 'HTML' },
  { key: 'pdf', label: 'PDF' },
  { key: 'docxClient', label: 'DOCX' },
]

const CATEGORY_ORDER = ['架构与关系', '数据可视化', '工程建模', '公式与标记'] as const
type ChartCategory = typeof CATEGORY_ORDER[number]
type ChartCategoryFilter = '全部' | ChartCategory
const CATEGORY_FILTERS: readonly ChartCategoryFilter[] = ['全部', ...CATEGORY_ORDER]
const DEFAULT_PLANTUML_SERVER = 'https://www.plantuml.com/plantuml'
const CATEGORY_BY_TYPE: Record<RendererType, ChartCategory> = {
  mermaid: '架构与关系',
  markmap: '架构与关系',
  graphviz: '架构与关系',
  drawio: '架构与关系',
  d2: '架构与关系',
  structurizr: '架构与关系',
  'antv-g6': '架构与关系',
  svg: '架构与关系',
  plantuml: '架构与关系',
  c4plantuml: '架构与关系',
  echarts: '数据可视化',
  infographic: '数据可视化',
  'vega-lite': '数据可视化',
  plotly: '数据可视化',
  excalidraw: '工程建模',
  bpmn: '工程建模',
  wavedrom: '工程建模',
  dbml: '工程建模',
  kroki: '工程建模',
  katex: '公式与标记',
}

function capabilityStateText(definition: RendererDefinition, column: CapabilityColumn): string {
  const capability: RendererTargetCapability | undefined = definition.capabilities[column.key]
  if (!capability || capability.state === 'unsupported') return '不支持'
  if (capability.state === 'optional' || capability.state === 'disabledByDefault') return '需配置'
  if (definition.networkPolicy === 'explicitRemoteAllowed') return '需服务'
  return '支持'
}

function networkLabel(definition: RendererDefinition): string {
  if (definition.networkPolicy === 'explicitRemoteAllowed') return '需服务'
  if (definition.networkPolicy === 'localOnly') return '仅本地'
  return '离线'
}

function categoryFor(definition: RendererDefinition): ChartCategory {
  return CATEGORY_BY_TYPE[definition.type]
}

function matchesNetworkFilter(definition: RendererDefinition, filter: NetworkFilter): boolean {
  if (filter === '全部') return true
  if (filter === '纯离线') return definition.networkPolicy === 'offlineOnly'
  return definition.networkPolicy !== 'offlineOnly'
}

function remotePreviewEndpoint(definition: RendererDefinition, plantumlServer: string): string {
  if (definition.type === 'kroki') return 'https://kroki.io'
  return normalizeHttpServer(plantumlServer) ?? DEFAULT_PLANTUML_SERVER
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 1024 * 100 ? 1 : 0)} KB`
}

function statusClass(status: ChartExamplesStatus | null): string {
  if (!status) return 'pending'
  return status.state === 'ready' ? 'ready' : 'error'
}

function normalizeHttpServer(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function ChartsSettingsTab({
  initialView,
  insertionSession,
  onCloseSettings,
  onOpenChartExamples,
}: ChartsSettingsTabProps): JSX.Element {
  const [view, setView] = useState<ChartsSettingsView>(initialView)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<ChartCategoryFilter>('全部')
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>('全部')
  const [selectedType, setSelectedType] = useState<RendererType | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [detailView, setDetailView] = useState<'preview' | 'source'>('preview')
  const [remotePreviewRequested, setRemotePreviewRequested] = useState(false)
  const [serviceReturnType, setServiceReturnType] = useState<RendererType | null>(null)
  const [plantumlMode, setPlantumlMode] = useState<'official' | 'custom'>('official')
  const [actionMessage, setActionMessage] = useState('')
  const [examplesStatus, setExamplesStatus] = useState<ChartExamplesStatus | null>(null)
  const [examplesLoading, setExamplesLoading] = useState(false)
  const [examplesExporting, setExamplesExporting] = useState(false)
  const [examplesOpening, setExamplesOpening] = useState(false)
  const [savedPath, setSavedPath] = useState('')
  const [plantumlServer, setPlantumlServer] = useState('')
  const [plantumlTestStatus, setPlantumlTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [showPlantumlGuide, setShowPlantumlGuide] = useState(false)
  const remoteChartHydration = useRemoteChartSettingsStore(state => state.hydration)
  const autoRenderRemoteCharts = useRemoteChartSettingsStore(state => state.autoRenderRemoteCharts)
  const hydrateRemoteChartSettings = useRemoteChartSettingsStore(state => state.hydrate)
  const setAutoRenderRemoteCharts = useRemoteChartSettingsStore(state => state.setAutoRenderRemoteCharts)
  const chartsSettingsRef = useRef<HTMLElement>(null)
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const storedServer = localStorage.getItem('plantuml-server-url') || ''
      setPlantumlServer(storedServer)
      setPlantumlMode(storedServer ? 'custom' : 'official')
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    void hydrateRemoteChartSettings()
  }, [hydrateRemoteChartSettings])

  useEffect(() => {
    if (!showPlantumlGuide) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowPlantumlGuide(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showPlantumlGuide])

  useEffect(() => {
    if (view !== 'examples' || examplesStatus || examplesLoading) return
    setExamplesLoading(true)
    window.api.getChartExamplesStatus()
      .then(setExamplesStatus)
      .catch(() => setExamplesStatus({
        state: 'missing',
        appVersion: '',
        message: '无法读取内置图表示例包状态。',
      }))
      .finally(() => setExamplesLoading(false))
  }, [examplesLoading, examplesStatus, view])

  const filteredDefinitions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...builtinRendererDefinitions]
      .sort((left, right) => CATEGORY_ORDER.indexOf(categoryFor(left)) - CATEGORY_ORDER.indexOf(categoryFor(right)))
      .filter(definition => categoryFilter === '全部' || categoryFor(definition) === categoryFilter)
      .filter(definition => matchesNetworkFilter(definition, networkFilter))
      .filter(definition => {
        if (!normalizedQuery) return true
        const descriptions = getTemplatesForRenderer(definition.type).map(template => template.description)
        return [
          definition.displayName,
          definition.type,
          ...definition.languages,
          ...definition.aliases,
          ...descriptions,
        ].some(value => value.toLowerCase().includes(normalizedQuery))
      })
  }, [categoryFilter, networkFilter, query])

  const selectedDefinition = selectedType
    ? builtinRendererDefinitions.find(definition => definition.type === selectedType) ?? null
    : null
  const selectedTemplates = selectedDefinition ? getTemplatesForRenderer(selectedDefinition.type) : []
  const selectedTemplate = selectedTemplates.find(template => template.id === selectedTemplateId) ?? selectedTemplates[0]
  const remotePreviewAllowed = selectedDefinition?.networkPolicy === 'offlineOnly'
    || remotePreviewRequested
    || (remoteChartHydration === 'ready' && autoRenderRemoteCharts)

  useEffect(() => {
    if (!selectedDefinition) return
    const scrollContainer = chartsSettingsRef.current?.closest<HTMLElement>('.settings-content')
    if (scrollContainer) scrollContainer.scrollTop = 0
    detailHeadingRef.current?.focus()
  }, [selectedDefinition])

  useEffect(() => {
    const preview = previewRef.current
    if (!preview || detailView !== 'preview') return

    const labelPreviewTools = () => {
      preview.querySelectorAll<HTMLElement>("[class*='-toggle-bar']").forEach(toolbar => {
        toolbar.setAttribute('role', 'toolbar')
        toolbar.setAttribute('aria-label', '图表预览工具')
      })
      preview.querySelectorAll<HTMLButtonElement>("button[class*='-action-btn']").forEach(button => {
        const label = button.title.trim()
        if (label && !button.getAttribute('aria-label')) button.setAttribute('aria-label', label)
      })
    }

    labelPreviewTools()
    const observer = new MutationObserver(labelPreviewTools)
    observer.observe(preview, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [detailView, remotePreviewRequested, selectedTemplate?.id])

  const openDefinition = (definition: RendererDefinition) => {
    const firstTemplate = getTemplatesForRenderer(definition.type)[0]
    setSelectedType(definition.type)
    setSelectedTemplateId(firstTemplate?.id ?? null)
    setDetailView('preview')
    setRemotePreviewRequested(false)
    setActionMessage('')
  }

  const copyTemplate = async () => {
    if (!selectedTemplate) return
    try {
      await navigator.clipboard.writeText(chartTemplateMarkdown(selectedTemplate))
      setActionMessage('模板源码已复制。')
    } catch {
      setActionMessage('复制失败，请重试。')
    }
  }

  const insertTemplate = () => {
    if (!selectedTemplate || !insertionSession) return
    if (!insertionSession.isValid()) {
      setActionMessage('目标编辑器已关闭或切换文档，请从目标编辑器重新打开图表设置。')
      return
    }
    if (!insertionSession.insert(selectedTemplate)) {
      setActionMessage('模板未插入，请从目标编辑器重新打开图表设置。')
      return
    }
    onCloseSettings()
  }

  const saveExamples = async () => {
    setActionMessage('')
    setExamplesExporting(true)
    try {
      const result = await window.api.saveChartExamples()
      if (result.canceled) return
      if (result.error) {
        setActionMessage(result.error.message)
        return
      }
      setSavedPath(result.filePath || '')
      setActionMessage('示例包已导出。')
    } catch {
      setActionMessage('导出示例包失败，请重试。')
    } finally {
      setExamplesExporting(false)
    }
  }

  const showSavedExamples = async () => {
    if (!savedPath) return
    try {
      const result = await window.api.showItemInFolder(savedPath)
      if (!result.success) setActionMessage('无法在文件管理器中显示示例包。')
    } catch {
      setActionMessage('无法在文件管理器中显示示例包。')
    }
  }

  const openExamples = async () => {
    setActionMessage('')
    setExamplesOpening(true)
    try {
      const result = await onOpenChartExamples()
      if (!result.canceled && 'error' in result) {
        setActionMessage(result.error.message)
      }
    } catch (error) {
      console.error('[ChartExamples] Failed to prepare offline examples:', error)
      setActionMessage('无法准备离线示例，请重试。')
    } finally {
      setExamplesOpening(false)
    }
  }

  const updateRemoteChartAutoRender = async (enabled: boolean) => {
    setActionMessage('')
    if (!enabled) setRemotePreviewRequested(false)
    const saved = await setAutoRenderRemoteCharts(enabled)
    setActionMessage(saved
      ? enabled ? '联网图表将默认自动渲染。' : '已关闭自动渲染；普通文档将每篇确认一次。'
      : '设置保存失败，已恢复原状态。')
  }

  const saveAndTestPlantumlServer = async () => {
    const server = plantumlMode === 'official'
      ? DEFAULT_PLANTUML_SERVER
      : normalizeHttpServer(plantumlServer)
    if (!server) {
      setPlantumlTestStatus('error')
      setActionMessage('请输入有效的 http:// 或 https:// 服务地址。')
      return
    }

    try {
      if (plantumlMode === 'official') {
        localStorage.removeItem('plantuml-server-url')
        setPlantumlServer('')
      } else {
        localStorage.setItem('plantuml-server-url', server)
        setPlantumlServer(server)
      }
    } catch { /* ignore */ }

    setActionMessage(`正在测试 ${server}…`)
    setPlantumlTestStatus('testing')
    try {
      const response = await fetch(`${server}/svg/SoWkIImgAStDuNBAJrBGjLDmpCbCJbMmKiX8pSd9vt98pKi1IW80`, {
        signal: AbortSignal.timeout(5000),
      })
      setPlantumlTestStatus(response.ok ? 'success' : 'error')
      setActionMessage(response.ok ? '服务地址已保存，连接正常。' : `服务地址已保存，但连接返回 HTTP ${response.status}。`)
    } catch {
      setPlantumlTestStatus('error')
      setActionMessage('服务地址已保存，但当前无法连接。请检查网络或本地服务。')
    }
  }

  const resetPlantumlServer = () => {
    try { localStorage.removeItem('plantuml-server-url') } catch { /* ignore */ }
    setPlantumlMode('official')
    setPlantumlServer('')
    setPlantumlTestStatus('idle')
    setActionMessage('已恢复为官方 PlantUML 服务。')
  }

  return (
    <section ref={chartsSettingsRef} className="charts-settings" aria-label="图表与公式">
      <div className="charts-settings-heading">
        <div>
          <h3>图表与公式</h3>
          <p>选择模板、预览真实效果，或管理离线示例与渲染服务。</p>
        </div>
        {insertionSession && (
          <span className={`chart-insertion-target ${insertionSession.isValid() ? '' : 'invalid'}`}>
            插入目标：{insertionSession.targetLabel}
          </span>
        )}
      </div>

      <div className="chart-settings-layout">
        <div className="charts-settings-subtabs" role="tablist" aria-label="图表设置分类">
          {([
            ['capabilities', '模板库', '浏览 20 类图表与公式'],
            ['examples', '离线示例', `打开 ${examplesStatus?.totalCaseCount ?? examplesStatus?.caseCount ?? 978} 个精选案例`],
            ['service', '渲染服务', '配置联网渲染能力'],
          ] as Array<[ChartsSettingsView, string, string]>).map(([key, label, description]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={view === key ? 'active' : ''}
              onClick={() => {
                setView(key)
                setServiceReturnType(null)
                if (key === 'capabilities') setSelectedType(null)
                setActionMessage('')
              }}
            >
              <strong>{label}</strong>
              <span>{description}</span>
            </button>
          ))}
        </div>

        <div className="chart-settings-content">
      {view === 'capabilities' && !selectedDefinition && (
        <div className="chart-catalog">
          <section className="chart-catalog-intro" aria-labelledby="chart-catalog-intro-title">
            <h4 id="chart-catalog-intro-title">选择一种图表开始</h4>
            <p className="chart-catalog-intro-description">MD Viewer 支持 20 类图表与公式渲染。以下是每类能力的入门模板，点击卡片可查看真实预览并复制源码。</p>
            <p className="chart-catalog-runtime-note">
              <strong>17 类纯离线</strong>
              <span><b>3 类需要服务</b>：PlantUML、C4-PlantUML 和 Kroki</span>
            </p>
          </section>
          <div className="chart-catalog-toolbar">
            <label className="chart-catalog-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="搜索图表"
                value={query}
                placeholder="搜索名称、语言或场景"
                onChange={event => setQuery(event.target.value)}
              />
            </label>
            <div className="chart-filter-stack">
              <div className="chart-filter-row">
                <span className="chart-filter-label">用途</span>
                <div className="chart-category-filters" role="group" aria-label="按用途筛选图表">
                  {CATEGORY_FILTERS.map(category => {
                    const count = category === '全部'
                      ? builtinRendererDefinitions.length
                      : builtinRendererDefinitions.filter(definition => categoryFor(definition) === category).length
                    return (
                      <button
                        key={category}
                        type="button"
                        aria-label={`${category}，${count} 种`}
                        aria-pressed={categoryFilter === category}
                        onClick={() => setCategoryFilter(category)}
                      >
                        <span>{category}</span>
                        <small>{count}</small>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="chart-filter-row">
                <span className="chart-filter-label">运行</span>
                <div className="chart-category-filters" role="group" aria-label="按运行方式筛选图表">
                  {(['全部', '纯离线', '需要服务'] as NetworkFilter[]).map(filter => {
                    const count = builtinRendererDefinitions.filter(definition => matchesNetworkFilter(definition, filter)).length
                    return (
                      <button
                        key={filter}
                        type="button"
                        aria-label={`${filter}，${count} 种`}
                        aria-pressed={networkFilter === filter}
                        onClick={() => setNetworkFilter(filter)}
                      >
                        <span>{filter}</span>
                        <small>{count}</small>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="chart-catalog-summary" aria-live="polite">
            <strong>{filteredDefinitions.length === builtinRendererDefinitions.length ? '全部模板' : `找到 ${filteredDefinitions.length} 个模板`}</strong>
            <span>选择卡片查看预览与源码</span>
          </div>
          {filteredDefinitions.length > 0 && (
            <div className="chart-catalog-grid">
              {filteredDefinitions.map(definition => {
                const template = getTemplatesForRenderer(definition.type)[0]
                return (
                  <button
                    type="button"
                    key={definition.type}
                    className="chart-catalog-card"
                    data-renderer-type={definition.type}
                    onClick={() => openDefinition(definition)}
                  >
                    <span className="chart-card-mark" aria-hidden="true">
                      {definition.displayName.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'ƒ'}
                    </span>
                    <span className="chart-card-body">
                      <span className="chart-card-title">
                        <strong>{definition.displayName}</strong>
                        {definition.networkPolicy !== 'offlineOnly' && (
                          <span className={`chart-network-badge ${definition.networkPolicy}`}>{networkLabel(definition)}</span>
                        )}
                      </span>
                      <span className="chart-card-description">
                        {template?.description ?? definition.userHelp.settingsDescription}
                      </span>
                      <code>{definition.languages[0] ?? '数学公式'}</code>
                    </span>
                    <span className="chart-card-arrow" aria-hidden="true">›</span>
                  </button>
                )
              })}
            </div>
          )}
          {!filteredDefinitions.length && (
            <div className="chart-empty">
              <strong>没有匹配的图表类型</strong>
              <button type="button" onClick={() => {
                setQuery('')
                setCategoryFilter('全部')
                setNetworkFilter('全部')
              }}>重置筛选</button>
            </div>
          )}
        </div>
      )}

      {view === 'capabilities' && selectedDefinition && selectedTemplate && (
        <div className="chart-detail">
          <button type="button" className="chart-back-button" aria-label="返回模板库" onClick={() => setSelectedType(null)}>‹ 模板库</button>
          <div className="chart-detail-header">
            <div>
              <div className="chart-detail-title">
                <h4 ref={detailHeadingRef} tabIndex={-1}>{selectedDefinition.displayName}</h4>
                <span className={`chart-network-badge ${selectedDefinition.networkPolicy}`}>{networkLabel(selectedDefinition)}</span>
              </div>
              <p className="chart-detail-description">{selectedTemplate.description}</p>
            </div>
            <div className="chart-detail-actions">
              <button type="button" onClick={copyTemplate}>复制源码</button>
              {insertionSession && (
                <button type="button" className="primary" disabled={!insertionSession.isValid()} onClick={insertTemplate}>
                  插入到 {insertionSession.targetLabel}
                </button>
              )}
            </div>
          </div>
          {selectedTemplates.length > 1 && (
            <label className="chart-template-picker">
              <span>模板</span>
              <select
                value={selectedTemplate.id}
                onChange={event => {
                  setSelectedTemplateId(event.target.value)
                  setRemotePreviewRequested(false)
                }}
              >
                {selectedTemplates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}
              </select>
            </label>
          )}
          <section
            className="chart-format-summary"
            aria-label="格式支持"
            data-network-policy={selectedDefinition.networkPolicy}
          >
            <span className="chart-format-label">格式支持</span>
            <div className="chart-capability-grid">
              {CAPABILITY_COLUMNS.map(column => {
                const capability = selectedDefinition.capabilities[column.key]
                return (
                  <div key={column.key} data-state={capability?.state ?? 'unsupported'}>
                    <span>{column.label}</span>
                    <strong>{capabilityStateText(selectedDefinition, column)}</strong>
                  </div>
                )
              })}
            </div>
          </section>
          <div className="chart-detail-tabs" role="tablist" aria-label="模板内容">
            <button type="button" role="tab" aria-selected={detailView === 'preview'} onClick={() => {
              setDetailView('preview')
              setActionMessage('')
            }}>预览</button>
            <button type="button" role="tab" aria-selected={detailView === 'source'} onClick={() => {
              setDetailView('source')
              setActionMessage('')
            }}>源码</button>
          </div>
          {actionMessage && <div className="chart-action-message" role="status">{actionMessage}</div>}
          {detailView === 'preview' && selectedDefinition.networkPolicy !== 'offlineOnly' && !remotePreviewAllowed && (
            <div className="chart-remote-consent" role="note">
              <div>
                <strong>{remoteChartHydration === 'loading' ? '正在读取联网渲染设置…' : '连接服务后生成预览'}</strong>
                <p>当前图表源码将发送到：</p>
                <code>{remotePreviewEndpoint(selectedDefinition, plantumlMode === 'custom' ? plantumlServer : '')}</code>
                <span>{remoteChartHydration === 'loading' ? '设置读取完成前不会发起请求。' : '自动渲染已关闭，只有点击下方按钮后才会发起本次请求。'}</span>
              </div>
              <div className="chart-remote-actions">
                <button type="button" className="primary" disabled={remoteChartHydration === 'loading'} onClick={() => setRemotePreviewRequested(true)}>连接服务并预览</button>
                <button type="button" onClick={() => {
                  setServiceReturnType(selectedDefinition.type)
                  setView('service')
                  setActionMessage('')
                }}>检查服务配置</button>
              </div>
            </div>
          )}
          {detailView === 'preview' && remotePreviewAllowed && (
            <div ref={previewRef} className="chart-starter-preview" data-renderer-type={selectedDefinition.type}>
              <VirtualizedMarkdown content={chartTemplateMarkdown(selectedTemplate)} renderDebounceMs={0} remoteChartPolicy="allow" />
            </div>
          )}
          {detailView === 'source' && (
            <pre className="chart-template-source"><code>{chartTemplateMarkdown(selectedTemplate)}</code></pre>
          )}
        </div>
      )}

      {view === 'examples' && (
        <div className="chart-examples-panel">
          <section className="chart-examples-card">
            <div className={`chart-examples-status ${statusClass(examplesStatus)}`} role="status">
              <strong>{examplesLoading && !examplesStatus ? '正在检查本地安装资源…' : examplesStatus?.message ?? '等待检查内置示例…'}</strong>
              {examplesStatus?.packageVersion && (
                <span>随应用提供 · 版本 {examplesStatus.packageVersion}</span>
              )}
            </div>
            <div className="chart-package-stats" aria-label="示例包内容统计">
              <div><strong>{examplesStatus?.totalCaseCount ?? examplesStatus?.caseCount ?? 978}</strong><span>精选案例</span></div>
              <div><strong>{examplesStatus?.rendererCount ?? 20}</strong><span>图表类型</span></div>
              <div><strong>{formatBytes(examplesStatus?.bytes)}</strong><span>压缩包体积</span></div>
            </div>
            <div className="chart-examples-contents">
              <h4>包含内容</h4>
              <ul>
                <li>{examplesStatus?.starterCount ?? 21} 个快速入门模板，覆盖 20 类图表与公式</li>
                <li>{examplesStatus?.designCaseCount ?? 93} 个架构与流程图设计核心案例</li>
                <li>{examplesStatus?.galleryCaseCount ?? 885} 个按 renderer 归档的专项正例</li>
              </ul>
            </div>
            <p className="chart-examples-open-note">
              点击后会自动准备到 MD Viewer 的应用数据目录，并立即打开根 README；无需选择位置或手工解压。
            </p>
            <div className="chart-examples-actions">
              <button
                type="button"
                className="chart-save-examples primary"
                disabled={examplesLoading || examplesExporting || examplesOpening || examplesStatus?.state !== 'ready'}
                onClick={openExamples}
              >
                {examplesOpening ? '正在准备…' : '打开离线示例…'}
              </button>
              <button
                type="button"
                className="chart-save-examples"
                disabled={examplesLoading || examplesExporting || examplesOpening || examplesStatus?.state !== 'ready'}
                onClick={saveExamples}
              >
                {examplesExporting ? '正在导出…' : '仅导出 ZIP…'}
              </button>
            </div>
            {actionMessage && <div className="chart-action-message" role="status">{actionMessage}</div>}
            {savedPath && (
              <div className="chart-examples-saved">
                <span title={savedPath}>已导出：{savedPath}</span>
                <div>
                  <button type="button" onClick={showSavedExamples}>在文件管理器中显示</button>
                </div>
              </div>
            )}
            <p className="chart-offline-note">准备过程不会访问 GitHub 或其他网络，也不会覆盖内容不同的已有示例。新版示例随 MD Viewer 更新。</p>
          </section>
        </div>
      )}

      {view === 'service' && (
        <div className="chart-service-panel">
          {serviceReturnType && (
            <button type="button" className="chart-back-button" onClick={() => {
              setView('capabilities')
              setSelectedType(serviceReturnType)
              setDetailView('preview')
              setRemotePreviewRequested(false)
              setServiceReturnType(null)
              setActionMessage('')
            }}>‹ 返回 {builtinRendererDefinitions.find(definition => definition.type === serviceReturnType)?.displayName}</button>
          )}
          <div className="chart-service-heading">
            <div>
              <h4>渲染服务</h4>
              <p>联网 renderer 会把当前图表源码发送到对应服务。</p>
            </div>
          </div>
          <section className="chart-service-card chart-auto-render-card">
            <label className="chart-auto-render-toggle">
              <span>
                <strong>自动渲染联网图表</strong>
                <small>默认开启。关闭后，普通 Markdown 会在每篇文档顶部确认一次。</small>
              </span>
              <input
                type="checkbox"
                checked={autoRenderRemoteCharts}
                disabled={remoteChartHydration === 'loading'}
                onChange={event => void updateRemoteChartAutoRender(event.target.checked)}
              />
            </label>
          </section>
          <section className="chart-service-card">
            <div className="chart-service-card-header">
              <div><strong>PlantUML</strong><span>用于 PlantUML 与 C4-PlantUML</span></div>
              <span className={`chart-service-state ${plantumlTestStatus}`}>
                {plantumlTestStatus === 'testing' ? '测试中' : plantumlTestStatus === 'success' ? '连接正常' : plantumlTestStatus === 'error' ? '连接失败' : '未测试'}
              </span>
            </div>
            <fieldset className="chart-service-mode">
              <legend>服务来源</legend>
              <label><input type="radio" name="plantuml-mode" checked={plantumlMode === 'official'} onChange={() => {
                setPlantumlMode('official')
                setPlantumlTestStatus('idle')
                setActionMessage('')
              }} /> 官方服务</label>
              <label><input type="radio" name="plantuml-mode" checked={plantumlMode === 'custom'} onChange={() => {
                setPlantumlMode('custom')
                setPlantumlTestStatus('idle')
                setActionMessage('')
              }} /> 自定义服务</label>
            </fieldset>
            <label className="chart-service-field" htmlFor="plantuml-server-url">
              <span>服务地址</span>
              <input
                id="plantuml-server-url"
                type="url"
                spellCheck={false}
                autoCapitalize="none"
                disabled={plantumlMode === 'official'}
                value={plantumlMode === 'official' ? DEFAULT_PLANTUML_SERVER : plantumlServer}
                placeholder="https://your-plantuml-server.example"
                onChange={event => {
                  setPlantumlServer(event.target.value)
                  setPlantumlTestStatus('idle')
                  setActionMessage('')
                }}
              />
            </label>
            <div className="chart-service-actions">
              <button type="button" className="primary" disabled={plantumlTestStatus === 'testing'} onClick={saveAndTestPlantumlServer}>保存并测试</button>
              <button type="button" onClick={resetPlantumlServer}>恢复官方地址</button>
              <button type="button" className="chart-help-link" onClick={() => setShowPlantumlGuide(true)}>配置本地服务…</button>
            </div>
            {actionMessage && <div className="chart-action-message" role="status">{actionMessage}</div>}
          </section>
          <section className="chart-service-card">
            <div className="chart-service-card-header">
              <div><strong>Kroki</strong><span>用于 Kroki、Pikchr、Nomnoml 等围栏</span></div>
              <span className="chart-service-state remote">按需联网</span>
            </div>
            <p>当前使用固定服务地址 <code>https://kroki.io</code>，暂不提供自定义配置。自动渲染开启时，文档中的 Kroki 图表会直接加入受限请求队列。</p>
          </section>
        </div>
      )}

        </div>
      </div>

      {showPlantumlGuide && (
        <div className="enable-guide-modal" onClick={() => setShowPlantumlGuide(false)}>
          <div
            className="plantuml-guide-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plantuml-guide-title"
            onClick={event => event.stopPropagation()}
          >
            <button type="button" className="chart-guide-close" aria-label="关闭本地 PlantUML 配置指南" onClick={() => setShowPlantumlGuide(false)}>×</button>
            <h2 id="plantuml-guide-title">配置本地 PlantUML 服务器</h2>
            <p className="guide-subtitle">本地服务器可减少外部请求并保护图表源码。</p>
            <div className="guide-section">
              <h4>方式一：Docker（推荐）</h4>
              <div className="guide-code-block">
                <code>docker run -d -p 8080:8080 plantuml/plantuml-server:jetty</code>
                <button type="button" className="guide-copy-btn" onClick={() => navigator.clipboard.writeText('docker run -d -p 8080:8080 plantuml/plantuml-server:jetty')}>复制</button>
              </div>
              <p className="guide-note">服务器地址填写：<code>http://localhost:8080</code></p>
            </div>
            <div className="guide-section">
              <h4>方式二：Java 直接运行</h4>
              <div className="guide-code-block"><code>java -jar plantuml.war</code></div>
              <p className="guide-note">需要安装 Java 运行时和 Graphviz。</p>
            </div>
            <button type="button" className="btn-primary" onClick={() => setShowPlantumlGuide(false)}>知道了</button>
          </div>
        </div>
      )}
    </section>
  )
}

export { chartStarterTemplates }
