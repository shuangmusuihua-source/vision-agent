import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AppWindow,
  Bot,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Goal,
  ListTodo,
  Loader2,
  LogOut,
  Mail,
  MessageSquareText,
  Presentation,
  Radio,
  RefreshCw,
  ShieldCheck,
  Table2,
  UserRound,
  UsersRound,
  Video,
  type LucideIcon,
} from 'lucide-react'
import type {
  FeishuAuthChallenge,
  FeishuCapabilityGroup,
  FeishuCapabilityId,
  FeishuConnectorActionResult,
  FeishuConnectorPhase,
  FeishuConnectorStatus,
} from '../../../shared/feishu-types'
import {
  FEISHU_CAPABILITIES,
  getFeishuCapability,
  getGrantedFeishuCapabilityScopes,
} from '../../../shared/feishu-types'
import { useModal } from '../common/ModalSystem'
import './ConnectorPanel.css'

type FixedPendingAction = 'install' | 'configure' | 'login' | 'cancel' | 'logout' | 'refresh'
type PendingAction = FixedPendingAction | `capability:${FeishuCapabilityId}` | null

const capabilityIcons: Record<FeishuCapabilityId, LucideIcon> = {
  docs: FileText,
  drive: FolderOpen,
  base: Database,
  sheets: Table2,
  slides: Presentation,
  wiki: BookOpen,
  calendar: CalendarDays,
  im: MessageSquareText,
  task: ListTodo,
  mail: Mail,
  meeting: Video,
  contact: UsersRound,
  attendance: Clock3,
  approval: ClipboardCheck,
  okr: Goal,
  apps: AppWindow,
  event: Radio,
}

const capabilityGroups: Array<{
  id: FeishuCapabilityGroup
  label: string
  description: string
}> = [
  { id: 'content', label: '内容与数据', description: '文档、知识和结构化数据' },
  { id: 'collaboration', label: '沟通与协作', description: '日程、消息与团队工作' },
  { id: 'organization', label: '组织与业务', description: '审批、目标和企业服务' },
]

const phaseCopy: Record<FeishuConnectorPhase, { label: string; summary: string }> = {
  'runtime-missing': {
    label: '待安装',
    summary: '安装由 sumi 管理的飞书 CLI 运行组件后即可开始配置。',
  },
  'not-configured': {
    label: '待配置',
    summary: '创建或选择一个飞书应用，授权范围由你在飞书开放平台控制。',
  },
  unauthorized: {
    label: '待授权',
    summary: '应用已经配置，请在浏览器完成飞书账号授权。',
  },
  'bot-only': {
    label: '待登录',
    summary: '飞书应用机器人已连接；登录你的飞书账号后，才能访问个人日历和云文档。',
  },
  configuring: {
    label: '配置中',
    summary: '飞书 CLI 正在准备应用配置，请按浏览器页面提示继续。',
  },
  authorizing: {
    label: '授权中',
    summary: '请在飞书授权页面确认身份和权限。',
  },
  connected: {
    label: '已连接',
    summary: 'sumi 已可以在任务中按需调用飞书能力。',
  },
  error: {
    label: '需要处理',
    summary: '连接器遇到问题，可以刷新状态或重新执行当前步骤。',
  },
}

function fallbackStatus(): FeishuConnectorStatus {
  return {
    phase: 'runtime-missing',
    runtime: {
      state: 'not-installed',
      version: '1.0.89',
      downloadSizeBytes: 0,
      reason: 'missing',
    },
  }
}

