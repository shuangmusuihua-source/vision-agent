import { describe, expect, it } from 'vitest'
import { Fragment, Schema, Slice } from '@tiptap/pm/model'
import {
  captureInlineRewriteSelection,
  replacementContentForSelection,
  replacementPlanForSelection,
} from '../src/renderer/components/editor/inline-rewrite-selection'
import type { Editor, JSONContent } from '@tiptap/core'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    blockquote: { content: 'block+', group: 'block' },
    bulletList: { content: 'listItem+', group: 'block' },
    orderedList: { content: 'listItem+', group: 'block' },
    listItem: { content: 'paragraph block*' },
    text: { group: 'inline' },
  },
})

describe('inline rewrite selection helpers', () => {
  it('captures the exact range plus bounded surrounding context', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('before selected after')),
    ])
    const from = 8
    const to = 16
    const editor = {
      state: { doc, selection: { from, to, empty: false } },
      markdown: { serialize: () => '**selected**' },
    } as unknown as Editor

    expect(captureInlineRewriteSelection(editor)).toEqual({
      from,
      to,
      selectedMarkdown: '**selected**',
      beforeContext: 'before ',
      afterContext: ' after',
    })
  })

  it('bounds rewrite context to the nearby 1,200 characters', () => {
    const before = 'a'.repeat(1_500)
    const after = 'b'.repeat(1_500)
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text(`${before}selected${after}`)),
    ])
    const from = before.length + 1
    const to = from + 'selected'.length
    const editor = {
      state: { doc, selection: { from, to, empty: false } },
      markdown: { serialize: () => 'selected' },
    } as unknown as Editor

    const snapshot = captureInlineRewriteSelection(editor)
    expect(snapshot?.beforeContext).toHaveLength(1_200)
    expect(snapshot?.afterContext).toHaveLength(1_200)
  })

  it('uses inline nodes when replacing text inside one paragraph', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('original text')),
    ])
    const editor = { state: { doc } } as unknown as Editor
    const replacementDoc: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'replacement' }],
      }],
    }

    expect(replacementContentForSelection(editor, replacementDoc, 2, 6)).toEqual([
      { type: 'text', text: 'replacement' },
    ])
  })

  it('keeps block nodes when replacing a cross-paragraph selection', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('first')),
      schema.node('paragraph', null, schema.text('second')),
    ])
    const editor = { state: { doc } } as unknown as Editor
    const replacementDoc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'new first' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'new second' }] },
      ],
    }

    expect(replacementContentForSelection(editor, replacementDoc, 2, 10)).toEqual(replacementDoc.content)
  })

  it('unwraps a preserved blockquote when replacing text already inside that blockquote', () => {
    const doc = schema.node('doc', null, [
      schema.node('blockquote', null, [
        schema.node('paragraph', null, schema.text('original quote')),
      ]),
    ])
    const editor = { state: { doc } } as unknown as Editor
    const replacementDoc: JSONContent = {
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'rewritten quote' }],
        }],
      }],
    }

    expect(replacementContentForSelection(editor, replacementDoc, 3, 11)).toEqual([
      { type: 'text', text: 'rewritten quote' },
    ])
  })

  it('keeps a new block container when it does not duplicate the selection context', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('ordinary text')),
    ])
    const editor = { state: { doc } } as unknown as Editor
    const replacementDoc: JSONContent = {
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new quote' }] }],
      }],
    }

    expect(replacementContentForSelection(editor, replacementDoc, 2, 8)).toEqual(replacementDoc.content)
  })

  it('replaces sibling list items without nesting a second list', () => {
    const doc = schema.node('doc', null, [
      schema.node('bulletList', null, [
        schema.node('listItem', null, [schema.node('paragraph', null, schema.text('first item'))]),
        schema.node('listItem', null, [schema.node('paragraph', null, schema.text('second item'))]),
      ]),
    ])
    const textPositions: Array<{ pos: number; size: number }> = []
    doc.descendants((node, pos) => {
      if (node.isText) textPositions.push({ pos, size: node.nodeSize })
    })
    const selectedFrom = textPositions[0].pos
    const selectedTo = textPositions[1].pos + textPositions[1].size
    const editor = {
      state: { doc, selection: { from: selectedFrom, to: selectedTo, empty: false } },
      markdown: { serialize: () => '- first item\n- second item' },
    } as unknown as Editor

    const snapshot = captureInlineRewriteSelection(editor)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.from).toBe(doc.resolve(selectedFrom).before(2))
    expect(snapshot?.to).toBe(doc.resolve(selectedTo).after(2))

    const replacementDoc: JSONContent = {
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new first' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new second' }] }] },
        ],
      }],
    }
    const plan = replacementPlanForSelection(
      editor,
      replacementDoc,
      snapshot!.from,
      snapshot!.to,
    )

    expect(Array.isArray(plan.content) && plan.content.map((node) => node.type)).toEqual([
      'listItem',
      'listItem',
    ])
    expect(Array.isArray(plan.previewContent) && plan.previewContent[0].type).toBe('bulletList')

    const replacementNodes = (plan.content as JSONContent[]).map((node) => schema.nodeFromJSON(node))
    const replaced = doc.replace(
      plan.from,
      plan.to,
      new Slice(Fragment.fromArray(replacementNodes), 0, 0),
    )
    const resultingList = replaced.toJSON().content[0]
    expect(resultingList.type).toBe('bulletList')
    expect(resultingList.content.map((node: JSONContent) => node.type)).toEqual(['listItem', 'listItem'])
    expect(resultingList.content[0].content[0].content[0].text).toBe('new first')
  })
})
