import { app } from 'electron'
import { createDiagnosticsBundle, type DiagnosticsBundleInput } from '../diagnostics/DiagnosticsService'
import { createFailureResult, createSuccessResult } from './result'

export async function buildDoctorBundleResult(
  flags: Record<string, string | boolean>,
) {
  const output = typeof flags.bundle === 'string' ? flags.bundle : null
  if (!output) {
    return createFailureResult('doctor', {
      code: 'INVALID_ARGUMENT',
      message: 'doctor --bundle 需要 ZIP 输出路径',
      exitCode: 2,
    })
  }
  const bundle = await createDiagnosticsBundle(output, collectCliDiagnostics())
  return createSuccessResult('doctor', {
    summary: {
      status: 'ok',
      bundleCreated: true,
      categories: ['app', 'packaging', 'docx', 'tts'],
    },
    results: {
      entries: bundle.entries,
      bytes: bundle.bytes,
    },
    artifacts: [{ type: 'diagnostics-zip', path: bundle.outputPath, bytes: bundle.bytes }],
  })
}

function collectCliDiagnostics(): DiagnosticsBundleInput {
  return {
    app: {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
    },
    packaging: {
      packaged: app.isPackaged,
      runtimeDependencyCheck: 'unknown',
      resourceCheck: 'unknown',
      localeCheck: 'unknown',
      fontCheck: 'unknown',
    },
    docx: { configured: false, status: 'not-configured' },
    tts: { providers: [] },
    errors: [],
  }
}
