import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { RendererDefinition, RendererTarget, RendererTargetCapability, RendererType } from '../../renderers/types'
import { builtinRendererDefinitions } from '../../renderers/builtin'
import { VirtualizedMarkdown } from '../VirtualizedMarkdown'
import type {
  ChartExamplesStatus,
  InstallChartExamplesResult,
} from '../../../../shared/chartExamples'
import { chartStarterTemplates, chartTemplateMarkdown, getChartFormatGuidance, getTemplatesForRenderer } from './chartStarterTemplates'
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
  const [selectedType, setSelectedType] = useState<RendererType | null>('mermaid')
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
  const directoryRef = useRef<HTMLDivElement>(null)
  const typePickerRef = useRef<HTMLLabelElement>(null)
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

  useLayoutEffect(() => {
    const picker = typePickerRef.current
    if (selectedTemplateId && selectedTemplate && picker?.getClientRects().length) picker.scrollIntoView({ block: 'start' })
  }, [selectedTemplate?.id, selectedTemplateId])

  useLayoutEffect(() => {
    const directory = directoryRef.current
    const button = directory?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    if (!directory || !button || document.activeElement !== button) return
    const bounds = button.getBoundingClientRect()
    const viewport = directory.getBoundingClientRect()
    if (bounds.top < viewport.top) directory.scrollTop -= viewport.top - bounds.top
    else if (bounds.bottom > viewport.bottom) directory.scrollTop += bounds.bottom - viewport.bottom
  }, [detailView, selectedTemplate?.id, view])

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
  }, [detailView, remotePreviewRequested, selectedTemplate?.id, view])

  const openDefinition = (definition: RendererDefinition) => {
    if (definition.type === selectedType) return
    const firstTemplate = getTemplatesForRenderer(definition.type)[0]
    setSelectedType(definition.type)
    setSelectedTemplateId(firstTemplate?.id ?? null)
    setRemotePreviewRequested(false)
    setActionMessage('')
  }

  const navigateDirectory = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const nextIndex = index + (event.key === 'ArrowDown' ? 1 : -1)
    const definition = filteredDefinitions[nextIndex]
    if (!definition) return
    openDefinition(definition)
    const directory = directoryRef.current
    const button = directory?.querySelector<HTMLButtonElement>(`[data-renderer-type="${definition.type}"]`)
    if (!directory || !button) return
    button.focus({ preventScroll: true })
  }

  const copyTemplate = async () => {
    if (!selectedTemplate) return
    try {
      await navigator.clipboard.writeText(chartTemplateMarkdown(selectedTemplate))
      setActionMessage('示例已复制。')
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
    <section className="charts-settings" aria-label="图表与公式">
      <div className="chart-settings-layout">
        <div className="charts-settings-heading">
          <h3>图表与公式</h3>
          <div className="charts-settings-subtabs" role="tablist" aria-label="图表设置分类">
          {([
            ['capabilities', '格式参考', '选择表达方式与示例'],
            ['examples', '离线示例', `打开 ${examplesStatus?.totalCaseCount ?? examplesStatus?.caseCount ?? '—'} 个精选案例`],
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
                setRemotePreviewRequested(false)
                setActionMessage('')
              }}
            >
              <strong>{label}</strong>
              <span>{description}</span>
            </button>
          ))}
          </div>
          {insertionSession && (
            <span className={`chart-insertion-target ${insertionSession.isValid() ? '' : 'invalid'}`}>
              插入目标：{insertionSession.targetLabel}
            </span>
          )}
        </div>

        <div className="chart-settings-content">
      {view === 'capabilities'  && (
        <div className="chart-catalog">
          <div className="chart-reference-guidance" role="note" aria-label="格式参考使用说明">
            <div className="chart-reference-usage">
              <h4>让 AI 参考格式，生成你需要的图表</h4>
              <p>不必手写复杂的图表代码。选择合适的表达方式，把完整 Markdown 示例和兼容说明交给 Claude、Codex 等 AI 工具，再描述你的需求，由 AI 生成内容，在 MD Viewer 中查看效果。这里提供格式参考，不在应用内调用 AI。</p>
            </div>
            <div className="chart-reference-compatibility">
              <h4>兼容说明</h4>
              <p>这些图表和公式通过 Markdown 扩展语法嵌入，并非所有 Markdown 查看器都支持。图表内容有的采用上游工具的原生语法，有的使用 MD Viewer 的适配格式或支持子集。请以每种类型的格式说明和示例为准，不能将其等同于完整上游 API，也不保证在其他工具中原样呈现。</p>
            </div>
            <p className="chart-reference-runtime"><strong>运行方式</strong>{builtinRendererDefinitions.filter(definition => definition.networkPolicy === 'offlineOnly').length} 类离线，{builtinRendererDefinitions.filter(definition => definition.networkPolicy !== 'offlineOnly').length} 类需服务（PlantUML、C4-PlantUML、Kroki）。完整参考文件见“离线示例”。</p>
          </div>
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
            <label className="chart-filter-select chart-filter-category">
              <span>用途</span>
              <select aria-label="按用途筛选图表" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value as ChartCategoryFilter)}>
                {CATEGORY_FILTERS.map(category => {
                  const count = category === '全部'
                    ? builtinRendererDefinitions.length
                    : builtinRendererDefinitions.filter(definition => categoryFor(definition) === category).length
                  return <option key={category} value={category}>{category}（{count}）</option>
                })}
              </select>
            </label>
            <label className="chart-filter-select chart-filter-network">
              <span>运行</span>
              <select aria-label="按运行方式筛选图表" value={networkFilter} onChange={event => setNetworkFilter(event.target.value as NetworkFilter)}>
                {(['全部', '纯离线', '需要服务'] as NetworkFilter[]).map(filter => {
                  const count = builtinRendererDefinitions.filter(definition => matchesNetworkFilter(definition, filter)).length
                  return <option key={filter} value={filter}>{filter}（{count}）</option>
                })}
              </select>
            </label>
          </div>
          <label className="chart-type-picker" ref={typePickerRef}>
            <span>图表类型</span>
            <select value={selectedType ?? ''} onChange={event => {
              const definition = builtinRendererDefinitions.find(item => item.type === event.target.value)
              if (definition) openDefinition(definition)
            }}>
              <option value="" disabled>选择一种图表</option>
              {selectedDefinition && !filteredDefinitions.includes(selectedDefinition) && (
                <option value={selectedDefinition.type}>{selectedDefinition.displayName}（不在筛选结果中）</option>
              )}
              {filteredDefinitions.map(definition => <option key={definition.type} value={definition.type}>{definition.displayName}</option>)}
            </select>
          </label>
          {selectedDefinition && !filteredDefinitions.includes(selectedDefinition) && <p className="chart-filtered-selection" role="status">当前类型不在筛选结果中</p>}
          {!filteredDefinitions.length && <div className="chart-empty">
            <strong>没有匹配的图表类型</strong>
            <button type="button" onClick={() => {
              setQuery('')
              setCategoryFilter('全部')
              setNetworkFilter('全部')
            }}>重置筛选</button>
          </div>}
          <div className={`chart-reference-browser${selectedDefinition && selectedTemplate ? '' : ' is-empty'}`}>
            <nav className="chart-type-directory" aria-label="图表类型">
              <div className="chart-catalog-grid" ref={directoryRef}>
                {filteredDefinitions.map((definition, index) => (
                  <button
                    type="button"
                    key={definition.type}
                    className="chart-catalog-card"
                    data-renderer-type={definition.type}
                    aria-pressed={selectedType === definition.type}
                    tabIndex={definition.type === selectedType || (!filteredDefinitions.some(item => item.type === selectedType) && index === 0) ? 0 : -1}
                    onClick={() => openDefinition(definition)}
                    onKeyDown={event => navigateDirectory(event, index)}
                  >
                    <span className="chart-card-body">
                      <span className="chart-card-title">
                        <strong>{definition.displayName}</strong>
                        {definition.networkPolicy !== 'offlineOnly' && (
                          <span className={`chart-network-badge ${definition.networkPolicy}`}>{networkLabel(definition)}</span>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <small className="chart-keyboard-hint">↑ / ↓ 切换，Tab 进入详情</small>
            </nav>
            {selectedDefinition && selectedTemplate ? (
        <div className="chart-detail">
          <div className="chart-detail-header">
            <div>
              <div className="chart-detail-title">
                <h4>{selectedDefinition.displayName}</h4>
                <span className={`chart-network-badge ${selectedDefinition.networkPolicy}`}>{networkLabel(selectedDefinition)}</span>
              </div>
              <p className="chart-detail-description">{selectedTemplate.description}</p>
            </div>
            <div className="chart-detail-actions">
              <button type="button" className="primary" onClick={copyTemplate}>复制示例</button>
              {insertionSession && (
                <button type="button" className="primary" disabled={!insertionSession.isValid()} onClick={insertTemplate}>
                  插入到 {insertionSession.targetLabel}
                </button>
              )}
            </div>
          </div>
          {selectedTemplates.length > 1 && (
            <label className="chart-template-picker">
              <span>示例形式</span>
              <select
                value={selectedTemplate.id}
                onChange={event => {
                  setSelectedTemplateId(event.target.value)
                  setRemotePreviewRequested(false)
                  setActionMessage('')
                }}
              >
                {selectedTemplates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}
              </select>
            </label>
          )}
          <section className="chart-syntax-summary" aria-label="语法与兼容范围">
            <h5>语法与兼容范围</h5>
            <dl>
              <div><dt>Markdown 嵌入</dt><dd>{selectedTemplate.sourceKind === 'fence' ? `${selectedDefinition.languages[0]} 代码围栏` : selectedTemplate.sourceKind === 'inlineMath' ? '$...$ 行内公式' : '$$...$$ 块级公式'}</dd></div>
              <div><dt>语法来源</dt><dd>{getChartFormatGuidance(selectedDefinition.type).syntax}</dd></div>
              <div><dt>支持范围</dt><dd>{getChartFormatGuidance(selectedDefinition.type).limits}</dd></div>
            </dl>
          </section>
          <div className="chart-detail-tabs" role="tablist" aria-label="模板内容">
            <button type="button" role="tab" aria-selected={detailView === 'preview'} onClick={() => {
              setDetailView('preview')
              setActionMessage('')
            }}>预览</button>
            <button type="button" role="tab" aria-selected={detailView === 'source'} onClick={() => {
              setDetailView('source')
              setActionMessage('')
            }}>Markdown</button>
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
              <VirtualizedMarkdown key={selectedTemplate.id} content={chartTemplateMarkdown(selectedTemplate)} renderDebounceMs={0} remoteChartPolicy="allow" />
            </div>
          )}
          {detailView === 'source' && (
            <pre className="chart-template-source" data-renderer-type={selectedDefinition.type}><code>{chartTemplateMarkdown(selectedTemplate)}</code></pre>
          )}
          <details className="chart-format-details" key={selectedTemplate.id}>
            <summary>导出支持详情</summary>
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
          </details>
        </div>
            ) : (
              <div className="chart-reference-empty">
                <h4>选择图表类型，查看实际效果</h4>
                <p>复制示例交给外部工具生成内容，完整参考文件见“离线示例”。</p>
              </div>
            )}
          </div>
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
              <div><strong>{examplesStatus?.totalCaseCount ?? examplesStatus?.caseCount ?? '—'}</strong><span>精选案例</span></div>
              <div><strong>{examplesStatus?.rendererCount ?? 20}</strong><span>图表类型</span></div>
              <div><strong>{formatBytes(examplesStatus?.bytes)}</strong><span>压缩包体积</span></div>
            </div>
            <div className="chart-examples-contents">
              <h4>供外部工具引用的本地 Markdown</h4>
              <p>先参考格式，再按需要补充设计或专项案例，不必一次引用整套案例。</p>
              <ul>
                <li>{examplesStatus?.starterCount ?? 21} 个完整格式示例，覆盖 20 类图表与公式</li>
                <li>{examplesStatus?.designCaseCount ?? '—'} 个架构与流程图设计核心案例</li>
                <li>{examplesStatus?.galleryCaseCount ?? '—'} 个按 renderer 归档的专项正例</li>
              </ul>
            </div>
            <p className="chart-examples-open-note">
              点击后会自动准备到 MD Viewer 的应用数据目录，并切换到示例工作区、打开首页；无需选择位置或手工解压。
            </p>
            <p className="chart-offline-note">打开首页中的格式参考后，可在文档标签右键“复制文件路径”，在支持文件引用的工具中用 @ 选择文件或添加附件；也可以直接粘贴示例。</p>
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
