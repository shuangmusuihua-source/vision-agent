import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export type InlineRewriteSelectionSnapshot = {
  from: number
  to: number
  selectedMarkdown: string
  beforeContext: string
  afterContext: string
}

export type InlineRewriteReplacementPlan = {
  from: number
  to: number
  content: JSONContent | JSONContent[]
  previewAt: number
  previewContent: JSONContent | JSONContent[]
}

const CONTEXT_CHARACTER_LIMIT = 1_200

function ancestorDepth(position: ReturnType<ProseMirrorNode['resolve']>, nodeType: string): number | null {
  for (let depth = position.depth; depth > 0; depth -= 1) {
    if (position.node(depth).type.name === nodeType) return depth
  }
  return null
}

function normalizeListSelection(document: ProseMirrorNode, from: number, to: number): { from: number; to: number } {
  const resolvedFrom = document.resolve(from)
  const resolvedTo = document.resolve(to)
  const fromItemDepth = ancestorDepth(resolvedFrom, 'listItem')
  const toItemDepth = ancestorDepth(resolvedTo, 'listItem')
  if (fromItemDepth === null || toItemDepth === null) return { from, to }

  const fromListDepth = fromItemDepth - 1
  const toListDepth = toItemDepth - 1
  const sharesList = fromListDepth === toListDepth
    && resolvedFrom.node(fromListDepth) === resolvedTo.node(toListDepth)
  if (!sharesList) return { from, to }

  const staysInsideOneTextblock = resolvedFrom.sameParent(resolvedTo) && resolvedFrom.parent.isTextblock
  if (staysInsideOneTextblock) return { from, to }

  return {
    from: resolvedFrom.before(fromItemDepth),
    to: resolvedTo.after(toItemDepth),
  }
}

export function captureInlineRewriteSelection(editor: Editor): InlineRewriteSelectionSnapshot | null {
  const { from: selectedFrom, to: selectedTo, empty } = editor.state.selection
  if (empty || selectedFrom >= selectedTo) return null

  const { from, to } = normalizeListSelection(editor.state.doc, selectedFrom, selectedTo)

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
  return replacementPlanForDocument(editor.state.doc, replacementDoc, from, to).content
}

export function replacementPlanForSelection(
  editor: Editor,
  replacementDoc: JSONContent,
  from: number,
  to: number,
): InlineRewriteReplacementPlan {
  return replacementPlanForDocument(editor.state.doc, replacementDoc, from, to)
}

export function replacementContentForDocument(
  document: ProseMirrorNode,
  replacementDoc: JSONContent,
  from: number,
  to: number,
): JSONContent | JSONContent[] {
  return replacementPlanForDocument(document, replacementDoc, from, to).content
}

export function replacementPlanForDocument(
  document: ProseMirrorNode,
  replacementDoc: JSONContent,
  from: number,
  to: number,
): InlineRewriteReplacementPlan {
  const content = replacementDoc.content || []
  const resolvedFrom = document.resolve(from)
  const resolvedTo = document.resolve(to)
  const isInlineSelection = resolvedFrom.sameParent(resolvedTo) && resolvedFrom.parent.isTextblock

  const defaultPlan: InlineRewriteReplacementPlan = {
    from,
    to,
    content,
    previewAt: to,
    previewContent: content,
  }

  if (content.length !== 1) return defaultPlan

  const candidate = content[0]
  const replacesContentsOfExistingContainer = resolvedFrom.sameParent(resolvedTo)
    && !resolvedFrom.parent.isTextblock
    && resolvedFrom.depth > 0
    && candidate.type === resolvedFrom.parent.type.name

  if (replacesContentsOfExistingContainer) {
    return {
      from,
      to,
      content: candidate.content || [],
      previewAt: resolvedTo.after(resolvedTo.depth),
      previewContent: [candidate],
    }
  }

  if (!isInlineSelection) return defaultPlan

  // A text selection inside a container (for example blockquote > paragraph)
  // serializes with that complete container chain. If the model preserves the
  // Markdown structure, inserting the chain again would create nested quotes or
  // lists. Peel only the chain that already exists around the selected text.
  let nestedCandidate = candidate
  if (nestedCandidate.type === resolvedFrom.parent.type.name) {
    const inlineContent = nestedCandidate.content || []
    return { ...defaultPlan, content: inlineContent, previewContent: inlineContent }
  }

  for (let depth = 1; depth <= resolvedFrom.depth; depth += 1) {
    if (nestedCandidate.type !== resolvedFrom.node(depth).type.name) return defaultPlan
    if (depth === resolvedFrom.depth) {
      const inlineContent = nestedCandidate.content || []
      return { ...defaultPlan, content: inlineContent, previewContent: inlineContent }
    }
    if (nestedCandidate.content?.length !== 1) return defaultPlan
    nestedCandidate = nestedCandidate.content[0]
  }

  return defaultPlan
}
