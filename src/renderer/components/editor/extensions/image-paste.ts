import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const ImagePaste = Extension.create({
  name: 'imagePaste',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
          handlePaste: (view, event) => {
            const items = event.clipboardData?.items
            if (!items) return false

            for (let i = 0; i < items.length; i++) {
              const item = items[i]
              if (item.type.startsWith('image/')) {
                const file = item.getAsFile()
                if (!file) continue

                const reader = new FileReader()
                reader.onload = () => {
                  const dataUrl = reader.result as string
                  view.dispatch(
                    view.state.tr.replaceSelectionWith(
                      view.state.schema.nodes.image?.create({ src: dataUrl })
                    )
                  )
                }
                reader.readAsDataURL(file)
                return true
              }
            }
            return false
          }
        }
      })
    ]
  }
})