import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildOpenResult } from '../cli/openCommand'

let tempDir: string | null = null

async function makeTempMarkdown(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-open-'))
  const filePath = path.join(tempDir, 'report.md')
  await writeFile(filePath, '# Report', 'utf8')
  return filePath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('buildOpenResult', () => {
  it('validates a markdown file and returns a GUI open action result', async () => {
    const filePath = await makeTempMarkdown()

    const result = await buildOpenResult([filePath], {})

    expect(result).toMatchObject({
      ok: true,
      command: 'open',
      summary: {
        type: 'md-file',
        normalizedPath: await realpath(filePath),
      },
      results: {
        open: {
          type: 'md-file',
          normalizedPath: await realpath(filePath),
        },
      },
    })
  })

  it('returns INVALID_ARGUMENT when input path is missing', async () => {
    const result = await buildOpenResult([], {})

    expect(result).toMatchObject({
      ok: false,
      command: 'open',
      code: 'INVALID_ARGUMENT',
      actions: [
        {
          command: 'md-viewer help open --json',
          risk: 'safe',
        },
      ],
    })
  })

  it('returns INPUT_NOT_FOUND when the path does not exist', async () => {
    const result = await buildOpenResult(['/path/that/does/not/exist.md'], {})

    expect(result).toMatchObject({
      ok: false,
      command: 'open',
      code: 'INPUT_NOT_FOUND',
      target: '/path/that/does/not/exist.md',
    })
  })
})
