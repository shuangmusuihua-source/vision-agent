import { useModal } from '../common/ModalSystem'
import { DINGTALK_CAPABILITIES } from '../../../shared/dingtalk-types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CalendarDays, Check, Download, FileText, Loader2, MessageSquare, RefreshCw, Unplug, Zap } from 'lucide-react'
import type { DingTalkConnectorActionResult, DingTalkConnectorStatus } from '../../../shared/dingtalk-types'

export default function DingTalkConnectorCard(): React.ReactElement {
  const modal = useModal()
  const [status, setStatus] = useState<DingTalkConnectorStatus | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const revision = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++revision.current
    try {
      const next = await window.api.dingtalk.status()
      if (mounted.current && revision.current === request) { setStatus(next); setError(null) }
    } catch { if (mounted.current && revision.current === request) setError('无法读取钉钉连接状态，请重试。') }
  }, [])
  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.api.dingtalk.onStatusChanged((next) => {
      revision.current++
      setStatus(next)
    })
    void refresh()
    return () => { mounted.current = false; revision.current++; unsubscribe() }
  }, [refresh])
  const run = async (action: () => Promise<DingTalkConnectorActionResult>) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await action()
      if (mounted.current && !result.success) setError(result.error || '操作未完成')
    } catch { if (mounted.current) setError('钉钉操作未完成，请重试。') }
    finally { if (mounted.current) setPending(false) }
  }
  const authorize = (product: string, label: string) => run(async () => {
    const plan = await window.api.dingtalk.prepareAuthorization(product)
    if (!plan.success) return plan
    if (!plan.scopes.length) { await modal.alert({ title: label, message: '没有需要新增的权限。' }); return { success: true } }
    const confirmed = await modal.confirm({
      title: `授权钉钉${label}`,
      message: `以下权限将持续有效，直到你在钉钉撤销。请核对读取、写入与删除范围：\n\n${plan.scopes.join('\n')}`,
      confirmLabel: '确认授权', variant: 'primary',
    })
    if (!confirmed) return { success: true }
    const result = await window.api.dingtalk.grantAuthorization(plan.planId)
    if (result.success) await modal.alert({ title: '授权完成', message: `可以回到会话继续处理${label}任务。` })
    return result
  })
  const busy = pending || status?.phase === 'installing' || status?.phase === 'authorizing'
  const connected = status?.phase === 'connected'
  const missing = status?.runtime.state === 'not-installed'
  const label = !status ? '检查中' : ({ 'runtime-missing': '未安装', installing: '安装中', unauthorized: '未连接', authorizing: '等待授权', connected: '已连接', error: '需要处理' })[status.phase]
  return <section className="connector-card dingtalk-connector-card" aria-label="钉钉连接器">
    <div className="connector-card-topline">
      <div className="connector-brand">
        <div className="dingtalk-brand-mark"><Zap size={25} /></div>
        <div><h2>钉钉</h2><p>文档、日程与团队协作</p></div>
      </div>
      <span className="dingtalk-status">{connected ? <Check size={14} /> : busy ? <Loader2 size={14} className="connector-spin" /> : null}{label}</span>
    </div>
    <div className="dingtalk-card-body">
    <p className="dingtalk-description">把钉钉里的工作资料接入当前会话，让 sumi 帮你查找信息、整理文档和处理协作任务。</p>
    <div className="dingtalk-capabilities"><span><FileText size={14} />文档与钉盘</span><span><CalendarDays size={14} />日程与待办</span><span><MessageSquare size={14} />团队消息</span></div>
    {connected && status.identity && <div className="dingtalk-identity"><strong>{status.identity.userName}</strong><span>{status.identity.corpName}</span></div>}
    {status?.phase === 'authorizing' && <p className="dingtalk-description">请在浏览器完成钉钉授权。若组织尚未开通 CLI 访问，请在官方页面申请管理员开通后重试。</p>}
    {(error || status?.error) && <div className="dingtalk-error" role="alert"><span>{error || status?.error}</span>{error && <button onClick={() => setError(null)} aria-label="关闭钉钉错误提示">×</button>}</div>}
    <div className="dingtalk-actions">
      {status?.runtime.state === 'unsupported' ? <span>当前系统暂不支持</span> : missing || status?.phase === 'installing' ?
        <button className="connector-primary-button" disabled={busy} onClick={() => void run(window.api.dingtalk.installRuntime)}><Download size={15} />{status?.phase === 'installing' ? '正在安装…' : '安装钉钉组件'}</button> :
        status?.phase === 'authorizing' ? <>
          <button className="connector-primary-button" disabled={!status.authorizationUrl || pending} onClick={() => void run(window.api.dingtalk.reopenAuthorization)}><ArrowUpRight size={15} />重新打开授权页</button>
          <button className="connector-secondary-button" disabled={pending} onClick={() => void run(window.api.dingtalk.cancelOperation)}>取消</button>
        </> : connected ?
          <button className="connector-secondary-button" disabled={busy} onClick={() => void run(window.api.dingtalk.logout)}><Unplug size={15} />断开连接</button> :
          <button className="connector-primary-button" disabled={!status || busy} onClick={() => void run(window.api.dingtalk.startLogin)}><ArrowUpRight size={15} />登录钉钉</button>}
      <button className="connector-icon-button" aria-label="刷新钉钉状态" title="刷新钉钉状态" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} /></button>
    </div>
    {connected && <div className="dingtalk-permissions"><strong>按需授权</strong><p>选择要使用的能力，查看具体范围后再确认。</p><div className="dingtalk-capabilities">{DINGTALK_CAPABILITIES.map((item) => <button key={item.id} className="connector-secondary-button" disabled={busy} onClick={() => void authorize(item.id, item.label)}>{item.label}</button>)}</div></div>}
    <p className="dingtalk-note">通过钉钉官方 CLI 连接，需要所属组织开通 CLI 访问。凭据由 sumi 独立保存；具体能力取决于账号授权。</p>
    </div>
  </section>
}
