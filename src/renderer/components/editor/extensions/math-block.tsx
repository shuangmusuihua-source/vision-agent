import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import katex from 'katex'
import React from 'react'

const MathBlockComponent: React.FC<{ node: { attrs: { latex: string } } }> = ({ node }) => {
  let html = ''
  try {
    html = katex.renderToString(node.attrs.latex || '', { displayMode: true, throwOnError: false })
  } catch {
    html = `<span class="math-error">${node.attrs.latex}</span>`
  }
  return (
    <NodeViewWrapper as="div" className="math-block" data-type="math-block">
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </NodeViewWrapper>
  )
}

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-type': 'math-block', class: 'math-block' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockComponent)
  },

  renderMarkdown(node) {
    return `$$\n${node.attrs?.latex || ''}\n$$`
  },

  parseMarkdown(token, helpers) {
    const raw = token.raw || ''
    const match = raw.match(/^\$\$([\s\S]+?)\$\$$/)
    if (!match) return null as any
    return helpers.createNode('mathBlock', { latex: match[1].trim() })
  },

  markdownTokenizer: {
    name: 'mathBlock',
    level: 'block' as const,
    start(src: string) {
      const idx = src.indexOf('$$')
      if (idx === -1) return
      return idx
    },
    tokenize(src: string) {
      const match = src.match(/^\$\$([\s\S]+?)\$\$/)
      if (match) {
        return { type: 'mathBlock', raw: match[0], text: match[1].trim() }
      }
      return undefined
    },
  },
})
