import { checkDocxService, getRuntimeDiagnostics } from './diagnostics'
import { createSuccessResult } from './result'

export async function buildDoctorResult(flags: Record<string, string | boolean>) {
  const runtime = getRuntimeDiagnostics()
  const serviceUrl = typeof flags['docx-service'] === 'string' ? flags['docx-service'] : undefined
  const docxService = serviceUrl ? await checkDocxService(serviceUrl) : undefined
  const status = docxService && !docxService.ok ? 'warning' : 'ok'

  return createSuccessResult('doctor', {
    summary: {
      status,
      platform: runtime.platform,
      arch: runtime.arch,
      docxService: docxService ? docxService.ok : 'not-configured',
    },
    results: {
      runtime,
      ...(docxService ? { docxService } : {}),
    },
    warnings: docxService && !docxService.ok
      ? [
          {
            code: 'DOCX_SERVICE_UNAVAILABLE',
            message: '无法连接 DOCX 服务',
            target: serviceUrl,
          },
        ]
      : [],
    actions: docxService && !docxService.ok
      ? [
          {
            label: '检查 DOCX 服务地址',
            command: 'md-viewer doctor --json',
            target: 'docx-service',
            risk: 'safe',
          },
        ]
      : [],
  })
}
