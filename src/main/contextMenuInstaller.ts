/**
 * 右键菜单安装器 - 跨平台实现
 */

import { app, dialog } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface InstallResult {
  success: boolean
  error?: string
}

/**
 * 安全的 Shell 路径转义（macOS）
 */
function escapeShellPath(inputPath: string): string {
  if (!inputPath || !inputPath.endsWith('.app')) {
    throw new Error('Invalid application path')
  }

  const allowedPrefixes = ['/Applications/', '/Users/']
  const normalizedPath = path.resolve(inputPath)

  if (!allowedPrefixes.some(prefix => normalizedPath.startsWith(prefix))) {
    throw new Error('Application path outside allowed directories')
  }

  return inputPath.replace(/'/g, "'\\''")
}

/**
 * 安全的注册表路径转义（Windows）
 */
function escapeRegPath(inputPath: string): string {
  if (!/^[A-Z]:\\/i.test(inputPath)) {
    throw new Error('Invalid Windows path format')
  }

  if (!inputPath.endsWith('.exe')) {
    throw new Error('Path must be an executable')
  }

  const dangerousChars = /[<>|&^%$#@!`]/
  if (dangerousChars.test(inputPath)) {
    throw new Error('Path contains dangerous characters')
  }

  return inputPath
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\n/g, '')
}

/**
 * macOS 安装右键菜单
 */
export async function installMacOSContextMenu(): Promise<InstallResult> {
  const rawAppPath = app.getPath('exe').replace(/\.app\/.*$/, '.app')

  let escapedAppPath: string
  try {
    escapedAppPath = escapeShellPath(rawAppPath)
  } catch (error) {
    return { success: false, error: `无效的应用路径: ${(error as Error).message}` }
  }

  const workflowDir = path.join(app.getPath('home'), 'Library/Services')
  const workflowName = '用 MD Viewer 打开.workflow'
  const workflowPath = path.join(workflowDir, workflowName)

  try {
    const exists = await fs.access(workflowPath).then(() => true, () => false)
    if (exists) {
      const result = await dialog.showMessageBox({
        type: 'question',
        title: '右键菜单已安装',
        message: '检测到已安装右键菜单，是否重新安装？',
        buttons: ['重新安装', '取消'],
        defaultId: 1
      })
      if (result.response === 1) {
        return { success: false, error: '用户取消' }
      }
      await fs.rm(workflowPath, { recursive: true, force: true })
    }

    await fs.mkdir(path.join(workflowPath, 'Contents'), { recursive: true })

    const infoPlist = generateMacOSInfoPlist()
    await fs.writeFile(path.join(workflowPath, 'Contents/Info.plist'), infoPlist)

    const workflow = generateMacOSWorkflow(escapedAppPath)
    await fs.writeFile(path.join(workflowPath, 'Contents/document.wflow'), workflow)

    try {
      await execAsync('killall Finder')
    } catch {
      // Finder 重启失败，忽略
    }

    return { success: true }
  } catch (error) {
    console.error('[ContextMenu] macOS installation error:', error)
    return { success: false, error: (error as Error).message }
  }
}

function generateMacOSInfoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>用 MD Viewer 打开</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.item</string>
			</array>
		</dict>
	</array>
</dict>
</plist>`
}

function generateMacOSWorkflow(escapedAppPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string> for f in "$@"
 do
     open -a "${escapedAppPath}" "$f"
 done</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>11111111-1111-1111-1111-111111111111</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>22222222-2222-2222-2222-222222222222</string>
				<key>UUID</key>
				<string>33333333-3333-3333-3333-333333333333</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					<key>0</key>
					<dict>
						<key>default value</key>
						<integer>0</integer>
						<key>name</key>
						<string>inputMethod</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>0</string>
					</dict>
					<key>1</key>
					<dict>
						<key>default value</key>
						<false/>
						<key>name</key>
						<string>CheckedForUserDefaultShell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>1</string>
					</dict>
					<key>2</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>source</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>2</string>
					</dict>
					<key>3</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>COMMAND_STRING</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>3</string>
					</dict>
					<key>4</key>
					<dict>
						<key>default value</key>
						<string>/bin/sh</string>
						<key>name</key>
						<string>shell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>4</string>
					</dict>
				</dict>
				<key>conversionLabel</key>
				<integer>0</integer>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:305.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleID</key>
		<string>com.apple.finder</string>
		<key>applicationBundleIDsByPath</key>
		<dict>
			<key>/System/Library/CoreServices/Finder.app</key>
			<string>com.apple.finder</string>
		</dict>
		<key>applicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>applicationPaths</key>
		<array>
			<string>/System/Library/CoreServices/Finder.app</string>
		</array>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>`
}

