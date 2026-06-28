import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Blocks,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  Loader2,
  Monitor,
  Palette,
  Presentation,
  RefreshCw,
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
  'guizang-ppt-skill': Presentation,
  'frontend-slides': Presentation,
  'huashu-design': WandSparkles,
  'system-cleanup': Trash2,
  'organize-desktop': Monitor,
  'organize-folder': FolderOpen,
  'perf-optimize': Gauge,
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

  const install = useCallback(async () => {
    if (!selectedSkill || pendingAction) return
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
  }, [loadCatalog, pendingAction, selectedSkill])

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
        <div className="skill-library-heading-icon" aria-hidden="true"><Blocks size={18} /></div>
        <div>
          <div className="skill-library-eyebrow">SKILLS</div>
          <h1>技能</h1>
          <p>管理 sumi 内置能力，并按需安装社区精选 Skill。</p>
        </div>
      </header>

      {error && (
        <div className="skill-library-error" role="alert">
          <span>{error}</span>
          {builtinSkills.length === 0 && skills.length === 0 && <button onClick={() => void loadCatalog()}>重试</button>}
        </div>
      )}

      <section className="skill-builtin-section" aria-labelledby="builtin-skill-title">
        <div className="skill-section-heading">
          <div>
            <h2 id="builtin-skill-title">内置技能</h2>
            <p>随 sumi 提供并自动更新，新增技能默认启用。</p>
          </div>
          <span>{builtinSkills.filter(skill => skill.enabled).length} / {builtinSkills.length} 已启用</span>
        </div>

        <div className="skill-builtin-grid">
          {builtinSkills.map(skill => {
            const Icon = builtinSkillIcons[skill.id as keyof typeof builtinSkillIcons] || Blocks
            const pending = pendingBuiltinId === skill.id
            return (
              <article className={`skill-builtin-card${skill.enabled ? '' : ' skill-builtin-card-disabled'}`} key={skill.id}>
                <div className="skill-builtin-card-icon" aria-hidden="true"><Icon size={18} /></div>
                <div className="skill-builtin-card-copy">
                  <h3>{skill.name}</h3>
                  <p>{skill.description}</p>
                </div>
                <button
                  className="skill-builtin-toggle"
                  type="button"
                  role="switch"
                  aria-checked={skill.enabled}
                  aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
                  disabled={pendingBuiltinId !== null}
                  onClick={() => void toggleBuiltin(skill)}
                >
                  <span className={`skill-toggle-track${skill.enabled ? ' skill-toggle-track-on' : ''}`} aria-hidden="true">
                    <span className="skill-toggle-thumb" />
                  </span>
                  <span>{pending ? '更新中' : skill.enabled ? '已启用' : '已停用'}</span>
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <div className="skill-library-layout">
        <section className="skill-catalog" aria-labelledby="skill-catalog-title">
          <div className="skill-section-heading">
            <div>
              <h2 id="skill-catalog-title">社区精选</h2>
              <p>目录随应用版本更新，安装和更新时需要联网。</p>
            </div>
            <span>{skills.length} 个</span>
          </div>

          <div className="skill-card-grid">
            {skills.map(skill => (
              <button
                key={skill.id}
                className={`skill-card${skill.id === selectedId ? ' skill-card-selected' : ''}`}
                onClick={() => setSelectedId(skill.id)}
                aria-pressed={skill.id === selectedId}
              >
                <div className="skill-card-topline">
                  <span className="skill-card-icon" aria-hidden="true"><Palette size={19} /></span>
                  <span className={`skill-card-status${skill.updateAvailable ? ' skill-card-status-update' : skill.installed ? ' skill-card-status-installed' : ''}`}>
                    {skill.updateAvailable
                      ? <><RefreshCw size={12} /> 可更新</>
                      : skill.installed
                        ? <><Check size={12} /> 已安装</>
                        : '可安装'}
                  </span>
                </div>
                <div className="skill-card-copy">
                  <span className="skill-card-category">{skill.category}</span>
                  <h3>{skill.name}</h3>
                  <p>{skill.summary}</p>
                </div>
                <span className="skill-card-author">来自 {skill.author}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="skill-detail" aria-live="polite">
          {selectedSkill ? (
            <>
              <div className="skill-detail-head">
                <div className="skill-detail-icon" aria-hidden="true"><Palette size={22} /></div>
                <div>
                  <span>{selectedSkill.category}</span>
                  <h2>{selectedSkill.name}</h2>
                  <p>by {selectedSkill.author}</p>
                </div>
              </div>

              <p className="skill-detail-description">{selectedSkill.description}</p>

              <div className="skill-detail-tags" aria-label="技能标签">
                {selectedSkill.tags.map(tag => <span key={tag}>{tag}</span>)}
              </div>

              <div className="skill-detail-section">
                <h3><ShieldCheck size={15} /> 安全检查</h3>
                <div className="skill-audit-list">
                  {selectedSkill.audits.map(audit => (
                    <div key={audit.name} className="skill-audit-row">
                      <CheckCircle2 size={14} />
                      <span>{audit.name}</span>
                      <span>{audit.status === 'passed' ? '通过' : '已审核'}</span>
                    </div>
                  ))}
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
                    ? '已是最新版本，可在输入框中通过 / 调用'
                    : '安装后会在所有工作区中可用'}</span>
              </div>
            </>
          ) : (
            <div className="skill-detail-empty">选择一个技能查看详情</div>
          )}
        </aside>
      </div>
    </div>
  )
}

export default SkillLibrary
