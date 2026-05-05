import AdmZip from 'adm-zip'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportToDocx } from '../docxExporter'

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('docxExporter embedded chart images', () => {
  it('embeds generated chart placeholders as DOCX media images', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-docx-images-'))
    const outputPath = path.join(tempDir, 'diagram.docx')

    await (exportToDocx as any)(
      '![架构图](mdv__chart__direct_excalidraw__)',
      outputPath,
      tempDir,
      [],
      [
        {
          id: 'mdv__chart__direct_excalidraw__',
          pngBase64: ONE_PIXEL_PNG,
          widthCm: 6,
        },
      ]
    )

    const zip = new AdmZip(outputPath)
    const entries = zip.getEntries().map(entry => entry.entryName)

    expect(entries.filter(name => name.startsWith('word/media/') && name.endsWith('.png'))).toHaveLength(1)
    expect(entries).toContain('word/document.xml')
    expect(entries).toContain('word/_rels/document.xml.rels')
  })
})
