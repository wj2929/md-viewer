const COMMON_STYLE_SOURCES = [
  "'self'",
  "'unsafe-inline'",
  'https://registry.npmmirror.com',
  'https://cdn.jsdelivr.net',
  'https://assets.antv.antgroup.com',
]

const COMMON_FONT_SOURCES = [
  "'self'",
  'data:',
  'https://registry.npmmirror.com',
  'https://cdn.jsdelivr.net',
  'https://viewer.diagrams.net',
  'https://assets.antv.antgroup.com',
]

const COMMON_CONNECT_SOURCES = [
  "'self'",
  'https://viewer.diagrams.net',
  'https://www.plantuml.com',
  'https://assets.antv.antgroup.com',
]

function joinDirective(name: string, sources: string[]): string {
  return `${name} ${sources.join(' ')}`
}

export function createContentSecurityPolicy(dev: boolean): string {
  const directives = [
    joinDirective('default-src', ["'self'"]),
    joinDirective(
      'script-src',
      dev
        ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', 'https://viewer.diagrams.net']
        : ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'https://viewer.diagrams.net'],
    ),
    joinDirective('style-src', COMMON_STYLE_SOURCES),
    joinDirective('img-src', dev
      ? ["'self'", 'data:', 'blob:', 'https:', 'local-image:']
      : ["'self'", 'data:', 'https:', 'local-image:']),
    joinDirective('font-src', COMMON_FONT_SOURCES),
    joinDirective('connect-src', dev
      ? [...COMMON_CONNECT_SOURCES, 'ws://localhost:*', 'http://localhost:*']
      : [...COMMON_CONNECT_SOURCES, 'http://localhost:*', 'http://127.0.0.1:*']),
  ]

  if (dev) {
    directives.push(joinDirective('worker-src', ["'self'", 'blob:']))
  }

  return `${directives.join('; ')};`
}
