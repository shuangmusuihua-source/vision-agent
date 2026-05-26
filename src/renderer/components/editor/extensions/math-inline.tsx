import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import katex from 'katex'
import React from 'react'

const MathInlineComponent: React.FC<{ node: { attrs: { latex: string } }; updateAttributes: (attrs: Record<string, string>) => void }> = ({ node }) => {
  let html = ''
  try {
    html = katex.renderToString(node.attrs.latex || '', { displayMode: false, throwOnError: false })
  } catch {
    html = `<span class="math-error">${node.attrs.latex}</span>`
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

  renderHTML({ HTMLAttributes }) {
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
      if (idx === -1) return
      if (src[idx + 1] === '$') return
      return idx
    },
    tokenize(src: string) {
      const match = src.match(/^\$([^\$\n]+?)\$/)
      if (match) {
        return { type: 'mathInline', raw: match[0], text: match[1] }
      }
      return undefined
    },
  },
})
