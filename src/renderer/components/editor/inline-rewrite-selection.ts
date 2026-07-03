import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export type InlineRewriteSelectionSnapshot = {
  from: number
  to: number
  selectedMarkdown: string
  beforeContext: string
  afterContext: string
}

const CONTEXT_CHARACTER_LIMIT = 1_200

export function captureInlineRewriteSelection(editor: Editor): InlineRewriteSelectionSnapshot | null {
  const { from, to, empty } = editor.state.selection
  if (empty || from >= to) return null

  const plainText = editor.state.doc.textBetween(from, to, '\n', '\n')
  if (!plainText.trim()) return null

  const selectionDoc = editor.state.doc.cut(from, to).toJSON() as JSONContent
  const selectedMarkdown = editor.markdown?.serialize(selectionDoc) || plainText
  const docEnd = editor.state.doc.content.size

  return {
    from,
    to,
    selectedMarkdown,
    beforeContext: editor.state.doc
      .textBetween(Math.max(0, from - CONTEXT_CHARACTER_LIMIT), from, '\n', '\n')
      .slice(-CONTEXT_CHARACTER_LIMIT),
    afterContext: editor.state.doc
      .textBetween(to, Math.min(docEnd, to + CONTEXT_CHARACTER_LIMIT), '\n', '\n')
      .slice(0, CONTEXT_CHARACTER_LIMIT),
  }
}

export function parseInlineRewriteMarkdown(editor: Editor, markdown: string): JSONContent {
  if (!editor.markdown) {
    return { type: 'doc', content: markdown ? [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }] : [] }
  }
  return editor.markdown.parse(markdown) as JSONContent
}

export function replacementContentForSelection(
  editor: Editor,
  replacementDoc: JSONContent,
  from: number,
  to: number,
): JSONContent | JSONContent[] {
  return replacementContentForDocument(editor.state.doc, replacementDoc, from, to)
}

export function replacementContentForDocument(
  document: ProseMirrorNode,
  replacementDoc: JSONContent,
  from: number,
  to: number,
): JSONContent | JSONContent[] {
  const content = replacementDoc.content || []
  const resolvedFrom = document.resolve(from)
  const resolvedTo = document.resolve(to)
  const isInlineSelection = resolvedFrom.sameParent(resolvedTo) && resolvedFrom.parent.isTextblock

  if (!isInlineSelection || content.length !== 1) return content

  // A text selection inside a container (for example blockquote > paragraph)
  // serializes with that complete container chain. If the model preserves the
  // Markdown structure, inserting the chain again would create nested quotes or
  // lists. Peel only the chain that already exists around the selected text.
  let candidate = content[0]
  if (candidate.type === resolvedFrom.parent.type.name) return candidate.content || []

  for (let depth = 1; depth <= resolvedFrom.depth; depth += 1) {
    if (candidate.type !== resolvedFrom.node(depth).type.name) return content
    if (depth === resolvedFrom.depth) return candidate.content || []
    if (candidate.content?.length !== 1) return content
    candidate = candidate.content[0]
  }

  return content
}
