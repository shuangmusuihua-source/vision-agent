import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Highlight } from '@tiptap/extension-highlight'
import { Typography } from '@tiptap/extension-typography'
import Placeholder from '@tiptap/extension-placeholder'
import { common, createLowlight } from 'lowlight'
import { useEffect, useCallback, useRef, useState, memo } from 'react'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import { Wikilink } from './extensions/wikilink'
import { Markdown } from '@tiptap/markdown'
import { CodeBlockEnhanced } from './extensions/code-block-enhanced'
import { FocusMode } from './extensions/focus-mode'
import { HeadingAnchor } from './extensions/heading-anchor'
import { ImagePaste } from './extensions/image-paste'
import { Frontmatter } from './extensions/frontmatter'
import Image from '@tiptap/extension-image'
import { Extension } from '@tiptap/core'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

const lowlight = createLowlight(common)

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function extractFrontmatter(md: string): { frontmatter: string; body: string } {
  const match = md.match(FRONTMATTER_RE)
  if (match) {
    return { frontmatter: match[1], body: md.slice(match[0].length) }
  }
  return { frontmatter: '', body: md }
}

function prependFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body
  return `---\n${frontmatter}\n---\n${body}`
}

function getFullMarkdown(editor: { getJSON: () => Record<string, unknown>; getMarkdown: () => string }): string {
  const doc = editor.getJSON()
  const content = doc.content as Array<Record<string, unknown>> | undefined
  let frontmatter = ''
  if (content?.[0]?.type === 'frontmatter') {
    const attrs = content[0].attrs as { content?: string } | undefined
    frontmatter = attrs?.content || ''
  }
  let bodyMd = editor.getMarkdown()
  // Strip empty placeholder — save as empty file on disk
  if (bodyMd === '\n\n' || bodyMd === '<p></p>') bodyMd = ''
  return prependFrontmatter(frontmatter, bodyMd)
}

interface MarkdownFile {
  label: string
  path: string
}

interface MarkdownEditorProps {
  content: string
  filePath: string
  workspacePath: string | null
  sourceMode: boolean
  focusMode: boolean
  onOpenFile: (filePath: string) => void
  onSave: (filePath: string, content: string) => void
  onAskAgent: (action: 'explain' | 'edit' | 'review' | 'ask', selection: string, filePath: string) => void
  onStatsUpdate: (wordCount: number, charCount: number) => void
}

function SuggestionList({ items, command, selectedIndex }: {
  items: MarkdownFile[]
  command: (item: MarkdownFile) => void
  selectedIndex: number
}) {
  if (items.length === 0) {
    return <div className="wikilink-suggestion-list wikilink-suggestion-empty">No matching files</div>
  }

  return (
    <div className="wikilink-suggestion-list">
      {items.map((item, index) => (
        <div
          key={item.path}
          className={`wikilink-suggestion-item ${index === selectedIndex ? 'wikilink-suggestion-selected' : ''}`}
          onClick={() => command(item)}
        >
          <span className="wikilink-suggestion-label">{item.label}</span>
          <span className="wikilink-suggestion-path">{item.path}</span>
        </div>
      ))}
    </div>
  )
}

