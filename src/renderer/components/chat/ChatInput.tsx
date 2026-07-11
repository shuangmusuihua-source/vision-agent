import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowUp, Square, Paperclip, X, Loader2 } from 'lucide-react'
import type { SkillDefinition } from '../../lib/ipc'
import type { AgentContext } from '../../../shared/types'
import { ASK_ASSISTANT_NAME } from '../../../shared/branding'
import { isSkillVisibleInSlashMenu } from '../../../shared/skill-invocation'
import { useAgentStore } from '../../store/agent-store-impl'
import { useModal } from '../common/ModalSystem'
import type { MarkitdownFormat } from '../../../shared/markitdown-runtime'
import {
  encodeFileConvertPath,
  encodeAttachmentReferencePath,
  fileExtension,
  formatAttachmentPromptLine,
  isConvertibleAttachmentPath,
  type AttachmentKind,
} from '../../../shared/file-attachments'

interface AttachedFile {
  name: string
  path: string
  type: AttachmentKind
  base64?: string
  mimeType?: string
  size?: number
  attachmentGrantId?: string
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

function ChatInput({ context, onSend, onSkillSelect, onStop, disabled, isStreaming, placeholder, variant = 'default' }: ChatInputProps): React.ReactElement {
  const [text, setText] = useState('')
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [showSkillPopup, setShowSkillPopup] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')
  const [selectedSkillIdx, setSelectedSkillIdx] = useState(0)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const preparingAttachmentsRef = useRef(false)
  const modal = useModal()
  const consumePrefill = useAgentStore((s) => s.consumePrefill)

  // Prefill from store slot — context-aware
  const prefillText = useAgentStore((s) => s.slots[context]?.prefillText)
  useEffect(() => {
    if (prefillText) {
      setText(prefillText)
      consumePrefill(context)
      ;(variant === 'capsule' ? inputRef.current : textareaRef.current)?.focus()
    }
  }, [consumePrefill, prefillText, context, variant])

  // Keep the slash menu in sync with runtime installs and uninstalls.
  useEffect(() => {
    let active = true
    const refreshSkills = () => {
      window.api.skills.list().then(
        (all) => { if (active) setSkills(all.filter(isSkillVisibleInSlashMenu)) }
      ).catch(() => { if (active) setSkills([]) })
    }

    refreshSkills()
    const unsubscribe = window.api.skills.onChanged(refreshSkills)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Detect "/" at start of input for skill popup
  const handleInputChange = useCallback((val: string) => {
    setText(val)

    if (context === 'editor' && val.startsWith('/')) {
      setShowSkillPopup(true)
      setSkillFilter(val.slice(1).toLowerCase())
      setSelectedSkillIdx(0)
    } else {
      setShowSkillPopup(false)
    }
  }, [context])

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
      const ext = fileExtension(name)
      const type = ext === 'pdf' ? 'pdf' :
        imageExts.includes(ext) ? 'image' : 'text'
      files.push({ name, path: filePath, type, attachmentGrantId: result.attachmentGrantId })
    }
    setAttachedFiles((prev) => [...prev, ...files])
  }, [])

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const ensureAttachmentRuntime = useCallback(async (formats: MarkitdownFormat[]): Promise<boolean> => {
    if (preparingAttachmentsRef.current) return false
    preparingAttachmentsRef.current = true
    setIsPreparingAttachments(true)

    try {
      const status = await window.api.attachments.runtimeStatus(formats)
      if (status.state === 'ready') return true

      if (status.state === 'python-missing') {
        await modal.alert({
          title: '需要 Python',
          message: `未找到可用的 Python ${status.minimumPythonVersion} 或更高版本。请先安装 Python，再重新发送附件。`,
        })
        return false
      }

      const confirmed = await modal.confirm({
        title: '安装附件解析组件',
        message: 'sumi 需要使用 MarkItDown 读取 PDF、Word、PowerPoint 和 Excel。组件将安装到 sumi 的独立目录，不会修改系统 Python；首次安装需要联网，可能需要几分钟。',
        variant: 'primary',
        confirmLabel: '安装并继续',
      })
      if (!confirmed) return false

      const result = await window.api.attachments.installRuntime()
      if (!result.success) {
        await modal.alert({ title: '安装失败', message: result.error })
        return false
      }
      return true
    } catch (error) {
      await modal.alert({
        title: '附件准备失败',
        message: error instanceof Error ? error.message : '无法准备附件解析组件，请稍后重试。',
      })
      return false
    } finally {
      preparingAttachmentsRef.current = false
      setIsPreparingAttachments(false)
    }
  }, [modal])

