import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const FocusMode = Extension.create({
  name: 'focusMode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('focusMode'),
        props: {
          decorations: (state) => {
            const { from } = state.selection
            const decorations: Decoration[] = []

            state.doc.descendants((node, pos) => {
              if (!node.isBlock) return false

              const containsCursor = pos <= from && pos + node.nodeSize >= from
              const isTopLevel = pos === 0 || state.doc.resolve(pos).parent === state.doc

              if (isTopLevel) {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: containsCursor ? 'focus-mode-active' : 'focus-mode-dimmed'
                  })
                )
              }
              return true
            })

            return DecorationSet.create(state.doc, decorations)
          }
        }
      })
    ]
  }
})