/**
 * macOS 卸载右键菜单
 */
export async function uninstallMacOSContextMenu(): Promise<InstallResult> {
  const workflowPath = path.join(
    app.getPath('home'),
    'Library/Services/用 MD Viewer 打开.workflow'
  )

  try {
    await fs.rm(workflowPath, { recursive: true, force: true })
    try {
      await execAsync('killall Finder')
    } catch {
      // 忽略
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/**
 * Windows 安装右键菜单
 */
export async function installWindowsContextMenu(): Promise<InstallResult> {
  const rawPath = process.execPath

  let escapedPath: string
  try {
    escapedPath = escapeRegPath(rawPath)
  } catch (error) {
    return { success: false, error: `无效的路径: ${(error as Error).message}` }
  }

  const regContent = generateWindowsRegContent(escapedPath)
  const tempRegFile = path.join(app.getPath('temp'), 'mdviewer-install.reg')

  try {
    const BOM = '\uFEFF'
    await fs.writeFile(tempRegFile, BOM + regContent, { encoding: 'utf16le' })
    await execAsync(`regedit /s "${tempRegFile}"`)
    await fs.unlink(tempRegFile).catch(() => {})
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

function generateWindowsRegContent(escapedPath: string): string {
  return `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\MDViewer]
@="Open with MD Viewer"
"Icon"="${escapedPath},0"

[HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\MDViewer\\command]
@="\\"${escapedPath}\\" \\"%1\\""

[HKEY_CURRENT_USER\\Software\\Classes\\.md\\shell\\MDViewer]
@="Open with MD Viewer"
"Icon"="${escapedPath},0"

[HKEY_CURRENT_USER\\Software\\Classes\\.md\\shell\\MDViewer\\command]
@="\\"${escapedPath}\\" \\"%1\\""`
}

/**
 * Windows 卸载右键菜单
 */
export async function uninstallWindowsContextMenu(): Promise<InstallResult> {
  const regContent = `Windows Registry Editor Version 5.00

[-HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\MDViewer]
[-HKEY_CURRENT_USER\\Software\\Classes\\.md\\shell\\MDViewer]`

  const tempRegFile = path.join(app.getPath('temp'), 'mdviewer-uninstall.reg')

  try {
    const BOM = '\uFEFF'
    await fs.writeFile(tempRegFile, BOM + regContent, { encoding: 'utf16le' })
    await execAsync(`regedit /s "${tempRegFile}"`)
    await fs.unlink(tempRegFile).catch(() => {})
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/**
 * Linux 安装右键菜单
 */
export async function installLinuxContextMenu(): Promise<InstallResult> {
  const appPath = process.execPath
  const desktopDir = path.join(app.getPath('home'), '.local/share/applications')
  const desktopFile = path.join(desktopDir, 'md-viewer.desktop')

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../resources/icon.png')

  const desktopContent = `[Desktop Entry]
Type=Application
Name=MD Viewer
Comment=Markdown Viewer
Exec=${appPath} %U
Icon=${iconPath}
Terminal=false
Categories=Office;Viewer;
MimeType=text/markdown;inode/directory;`

  try {
    await fs.mkdir(desktopDir, { recursive: true })
    await fs.writeFile(desktopFile, desktopContent)
    await fs.chmod(desktopFile, 0o755)
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/**
 * Linux 卸载右键菜单
 */
export async function uninstallLinuxContextMenu(): Promise<InstallResult> {
  const desktopFile = path.join(
    app.getPath('home'),
    '.local/share/applications/md-viewer.desktop'
  )

  try {
    await fs.unlink(desktopFile)
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
