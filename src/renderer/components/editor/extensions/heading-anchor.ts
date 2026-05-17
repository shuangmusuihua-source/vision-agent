import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const HeadingAnchor = Extension.create({
  name: 'headingAnchor',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingAnchor'),
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'heading') {
                const text = node.textContent.trim()
                const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9一-鿿-]/g, '')
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    id,
                    class: 'heading-with-anchor'
                  })
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          }
        }
      })
    ]
  }
})