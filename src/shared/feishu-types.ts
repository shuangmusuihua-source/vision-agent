export const FEISHU_CLI_VERSION = '1.0.89'

export type FeishuCapabilityGroup = 'content' | 'collaboration' | 'organization'

export interface FeishuCapabilityDefinition {
  id: string
  label: string
  description: string
  group: FeishuCapabilityGroup
  cliDomains: readonly string[]
  scopePrefixes: readonly string[]
}

/**
 * Product-level permission bundles. A bundle can cover more than one CLI
 * domain when those domains share one user intent (for example meeting
 * records, minutes, and notes). Scope prefixes are used only to summarize the
 * token that Feishu reports; they do not claim every command in the domain is
 * authorized.
 */
export const FEISHU_CAPABILITIES = [
  {
    id: 'docs',
    label: '云文档',
    description: '读取、创建和编辑文档与思维笔记',
    group: 'content',
    cliDomains: ['docs', 'mindnotes'],
    scopePrefixes: ['docx:', 'docs:', 'mindnote:', 'mindnotes:'],
  },
  {
    id: 'drive',
    label: '云空间',
    description: '搜索、上传、下载和管理文件',
    group: 'content',
    cliDomains: ['drive', 'markdown'],
    scopePrefixes: ['drive:', 'space:', 'search:docs'],
  },
  {
    id: 'base',
    label: '多维表格',
    description: '管理数据表、字段、记录和视图',
    group: 'content',
    cliDomains: ['base'],
    scopePrefixes: ['base:', 'bitable:'],
  },
  {
    id: 'sheets',
    label: '电子表格',
    description: '读取、写入、查找和导出表格',
    group: 'content',
    cliDomains: ['sheets'],
    scopePrefixes: ['sheets:'],
  },
  {
    id: 'slides',
    label: '幻灯片',
    description: '创建演示文稿并管理幻灯片页面',
    group: 'content',
    cliDomains: ['slides'],
    scopePrefixes: ['slides:'],
  },
  {
    id: 'wiki',
    label: '知识库',
    description: '浏览和管理知识空间与节点',
    group: 'content',
    cliDomains: ['wiki'],
    scopePrefixes: ['wiki:'],
  },
  {
    id: 'calendar',
    label: '日历',
    description: '查看日程、查询忙闲和安排会议',
    group: 'collaboration',
    cliDomains: ['calendar'],
    scopePrefixes: ['calendar:'],
  },
  {
    id: 'im',
    label: '消息',
    description: '搜索、发送消息并管理群聊',
    group: 'collaboration',
    cliDomains: ['im'],
    scopePrefixes: ['im:', 'search:message'],
  },
  {
    id: 'task',
    label: '任务',
    description: '管理任务、清单、评论和提醒',
    group: 'collaboration',
    cliDomains: ['task'],
    scopePrefixes: ['task:'],
  },
  {
    id: 'mail',
    label: '邮箱',
    description: '阅读、搜索、起草和发送邮件',
    group: 'collaboration',
    cliDomains: ['mail'],
    scopePrefixes: ['mail:'],
  },
  {
    id: 'meeting',
    label: '会议与妙记',
    description: '查询会议、纪要、逐字稿和妙记',
    group: 'collaboration',
    cliDomains: ['vc', 'minutes', 'note'],
    scopePrefixes: ['vc:', 'minutes:', 'note:'],
  },
  {
    id: 'contact',
    label: '通讯录',
    description: '搜索人员并读取公开资料',
    group: 'collaboration',
    cliDomains: ['contact'],
    scopePrefixes: ['contact:'],
  },
  {
    id: 'attendance',
    label: '考勤',
    description: '查询个人考勤与打卡记录',
    group: 'organization',
    cliDomains: ['attendance'],
    scopePrefixes: ['attendance:'],
  },
  {
    id: 'approval',
    label: '审批',
    description: '查询、处理和发起审批实例',
    group: 'organization',
    cliDomains: ['approval'],
    scopePrefixes: ['approval:'],
  },
  {
    id: 'okr',
    label: 'OKR',
    description: '管理目标、关键结果和进展',
    group: 'organization',
    cliDomains: ['okr'],
    scopePrefixes: ['okr:'],
  },
  {
    id: 'apps',
    label: '应用',
    description: '创建和管理妙搭应用与可用范围',
    group: 'organization',
    cliDomains: ['apps', 'application'],
    scopePrefixes: ['apps:', 'application:'],
  },
  {
    id: 'event',
    label: '实时事件',
    description: '订阅消息、任务和会议等事件',
    group: 'organization',
    cliDomains: ['event'],
    scopePrefixes: ['event:'],
  },
] as const satisfies readonly FeishuCapabilityDefinition[]

export type FeishuCapabilityId = typeof FEISHU_CAPABILITIES[number]['id']

export function getFeishuCapability(id: string): typeof FEISHU_CAPABILITIES[number] | undefined {
  return FEISHU_CAPABILITIES.find(capability => capability.id === id)
}

export function getGrantedFeishuCapabilityScopes(
  capability: FeishuCapabilityDefinition,
  scopes: readonly string[] = [],
): string[] {
  return scopes.filter(scope => capability.scopePrefixes.some(prefix => scope.startsWith(prefix)))
}

export type FeishuRuntimeStatus =
  | {
      state: 'ready'
      version: string
      executablePath: string
    }
  | {
      state: 'not-installed'
      version: string
      downloadSizeBytes: number
      reason?: 'missing' | 'invalid'
    }
  | {
      state: 'unsupported'
      platform: string
      arch: string
    }

export type FeishuRuntimeInstallResult =
  | { success: true; status: Extract<FeishuRuntimeStatus, { state: 'ready' }> }
  | { success: false; error: string }

export type FeishuConnectorPhase =
  | 'runtime-missing'
  | 'not-configured'
  | 'unauthorized'
  | 'bot-only'
  | 'configuring'
  | 'authorizing'
  | 'connected'
  | 'error'

export interface FeishuConnectorIdentity {
  displayName?: string
  openId?: string
  userAvailable: boolean
  botAvailable: boolean
  userScopes?: string[]
}

export interface FeishuConnectorStatus {
  phase: FeishuConnectorPhase
  runtime: FeishuRuntimeStatus
  identity?: FeishuConnectorIdentity
  activeCapabilityId?: FeishuCapabilityId
  error?: string
}

export interface FeishuConnectorActionResult {
  success: boolean
  error?: string
}

export interface FeishuAuthChallenge {
  operation: 'configure' | 'login' | 'grant-capability'
  capabilityId?: FeishuCapabilityId
  url: string
}
