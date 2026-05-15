import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Highlight } from '@tiptap/extension-highlight'
import { Typography } from '@tiptap/extension-typography'
import { common, createLowlight } from 'lowlight'
import { useEffect, useCallback, useRef, useState } from 'react'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import { Wikilink } from './extensions/wikilink'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

const lowlight = createLowlight(common)

interface MarkdownFile {
  label: string
  path: string
}

interface MarkdownEditorProps {
  content: string
  filePath: string
  workspacePath: string | null
  onOpenFile: (filePath: string) => void
  onSave: (filePath: string, content: string) => void
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

function MarkdownEditor({ content, filePath, workspacePath, onOpenFile, onSave }: MarkdownEditorProps): React.ReactElement {
  const [markdownFiles, setMarkdownFiles] = useState<MarkdownFile[]>([])
  const filesRef = useRef<MarkdownFile[]>([])

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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false
      }),
      CodeBlockLowlight.configure({
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
    content,
    editorProps: {
      attributes: {
        class: 'markdown-editor'
      }
    }
  })

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (editor && filePath) {
          onSave(filePath, editor.getHTML())
        }
      }
    },
    [editor, filePath, onSave]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!editor) {
    return <div className="editor-loading">Loading editor...</div>
  }

  return (
    <div className="editor-wrapper">
      <EditorContent editor={editor} />
    </div>
  )
}

export default MarkdownEditor