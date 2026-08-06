import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import { validateSecurePathInBase } from '../security'

const temporaryPaths: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-security-'))
  temporaryPaths.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(directory => fs.remove(directory)))
})

describe('validateSecurePathInBase realpath boundary', () => {
  it('allows a nested target that does not exist yet', async () => {
    const root = await createTemporaryDirectory()
    const target = path.join(root, 'new', 'nested', 'file.md')
    const canonicalRoot = await fs.realpath(root)

    await expect(validateSecurePathInBase(target, root)).resolves.toBe(
      path.join(canonicalRoot, 'new', 'nested', 'file.md')
    )
  })

  it('rejects a source reached through a symbolic link outside the root', async () => {
    const root = await createTemporaryDirectory()
    const outside = await createTemporaryDirectory()
    await fs.writeFile(path.join(outside, 'secret.md'), 'secret')
    await fs.symlink(outside, path.join(root, 'outside-link'), 'dir')

    await expect(
      validateSecurePathInBase(path.join(root, 'outside-link', 'secret.md'), root)
    ).rejects.toThrow('安全错误')
  })

  it('rejects a new target under a symbolic link outside the root', async () => {
    const root = await createTemporaryDirectory()
    const outside = await createTemporaryDirectory()
    await fs.symlink(outside, path.join(root, 'outside-link'), 'dir')

    await expect(
      validateSecurePathInBase(path.join(root, 'outside-link', 'copied.md'), root)
    ).rejects.toThrow('安全错误')
  })

  it('rejects a target below a dangling symbolic link', async () => {
    const root = await createTemporaryDirectory()
    await fs.symlink(path.join(root, 'missing-target'), path.join(root, 'dangling-link'), 'dir')

    await expect(
      validateSecurePathInBase(path.join(root, 'dangling-link', 'copied.md'), root)
    ).rejects.toThrow('安全错误')
  })
})
