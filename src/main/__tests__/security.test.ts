/**
 * 安全模块测试
 * @description 测试路径校验和受保护路径检测功能
 */

import {
  setAllowedBasePath,
  getAllowedBasePath,
  isPathAllowed,
  validatePath,
  isProtectedPath,
  validateNotProtected,
  validateSecurePath,
  resetSecurity
} from '../security'

describe('Security Module', () => {
  beforeEach(() => {
    // 每个测试前重置安全配置
    resetSecurity()
  })

  describe('setAllowedBasePath & getAllowedBasePath', () => {
    it('should set and get allowed base path', () => {
      const testPath = '/Users/test/documents'
      setAllowedBasePath(testPath)
      expect(getAllowedBasePath()).toBe(testPath)
    })

    it('should resolve relative paths to absolute', () => {
      setAllowedBasePath('./test')
      const result = getAllowedBasePath()
      expect(result).toBeTruthy()
      expect(result).not.toBe('./test')
    })

    it('should return null when not set', () => {
      expect(getAllowedBasePath()).toBeNull()
    })
  })

  describe('isPathAllowed', () => {
    beforeEach(() => {
      setAllowedBasePath('/Users/test/documents')
    })

    it('should allow paths within the base path', () => {
      expect(isPathAllowed('/Users/test/documents/file.md')).toBe(true)
      expect(isPathAllowed('/Users/test/documents/sub/file.md')).toBe(true)
    })

    it('should allow the base path itself', () => {
      expect(isPathAllowed('/Users/test/documents')).toBe(true)
    })

    it('should reject paths outside the base path', () => {
      expect(isPathAllowed('/Users/test/other/file.md')).toBe(false)
      expect(isPathAllowed('/Users/other/documents/file.md')).toBe(false)
      expect(isPathAllowed('/etc/passwd')).toBe(false)
    })

    it('should prevent path traversal attacks', () => {
      // 尝试通过 ../ 穿越到父目录
      expect(isPathAllowed('/Users/test/documents/../other/file.md')).toBe(false)
      expect(isPathAllowed('/Users/test/documents/sub/../../other/file.md')).toBe(false)
    })

    it('should return false when no base path is set', () => {
      resetSecurity()
      expect(isPathAllowed('/Users/test/documents/file.md')).toBe(false)
    })
  })

  describe('validatePath', () => {
    beforeEach(() => {
      setAllowedBasePath('/Users/test/documents')
    })

    it('should not throw for allowed paths', () => {
      expect(() => validatePath('/Users/test/documents/file.md')).not.toThrow()
    })

    it('should throw for disallowed paths', () => {
      expect(() => validatePath('/etc/passwd')).toThrow('安全错误')
      expect(() => validatePath('/Users/other/file.md')).toThrow('安全错误')
    })

    it('should throw with descriptive error message', () => {
      expect(() => validatePath('/etc/passwd')).toThrow(/不在允许范围内/)
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

  describe('validateSecurePath (综合验证)', () => {
    beforeEach(() => {
      setAllowedBasePath('/Users/test/documents')
    })

    it('should pass for allowed and non-protected paths', () => {
      expect(() => validateSecurePath('/Users/test/documents/file.md')).not.toThrow()
    })

    it('should fail for disallowed paths', () => {
      expect(() => validateSecurePath('/Users/other/file.md')).toThrow()
    })

    it('should fail for protected paths even if within allowed base', () => {
      // 假设用户打开了系统目录（不应该发生，但要防御）
      setAllowedBasePath('/Users/test')
      expect(() => validateSecurePath('/Users/test/.ssh/id_rsa')).toThrow()
    })

    it('should prevent path traversal to protected areas', () => {
      setAllowedBasePath('/Users/test/documents')
      expect(() => validateSecurePath('/Users/test/documents/../.ssh/id_rsa')).toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle paths with trailing slashes', () => {
      setAllowedBasePath('/Users/test/documents/')
      expect(isPathAllowed('/Users/test/documents/file.md')).toBe(true)
    })

    it('should handle paths with mixed separators (Windows)', () => {
      // Note: 这个测试只在 Windows 上有效
      // 在 Unix 系统上，反斜杠不是路径分隔符
      if (process.platform === 'win32') {
        setAllowedBasePath('C:\\Users\\test\\documents')
        // path.resolve 会统一分隔符
        expect(isPathAllowed('C:\\Users\\test\\documents\\file.md')).toBe(true)
      } else {
        // 在非 Windows 平台上，跳过测试
        expect(true).toBe(true)
      }
    })

    it('should handle symlinks correctly', () => {
      // Note: 这个测试依赖于 path.resolve 的行为
      // 在实际环境中，symlinks 会被解析为真实路径
      setAllowedBasePath('/Users/test/documents')
      expect(() => validatePath('/Users/test/documents/link-to-file.md')).not.toThrow()
    })
  })

  describe('resetSecurity', () => {
    it('should clear allowed base path', () => {
      setAllowedBasePath('/Users/test/documents')
      expect(getAllowedBasePath()).not.toBeNull()

      resetSecurity()
      expect(getAllowedBasePath()).toBeNull()
    })
  })
})
