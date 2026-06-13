import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildPreflightResult } from '../cli/preflightCommand'

let tempDir: string | null = null

async function createMarkdown(content: string): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-preflight-'))
  const filePath = path.join(tempDir, 'report.md')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('buildPreflightResult', () => {
  it('passes a basic markdown document for pdf export', async () => {
    const filePath = await createMarkdown('# Report\n\nHello')

    const result = await buildPreflightResult([filePath], { format: 'pdf' })

    expect(result).toMatchObject({
      ok: true,
      command: 'preflight',
      summary: {
        status: 'ok',
        format: 'pdf',
        missingResources: 0,
      },
    })
  })

  it('fails when the target format is missing', async () => {
    const filePath = await createMarkdown('# Report')

    const result = await buildPreflightResult([filePath], {})

    expect(result).toMatchObject({
      ok: false,
      command: 'preflight',
      code: 'INVALID_ARGUMENT',
    })
  })

  it('warns about missing local image resources', async () => {
    const filePath = await createMarkdown('# Report\n\n![missing](./images/missing.png)')
    await mkdir(path.join(tempDir!, 'images'))

    const result = await buildPreflightResult([filePath], { format: 'html' })

    expect(result.ok).toBe(true)
    expect(result.summary).toMatchObject({
      status: 'warning',
      missingResources: 1,
    })
    expect(result.warnings[0]).toMatchObject({
      code: 'LOCAL_RESOURCE_MISSING',
      target: './images/missing.png',
    })
  })

  it('checks DOCX service availability when preflighting DOCX export', async () => {
    const filePath = await createMarkdown('# Report')
    const serviceUrl = 'http://127.0.0.1:9'

    const result = await buildPreflightResult([filePath], {
      format: 'docx',
      'docx-service': serviceUrl,
    })

    expect(result.ok).toBe(true)
    expect(result.summary).toMatchObject({
      format: 'docx',
      status: 'warning',
      docxService: false,
    })
    expect(result.warnings[0]).toMatchObject({
      code: 'DOCX_SERVICE_UNAVAILABLE',
      target: serviceUrl,
    })
    expect(result.actions[0]).toMatchObject({
      command: `md-viewer doctor --docx-service ${serviceUrl} --json`,
      risk: 'safe',
    })
  })
})
