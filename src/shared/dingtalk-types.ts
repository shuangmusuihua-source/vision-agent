export const DINGTALK_CLI_VERSION = '1.0.61'

export type DingTalkRuntimeStatus =
  | { state: 'unsupported'; platform: string; arch: string }
  | { state: 'not-installed'; version: string; downloadSizeBytes: number; reason: 'missing' | 'invalid' }
  | { state: 'ready'; version: string; executablePath: string }
export type DingTalkRuntimeInstallResult =
  | { success: true; status: DingTalkRuntimeStatus }
  | { success: false; error: string }
export type DingTalkConnectorStatus = {
  phase: 'runtime-missing' | 'installing' | 'unauthorized' | 'authorizing' | 'permissions' | 'disconnecting' | 'connected' | 'error'
  runtime: DingTalkRuntimeStatus
  identity?: { userName: string; corpName: string }
  permissionChallenge?: { url: string; expiresAt: number }
  authorizationUrl?: string
  error?: string
}
export type DingTalkConnectorActionResult = { success: boolean; error?: string }

export const DINGTALK_CAPABILITIES = [
  { id: 'doc', label: '文档' }, { id: 'drive', label: '钉盘' },
  { id: 'aitable', label: '多维表格' }, { id: 'calendar', label: '日程' },
  { id: 'todo', label: '待办' }, { id: 'chat', label: '消息' },
] as const
export type DingTalkCapabilityId = typeof DINGTALK_CAPABILITIES[number]['id']
export type DingTalkAuthorizationPlan =
  | { success: true; planId: string; scopes: string[] }
  | { success: false; error: string }
