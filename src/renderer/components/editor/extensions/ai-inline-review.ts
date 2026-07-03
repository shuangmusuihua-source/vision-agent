import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { replacementContentForDocument } from '../inline-rewrite-selection'

export type AiInlineReviewState = {
  phase: 'pending' | 'review'
  from: number
  to: number
  replacementDoc?: JSONContent
  replacementMarkdown?: string
}

export const aiInlineReviewPluginKey = new PluginKey<AiInlineReviewState | null>('aiInlineReview')

function buildSuggestionWidget(state: AiInlineReviewState, editorState: EditorState): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'ai-inline-review-suggestion'
  wrapper.contentEditable = 'false'
  wrapper.setAttribute('aria-label', 'AI 修改建议')

  try {
    if (!state.replacementDoc) throw new Error('Missing replacement document')
    const previewContent = replacementContentForDocument(
      editorState.doc,
      state.replacementDoc,
      state.from,
      state.to,
    )
    const previewNodes = (Array.isArray(previewContent) ? previewContent : [previewContent])
      .map((node) => editorState.schema.nodeFromJSON(node))
    const rendered = DOMSerializer.fromSchema(editorState.schema)
      .serializeFragment(Fragment.fromArray(previewNodes))
    wrapper.appendChild(rendered)
  } catch {
    wrapper.textContent = state.replacementMarkdown || ''
  }

  return wrapper
}

export function setAiInlineReview(editor: Editor, state: AiInlineReviewState | null): void {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(aiInlineReviewPluginKey, state))
}

export const AiInlineReview = Extension.create({
  name: 'aiInlineReview',

  addProseMirrorPlugins() {
    return [
      new Plugin<AiInlineReviewState | null>({
        key: aiInlineReviewPluginKey,
        state: {
          init: () => null,
          apply(transaction, current) {
            const meta = transaction.getMeta(aiInlineReviewPluginKey) as AiInlineReviewState | null | undefined
            if (meta !== undefined) return meta
            if (!current || !transaction.docChanged) return current

            const from = transaction.mapping.map(current.from, 1)
            const to = transaction.mapping.map(current.to, -1)
            return from < to ? { ...current, from, to } : null
          },
        },
        props: {
          decorations(editorState) {
            const review = aiInlineReviewPluginKey.getState(editorState)
            if (!review || review.from >= review.to || review.to > editorState.doc.content.size) return null

            const decorations = [
              Decoration.inline(review.from, review.to, {
                class: review.phase === 'review'
                  ? 'ai-inline-review-original'
                  : 'ai-inline-review-target',
              }),
            ]

            if (review.phase === 'review') {
              decorations.push(Decoration.widget(
                review.to,
                () => buildSuggestionWidget(review, editorState),
                { side: 1, key: `ai-inline-review-${review.from}-${review.to}` },
              ))
            }
            return DecorationSet.create(editorState.doc, decorations)
          },
        },
      }),
    ]
  },
})
