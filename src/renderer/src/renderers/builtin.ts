import type { RendererDefinition, RendererTarget, RendererTargetCapability } from './types'

function supported(): RendererTargetCapability {
  return { state: 'supported' }
}

function supportedTargets(overrides: Partial<Record<RendererTarget, RendererTargetCapability>> = {}): Record<RendererTarget, RendererTargetCapability> {
  return {
    preview: supported(),
    html: supported(),
    pdf: supported(),
    docxClient: supported(),
    serverRender: supported(),
    docxService: supported(),
    ...overrides,
  }
}

function createDefinition(input: Pick<RendererDefinition, 'type' | 'displayName' | 'aliases' | 'languages' | 'sourceKinds' | 'renderMode' | 'selectors'> & Partial<Pick<RendererDefinition, 'capabilities' | 'networkPolicy' | 'fallbackPolicy' | 'manifestVersion' | 'userHelp' | 'sanitizePolicy' | 'replacement'>>): RendererDefinition {
  return {
    capabilities: supportedTargets(),
    networkPolicy: 'offlineOnly',
    fallbackPolicy: 'allowSourceFallbackWithWarning',
    manifestVersion: '2.0',
    userHelp: {
      exampleFence: input.languages[0],
      settingsDescription: `${input.displayName} renderer`,
      failureHints: {},
    },
    sanitizePolicy: {
      classes: [],
      attributes: [],
    },
    replacement: {
      strategy: 'blockId',
    },
    ...input,
  }
}

