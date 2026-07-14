import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  ArrowUp,
  BookOpenText,
  Check,
  ChevronDown,
  LoaderCircle,
  MessageCircleQuestionMark,
  ScanSearch,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'

export type InlineEditMode = 'idle' | 'prompt' | 'loading' | 'review'
type BlockStyle = 'paragraph' | 'heading-1' | 'heading-2' | 'heading-3' | 'ordered-list' | 'bullet-list'

const BLOCK_STYLES: Array<{ id: BlockStyle; label: string; compactLabel: string; shortcut: string }> = [
  { id: 'paragraph', label: '正文', compactLabel: '正文', shortcut: '⌥⌘0' },
  { id: 'heading-1', label: '一级标题', compactLabel: '标题 1', shortcut: '⌥⌘1' },
  { id: 'heading-2', label: '二级标题', compactLabel: '标题 2', shortcut: '⌥⌘2' },
  { id: 'heading-3', label: '三级标题', compactLabel: '标题 3', shortcut: '⌥⌘3' },
  { id: 'ordered-list', label: '有序列表', compactLabel: '有序列表', shortcut: '⇧⌘7' },
  { id: 'bullet-list', label: '无序列表', compactLabel: '无序列表', shortcut: '⇧⌘8' },
]

function getActiveBlockStyle(editor: Editor): BlockStyle {
  if (editor.isActive('orderedList')) return 'ordered-list'
  if (editor.isActive('bulletList')) return 'bullet-list'
  if (editor.isActive('heading', { level: 1 })) return 'heading-1'
  if (editor.isActive('heading', { level: 2 })) return 'heading-2'
  if (editor.isActive('heading', { level: 3 })) return 'heading-3'
  return 'paragraph'
}

function getInlineSelectionVirtualElement(editor: Editor) {
  const selection = window.getSelection()
  const editorRoot = editor.view.dom

  if (
    !selection
    || selection.rangeCount === 0
    || selection.isCollapsed
    || !editorRoot.contains(selection.anchorNode)
    || !editorRoot.contains(selection.focusNode)
  ) {
    return null
  }

  const range = selection.getRangeAt(0)
  const clientRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  )

  if (clientRects.length === 0) return null

  const boundingRect = range.getBoundingClientRect()
  return {
    getBoundingClientRect: () => boundingRect,
    getClientRects: () => clientRects,
    contextElement: editorRoot,
  }
}

type AiInlineEditControlsProps = {
  editor: Editor
  mode: InlineEditMode
  instruction: string
  error: string | null
  onInstructionChange: (value: string) => void
  onOpen: () => void
  onAgentAction: (action: 'explain' | 'review' | 'ask') => void
  onSubmit: () => void
  onCancel: () => void
  onAccept: () => void
}

