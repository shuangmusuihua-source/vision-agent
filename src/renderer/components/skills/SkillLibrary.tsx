import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Blocks,
  Check,
  CheckCircle2,
  ChevronRight,
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
  SlidersHorizontal,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import type { BuiltinSkillCatalogItem, CommunitySkillCatalogItem } from '../../../shared/types'
import { useModal } from '../common/ModalSystem'
import { useAgentStore } from '../../store/agent-store-impl'

type PendingActionName = 'install' | 'update' | 'uninstall'
type PendingAction = { skillId: string; action: PendingActionName } | null
type SkillFilter = 'all' | 'installed' | 'updates'

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

const filterOptions: Array<{ id: SkillFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'installed', label: '已安装' },
  { id: 'updates', label: '可更新' },
]

function SkillLibrary(): React.ReactElement {
  const modal = useModal()
  const libraryRef = useRef<HTMLDivElement>(null)
  const catalogScrollTopRef = useRef(0)
  const [builtinSkills, setBuiltinSkills] = useState<BuiltinSkillCatalogItem[]>([])
  const [skills, setSkills] = useState<CommunitySkillCatalogItem[]>([])
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')
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
      setDetailSkillId(current => catalog.some(skill => skill.id === current) ? current : null)
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

  const installedCommunityCount = skills.filter(skill => skill.installed).length
  const updateCount = skills.filter(skill => skill.updateAvailable).length
  const enabledBuiltinCount = builtinSkills.filter(skill => skill.enabled).length

  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return skills
      .filter(skill => {
        if (filter === 'installed' && !skill.installed) return false
        if (filter === 'updates' && !skill.updateAvailable) return false
        if (!normalizedQuery) return true
        const searchableText = [
          skill.name,
          skill.author,
          skill.category,
          skill.summary,
          ...skill.tags,
        ].join(' ').toLocaleLowerCase()
        return searchableText.includes(normalizedQuery)
      })
      .sort((left, right) => {
        if (left.updateAvailable !== right.updateAvailable) return left.updateAvailable ? -1 : 1
        if (left.installed !== right.installed) return left.installed ? -1 : 1
        return left.name.localeCompare(right.name, 'zh-CN')
      })
  }, [filter, query, skills])

  const selectedSkill = useMemo(
    () => skills.find(skill => skill.id === detailSkillId) || null,
    [detailSkillId, skills],
  )
  const selectedSkillRunning = useAgentStore(state => {
    if (!detailSkillId) return false
    const slots = [...Object.values(state.slots), ...Object.values(state.sessionSlots)]
    return slots.some(slot => slot.isStreaming && slot.activeSkillId === detailSkillId)
  })
  const SelectedSkillIcon = selectedSkill ? communitySkillIcons[selectedSkill.icon] || Blocks : Blocks

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
    setPendingAction({ skillId: selectedSkill.id, action: 'install' })
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

    setPendingAction({ skillId: selectedSkill.id, action: 'uninstall' })
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
    setPendingAction({ skillId: selectedSkill.id, action: 'update' })
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

  const openSkillDetail = useCallback((skillId: string) => {
    catalogScrollTopRef.current = libraryRef.current?.scrollTop || 0
    setError(null)
    setDetailSkillId(skillId)
  }, [])

  const closeSkillDetail = useCallback(() => {
    setError(null)
    setDetailSkillId(null)
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      libraryRef.current?.scrollTo({
        top: detailSkillId ? 0 : catalogScrollTopRef.current,
        behavior: 'auto',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [detailSkillId])

  if (loading && builtinSkills.length === 0 && skills.length === 0) {
    return (
      <div className="skill-library-state" role="status">
        <Loader2 className="skill-library-spinner" size={20} />
        <span>正在加载技能...</span>
      </div>
    )
  }

  if (selectedSkill) {
    return (
      <div className="skill-library" ref={libraryRef}>
        <div className="skill-library-shell skill-detail-shell">
          <div className="skill-detail-toolbar">
            <button type="button" className="skill-detail-back" onClick={closeSkillDetail}>
              <ArrowLeft size={15} />
              返回社区精选
            </button>
            <span>技能详情</span>
          </div>

          {error && (
            <div className="skill-library-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          <article className="skill-detail-page">
            <header className="skill-detail-page-header">
              <div className="skill-detail-identity">
                <div className="skill-detail-icon" aria-hidden="true"><SelectedSkillIcon size={24} /></div>
                <div className="skill-detail-title">
                  <span>{selectedSkill.category}</span>
                  <h1>{selectedSkill.name}</h1>
                  <p>由 {selectedSkill.author} 维护</p>
                </div>
              </div>

              <div className="skill-detail-page-actions">
                <span className={`skill-detail-status${selectedSkill.updateAvailable ? ' skill-detail-status-update' : selectedSkill.installed ? ' skill-detail-status-installed' : ''}`} aria-live="polite">
                  {selectedSkillRunning
                    ? '运行中'
                    : selectedSkill.updateAvailable
                      ? '有可用更新'
                      : selectedSkill.installed
                        ? '已安装'
                        : '未安装'}
                </span>

                {selectedSkill.installed ? (
                  <div className="skill-action-buttons">
                    {selectedSkill.updateAvailable && (
                      <button type="button" className="skill-action-button skill-action-install" onClick={() => void update()} disabled={pendingAction !== null || selectedSkillRunning}>
                        {pendingAction?.skillId === selectedSkill.id && pendingAction.action === 'update' ? <Loader2 className="skill-library-spinner" size={15} /> : <RefreshCw size={15} />}
                        {pendingAction?.skillId === selectedSkill.id && pendingAction.action === 'update' ? '正在更新' : selectedSkillRunning ? '任务结束后更新' : '更新技能'}
                      </button>
                    )}
                    <button type="button" className="skill-action-button skill-action-uninstall" onClick={() => void uninstall()} disabled={pendingAction !== null || selectedSkillRunning}>
                      {pendingAction?.skillId === selectedSkill.id && pendingAction.action === 'uninstall' ? <Loader2 className="skill-library-spinner" size={15} /> : <Trash2 size={15} />}
                      {pendingAction?.skillId === selectedSkill.id && pendingAction.action === 'uninstall' ? '正在卸载' : selectedSkillRunning ? '正在使用' : '卸载'}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="skill-action-button skill-action-install" onClick={() => void install()} disabled={pendingAction !== null}>
                    {pendingAction?.skillId === selectedSkill.id && pendingAction.action === 'install' ? <Loader2 className="skill-library-spinner" size={15} /> : <Download size={15} />}
                    {pendingAction?.skillId === selectedSkill.id && pendingAction.action === 'install' ? '正在安装' : '安装技能'}
                  </button>
                )}
              </div>
            </header>

            <div className="skill-detail-page-grid">
              <section className="skill-detail-overview" aria-labelledby="skill-detail-overview-title">
                <h2 id="skill-detail-overview-title">技能说明</h2>
                <p className="skill-detail-description">{selectedSkill.description}</p>

                <div className="skill-detail-tags" aria-label="技能标签">
                  {selectedSkill.tags.map(tag => <span key={tag}>{tag}</span>)}
                </div>

                <p className="skill-detail-availability">
                  {selectedSkill.updateAvailable
                    ? '新版本已通过目录检查，更新后对所有工作区生效。'
                    : selectedSkill.installed
                      ? '当前版本可直接在工作区会话中调用。'
                      : '安装一次，即可在所有工作区会话中使用。'}
                </p>

                <div className="skill-detail-links">
                  <a href={selectedSkill.sourcePageUrl} target="_blank" rel="noreferrer">
                    技能说明 <ExternalLink size={13} />
                  </a>
                  <a href={selectedSkill.repositoryUrl} target="_blank" rel="noreferrer">
                    查看源码 <ExternalLink size={13} />
                  </a>
                </div>
              </section>

              <section className="skill-detail-security" aria-labelledby="skill-detail-security-title">
                <div className="skill-detail-section-head">
                  <h2 id="skill-detail-security-title"><ShieldCheck size={16} /> 安全检查</h2>
                  <span>{selectedSkill.audits.filter(audit => audit.status === 'passed' || audit.status === 'reviewed').length} / {selectedSkill.audits.length} 项已确认</span>
                </div>
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
              </section>
            </div>
          </article>
        </div>
      </div>
    )
  }

  return (
    <div className="skill-library" ref={libraryRef}>
      <div className="skill-library-shell">
        <div className="skill-library-toolbar">
          <div className="skill-search-field">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索技能、用途或作者"
              aria-label="搜索技能"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索" title="清空搜索">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="skill-filter-group" role="group" aria-label="筛选社区技能">
            <SlidersHorizontal size={14} aria-hidden="true" />
            {filterOptions.map(option => (
              <button
                type="button"
                key={option.id}
                className={filter === option.id ? 'skill-filter-active' : ''}
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
                {option.id === 'updates' && updateCount > 0 && <span>{updateCount}</span>}
              </button>
            ))}
          </div>

          <div className="skill-library-summary" aria-label="技能概况">
            <span><strong>{installedCommunityCount}</strong> / {skills.length} 社区技能</span>
            <span><strong>{enabledBuiltinCount}</strong> / {builtinSkills.length} 内置能力</span>
          </div>
        </div>

        {error && (
          <div className="skill-library-error" role="alert">
            <span>{error}</span>
            {builtinSkills.length === 0 && skills.length === 0 && <button type="button" onClick={() => void loadCatalog()}>重试</button>}
          </div>
        )}

        <section className="skill-catalog" aria-labelledby="skill-catalog-title">
          <div className="skill-section-heading">
            <div>
              <h2 id="skill-catalog-title">社区精选</h2>
              <p>按需安装，由社区维护并经过安全检查。</p>
            </div>
            <span>{visibleSkills.length} 个结果</span>
          </div>

          {visibleSkills.length > 0 ? (
            <div className="skill-catalog-grid">
              {visibleSkills.map(skill => {
                const Icon = communitySkillIcons[skill.icon] || Blocks
                return (
                  <button
                    type="button"
                    key={skill.id}
                    className="skill-catalog-card"
                    aria-label={`查看 ${skill.name} 详情`}
                    onClick={() => openSkillDetail(skill.id)}
                  >
                    <span className="skill-catalog-card-head">
                      <span className="skill-catalog-card-icon" aria-hidden="true"><Icon size={18} /></span>
                      <span className="skill-catalog-card-identity">
                        <span>{skill.category}</span>
                        <strong>{skill.name}</strong>
                      </span>
                      <span className="skill-catalog-card-arrow" aria-hidden="true"><ChevronRight size={16} /></span>
                    </span>

                    <span className="skill-catalog-card-summary">{skill.summary}</span>

                    <span className="skill-catalog-card-tags" aria-hidden="true">
                      {skill.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}
                    </span>

                    <span className="skill-catalog-card-footer">
                      <span className={`skill-catalog-card-status${skill.updateAvailable ? ' skill-catalog-card-status-update' : skill.installed ? ' skill-catalog-card-status-installed' : ''}`}>
                        {skill.updateAvailable
                          ? <><RefreshCw size={12} /> 可更新</>
                          : skill.installed
                            ? <><Check size={12} /> 已安装</>
                            : <><Download size={12} /> 可安装</>}
                      </span>
                      <span>by {skill.author}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="skill-catalog-empty" role="status">
              <Search size={18} aria-hidden="true" />
              <strong>没有匹配的技能</strong>
              <span>换个关键词，或调整上方筛选条件。</span>
              <button type="button" onClick={() => { setQuery(''); setFilter('all') }}>查看全部</button>
            </div>
          )}
        </section>

        <section className="skill-builtin-section" aria-labelledby="builtin-skill-title">
          <div className="skill-section-heading">
            <div>
              <h2 id="builtin-skill-title">内置能力</h2>
              <p>随 sumi 提供并自动更新，可以随时启用或停用。</p>
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
                    <div>
                      <h3>{skill.name}</h3>
                      <span>{skill.enabled ? '已启用' : '已停用'}</span>
                    </div>
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
    </div>
  )
}

export default SkillLibrary