function MarkdownEditor({ content, filePath, workspacePath, sourceMode, focusMode, onOpenFile, onSave, onAskAgent, onStatsUpdate }: MarkdownEditorProps): React.ReactElement {
  const [markdownFiles, setMarkdownFiles] = useState<MarkdownFile[]>([])
  const filesRef = useRef<MarkdownFile[]>([])
  const [internalSourceMode, setInternalSourceMode] = useState(sourceMode)
  const [sourceText, setSourceText] = useState('')
  const frontmatterRef = useRef('')
  const isLocalChange = useRef(false)

  // Normalize markdown for comparison: strip trailing whitespace
  const normalizeMd = (md: string) => md.replace(/\n+$/, '')

  useEffect(() => {
    if (!workspacePath) {
      setMarkdownFiles([])
      filesRef.current = []
      return
    }
    window.api.workspace.listMarkdownFiles(workspacePath).then((files) => {
      setMarkdownFiles(files)
      filesRef.current = files
    }).catch(() => {
      setMarkdownFiles([])
      filesRef.current = []
    })
  }, [workspacePath])

  const isMemoryFile = filePath.includes('.vision/memory/')

  const editor = useEditor({
    editable: !isMemoryFile,
    extensions: [      StarterKit.configure({
        codeBlock: false
      }),
      CodeBlockEnhanced.configure({
        lowlight
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Table.configure({
        resizable: true
      }),
      TableRow,
      TableCell,
      TableHeader,
      Highlight,
      Typography,
      Markdown.configure({
        markedOptions: { breaks: true }
      }),
      FocusMode,
      HeadingAnchor,
      Image,
      ImagePaste,
      Frontmatter,
      Placeholder.configure({
        placeholder: '开始输入...'
      }),
      Extension.create({
        name: 'saveShortcut',
        addKeyboardShortcuts() {
          return {
            'Mod-s': () => {
              const md = getFullMarkdown(this.editor)
              onSave(filePath, md)
              return true
            }
          }
        }
      }),
      Wikilink.configure({
        onOpen: (target: string) => {
          const match = filesRef.current.find(
            (f) => f.label === target || f.label === target.replace(/\.md$/, '')
          )
          if (match) {
            onOpenFile(match.path)
          }
        },
        suggestion: {
          char: '[',
          allowToIncludeChar: true,
          allowedPrefixes: null as unknown as string[],
          items: ({ query }) => {
            const files = filesRef.current
            const q = query.toLowerCase().replace(/^\[+/, '')
            if (!q) return files.slice(0, 10)
            return files.filter((f) => f.label.toLowerCase().includes(q)).slice(0, 10)
          },
          render: () => {
            let component: ReactRenderer | null = null
            let popup: TippyInstance | null = null
            let selectedIndex = 0

            return {
              onStart: (props: SuggestionProps<MarkdownFile>) => {
                selectedIndex = 0
                component = new ReactRenderer(SuggestionList, {
                  props: { items: props.items, command: props.command, selectedIndex },
                  editor: props.editor
                })

                if (!props.clientRect) return

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start'
                })[0]
              },

              onUpdate(props: SuggestionProps<MarkdownFile>) {
                component?.updateProps({ items: props.items, command: props.command, selectedIndex })
                if (props.clientRect) {
                  popup?.setProps({
                    getReferenceClientRect: props.clientRect as () => DOMRect
                  })
                }
              },

              onKeyDown(props: SuggestionKeyDownProps) {
                const itemCount = component?.props?.items?.length || 0
                if (props.event.key === 'ArrowUp') {
                  selectedIndex = (selectedIndex + itemCount - 1) % (itemCount || 1)
                  component?.updateProps({ selectedIndex })
                  return true
                }
                if (props.event.key === 'ArrowDown') {
                  selectedIndex = (selectedIndex + 1) % (itemCount || 1)
                  component?.updateProps({ selectedIndex })
                  return true
                }
                if (props.event.key === 'Enter') {
                  const items = component?.props?.items as MarkdownFile[] | undefined
                  if (items?.[selectedIndex]) {
                    ;(component?.props?.command as (item: MarkdownFile) => void)(items[selectedIndex])
                  }
                  return true
                }
                return false
              },

              onExit() {
                popup?.destroy()
                component?.destroy()
                popup = null
                component = null
              }
            }
          },
          command: ({ editor, range, props: item }) => {
            if (item) {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .setWikilink({ target: (item as MarkdownFile).label })
                .run()
            } else {
              editor.chain().focus().deleteRange(range).run()
            }
          }
        }
      })
    ],
    content: (() => {
      const { frontmatter, body } = extractFrontmatter(content)
      if (frontmatter) {
        frontmatterRef.current = frontmatter
        return body || '<p></p>'
      }
      return content || '<p></p>'
    })(),
    contentType: 'markdown',
    onCreate: ({ editor }) => {
      const fm = frontmatterRef.current
      if (fm) {
        editor.commands.setFrontmatter({ content: fm })
        frontmatterRef.current = ''
      }
    },
    editorProps: {
      attributes: {
        class: `markdown-editor${focusMode ? ' focus-mode' : ''}`
      },
      handleClick: (view, pos) => {
        if (!view.hasFocus()) {
          view.focus()
        }
      }
    }
  })

  // Sync source mode from parent
  useEffect(() => {
    if (sourceMode !== internalSourceMode) {
      if (!editor) return
      if (sourceMode) {
        // Entering source mode: save current full markdown to sourceText
        setSourceText(getFullMarkdown(editor))
      } else {
        // Leaving source mode: apply sourceText back to editor
        const { frontmatter, body } = extractFrontmatter(sourceText)
        editor.commands.setContent(body || '\n\n', { contentType: 'markdown', emitUpdate: false })
        if (frontmatter) {
          editor.commands.setFrontmatter({ content: frontmatter })
        } else {
          editor.commands.removeFrontmatter()
        }
      }
      setInternalSourceMode(sourceMode)
    }
  }, [sourceMode, internalSourceMode, editor, sourceText])

  useEffect(() => {
    if (!editor) return
    if (isLocalChange.current) {
      isLocalChange.current = false
      return
    }
    if (normalizeMd(content) !== normalizeMd(getFullMarkdown(editor))) {
      const { frontmatter, body } = extractFrontmatter(content)
      editor.commands.setContent(body || '\n\n', { contentType: 'markdown', emitUpdate: false })
      if (frontmatter) {
        editor.commands.setFrontmatter({ content: frontmatter })
      } else {
        editor.commands.removeFrontmatter()
      }
    }
  }, [content, editor])

  // Sync editable state when filePath changes (memory files are read-only)
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!isMemoryFile)
  }, [isMemoryFile, editor])

  // Auto-save with debounce
  useEffect(() => {
    if (!editor || !filePath || isMemoryFile) return

    const handleUpdate = () => {
      isLocalChange.current = true
      const saveTimer = setTimeout(() => {
        const md = getFullMarkdown(editor)
        onSave(filePath, md)
      }, 1500)
      return () => clearTimeout(saveTimer)
    }

    let cleanup: (() => void) | undefined
    const handler = () => {
      cleanup?.()
      cleanup = handleUpdate()
    }

    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
      cleanup?.()
    }
  }, [editor, filePath, onSave])

  useEffect(() => {
    if (!editor) return
    const updateCounts = () => {
      const text = editor.getText()
      const words = text.trim().split(/\s+/).filter(Boolean).length
      onStatsUpdate(text.trim() ? words : 0, text.length)
    }
    editor.on('update', updateCounts)
    updateCounts()
    return () => { editor.off('update', updateCounts) }
  }, [editor, onStatsUpdate])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!editor) return
      const { from, to } = editor.state.selection
      if (from === to) return

      const selectedText = editor.state.doc.textBetween(from, to)
      if (!selectedText.trim()) return

      e.preventDefault()

      const menu = document.createElement('div')
      menu.className = 'editor-context-menu'

      const items = [
        { label: 'Explain', action: 'explain' as const },
        { label: 'Edit', action: 'edit' as const },
        { label: 'Review', action: 'review' as const },
        { label: 'Ask...', action: 'ask' as const }
      ]

      for (const item of items) {
        const el = document.createElement('div')
        el.className = 'editor-context-menu-item'
        el.textContent = item.label
        el.onclick = () => {
          onAskAgent(item.action, selectedText, filePath)
          menu.remove()
        }
        menu.appendChild(el)
      }

      menu.style.left = `${e.clientX}px`
      menu.style.top = `${e.clientY}px`
      document.body.appendChild(menu)

      const removeMenu = () => {
        menu.remove()
        document.removeEventListener('click', removeMenu)
      }
      setTimeout(() => document.addEventListener('click', removeMenu), 0)
    },
    [editor, filePath, onAskAgent]
  )

  if (!editor) {
    return <div className="editor-loading">Loading editor...</div>
  }

  if (internalSourceMode && !isMemoryFile) {
    return (
      <textarea
        className="editor-source-textarea"
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
        spellCheck={false}
      />
    )
  }

  return (
    <div className="editor-wrapper" onContextMenu={handleContextMenu}>
      <EditorContent editor={editor} />
    </div>
  )
}

export default memo(MarkdownEditor, (prev, next) =>
  prev.content === next.content &&
  prev.filePath === next.filePath &&
  prev.workspacePath === next.workspacePath &&
  prev.sourceMode === next.sourceMode &&
  prev.focusMode === next.focusMode
)
