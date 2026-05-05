import { mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateSecurePath } from '../security/pathValidator'

let tempDir: string | null = null

async function makeTempFile(fileName: string, content: string): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-path-validator-'))
  const filePath = path.join(tempDir, fileName)
  await writeFile(filePath, content, 'utf8')
  return filePath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('pathValidator previewable files', () => {
  it('accepts .excalidraw files as launchable preview files', async () => {
    const filePath = await makeTempFile('diagram.excalidraw', '{"type":"excalidraw","elements":[]}')

    const result = await validateSecurePath(filePath)

    expect(result.valid).toBe(true)
    expect(result.type).toBe('md-file')
    expect(result.normalizedPath).toBe(await realpath(filePath))
  })

  it('still rejects unsupported files', async () => {
    const filePath = await makeTempFile('notes.txt', 'hello')

    const result = await validateSecurePath(filePath)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('只支持 Markdown 或 Excalidraw 文件')
  })
})