export const builtinRendererDefinitions: RendererDefinition[] = [
  createDefinition({
    type: 'mermaid',
    displayName: 'Mermaid',
    aliases: [],
    languages: ['mermaid'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-mermaid, .mermaid-wrapper, .mermaid-error',
      ready: '.mermaid-wrapper svg',
      screenshotTarget: '.mermaid-wrapper svg',
    },
  }),
  createDefinition({
    type: 'echarts',
    displayName: 'ECharts',
    aliases: [],
    languages: ['echarts'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-echarts, .echarts-wrapper, .echarts-error',
      ready: '.echarts-wrapper .echarts-container svg',
      screenshotTarget: '.echarts-wrapper .echarts-container',
    },
  }),
  createDefinition({
    type: 'markmap',
    displayName: 'Markmap',
    aliases: [],
    languages: ['markmap'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-markmap, .markmap-wrapper, .markmap-error',
      ready: '.markmap-wrapper .markmap-container svg',
      screenshotTarget: '.markmap-wrapper .markmap-container svg',
    },
  }),
  createDefinition({
    type: 'graphviz',
    displayName: 'Graphviz',
    aliases: ['dot'],
    languages: ['graphviz'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-graphviz, .graphviz-wrapper, .graphviz-error',
      ready: '.graphviz-wrapper .graphviz-container svg',
      screenshotTarget: '.graphviz-wrapper .graphviz-container',
    },
  }),
  createDefinition({
    type: 'plantuml',
    displayName: 'PlantUML',
    aliases: ['puml'],
    languages: ['plantuml'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    networkPolicy: 'explicitRemoteAllowed',
    selectors: {
      preview: 'pre.language-plantuml, .plantuml-wrapper, .plantuml-error',
      ready: '.plantuml-wrapper .plantuml-container svg',
      screenshotTarget: '.plantuml-wrapper .plantuml-container svg',
    },
  }),
  createDefinition({
    type: 'drawio',
    displayName: 'DrawIO',
    aliases: ['dio'],
    languages: ['drawio'],
    sourceKinds: ['fence'],
    renderMode: 'dom',
    selectors: {
      preview: 'pre.language-drawio, .drawio-wrapper, .drawio-error',
      ready: '.drawio-container[data-drawio-ready="true"] svg',
      screenshotTarget: '.drawio-wrapper .drawio-container',
    },
  }),
  createDefinition({
    type: 'infographic',
    displayName: 'Infographic',
    aliases: [],
    languages: ['infographic'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-infographic, .infographic-wrapper, .infographic-error',
      ready: '.infographic-wrapper .infographic-container svg',
      screenshotTarget: '.infographic-wrapper .infographic-container svg',
    },
  }),
  createDefinition({
    type: 'katex',
    displayName: 'KaTeX',
    aliases: [],
    languages: [],
    sourceKinds: ['inlineMath', 'blockMath'],
    renderMode: 'dom',
    selectors: {
      preview: '.katex',
      ready: '.katex',
      screenshotTarget: '.katex-html, .katex',
    },
    replacement: {
      strategy: 'mathBlockId',
    },
  }),
  createDefinition({
    type: 'excalidraw',
    displayName: 'Excalidraw',
    aliases: ['excalidraw-json'],
    languages: ['excalidraw'],
    sourceKinds: ['fence', 'imageRef', 'fileResource'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-excalidraw, .excalidraw-file-placeholder, .excalidraw-wrapper, .excalidraw-error',
      ready: '.excalidraw-wrapper svg',
      screenshotTarget: '.excalidraw-wrapper .excalidraw-container svg',
    },
    replacement: {
      strategy: 'blockId',
      fileExtensions: ['excalidraw'],
    },
  }),
  createDefinition({
    type: 'vega-lite',
    displayName: 'Vega-Lite',
    aliases: ['vegalite'],
    languages: ['vega-lite'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-vega-lite, .vega-lite-wrapper, .vega-lite-error',
      ready: '.vega-lite-wrapper .vega-lite-container svg',
      screenshotTarget: '.vega-lite-wrapper .vega-lite-container svg',
    },
  }),
  createDefinition({
    type: 'd2',
    displayName: 'D2',
    aliases: [],
    languages: ['d2'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-d2, .d2-wrapper, .d2-error',
      ready: '.d2-wrapper .d2-container svg',
      screenshotTarget: '.d2-wrapper .d2-container svg',
    },
  }),
  createDefinition({
    type: 'bpmn',
    displayName: 'BPMN',
    aliases: [],
    languages: ['bpmn'],
    sourceKinds: ['fence', 'imageRef', 'fileResource'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-bpmn, .bpmn-file-placeholder, .bpmn-wrapper, .bpmn-error',
      ready: '.bpmn-wrapper .bpmn-container svg',
      screenshotTarget: '.bpmn-wrapper .bpmn-container svg',
    },
    replacement: {
      strategy: 'blockId',
      fileExtensions: ['bpmn'],
    },
  }),
  createDefinition({
    type: 'wavedrom',
    displayName: 'WaveDrom',
    aliases: [],
    languages: ['wavedrom'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-wavedrom, .wavedrom-wrapper, .wavedrom-error',
      ready: '.wavedrom-wrapper .wavedrom-container svg',
      screenshotTarget: '.wavedrom-wrapper .wavedrom-container svg',
    },
  }),
  createDefinition({
    type: 'c4plantuml',
    displayName: 'C4-PlantUML',
    aliases: ['c4'],
    languages: ['c4plantuml'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    networkPolicy: 'explicitRemoteAllowed',
    selectors: {
      preview: 'pre.language-c4plantuml, .c4plantuml-wrapper, .c4plantuml-error',
      ready: '.c4plantuml-wrapper .plantuml-container svg',
      screenshotTarget: '.c4plantuml-wrapper .plantuml-container svg',
    },
  }),
  createDefinition({
    type: 'structurizr',
    displayName: 'Structurizr',
    aliases: ['structurizr-dsl'],
    languages: ['structurizr'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-structurizr, .structurizr-wrapper, .structurizr-error',
      ready: '.structurizr-wrapper .structurizr-container svg',
      screenshotTarget: '.structurizr-wrapper .structurizr-container svg',
    },
  }),
  createDefinition({
    type: 'plotly',
    displayName: 'Plotly',
    aliases: ['plotly-json'],
    languages: ['plotly'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-plotly, .plotly-wrapper, .plotly-error',
      ready: '.plotly-wrapper .plotly-container svg',
      screenshotTarget: '.plotly-wrapper .plotly-container svg',
    },
  }),
  createDefinition({
    type: 'dbml',
    displayName: 'DBML',
    aliases: [],
    languages: ['dbml'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-dbml, .dbml-wrapper, .dbml-error',
      ready: '.dbml-wrapper .dbml-container svg',
      screenshotTarget: '.dbml-wrapper .dbml-container svg',
    },
  }),
  createDefinition({
    type: 'antv-g6',
    displayName: 'AntV G6',
    aliases: ['g6'],
    languages: ['antv-g6'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    selectors: {
      preview: 'pre.language-antv-g6, .antv-g6-wrapper, .antv-g6-error',
      ready: '.antv-g6-wrapper .antv-g6-container svg',
      screenshotTarget: '.antv-g6-wrapper .antv-g6-container svg',
    },
  }),
  createDefinition({
    type: 'kroki',
    displayName: 'Kroki',
    aliases: ['kroki-pikchr', 'kroki-nomnoml', 'kroki-svgbob', 'kroki-bytefield', 'kroki-tikz'],
    languages: ['kroki', 'pikchr', 'nomnoml', 'svgbob', 'bytefield', 'tikz'],
    sourceKinds: ['fence'],
    renderMode: 'svg',
    networkPolicy: 'explicitRemoteAllowed',
    selectors: {
      preview: 'pre.language-kroki, .kroki-wrapper, .kroki-error',
      ready: '.kroki-wrapper .kroki-container svg',
      screenshotTarget: '.kroki-wrapper .kroki-container svg',
    },
  }),
]
