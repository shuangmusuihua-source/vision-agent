import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowUp } from '@phosphor-icons/react'
import type { SlashCommand } from '../../lib/ipc'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled: boolean
  placeholder?: string
  prefill?: string | null
  onPrefillConsumed?: () => void
}

function ChatInput({ onSend, disabled, placeholder, prefill, onPrefillConsumed }: ChatInputProps): React.ReactElement {
  const [text, setText] = useState('')
  const [skills, setSkills] = useState<SlashCommand[]>([])
  const [showSkillPopup, setShowSkillPopup] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')
  const [selectedSkillIdx, setSelectedSkillIdx] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Load skills on mount
  useEffect(() => {
    window.api.skills.list().then(setSkills).catch(() => setSkills([]))
  }, [])

  // Handle prefill
  useEffect(() => {
    if (prefill) {
      setText(prefill)
      onPrefillConsumed?.()
      inputRef.current?.focus()
    }
  }, [prefill, onPrefillConsumed])

  // Detect "/" at start of input for skill popup
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
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
    s.description.toLowerCase().includes(skillFilter) ||
    s.aliases?.some(a => a.toLowerCase().includes(skillFilter))
  )

  const handleSelectSkill = useCallback((skill: SlashCommand) => {
    const prefix = `/${skill.name} `
    setText(prefix)
    setShowSkillPopup(false)
    inputRef.current?.focus()
    // Move cursor to end
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.selectionStart = prefix.length
        inputRef.current.selectionEnd = prefix.length
      }
    }, 0)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim() && !disabled) {
        onSend(text.trim())
        setText('')
        setShowSkillPopup(false)
      }
    }
  }, [showSkillPopup, filteredSkills, selectedSkillIdx, handleSelectSkill, text, disabled, onSend])

  // Close popup on outside click
  useEffect(() => {
    if (!showSkillPopup) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSkillPopup(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSkillPopup])

  // Scroll selected skill into view
  useEffect(() => {
    if (!showSkillPopup || filteredSkills.length === 0) return
    const el = popupRef.current?.querySelector(`[data-skill-idx="${selectedSkillIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedSkillIdx, showSkillPopup, filteredSkills.length])

  return (
    <div className="chat-input-container">
      <div className="chat-input-wrapper">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={placeholder || '输入消息，/ 触发技能...'}
          value={text}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />
        <button
          className={`chat-send-btn ${text.trim() && !disabled ? 'chat-send-btn-active' : ''}`}
          onClick={() => {
            if (text.trim() && !disabled) {
              onSend(text.trim())
              setText('')
              setShowSkillPopup(false)
            }
          }}
          disabled={!text.trim() || disabled}
        >
          <ArrowUp size={16} weight="regular" />
        </button>
      </div>

      {showSkillPopup && filteredSkills.length > 0 && (
        <div className="skill-popup" ref={popupRef}>
          <div className="skill-popup-header">可用技能</div>
          {filteredSkills.map((skill, idx) => (
            <div
              key={skill.name}
              className={`skill-popup-item ${idx === selectedSkillIdx ? 'selected' : ''}`}
              data-skill-idx={idx}
              onClick={() => handleSelectSkill(skill)}
              onMouseEnter={() => setSelectedSkillIdx(idx)}
            >
              <div className="skill-popup-item-name">
                /{skill.name}
                {skill.argumentHint && (
                  <span className="skill-popup-item-hint">{skill.argumentHint}</span>
                )}
              </div>
              <div className="skill-popup-item-desc">{skill.description}</div>
            </div>
          ))}
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
