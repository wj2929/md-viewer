const USER_MANUAL_BASE_URL = 'https://github.com/wj2929/md-viewer/blob/main/docs/user-manual.md'

export const USER_MANUAL_URL = USER_MANUAL_BASE_URL
export const SOURCE_EDIT_HELP_URL = `${USER_MANUAL_BASE_URL}#源码编辑`
export const DOCX_SERVICE_HELP_URL = `${USER_MANUAL_BASE_URL}#docx-服务配置`

export function openHelpLink(url: string): void {
  window.api?.openExternal?.(url).catch(error => {
    console.warn('[HelpLink] Failed to open help link:', error)
  })
}
