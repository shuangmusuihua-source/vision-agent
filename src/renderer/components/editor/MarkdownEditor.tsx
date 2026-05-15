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
import { useEffect, useCallback } from 'react'

const lowlight = createLowlight(common)

interface MarkdownEditorProps {
  content: string
  filePath: string
  onSave: (filePath: string, content: string) => void
}

function MarkdownEditor({ content, filePath, onSave }: MarkdownEditorProps): React.ReactElement {
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
      Typography
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