  const doSend = useCallback(async () => {
    const hasContent = text.trim() || attachedFiles.length > 0
    if (hasContent && !disabled && !preparingAttachmentsRef.current) {
      let prompt = text.trim()
      if (attachedFiles.length > 0) {
        // Hidden marker for main process to convert non-text files (pptx/xlsx/docx/pdf)
        const convertibleFiles = attachedFiles.filter(f => isConvertibleAttachmentPath(f.path || f.name))
        const convPaths = convertibleFiles.map(f => encodeFileConvertPath(f.path, f.attachmentGrantId))
        if (convertibleFiles.length > 0) {
          const formats = [...new Set(convertibleFiles.map(file => fileExtension(file.path || file.name)))] as MarkitdownFormat[]
          if (!await ensureAttachmentRuntime(formats)) return
        }
        const fileParts = attachedFiles.map(formatAttachmentPromptLine)
        const attachmentPaths = attachedFiles.map(file => (
          encodeAttachmentReferencePath(file.path, file.attachmentGrantId)
        ))
        const attachmentPrefix = '<!--FILE_ATTACH:' + attachmentPaths.join('|') + '-->\n'
        const conversionPrefix = convPaths.length > 0 ? '<!--FILE_CONVERT:' + convPaths.join('|') + '-->\n' : ''
        const prefix = attachmentPrefix + conversionPrefix
        prompt = prefix + fileParts.join('\n') + (prompt ? '\n\n' + prompt : '')
      }
      onSend(prompt)
      setText('')
      setAttachedFiles([])
      setShowSkillPopup(false)
    }
  }, [text, disabled, onSend, attachedFiles, ensureAttachmentRuntime])

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
      void doSend()
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

  // --- Capsule variant: single-line input (Ask sumi style) ---
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
            disabled={disabled || isPreparingAttachments}
            type="button"
            title="上传文件"
          >
            <Paperclip size={14} />
          </button>
          <input
            ref={inputRef}
            type="text"
            className="ask-zuovis-input"
            placeholder={placeholder || `问 ${ASK_ASSISTANT_NAME} 任何问题...`}
            value={text}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || isPreparingAttachments}
            autoFocus
          />
          {isStreaming && onStop ? (
            <button
              className="ask-zuovis-stop-btn"
              onClick={onStop}
              type="button"
              title="停止生成"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              className={`ask-zuovis-send-btn ${(text.trim() || attachedFiles.length > 0) && !disabled && !isPreparingAttachments ? 'ask-zuovis-send-btn-active' : ''}`}
              onClick={() => void doSend()}
              disabled={(!text.trim() && attachedFiles.length === 0) || disabled || isPreparingAttachments}
              type="button"
              title={isPreparingAttachments ? '正在准备附件解析组件' : '发送'}
            >
              {isPreparingAttachments ? <Loader2 size={16} className="spin" /> : <ArrowUp size={16} />}
            </button>
          )}
        </div>
        {showSkillPopup && filteredSkills.length > 0 && (
          <div className="skill-popup" ref={popupRef}>
            <div className="skill-popup-header">可用技能</div>
            {filteredSkills.map((skill, idx) => {
              return (
                <div
                  key={skill.id}
                  className={`skill-popup-item ${idx === selectedSkillIdx ? 'selected' : ''}`}
                  data-skill-idx={idx}
                  onClick={() => handleSelectSkill(skill)}
                  onMouseEnter={() => setSelectedSkillIdx(idx)}
                >
                  <div className="skill-popup-item-name">
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
      {attachedFiles.length > 0 && (
        <div className="chat-input-attachments">
          {attachedFiles.map((file, idx) => (
            <span key={idx} className="chat-input-attachment-chip" title={file.path}>
              <span className="chat-input-attachment-name">{file.name}</span>
              <button
                className="chat-input-attachment-remove"
                onClick={() => handleRemoveFile(idx)}
                type="button"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input-wrapper">
        <button
          className="chat-input-attach-btn"
          onClick={handleAttachFiles}
          disabled={disabled || isPreparingAttachments}
          type="button"
          title="上传文件"
        >
          <Paperclip size={14} />
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={placeholder || '输入消息，/ 触发技能...'}
          value={text}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isPreparingAttachments}
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
            <Square size={14} />
          </button>
        ) : (
          <button
            className={`chat-send-btn ${(text.trim() || attachedFiles.length > 0) && !disabled && !isPreparingAttachments ? 'chat-send-btn-active' : ''}`}
            onClick={() => void doSend()}
            disabled={(!text.trim() && attachedFiles.length === 0) || disabled || isPreparingAttachments}
            type="button"
            title={isPreparingAttachments ? '正在准备附件解析组件' : '发送'}
          >
            {isPreparingAttachments ? <Loader2 size={16} className="spin" /> : <ArrowUp size={16} />}
          </button>
        )}
      </div>

      {showSkillPopup && filteredSkills.length > 0 && (
        <div className="skill-popup" ref={popupRef}>
          <div className="skill-popup-header">可用技能</div>
          {filteredSkills.map((skill, idx) => {
            return (
            <div
              key={skill.id}
              className={`skill-popup-item ${idx === selectedSkillIdx ? 'selected' : ''}`}
              data-skill-idx={idx}
              onClick={() => handleSelectSkill(skill)}
              onMouseEnter={() => setSelectedSkillIdx(idx)}
            >
              <div className="skill-popup-item-name">
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
