import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
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
      })
    ],
    content,
    editorProps: {
      attributes: {
        class: 'markdown-editor'
      }
    }
  })

  // Update editor content when a new file is opened
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  // Cmd+S save handler
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