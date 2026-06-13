import { CLI_SCHEMA_VERSION, type CliCommandSchema, type CliCommandName } from './types'

export function getSharedResultSchema() {
  return {
    name: 'CliResult',
    schemaVersion: CLI_SCHEMA_VERSION,
    type: 'object',
    required: [
      'schemaVersion',
      'ok',
      'command',
      'summary',
      'results',
      'artifacts',
      'warnings',
      'actions',
    ],
    properties: {
      schemaVersion: { type: 'string', enum: [CLI_SCHEMA_VERSION] },
      ok: { type: 'boolean' },
      command: { type: 'string' },
      summary: { type: 'object' },
      results: { type: 'object' },
      artifacts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'path'],
          properties: {
            type: { type: 'string' },
            path: { type: 'string' },
            bytes: { type: 'number' },
          },
        },
      },
      warnings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            target: { type: 'string' },
          },
        },
      },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['label', 'risk'],
          properties: {
            label: { type: 'string' },
            command: { type: 'string' },
            docsUrl: { type: 'string' },
            target: { type: 'string' },
            risk: {
              type: 'string',
              enum: ['safe', 'writes-file', 'network', 'starts-service', 'destructive'],
            },
          },
        },
      },
      diagnostics: { type: 'object' },
      code: { type: 'string' },
      message: { type: 'string' },
      target: { type: 'string' },
    },
  }
}

export const commandSchemas: Partial<Record<CliCommandName | 'result', CliCommandSchema>> = {
  result: {
    command: 'result',
    description: '所有自动化命令共享的 JSON 输出契约。',
    positional: [],
    flags: {},
  },
  capabilities: {
    command: 'capabilities',
    description: '输出当前版本支持的 CLI 能力。',
    positional: [],
    flags: {
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  schema: {
    command: 'schema',
    description: '输出命令参数或结果 schema。',
    positional: [{ name: 'target', required: false, description: '命令名或 result。' }],
    flags: {
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  help: {
    command: 'help',
    description: '输出人类帮助或 AI 可解析帮助。',
    positional: [{ name: 'command', required: false, description: '目标命令。' }],
    flags: {
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  open: {
    command: 'open',
    description: '打开 Markdown 文件或目录。',
    positional: [{ name: 'input', required: true, description: 'Markdown 文件或目录路径。' }],
    flags: {
      line: { type: 'number', description: '打开到指定行。' },
      heading: { type: 'string', description: '打开到指定标题。' },
    },
  },
  export: {
    command: 'export',
    description: '导出 HTML、PDF 或 DOCX。',
    positional: [{ name: 'input', required: true, description: 'Markdown 文件路径。' }],
    flags: {
      format: { type: 'string', required: true, enum: ['html', 'pdf', 'docx'], description: '导出格式。' },
      out: { type: 'string', required: true, description: '输出文件路径。' },
      'docx-style': { type: 'string', enum: ['preview', 'standard', 'official', 'internal', 'report'], description: 'DOCX 样式。' },
      'docx-service': { type: 'string', description: 'DOCX 服务地址，默认 http://127.0.0.1:3179。' },
      'docx-api-key': { type: 'string', description: 'DOCX 服务 API Key。' },
      'embed-font': { type: 'boolean', description: '请求 DOCX 服务按需嵌入可用字体。' },
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  preflight: {
    command: 'preflight',
    description: '导出前检查文档和目标格式风险。',
    positional: [{ name: 'input', required: true, description: 'Markdown 文件路径。' }],
    flags: {
      format: { type: 'string', required: true, enum: ['html', 'pdf', 'docx'], description: '目标格式。' },
      'docx-service': { type: 'string', description: 'DOCX 服务地址，format=docx 时用于服务可用性检查。' },
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  doctor: {
    command: 'doctor',
    description: '检查当前环境和服务状态。',
    positional: [],
    flags: {
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
      'docx-service': { type: 'string', description: 'DOCX 服务地址。' },
    },
  },
  screenshot: {
    command: 'screenshot',
    description: '生成页面、正文、选择器或图表截图。',
    positional: [{ name: 'input', required: true, description: 'Markdown 文件路径。' }],
    flags: {
      out: { type: 'string', required: true, description: '输出 PNG 路径。' },
      selector: { type: 'string', description: '截图目标 CSS selector。' },
      chart: { type: 'number', description: '图表序号。' },
      width: { type: 'number', description: '视口宽度。' },
      height: { type: 'number', description: '视口高度。' },
      theme: { type: 'string', enum: ['light', 'dark'], description: '截图主题。' },
      scale: { type: 'number', description: '设备缩放倍率。' },
    },
  },
  charts: {
    command: 'charts',
    description: '列出或导出文档图表。',
    positional: [
      { name: 'action', required: true, description: 'list 或 export。' },
      { name: 'input', required: true, description: 'Markdown 文件路径。' },
    ],
    flags: {
      out: { type: 'string', description: '输出 ZIP 路径。' },
      'out-dir': { type: 'string', description: '输出目录。' },
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  batch: {
    command: 'batch',
    description: '批量执行真实文档回归。',
    positional: [{ name: 'config', required: true, description: '批量配置 JSON 文件。' }],
    flags: {
      out: { type: 'string', description: 'JSON 报告路径。' },
      'report-md': { type: 'string', description: 'Markdown 报告路径。' },
      'artifacts-dir': { type: 'string', description: 'documents 配置展开后的导出、截图和图表产物目录。' },
      'fail-fast': { type: 'boolean', description: '首个失败后停止。' },
    },
  },
  inspect: {
    command: 'inspect',
    description: '分析 Markdown 结构、链接、图片和图表风险。',
    positional: [{ name: 'input', required: true, description: 'Markdown 文件路径。' }],
    flags: {
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  links: {
    command: 'links',
    description: '检查 Markdown 本地链接、锚点、图片资源和外链。',
    positional: [{ name: 'input', required: true, description: 'Markdown 文件路径。' }],
    flags: {
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  render: {
    command: 'render',
    description: '执行诊断渲染并输出图表统计，可选写出中间 HTML。',
    positional: [{ name: 'input', required: true, description: 'Markdown 文件路径。' }],
    flags: {
      out: { type: 'string', description: '可选输出中间 HTML 文件路径。' },
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  'install-cli': {
    command: 'install-cli',
    description: '在 macOS、Windows 或 Linux 上安装 md-viewer 命令行入口。',
    positional: [],
    flags: {
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
  'uninstall-cli': {
    command: 'uninstall-cli',
    description: '移除 MD Viewer 生成的 md-viewer 命令行入口。',
    positional: [],
    flags: {
      json: { type: 'boolean', description: '输出机器可读 JSON。' },
    },
  },
}

export function getCommandParameterSchema(command: string): CliCommandSchema | undefined {
  return commandSchemas[command as CliCommandName | 'result']
}
