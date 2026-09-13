import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { CurationDraft, PersonalSkillSummary } from '../../../shared/curation-types'
import AssistantMarkdown from '../chat/AssistantMarkdown'
import './Curation.css'

export type CurationTarget =
  | { kind: 'knowledge'; paths: string[]; sessionId?: string }
  | { kind: 'skill'; sessionId: string; artifactPath?: string }
  | { kind: 'edit-skill'; skillId: string }

export default function CurationDialog({ target, onClose, onSaved }: {
  target: CurationTarget; onClose: () => void; onSaved: () => void
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const alive = useRef(true)
  const epoch = useRef(0)
  const requestId = useRef(crypto.randomUUID())
  const draftRef = useRef<CurationDraft | null>(null)
  const [draft, setDraft] = useState<CurationDraft | null>(null)
  const [busy, setBusy] = useState(target.kind !== 'skill')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [instruction, setInstruction] = useState('')
  const [skillId, setSkillId] = useState('')
  const [personal, setPersonal] = useState<PersonalSkillSummary[]>([])
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<'edit' | 'preview' | 'before'>('preview')
  const api = target.kind === 'knowledge' ? window.api.graph : window.api.skills

  const acceptDraft = (result: Awaited<ReturnType<typeof window.api.graph.prepareKnowledge>>, generation: number) => {
    if (!alive.current || generation !== epoch.current) { if (result.success) void api.discardDraft(result.value.id).catch(() => {}); return }
    if (result.success) { draftRef.current = result.value; setDraft(result.value); setIndex(0) }
    else setError(result.error)
  }

  useEffect(() => {
    alive.current = true
    const generation = ++epoch.current
    const id = crypto.randomUUID()
    requestId.current = id
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    dialog.current?.showModal()
    if (target.kind === 'skill') {
      void window.api.skills.listPersonal().then(result => {
        if (!alive.current || generation !== epoch.current) return
        if (result.success) setPersonal(result.value)
        else setError(result.error)
      }).catch(err => { if (alive.current && generation === epoch.current) setError(String(err)) })
    } else {
      // Defer one microtask so React StrictMode's abandoned setup never starts a model run.
      const pending = Promise.resolve().then(() => {
        if (generation !== epoch.current) return null
        return target.kind === 'knowledge'
          ? window.api.graph.prepareKnowledge({ ...target, requestId: id })
          : window.api.skills.editPersonal(target.skillId)
      })
      void pending.then(result => { if (result) acceptDraft(result, generation) })
        .catch(err => { if (alive.current && generation === epoch.current) setError(String(err)) })
        .finally(() => { if (alive.current && generation === epoch.current) setBusy(false) })
    }
    return () => {
      alive.current = false
      epoch.current++
      element?.close()
      if (returnFocus?.isConnected) returnFocus.focus()
      void api.cancelPreparation(id).catch(() => {})
      if (draftRef.current) void api.discardDraft(draftRef.current.id).catch(() => {})
    }
    // AppShell keys this dialog by the captured target; it never follows the visible session.
  }, [])

  const generateSkill = async () => {
    if (target.kind !== 'skill' || busy) return
    const generation = epoch.current
    setBusy(true); setError('')
    try {
      acceptDraft(await window.api.skills.preparePersonal({ sessionId: target.sessionId, artifactPath: target.artifactPath,
        requestId: requestId.current, instruction, skillId: skillId || undefined }), generation)
    } catch (err) { if (alive.current) setError(String(err)) }
    finally { if (alive.current) setBusy(false) }
  }

  const save = async () => {
    if (!draft || saving) return
    setSaving(true); setError('')
    const request = { draftId: draft.id, files: draft.files.map(({ id, content }) => ({ id, content })) }
    try {
      const result = draft.kind === 'knowledge' ? await window.api.graph.saveKnowledge(request) : await window.api.skills.savePersonal(request)
      if (!result.success) { setError(result.error); return }
      draftRef.current = null
      onSaved(); onClose()
    } catch (err) { setError(String(err)) }
    finally { setSaving(false) }
  }
  const file = draft?.files[index]
  const title = draft?.title || (target.kind === 'knowledge' ? '整理知识' : target.kind === 'edit-skill' ? '编辑我的 Skill' : '保存为我的 Skill')

  return createPortal(<dialog ref={dialog} className="curation-dialog" aria-labelledby="curation-title"
    onCancel={event => { event.preventDefault(); if (!saving) onClose() }}>
    <header><div><span className="curation-eyebrow">{target.kind === 'knowledge' ? '个人知识库' : '我的工作方法'}</span><h2 id="curation-title">{title}</h2></div>
      <button type="button" className="curation-button curation-icon" onClick={onClose} disabled={saving} aria-label={busy ? '取消生成并关闭' : '关闭草稿'}><X size={18} /></button>
    </header>
    {error && <div className="curation-error" role="alert">{error}</div>}
    {busy ? <div className="curation-loading" role="status"><LoaderCircle className="is-spinning" size={24} /><h3>正在提炼可复用的内容</h3><p>多份资料可能需要几分钟。你可以随时取消。</p></div>
      : !draft && target.kind === 'skill' ? <div className="curation-setup">
        <p>把这次任务中有效的方法留下来，下次处理相似任务时直接使用。</p>
        <label>想保留什么方法？<textarea value={instruction} maxLength={4000} onChange={event => setInstruction(event.target.value)} placeholder="例如：保留这次竞品调研的维度、资料筛选方法和报告结构。" rows={4} /></label>
        <label>保存位置<select value={skillId} onChange={event => setSkillId(event.target.value)}><option value="">创建新的个人 Skill</option>{personal.map(skill => <option key={skill.id} value={skill.id}>更新：{skill.name}</option>)}</select></label>
        <p className="curation-hint">将参考这个任务的对话{target.artifactPath ? '和所选成果' : ''}，先生成草稿供你检查。</p>
      </div>
      : draft ? <>
        <p className="curation-notice">{draft.notice}</p>
        {file && <div className="curation-workbench">
          <aside aria-label="草稿文件">{draft.files.map((item, i) => <button type="button" key={item.id} aria-current={index === i ? 'true' : undefined} onClick={() => { setIndex(i); if (mode === 'before' && item.before === null) setMode('preview') }}><span>{item.title}</span><small>{item.before === null ? '新建' : '更新'}</small></button>)}</aside>
          <section className="curation-document"><div className="curation-tabs" aria-label="查看方式">
            {(['preview', 'edit', 'before'] as const).map(tab => <button type="button" key={tab} className="curation-button" aria-pressed={mode === tab} disabled={tab === 'before' && file.before === null} onClick={() => setMode(tab)}>{tab === 'preview' ? '预览' : tab === 'edit' ? '编辑' : '原内容'}</button>)}
          </div>{mode === 'edit' ? <textarea className="curation-editor" aria-label={`编辑 ${file.title}`} value={file.content} spellCheck={false} onChange={event => setDraft(current => current && ({ ...current, files: current.files.map((item, i) => i === index ? { ...item, content: event.target.value } : item) }))} />
            : <div className="curation-preview" onClickCapture={event => { if ((event.target as HTMLElement).closest('a,button')) { event.preventDefault(); event.stopPropagation() } }}><AssistantMarkdown text={(mode === 'before' ? file.before || '尚无原内容' : file.content).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')} isStreaming={false} /></div>}
          </section>
        </div>}
      </> : <div className="curation-setup"><p>没有生成草稿。关闭后可重新尝试。</p></div>}
    <footer><span>{draft?.files.length ? `${draft.files.length} 个文件 · 保存后生效` : ''}</span><button type="button" className="curation-button" onClick={onClose} disabled={saving}>{busy ? '取消生成' : '关闭'}</button>
      {!draft && target.kind === 'skill' && !busy && <button type="button" className="curation-button curation-primary" onClick={() => void generateSkill()}><Sparkles size={15} />生成草稿</button>}
      {!!draft?.files.length && <button type="button" className="curation-button curation-primary" onClick={() => void save()} disabled={saving || draft.files.some(item => !item.content.trim())}>{saving ? <LoaderCircle size={15} className="is-spinning" /> : <Check size={15} />}保存{draft.kind === 'knowledge' ? '主题' : ' Skill'}</button>}
    </footer>
  </dialog>, document.body)
}
