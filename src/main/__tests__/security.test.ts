/**
 * 安全模块测试
 * @description 测试路径校验和受保护路径检测功能
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import {
  isProtectedPath,
  validateNotProtected,
  validateSecurePathInBase,
  resetSecurity
} from '../security'

const temporaryPaths: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-security-'))
  temporaryPaths.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(directory => fs.remove(directory)))
})

describe('Security Module', () => {
  beforeEach(() => {
    // 每个测试前重置安全配置
    resetSecurity()
  })

  describe('validateSecurePathInBase', () => {
    it('should allow the explicit root and its descendants', async () => {
      const root = await createTemporaryDirectory()
      const target = path.join(root, 'file.md')
      const canonicalRoot = await fs.realpath(root)

      await expect(validateSecurePathInBase(root, root)).resolves.toBe(canonicalRoot)
      await expect(validateSecurePathInBase(target, root)).resolves.toBe(
        path.join(canonicalRoot, 'file.md')
      )
    })

    it('should reject traversal and sibling-prefix paths', async () => {
      const parent = await createTemporaryDirectory()
      const root = path.join(parent, 'A')
      const sibling = path.join(parent, 'AB')
      await fs.ensureDir(root)
      await fs.ensureDir(sibling)

      await expect(
        validateSecurePathInBase(path.join(root, '..', 'B', 'file.md'), root)
      ).rejects.toThrow('安全错误')
      await expect(
        validateSecurePathInBase(path.join(sibling, 'file.md'), root)
      ).rejects.toThrow('安全错误')
    })

    it('should reject protected paths even inside the explicit root', async () => {
      const root = await createTemporaryDirectory()

      await expect(
        validateSecurePathInBase(path.join(root, '.ssh', 'id_rsa'), root)
      ).rejects.toThrow('受保护')
    })
  })

  describe('isProtectedPath', () => {
    it('should detect Unix system directories', () => {
      expect(isProtectedPath('/etc/passwd')).toBe(true)
      expect(isProtectedPath('/usr/bin/sudo')).toBe(true)
      expect(isProtectedPath('/System/Library/file')).toBe(true)
      expect(isProtectedPath('/bin/bash')).toBe(true)
      expect(isProtectedPath('/sbin/init')).toBe(true)
    })

    it('should detect Windows system directories', () => {
      // Note: 这个测试只在 Windows 上有效
      // 在 Unix 系统上，Windows 路径会被当作普通相对路径处理
      if (process.platform === 'win32') {
        expect(isProtectedPath('C:\\Windows\\System32\\file.dll')).toBe(true)
        expect(isProtectedPath('C:\\Program Files\\app\\file.exe')).toBe(true)
        expect(isProtectedPath('c:\\windows\\file.sys')).toBe(true) // 大小写不敏感
      } else {
        // 在非 Windows 平台上，跳过测试或使用不同的断言
        expect(true).toBe(true)
      }
    })

    it('should detect sensitive config directories', () => {
      expect(isProtectedPath('/Users/test/.ssh/id_rsa')).toBe(true)
      expect(isProtectedPath('/Users/test/.gnupg/private-key.asc')).toBe(true)
      expect(isProtectedPath('/Users/test/.aws/credentials')).toBe(true)
      expect(isProtectedPath('/Users/test/.kube/config')).toBe(true)
    })

    it('should detect hidden directory key/pem files', () => {
      expect(isProtectedPath('/Users/test/.config/private.key')).toBe(true)
      expect(isProtectedPath('/Users/test/.secrets/cert.pem')).toBe(true)
    })

    it('should not flag normal user files', () => {
      expect(isProtectedPath('/Users/test/documents/file.md')).toBe(false)
      expect(isProtectedPath('/Users/test/projects/app.js')).toBe(false)
      expect(isProtectedPath('/home/user/notes.txt')).toBe(false)
    })

    // ========== v1.3 新增测试 ==========
    describe('v1.3 扩展规则', () => {
      it('应该保护 Docker 配置目录', () => {
        expect(isProtectedPath('/Users/test/.docker/config.json')).toBe(true)
      })

      it('应该保护 Azure 配置目录', () => {
        expect(isProtectedPath('/Users/test/.azure/credentials')).toBe(true)
      })

      it('应该保护 Google Cloud 配置目录', () => {
        expect(isProtectedPath('/Users/test/.gcloud/credentials.db')).toBe(true)
        expect(isProtectedPath('/Users/test/.config/gcloud/credentials.db')).toBe(true)
      })

      it('应该保护 GitHub CLI 配置目录', () => {
        expect(isProtectedPath('/Users/test/.config/gh/hosts.yml')).toBe(true)
      })

      it('应该保护 .env 文件', () => {
        expect(isProtectedPath('/project/.env')).toBe(true)
        expect(isProtectedPath('/project/.env.local')).toBe(true)
        expect(isProtectedPath('/project/.env.production')).toBe(true)
      })

      it('应该保护 NPM 配置文件', () => {
        expect(isProtectedPath('/Users/test/.npmrc')).toBe(true)
      })

      it('应该保护 PyPI 配置文件', () => {
        expect(isProtectedPath('/Users/test/.pypirc')).toBe(true)
      })

      it('应该保护 Git 凭证文件', () => {
        expect(isProtectedPath('/Users/test/.git-credentials')).toBe(true)
        expect(isProtectedPath('/Users/test/.gitconfig')).toBe(true)
      })

      it('应该保护 Keychain 目录', () => {
        expect(isProtectedPath('/Users/test/Library/Keychains/login.keychain')).toBe(true)
      })

      it('应该保护 SSH 私钥文件', () => {
        expect(isProtectedPath('/Users/test/.ssh/id_rsa')).toBe(true)
        expect(isProtectedPath('/Users/test/.ssh/id_ed25519')).toBe(true)
        expect(isProtectedPath('/Users/test/.ssh/id_ecdsa')).toBe(true)
        expect(isProtectedPath('/Users/test/.ssh/id_dsa')).toBe(true)
      })

      it('应该保护证书文件', () => {
        expect(isProtectedPath('/project/server.pem')).toBe(true)
        expect(isProtectedPath('/project/server.key')).toBe(true)
        expect(isProtectedPath('/project/cert.p12')).toBe(true)
        expect(isProtectedPath('/project/cert.pfx')).toBe(true)
      })

      it('应该保护 Java 密钥库', () => {
        expect(isProtectedPath('/project/app.keystore')).toBe(true)
        expect(isProtectedPath('/project/app.jks')).toBe(true)
      })

      it('应该保护密码管理器数据库', () => {
        expect(isProtectedPath('/Users/test/passwords.kdbx')).toBe(true)
        expect(isProtectedPath('/Users/test/export.1pux')).toBe(true)
      })

      it('应该保护包含 password 的文件', () => {
        expect(isProtectedPath('/project/password.txt')).toBe(true)
        expect(isProtectedPath('/project/passwords.json')).toBe(true)
        expect(isProtectedPath('/project/myPassword.md')).toBe(true)
      })

      it('应该保护隐藏目录下的敏感文件', () => {
        expect(isProtectedPath('/Users/test/.config/credentials.json')).toBe(true)
        expect(isProtectedPath('/Users/test/.app/secret.yaml')).toBe(true)
        expect(isProtectedPath('/Users/test/.service/token.txt')).toBe(true)
      })

      it('不应该误判普通 Markdown 文件', () => {
        expect(isProtectedPath('/Users/test/docs/README.md')).toBe(false)
        expect(isProtectedPath('/Users/test/notes/todo.md')).toBe(false)
        expect(isProtectedPath('/project/docs/api.md')).toBe(false)
      })
    })
  })

  describe('validateNotProtected', () => {
    it('should not throw for normal paths', () => {
      expect(() => validateNotProtected('/Users/test/documents/file.md')).not.toThrow()
    })

    it('should throw for protected paths', () => {
      expect(() => validateNotProtected('/etc/passwd')).toThrow('安全错误')
      expect(() => validateNotProtected('/Users/test/.ssh/id_rsa')).toThrow('安全错误')
    })

    it('should throw with descriptive error message', () => {
      expect(() => validateNotProtected('/etc/passwd')).toThrow(/受保护的系统路径/)
    })
  })

})
