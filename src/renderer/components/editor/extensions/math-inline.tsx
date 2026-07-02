import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import katex from 'katex'
import React from 'react'

const MathInlineComponent: React.FC<{ node: { attrs: Record<string, unknown> } }> = ({ node }) => {
  const latex = (node.attrs.latex as string) || ''
  let html = ''
  try {
    html = katex.renderToString(latex, { displayMode: false, throwOnError: false })
  } catch {
    html = `<span class="math-error">${latex}</span>`
  }
  return (
    <NodeViewWrapper as="span" className="math-inline" data-type="math-inline">
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </NodeViewWrapper>
  )
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }]
  },

  renderHTML() {
    return [
      'span',
      mergeAttributes({ 'data-type': 'math-inline', class: 'math-inline' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineComponent)
  },

  renderMarkdown(node) {
    return `$${node.attrs?.latex || ''}$`
  },

  parseMarkdown(token, helpers) {
    const raw = token.raw || ''
    const match = raw.match(/^\$([^\$]+)\$/)
    if (!match) return null as any
    return helpers.createNode('mathInline', { latex: match[1] })
  },

  markdownTokenizer: {
    name: 'mathInline',
    level: 'inline' as const,
    start(src: string) {
      const idx = src.indexOf('$')
      if (idx === -1) return -1
      if (src[idx + 1] === '$') return -1
      return idx
    },
    tokenize(src: string) {
      const match = src.match(/^\$([^\$\n]+?)\$/)
      if (match) {
        return { type: 'mathInline', raw: match[0], text: match[1] }
      }
    },
  },
})
