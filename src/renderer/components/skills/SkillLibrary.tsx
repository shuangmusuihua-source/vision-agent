import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Blocks,
  Check,
  CheckCircle2,
  CircleX,
  ClipboardList,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Gauge,
  Lightbulb,
  Loader2,
  Monitor,
  Palette,
  Presentation,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import type { BuiltinSkillCatalogItem, CommunitySkillCatalogItem } from '../../../shared/types'
import { useModal } from '../common/ModalSystem'
import { useAgentStore } from '../../store/agent-store-impl'

type PendingAction = 'install' | 'update' | 'uninstall' | null

const builtinSkillIcons = {
  kami: FileText,
  'frontend-slides': Presentation,
  'system-cleanup': Trash2,
  'organize-desktop': Monitor,
  'organize-folder': FolderOpen,
  'perf-optimize': Gauge,
}

const communitySkillIcons: Record<string, typeof Blocks> = {
  Palette,
  Lightbulb,
  Search,
  ClipboardList,
  Presentation,
  FileText,
  FileSpreadsheet,
  WandSparkles,
}

const auditStatusLabels = {
  passed: '通过',
  reviewed: '已审核',
  warning: '需复核',
  failed: '未通过',
}

function SkillLibrary(): React.ReactElement {
  const modal = useModal()
  const [builtinSkills, setBuiltinSkills] = useState<BuiltinSkillCatalogItem[]>([])
  const [skills, setSkills] = useState<CommunitySkillCatalogItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [pendingBuiltinId, setPendingBuiltinId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadCatalog = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const [builtins, catalog] = await Promise.all([
        window.api.skills.builtins(),
        window.api.skills.catalog(),
      ])
      setBuiltinSkills(builtins)
      setSkills(catalog)
      setSelectedId(current => catalog.some(skill => skill.id === current) ? current : catalog[0]?.id || null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '技能目录加载失败')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    return window.api.skills.onChanged(() => {
      void loadCatalog(false)
    })
  }, [loadCatalog])

  const selectedSkill = useMemo(
    () => skills.find(skill => skill.id === selectedId) || null,
    [selectedId, skills],
  )
  const selectedSkillRunning = useAgentStore(state => {
    if (!selectedId) return false
    const slots = [...Object.values(state.slots), ...Object.values(state.sessionSlots)]
    return slots.some(slot => slot.isStreaming && slot.activeSkillId === selectedId)
  })
  const SelectedSkillIcon = selectedSkill ? communitySkillIcons[selectedSkill.icon] || Blocks : Blocks
  const installedCommunityCount = skills.filter(skill => skill.installed).length
  const enabledBuiltinCount = builtinSkills.filter(skill => skill.enabled).length

  const install = useCallback(async () => {
    if (!selectedSkill || pendingAction) return
    const failedAudits = selectedSkill.audits.filter(audit => audit.status === 'failed')
    if (failedAudits.length > 0) {
      const confirmed = await modal.confirm({
        title: '安全审计未全部通过',
        message: `${failedAudits.map(audit => audit.name).join('、')} 将该 Skill 标记为未通过。请先查看技能详情和源码，确认风险后再安装。`,
        variant: 'danger',
        confirmLabel: '仍然安装',
      })
      if (!confirmed) return
    }
    setPendingAction('install')
    setError(null)
    try {
      const result = await window.api.skills.install(selectedSkill.id)
      if (!result.success) throw new Error(result.error || '安装失败')
      await loadCatalog()
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : '安装失败')
    } finally {
      setPendingAction(null)
    }
  }, [loadCatalog, modal, pendingAction, selectedSkill])

  const uninstall = useCallback(async () => {
    if (!selectedSkill || pendingAction) return
    if (selectedSkillRunning) {
      setError('该 Skill 正在执行，请等待任务结束后再卸载')
      return
    }
    const confirmed = await modal.confirm({
      title: '卸载技能',
      message: `确定卸载 ${selectedSkill.name}？之后可以随时重新安装。`,
      variant: 'danger',
      confirmLabel: '卸载',
    })
    if (!confirmed) return

    setPendingAction('uninstall')
    setError(null)
    try {
      const result = await window.api.skills.uninstall(selectedSkill.id)
      if (!result.success) throw new Error(result.error || '卸载失败')
      await loadCatalog()
    } catch (uninstallError) {
      setError(uninstallError instanceof Error ? uninstallError.message : '卸载失败')
    } finally {
      setPendingAction(null)
    }
  }, [loadCatalog, modal, pendingAction, selectedSkill, selectedSkillRunning])

  const update = useCallback(async () => {
    if (!selectedSkill || pendingAction || !selectedSkill.updateAvailable) return
    if (selectedSkillRunning) {
      setError('该 Skill 正在执行，请等待任务结束后再更新')
      return
    }
    setPendingAction('update')
    setError(null)
    try {
      const result = await window.api.skills.update(selectedSkill.id)
      if (!result.success) throw new Error(result.error || '更新失败')
      await loadCatalog(false)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '更新失败')
    } finally {
      setPendingAction(null)
    }
  }, [loadCatalog, pendingAction, selectedSkill, selectedSkillRunning])

  const toggleBuiltin = useCallback(async (skill: BuiltinSkillCatalogItem) => {
    if (pendingBuiltinId) return
    setPendingBuiltinId(skill.id)
    setError(null)
    try {
      await window.api.skills.toggle(skill.id, !skill.enabled)
      await loadCatalog(false)
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '技能状态更新失败')
    } finally {
      setPendingBuiltinId(null)
    }
  }, [loadCatalog, pendingBuiltinId])

  if (loading && builtinSkills.length === 0 && skills.length === 0) {
    return (
      <div className="skill-library-state" role="status">
        <Loader2 className="skill-library-spinner" size={20} />
        <span>正在加载技能...</span>
      </div>
    )
  }

  return (
    <div className="skill-library">
      <header className="skill-library-header">
        <div>
          <p>启用内置能力，或按需安装社区精选。</p>
        </div>
        <div className="skill-library-summary" aria-label="技能概况">
          <span><strong>{installedCommunityCount}</strong> 个社区技能已安装</span>
          <span><strong>{enabledBuiltinCount}</strong> 个内置技能已启用</span>
        </div>
      </header>

      {error && (
        <div className="skill-library-error" role="alert">
          <span>{error}</span>
          {builtinSkills.length === 0 && skills.length === 0 && <button onClick={() => void loadCatalog()}>重试</button>}
        </div>
      )}

      <div className="skill-library-layout">
        <section className="skill-catalog" aria-labelledby="skill-catalog-title">
          <div className="skill-section-heading">
            <div>
              <h2 id="skill-catalog-title">社区精选</h2>
              <p>经筛选的社区技能，安装与更新时需要联网。</p>
            </div>
            <span>{installedCommunityCount} / {skills.length} 已安装</span>
          </div>

          <div className="skill-catalog-grid">
            {skills.map(skill => {
              const Icon = communitySkillIcons[skill.icon] || Blocks
              return (
                <button
                  key={skill.id}
                  className={`skill-catalog-card${skill.id === selectedId ? ' skill-catalog-card-selected' : ''}`}
                  onClick={() => setSelectedId(skill.id)}
                  aria-pressed={skill.id === selectedId}
                >
                  <div className="skill-catalog-card-topline">
                    <span className="skill-catalog-card-icon" aria-hidden="true"><Icon size={18} /></span>
                    <span className={`skill-catalog-card-status${skill.updateAvailable ? ' skill-catalog-card-status-update' : skill.installed ? ' skill-catalog-card-status-installed' : ''}`}>
                      {skill.updateAvailable
                        ? <><RefreshCw size={12} /> 可更新</>
                        : skill.installed
                          ? <><Check size={12} /> 已安装</>
                          : '可安装'}
                    </span>
                  </div>
                  <div className="skill-catalog-card-copy">
                    <span className="skill-catalog-card-category">{skill.category}</span>
                    <h3>{skill.name}</h3>
                    <p>{skill.summary}</p>
                  </div>
                  <span className="skill-catalog-card-author">{skill.author}</span>
                </button>
              )
            })}
          </div>
        </section>

        <aside className="skill-detail" aria-live="polite">
          {selectedSkill ? (
            <>
              <div className="skill-detail-head">
                <div className="skill-detail-icon" aria-hidden="true"><SelectedSkillIcon size={22} /></div>
                <div>
                  <span>{selectedSkill.category}</span>
                  <h2>{selectedSkill.name}</h2>
                  <p>by {selectedSkill.author}</p>
                </div>
              </div>

              <p className="skill-detail-description">{selectedSkill.description}</p>

              <div className="skill-detail-action">
                {selectedSkill.installed ? (
                  <div className="skill-action-buttons">
                    {selectedSkill.updateAvailable && (
                      <button className="skill-action-button skill-action-install" onClick={() => void update()} disabled={pendingAction !== null || selectedSkillRunning}>
                        {pendingAction === 'update' ? <Loader2 className="skill-library-spinner" size={15} /> : <RefreshCw size={15} />}
                        {pendingAction === 'update' ? '正在更新' : selectedSkillRunning ? '任务结束后更新' : '更新'}
                      </button>
                    )}
                    <button className="skill-action-button skill-action-uninstall" onClick={() => void uninstall()} disabled={pendingAction !== null || selectedSkillRunning}>
                      {pendingAction === 'uninstall' ? <Loader2 className="skill-library-spinner" size={15} /> : <Trash2 size={15} />}
                      {pendingAction === 'uninstall' ? '正在卸载' : selectedSkillRunning ? '正在使用' : '卸载'}
                    </button>
                  </div>
                ) : (
                  <button className="skill-action-button skill-action-install" onClick={() => void install()} disabled={pendingAction !== null}>
                    {pendingAction === 'install' ? <Loader2 className="skill-library-spinner" size={15} /> : <Download size={15} />}
                    {pendingAction === 'install' ? '正在安装' : '安装技能'}
                  </button>
                )}
                <span>{selectedSkill.updateAvailable
                  ? '有新版本可用，更新后仍可在所有工作区中调用'
                  : selectedSkill.installed
                    ? '已是最新版本，可在工作区会话中调用'
                    : '安装后会在所有工作区中可用'}</span>
              </div>

              <div className="skill-detail-tags" aria-label="技能标签">
                {selectedSkill.tags.map(tag => <span key={tag}>{tag}</span>)}
              </div>

              <div className="skill-detail-section">
                <h3><ShieldCheck size={15} /> 安全检查</h3>
                <div className="skill-audit-list">
                  {selectedSkill.audits.map(audit => {
                    const AuditIcon = audit.status === 'failed'
                      ? CircleX
                      : audit.status === 'warning'
                        ? AlertTriangle
                        : CheckCircle2
                    return (
                      <div key={audit.name} className={`skill-audit-row skill-audit-row-${audit.status}`}>
                        <AuditIcon size={14} />
                        <span>{audit.name}</span>
                        <span>{auditStatusLabels[audit.status]}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="skill-detail-links">
                <a href={selectedSkill.sourcePageUrl} target="_blank" rel="noreferrer">
                  查看技能详情 <ExternalLink size={13} />
                </a>
                <a href={selectedSkill.repositoryUrl} target="_blank" rel="noreferrer">
                  源代码 <ExternalLink size={13} />
                </a>
              </div>

            </>
          ) : (
            <div className="skill-detail-empty">选择一个技能查看详情</div>
          )}
        </aside>
      </div>

      <section className="skill-builtin-section" aria-labelledby="builtin-skill-title">
        <div className="skill-section-heading">
          <div>
            <h2 id="builtin-skill-title">内置技能</h2>
            <p>随 sumi 提供并自动更新，可随时启用或停用。</p>
          </div>
          <span>{enabledBuiltinCount} / {builtinSkills.length} 已启用</span>
        </div>

        <div className="skill-builtin-grid">
          {builtinSkills.map(skill => {
            const Icon = builtinSkillIcons[skill.id as keyof typeof builtinSkillIcons] || Blocks
            const pending = pendingBuiltinId === skill.id
            return (
              <article className={`skill-builtin-card${skill.enabled ? '' : ' skill-builtin-card-disabled'}`} key={skill.id}>
                <div className="skill-builtin-card-icon" aria-hidden="true"><Icon size={17} /></div>
                <div className="skill-builtin-card-copy">
                  <h3>{skill.name}</h3>
                  <p>{skill.description}</p>
                </div>
                <button
                  className="skill-builtin-toggle"
                  type="button"
                  role="switch"
                  aria-checked={skill.enabled}
                  aria-busy={pending}
                  aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
                  title={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
                  disabled={pendingBuiltinId !== null}
                  onClick={() => void toggleBuiltin(skill)}
                >
                  {pending && <Loader2 className="skill-library-spinner" size={14} aria-hidden="true" />}
                  <span className={`skill-toggle-track${skill.enabled ? ' skill-toggle-track-on' : ''}`} aria-hidden="true">
                    <span className="skill-toggle-thumb" />
                  </span>
                </button>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default SkillLibrary
