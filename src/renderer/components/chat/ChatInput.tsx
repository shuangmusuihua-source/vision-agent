import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowUp, FileText, Presentation, Newspaper, CircleStop, Trash2, FolderOpen, Monitor, Paperclip, X } from 'lucide-react'
import type { SkillDefinition } from '../../lib/ipc'
import type { AgentContext } from '../../../shared/types'
import { useAgentStore } from '../../store/agent-store-impl'

interface AttachedFile {
  name: string
  path: string
  type: 'text' | 'image' | 'pdf'
}

interface ChatInputProps {
  context: AgentContext
  onSend: (message: string) => void
  onSkillSelect?: (skill: SkillDefinition) => void
  onStop?: () => void
  disabled: boolean
  isStreaming?: boolean
  placeholder?: string
  variant?: 'default' | 'capsule'
}

const ICON_MAP: Record<string, React.ComponentType<{ size: number }>> = {
  FileText,
  Presentation,
  Newspaper,
  Trash2,
  FolderOpen,
  Monitor
}

function ChatInput({ context, onSend, onSkillSelect, onStop, disabled, isStreaming, placeholder, variant = 'default' }: ChatInputProps): React.ReactElement {
  const [text, setText] = useState('')
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [showSkillPopup, setShowSkillPopup] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')
  const [selectedSkillIdx, setSelectedSkillIdx] = useState(0)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Prefill from store slot — context-aware
  const prefillText = useAgentStore((s) => s.slots[context]?.prefillText)
  useEffect(() => {
    if (prefillText) {
      setText(prefillText)
      useAgentStore.setState((prev) => ({
        slots: {
          ...prev.slots,
          [context]: { ...prev.slots[context], prefillText: null },
        },
      }))
      ;(variant === 'capsule' ? inputRef.current : textareaRef.current)?.focus()
    }
  }, [prefillText, context, variant])

  // Load skills on mount
  useEffect(() => {
    window.api.skills.list().then(
      (all) => setSkills(all.filter((s) => !s.hideInSlashMenu))
    ).catch(() => setSkills([]))
  }, [])

  // Detect "/" at start of input for skill popup
  const handleInputChange = useCallback((val: string) => {
    setText(val)

    if (val.startsWith('/')) {
      setShowSkillPopup(true)
      setSkillFilter(val.slice(1).toLowerCase())
      setSelectedSkillIdx(0)
    } else {
      setShowSkillPopup(false)
    }
  }, [])

  const filteredSkills = skills.filter(s =>
    s.name.toLowerCase().includes(skillFilter) ||
    (s.description || '').toLowerCase().includes(skillFilter) ||
    (s.id || '').toLowerCase().includes(skillFilter)
  )

  const handleSelectSkill = useCallback((skill: SkillDefinition) => {
    setShowSkillPopup(false)
    setText('')
    if (onSkillSelect) {
      onSkillSelect(skill)
    }
  }, [onSkillSelect])

  const handleAttachFiles = useCallback(async () => {
    const result = await window.api.workspace.selectFiles()
    if (result.canceled || result.filePaths.length === 0) return

    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
    const files: AttachedFile[] = []
    for (const filePath of result.filePaths) {
      const name = filePath.split('/').pop() || filePath
      const ext = name.split('.').pop()?.toLowerCase() || ''
      const type = ext === 'pdf' ? 'pdf' :
        imageExts.includes(ext) ? 'image' : 'text'
      files.push({ name, path: filePath, type })
    }
    setAttachedFiles((prev) => [...prev, ...files])
  }, [])

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const doSend = useCallback(() => {
    const hasContent = text.trim() || attachedFiles.length > 0
    if (hasContent && !disabled) {
      let prompt = text.trim()
      if (attachedFiles.length > 0) {
        const fileParts = attachedFiles.map((f) => {
          const label = f.type === 'image' ? 'image' : f.type === 'pdf' ? 'PDF' : 'file'
          return `[Attached ${label}: ${f.path}]`
        })
        prompt = fileParts.join('\n') + (prompt ? '\n\n' + prompt : '')
      }
      onSend(prompt)
      setText('')
      setAttachedFiles([])
      setShowSkillPopup(false)
    }
  }, [text, disabled, onSend, attachedFiles])

  // Skill popup keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (showSkillPopup && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSkillIdx(prev => Math.min(prev + 1, filteredSkills.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSkillIdx(prev => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        handleSelectSkill(filteredSkills[selectedSkillIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSkillPopup(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      doSend()
    }
  }, [showSkillPopup, filteredSkills, selectedSkillIdx, handleSelectSkill, doSend])

  // Close popup on outside click
  useEffect(() => {
    if (!showSkillPopup) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        const activeInput = variant === 'capsule' ? inputRef.current : textareaRef.current
        if (activeInput && !activeInput.contains(e.target as Node)) {
          setShowSkillPopup(false)
        }
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSkillPopup, variant])

  // Scroll selected skill into view
  useEffect(() => {
    if (!showSkillPopup || filteredSkills.length === 0) return
    const el = popupRef.current?.querySelector(`[data-skill-idx="${selectedSkillIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedSkillIdx, showSkillPopup, filteredSkills.length])

  // --- Capsule variant: single-line input (AskZuovis style) ---
  if (variant === 'capsule') {
    return (
      <div className="ask-zuovis-capsule-wrapper">
        {attachedFiles.length > 0 && (
          <div className="ask-zuovis-attachments">
            {attachedFiles.map((file, idx) => (
              <span key={idx} className="ask-zuovis-attachment-chip" title={file.path}>
                <span className="ask-zuovis-attachment-name">{file.name}</span>
                <button
                  className="ask-zuovis-attachment-remove"
                  onClick={() => handleRemoveFile(idx)}
                  type="button"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="ask-zuovis-capsule">
          <button
            className="ask-zuovis-attach-btn"
            onClick={handleAttachFiles}
            disabled={disabled}
            type="button"
            title="上传文件"
          >
            <Paperclip size={14} />
          </button>
          <input
            ref={inputRef}
            type="text"
            className="ask-zuovis-input"
            placeholder={placeholder || '问 Zuovis 任何问题...'}
            value={text}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autoFocus
          />
          {isStreaming && onStop ? (
            <button
              className="ask-zuovis-stop-btn"
              onClick={onStop}
              type="button"
              title="停止生成"
            >
              <CircleStop size={14} />
            </button>
          ) : (
            <button
              className={`ask-zuovis-send-btn ${(text.trim() || attachedFiles.length > 0) && !disabled ? 'ask-zuovis-send-btn-active' : ''}`}
              onClick={doSend}
              disabled={(!text.trim() && attachedFiles.length === 0) || disabled}
              type="button"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {showSkillPopup && filteredSkills.length > 0 && (
          <div className="skill-popup" ref={popupRef}>
            <div className="skill-popup-header">可用技能</div>
            {filteredSkills.map((skill, idx) => {
              const IconComp = ICON_MAP[skill.icon]
              return (
                <div
                  key={skill.id}
                  className={`skill-popup-item ${idx === selectedSkillIdx ? 'selected' : ''}`}
                  data-skill-idx={idx}
                  onClick={() => handleSelectSkill(skill)}
                  onMouseEnter={() => setSelectedSkillIdx(idx)}
                >
                  <div className="skill-popup-item-name">
                    {IconComp && <IconComp size={14} />}
                    {skill.name}
                    {skill.argumentHint && (
                      <span className="skill-popup-item-hint">{skill.argumentHint}</span>
                    )}
                  </div>
                  <div className="skill-popup-item-desc">{skill.description}</div>
                </div>
              )
            })}
          </div>
        )}
        {showSkillPopup && filteredSkills.length === 0 && skillFilter && (
          <div className="skill-popup" ref={popupRef}>
            <div className="skill-popup-empty">没有匹配的技能</div>
          </div>
        )}
      </div>
    )
  }

  // --- Default variant: textarea (editor agent panel style) ---
  return (
    <div className="chat-input-container">
      <div className="chat-input-wrapper">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={placeholder || '输入消息，/ 触发技能...'}
          value={text}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          autoFocus
        />
        {isStreaming && onStop ? (
          <button
            className="chat-stop-btn"
            onClick={onStop}
            type="button"
            title="停止生成"
          >
            <CircleStop size={14} />
          </button>
        ) : (
          <button
            className={`chat-send-btn ${text.trim() && !disabled ? 'chat-send-btn-active' : ''}`}
            onClick={doSend}
            disabled={!text.trim() || disabled}
            type="button"
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>

      {showSkillPopup && filteredSkills.length > 0 && (
        <div className="skill-popup" ref={popupRef}>
          <div className="skill-popup-header">可用技能</div>
          {filteredSkills.map((skill, idx) => {
            const IconComp = ICON_MAP[skill.icon]
            return (
            <div
              key={skill.id}
              className={`skill-popup-item ${idx === selectedSkillIdx ? 'selected' : ''}`}
              data-skill-idx={idx}
              onClick={() => handleSelectSkill(skill)}
              onMouseEnter={() => setSelectedSkillIdx(idx)}
            >
              <div className="skill-popup-item-name">
                {IconComp && <IconComp size={14} />}
                {skill.name}
                {skill.argumentHint && (
                  <span className="skill-popup-item-hint">{skill.argumentHint}</span>
                )}
              </div>
              <div className="skill-popup-item-desc">{skill.description}</div>
            </div>
            )
          })}
        </div>
      )}

      {showSkillPopup && filteredSkills.length === 0 && skillFilter && (
        <div className="skill-popup" ref={popupRef}>
          <div className="skill-popup-empty">没有匹配的技能</div>
        </div>
      )}
    </div>
  )
}

export default ChatInput