function ConnectorPanel(): React.ReactElement {
  const modal = useModal()
  const [status, setStatus] = useState<FeishuConnectorStatus | null>(null)
  const [authChallenge, setAuthChallenge] = useState<FeishuAuthChallenge | null>(null)
  const [pending, setPending] = useState<PendingAction>('refresh')
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async (showPending = false) => {
    if (showPending) setPending('refresh')
    setError(null)
    try {
      const nextStatus = await window.api.feishu.status()
      setStatus(nextStatus)
      if (nextStatus.phase === 'connected') setAuthChallenge(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取飞书连接状态')
    } finally {
      if (showPending) setPending(null)
    }
  }, [])

  useEffect(() => {
    void loadStatus().finally(() => setPending(null))
    const unsubscribeStatus = window.api.feishu.onStatusChanged(nextStatus => {
      setStatus(nextStatus)
      if (nextStatus.phase === 'connected') setAuthChallenge(null)
      setPending(null)
    })
    const unsubscribeChallenge = window.api.feishu.onAuthChallenge(challenge => {
      setAuthChallenge(challenge)
    })
    return () => {
      unsubscribeStatus()
      unsubscribeChallenge()
    }
  }, [loadStatus])

  const currentStatus = status ?? fallbackStatus()
  const copy = status
    ? phaseCopy[currentStatus.phase]
    : { label: '检查中', summary: '正在检查飞书 CLI 和账号授权状态…' }
  const operating = currentStatus.phase === 'configuring' || currentStatus.phase === 'authorizing'
  const connected = currentStatus.phase === 'connected'
  const botOnly = currentStatus.phase === 'bot-only'
  const hasIdentity = connected || botOnly
  const identity = currentStatus.identity
  const activeCapabilityId = currentStatus.activeCapabilityId ?? authChallenge?.capabilityId
  const activeCapability = activeCapabilityId ? getFeishuCapability(activeCapabilityId) : undefined
  const grantedCapabilityCount = FEISHU_CAPABILITIES.filter(capability => (
    getGrantedFeishuCapabilityScopes(capability, identity?.userScopes).length > 0
  )).length

  const runtimeNote = useMemo(() => {
    if (!status) return '正在读取本机连接器状态'
    const runtime = currentStatus.runtime
    if (runtime.state === 'unsupported') return `暂不支持 ${runtime.platform}/${runtime.arch}`
    if (runtime.state === 'not-installed') {
      const size = Math.ceil(runtime.downloadSizeBytes / 1024 / 1024)
      return `${runtime.reason === 'invalid' ? '需要修复' : '尚未安装'} · v${runtime.version}${size > 0 ? ` · 约 ${size} MB` : ''}`
    }
    return `运行组件 v${runtime.version} 已就绪`
  }, [currentStatus.runtime, status])

  const runAction = useCallback(async (
    action: Exclude<PendingAction, 'refresh' | null>,
    operation: () => Promise<FeishuConnectorActionResult>,
  ) => {
    setPending(action)
    setError(null)
    if (action === 'configure' || action === 'login' || action.startsWith('capability:')) {
      setAuthChallenge(null)
    }
    try {
      const result = await operation()
      if (!result.success) throw new Error(result.error || '连接操作失败')
      await loadStatus()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '连接操作失败')
    } finally {
      setPending(null)
    }
  }, [loadStatus])

  const handleGrantCapability = useCallback((capabilityId: FeishuCapabilityId) => {
    void runAction(
      `capability:${capabilityId}`,
      () => window.api.feishu.grantCapability(capabilityId),
    )
  }, [runAction])

  const handleLogout = useCallback(async () => {
    const confirmed = await modal.confirm({
      title: '退出飞书账号',
      message: '这会清除当前用户身份授权，但保留已经配置的飞书应用机器人。已生成的本地文件不会受到影响。',
      variant: 'danger',
      confirmLabel: '退出账号',
    })
    if (!confirmed) return
    await runAction('logout', window.api.feishu.logout)
    setAuthChallenge(null)
  }, [modal, runAction])

  const openAuthorization = useCallback(async () => {
    if (!authChallenge) return
    const result = await window.api.workspace.openExternalUrl(authChallenge.url)
    if (!result.success) setError('无法打开飞书授权页面')
  }, [authChallenge])

  const primaryAction = (() => {
    if (!status) return null
    const disabled = pending !== null
    if (currentStatus.runtime.state === 'unsupported') {
      return <button className="connector-primary-button" disabled>当前系统暂不支持</button>
    }
    if (currentStatus.runtime.state === 'not-installed') {
      return (
        <button
          className="connector-primary-button"
          disabled={disabled}
          onClick={() => void runAction('install', window.api.feishu.installRuntime)}
        >
          {pending === 'install' ? <Loader2 className="connector-spin" size={15} /> : <Download size={15} />}
          {currentStatus.runtime.reason === 'invalid' ? '修复运行组件' : '安装运行组件'}
        </button>
      )
    }
    if (currentStatus.phase === 'not-configured') {
      return (
        <button
          className="connector-primary-button"
          disabled={disabled}
          onClick={() => void runAction('configure', window.api.feishu.startConfigure)}
        >
          {pending === 'configure' ? <Loader2 className="connector-spin" size={15} /> : <ChevronRight size={15} />}
          配置飞书应用
        </button>
      )
    }
    if (currentStatus.phase === 'unauthorized' || currentStatus.phase === 'bot-only' || currentStatus.phase === 'error') {
      return (
        <button
          className="connector-primary-button"
          disabled={disabled}
          onClick={() => void runAction('login', window.api.feishu.startLogin)}
        >
          {pending === 'login' ? <Loader2 className="connector-spin" size={15} /> : <ExternalLink size={15} />}
          {botOnly ? '登录飞书账号' : '前往飞书授权'}
        </button>
      )
    }
    if (operating) {
      return (
        <button
          className="connector-secondary-button"
          disabled={disabled}
          onClick={() => void runAction('cancel', window.api.feishu.cancelOperation)}
        >
          {pending === 'cancel' ? <Loader2 className="connector-spin" size={15} /> : null}
          取消当前操作
        </button>
      )
    }
    return null
  })()

  return (
    <div className="connector-panel">
      <div className="connector-shell">
        <header className="connector-header">
          <div>
            <span className="connector-eyebrow">INTEGRATIONS</span>
            <h1>连接器</h1>
            <p>把工作资料和协作能力接入 sumi，让 Agent 在你的许可下完成跨应用任务。</p>
          </div>
          <button
            className="connector-icon-button"
            aria-label="刷新连接状态"
            title="刷新连接状态"
            disabled={pending !== null || operating}
            onClick={() => void loadStatus(true)}
          >
            <RefreshCw className={pending === 'refresh' ? 'connector-spin' : undefined} size={16} />
          </button>
        </header>

        <section className={`connector-card connector-card-${currentStatus.phase}`}>
          <div className="connector-card-topline">
            <div className="connector-brand">
              <div className="connector-brand-mark" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div>
                <h2>飞书</h2>
                <p>官方 CLI · 由 sumi 隔离管理</p>
              </div>
            </div>
            <span className="connector-status-badge">
              {connected ? <Check size={12} /> : operating || !status ? <Loader2 className="connector-spin" size={12} /> : <span />}
              {copy.label}
            </span>
          </div>

          <div className="connector-card-body">
            <div className="connector-status-copy">
              <h3>{copy.summary}</h3>
              <p>{runtimeNote}</p>
              {currentStatus.error || error ? (
                <div className="connector-inline-error" role="alert">
                  <CircleAlert size={15} />
                  <span>{error || currentStatus.error}</span>
                </div>
              ) : null}

              {authChallenge ? (
                <div className="connector-auth-callout">
                  <div>
                    <strong>{authChallenge.operation === 'configure'
                      ? '继续配置'
                      : authChallenge.operation === 'grant-capability'
                        ? `完成「${activeCapability?.label || '飞书能力'}」授权`
                        : '完成账号授权'}</strong>
                    <span>在飞书官方页面确认本次新增的权限范围</span>
                  </div>
                  <button onClick={() => void openAuthorization()}>
                    打开页面
                    <ExternalLink size={13} />
                  </button>
                </div>
              ) : null}

              {hasIdentity ? (
                <div className="connector-identity">
                  <div className="connector-identity-avatar"><UserRound size={17} /></div>
                  <div>
                    <strong>{identity?.displayName || (identity?.userAvailable ? '飞书账号' : '飞书应用机器人')}</strong>
                    <span>{identity?.openId ? `ID ${identity.openId.slice(0, 10)}…` : '授权状态已验证'}</span>
                  </div>
                  <div className="connector-identity-scopes">
                    {identity?.userAvailable ? <span><UserRound size={12} />用户身份</span> : null}
                    {identity?.botAvailable ? <span><Bot size={12} />机器人身份</span> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="connector-actions">
              {primaryAction}
              {connected ? (
                <>
                  <button
                    className="connector-secondary-button"
                    disabled={pending !== null}
                    onClick={() => void loadStatus(true)}
                  >
                    <RefreshCw className={pending === 'refresh' ? 'connector-spin' : undefined} size={14} />
                    验证连接
                  </button>
                  <button
                    className="connector-quiet-button"
                    disabled={pending !== null}
                    onClick={() => void handleLogout()}
                  >
                    {pending === 'logout' ? <Loader2 className="connector-spin" size={14} /> : <LogOut size={14} />}
                    退出账号
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </section>

        {hasIdentity ? (
          <section className="connector-permissions" aria-labelledby="feishu-permissions-title">
            <div className="connector-permissions-header">
              <div>
                <span>按需开启</span>
                <h2 id="feishu-permissions-title">能力与权限</h2>
                <p>一个业务域只需授权一次；后续新增权限时可以再次扩展。</p>
              </div>
              <div className="connector-permissions-summary">
                <strong>{identity?.userAvailable ? grantedCapabilityCount : 0}</strong>
                <span>/ {FEISHU_CAPABILITIES.length} 个域已有权限</span>
              </div>
            </div>

            {capabilityGroups.map(group => {
              const capabilities = FEISHU_CAPABILITIES.filter(capability => capability.group === group.id)
              return (
                <div className="connector-permission-group" key={group.id}>
                  <div className="connector-permission-group-heading">
                    <strong>{group.label}</strong>
                    <span>{group.description}</span>
                  </div>
                  <div className="connector-permission-grid">
                    {capabilities.map(capability => {
                      const Icon = capabilityIcons[capability.id]
                      const grantedScopes = getGrantedFeishuCapabilityScopes(
                        capability,
                        identity?.userScopes,
                      )
                      const authorized = grantedScopes.length > 0
                      const authorizing = activeCapabilityId === capability.id && operating
                      const actionPending = pending === `capability:${capability.id}`
                      return (
                        <article
                          className={`connector-permission-item${authorized ? ' connector-permission-item-authorized' : ''}`}
                          key={capability.id}
                        >
                          <div className="connector-permission-icon"><Icon size={16} /></div>
                          <div className="connector-permission-copy">
                            <strong>{capability.label}</strong>
                            <span>{capability.description}</span>
                          </div>
                          <div className="connector-permission-footer">
                            <span className={`connector-permission-state${authorized ? ' is-authorized' : ''}`}>
                              <i />
                              {identity?.userAvailable
                                ? authorized ? `已有 ${grantedScopes.length} 项权限` : '尚未授权'
                                : '需要用户身份'}
                            </span>
                            {connected ? (
                              <button
                                className="connector-capability-action"
                                disabled={pending !== null || operating}
                                onClick={() => handleGrantCapability(capability.id)}
                              >
                                {actionPending || authorizing
                                  ? <Loader2 className="connector-spin" size={12} />
                                  : null}
                                {authorized ? '扩展' : '授权'}
                              </button>
                            ) : null}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>
        ) : null}

        <div className="connector-foot-grid">
          <section className="connector-note-card">
            <ShieldCheck size={18} />
            <div>
              <h3>权限仍由你掌控</h3>
              <p>凭据保存在 sumi 的独立飞书 CLI 配置目录，不进入聊天记录。写入操作仍会经过 Agent 权限确认。</p>
            </div>
          </section>
          <section className="connector-coming-card">
            <div>
              <span>接下来</span>
              <h3>更多工作连接器</h3>
              <p>企业微信、云盘与项目管理能力将沿用同一套安全边界。</p>
            </div>
            <span className="connector-coming-pill">规划中</span>
          </section>
        </div>
      </div>
    </div>
  )
}

export default ConnectorPanel
