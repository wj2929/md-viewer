import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('macOS DMG installer guidance', () => {
  it('includes a first-open instruction file in the DMG layout', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const contents = packageJson.build?.dmg?.contents ?? []

    expect(contents).toContainEqual(
      expect.objectContaining({
        type: 'file',
        path: 'resources/mac-first-open-note.txt',
        name: '首次打开说明.txt',
      }),
    )
  })
})
