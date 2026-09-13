import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Pencil, Trash2, WandSparkles } from 'lucide-react'
import type { PersonalSkillSummary } from '../../../shared/curation-types'
import { useModal } from '../common/ModalSystem'
import '../knowledge/Curation.css'

export default function PersonalSkillLibrary({ query, onEdit, onUse }: {
  query: string; onEdit: (id: string) => void; onUse: (id: string) => void
}): React.ReactElement {
  const modal = useModal()
  const [skills, setSkills] = useState<PersonalSkillSummary[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const loadEpoch = useRef(0)
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current
    try {
      const result = await window.api.skills.listPersonal()
      if (epoch !== loadEpoch.current) return
      if (!result.success) throw new Error(result.error)
      setSkills(result.value); setError('')
    } catch (err) { if (epoch === loadEpoch.current) setError(String(err)) }
  }, [])
  useEffect(() => {
    void load()
    const off = window.api.skills.onChanged(() => { void load() })
    return () => { loadEpoch.current++; off() }
  }, [load])
  const remove = async (skill: PersonalSkillSummary) => {
    if (!await modal.confirm({ title: `删除「${skill.name}」？`, message: '这个 Skill 将从个人技能库移除，任务中的成果会保留。', variant: 'danger', confirmLabel: '删除 Skill' })) return
    setBusy(skill.id)
    try {
      const result = await window.api.skills.deletePersonal(skill.id)
      if (!result.success) throw new Error(result.error)
      await load()
    } catch (err) { setError(String(err)) }
    finally { setBusy(null) }
  }
  const toggle = async (skill: PersonalSkillSummary) => {
    setBusy(skill.id)
    try {
      await window.api.skills.toggle(skill.id, !skill.enabled)
      await load()
    } catch (err) { setError(String(err)) }
    finally { setBusy(null) }
  }
  return <section className="skill-builtin-section personal-skill-section" aria-labelledby="personal-skills-title">
    <div className="skill-section-heading"><div><h2 id="personal-skills-title">我的 Skill</h2><p>从满意的任务中，积累适合自己的工作方法。</p></div><span>{skills.length} 个</span></div>
    {error && <div className="curation-error" role="alert">{error}<button type="button" className="curation-button" onClick={() => void load()}>重试</button></div>}
    {!skills.length && !error && <p className="personal-skills-empty">完成一次任务后，在成果页点击「保存为我的 Skill」。</p>}
    <div className="personal-skill-grid">{skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())).map(skill => <article key={skill.id} className="personal-skill-card">
      <div className="personal-skill-heading"><WandSparkles size={18} /><h3>{skill.name}</h3><label><input type="checkbox" aria-label={`启用 ${skill.name}`} checked={skill.enabled} disabled={busy === skill.id} onChange={() => void toggle(skill)} />启用</label></div>
      <p>{skill.description}</p><small>/{skill.id}</small>
      <div className="personal-skill-actions"><button type="button" className="curation-button" disabled={!skill.enabled || !!busy} onClick={() => onUse(skill.id)}><ArrowUpRight size={13} />用于任务</button><button type="button" className="curation-button" disabled={!!busy} onClick={() => onEdit(skill.id)}><Pencil size={13} />编辑</button><button type="button" className="curation-button curation-icon" disabled={!!busy} aria-label={`删除 ${skill.name}`} onClick={() => void remove(skill)}><Trash2 size={13} /></button></div>
    </article>)}</div>
  </section>
}