export default function AiInlineEditControls({
  editor,
  mode,
  instruction,
  error,
  onInstructionChange,
  onOpen,
  onAgentAction,
  onSubmit,
  onCancel,
  onAccept,
}: AiInlineEditControlsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const stylePickerRef = useRef<HTMLDivElement>(null)
  const [styleMenuOpen, setStyleMenuOpen] = useState(false)
  const [bubblePortal] = useState(() => {
    const portal = document.createElement('div')
    portal.className = 'ai-inline-portal'
    return portal
  })
  const editorFormatting = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor.isActive('bold'),
      italic: currentEditor.isActive('italic'),
      blockStyle: getActiveBlockStyle(currentEditor),
    }),
  })
  const activeBlockStyle = BLOCK_STYLES.find(({ id }) => id === editorFormatting.blockStyle) || BLOCK_STYLES[0]

  useLayoutEffect(() => {
    document.body.appendChild(bubblePortal)
    return () => bubblePortal.remove()
  }, [bubblePortal])

  useEffect(() => {
    if (mode !== 'prompt') return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [mode])

  useEffect(() => {
    if (mode !== 'idle') setStyleMenuOpen(false)
  }, [mode])

  useEffect(() => {
    if (!styleMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!stylePickerRef.current?.contains(event.target as Node)) setStyleMenuOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStyleMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [styleMenuOpen])

  useEffect(() => {
    if (mode !== 'loading' && mode !== 'review') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (mode === 'review' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onAccept()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mode, onAccept, onCancel])

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmit()
    }
  }

  const applyBlockStyle = (style: BlockStyle) => {
    setStyleMenuOpen(false)
    if (style === editorFormatting.blockStyle) return

    let chain = editor.chain().focus()
    const inList = editor.isActive('orderedList') || editor.isActive('bulletList')

    if (style === 'paragraph') {
      if (inList) chain = chain.liftListItem('listItem')
      chain.setParagraph().run()
      return
    }

    if (style.startsWith('heading-')) {
      if (inList) chain = chain.liftListItem('listItem')
      const level = Number(style.at(-1)) as 1 | 2 | 3
      chain.setHeading({ level }).run()
      return
    }

    if (style === 'ordered-list') {
      chain.toggleOrderedList().run()
      return
    }
    chain.toggleBulletList().run()
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="aiInlineEditMenu"
      updateDelay={50}
      appendTo={() => bubblePortal}
      getReferencedVirtualElement={() => getInlineSelectionVirtualElement(editor)}
      options={{
        placement: 'top',
        offset: 10,
        strategy: 'fixed',
        flip: true,
        shift: { padding: 12 },
        inline: true,
      }}
      shouldShow={({ state }) => {
        if (mode !== 'idle') return true
        const { from, to, empty } = state.selection
        return !empty && Boolean(state.doc.textBetween(from, to, ' ').trim())
      }}
      className={`ai-inline-menu ai-inline-menu-${mode}`}
    >
      {mode === 'idle' && (
        <div className="ai-inline-toolbar" role="toolbar" aria-label="选区编辑工具">
          <button
            type="button"
            className="ai-inline-toolbar-primary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onOpen}
          >
            <Sparkles size={14} />
            <span>AI 修改</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            type="button"
            className="ai-inline-agent-action"
            title="解释选中内容"
            aria-label="解释选中内容"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAgentAction('explain')}
          >
            <BookOpenText size={14} aria-hidden="true" />
            解释
          </button>
          <button
            type="button"
            className="ai-inline-agent-action"
            title="审阅选中内容"
            aria-label="审阅选中内容"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAgentAction('review')}
          >
            <ScanSearch size={14} aria-hidden="true" />
            审阅
          </button>
          <button
            type="button"
            className="ai-inline-agent-action"
            title="围绕选中内容提问"
            aria-label="围绕选中内容提问"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAgentAction('ask')}
          >
            <MessageCircleQuestionMark size={14} aria-hidden="true" />
            提问
          </button>
          <span className="ai-inline-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className={editorFormatting.bold ? 'is-active' : ''}
            aria-label="加粗"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={editorFormatting.italic ? 'is-active' : ''}
            aria-label="斜体"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <em>I</em>
          </button>
          <div className="ai-inline-style-picker" ref={stylePickerRef}>
            <button
              type="button"
              className={`ai-inline-style-trigger ${styleMenuOpen ? 'is-active' : ''}`}
              aria-label="改变文本样式"
              aria-haspopup="menu"
              aria-expanded={styleMenuOpen}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setStyleMenuOpen((open) => !open)}
            >
              <span>{activeBlockStyle.compactLabel}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {styleMenuOpen && (
              <div className="ai-inline-style-menu" role="menu" aria-label="文本样式">
                {BLOCK_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    className={`ai-inline-style-option ${style.id === editorFormatting.blockStyle ? 'is-selected' : ''}`}
                    role="menuitemradio"
                    aria-checked={style.id === editorFormatting.blockStyle}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyBlockStyle(style.id)}
                  >
                    <span>{style.label}</span>
                    <kbd>{style.shortcut}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'prompt' && (
        <div className="ai-inline-prompt-shell">
          <div className="ai-inline-prompt-row">
            <Sparkles size={14} aria-hidden="true" />
            <input
              ref={inputRef}
              value={instruction}
              onChange={(event) => onInstructionChange(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="描述如何修改…"
              aria-label="描述如何修改选中内容"
              maxLength={4000}
            />
            <button
              type="button"
              className="ai-inline-submit"
              onClick={onSubmit}
              disabled={!instruction.trim()}
              aria-label="提交修改要求"
            >
              <ArrowUp size={15} />
            </button>
            <button type="button" className="ai-inline-close" onClick={onCancel} aria-label="取消">
              <X size={14} />
            </button>
          </div>
          {error && <div className="ai-inline-error" role="alert">{error}</div>}
        </div>
      )}

      {mode === 'loading' && (
        <div className="ai-inline-loading" role="status" aria-live="polite">
          <LoaderCircle size={14} className="ai-inline-spinner" />
          <span>正在改写选中内容…</span>
          <button type="button" onClick={onCancel}>取消</button>
        </div>
      )}

      {mode === 'review' && (
        <div className="ai-inline-review-actions" role="toolbar" aria-label="审阅 AI 修改">
          <button type="button" className="ai-inline-undo" onClick={onCancel}>
            <Undo2 size={14} />
            <span>撤销</span>
          </button>
          <button type="button" className="ai-inline-accept" onClick={onAccept}>
            <Check size={14} />
            <span>接受</span>
          </button>
        </div>
      )}
    </BubbleMenu>
  )
}
