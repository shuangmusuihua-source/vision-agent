import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

interface ImagePasteOptions {
  getDocumentIdentity: () => string
  saveImage: (file: File) => Promise<{ success: boolean; relativePath?: string; error?: string }>
}

export const ImagePaste = Extension.create<ImagePasteOptions>({
  name: 'imagePaste',

  addOptions() {
    return {
      getDocumentIdentity: () => '',
      saveImage: async () => ({ success: false, error: 'Image storage is not configured' }),
    }
  },

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

                const documentIdentity = this.options.getDocumentIdentity()
                void this.options.saveImage(file).then((result) => {
                  if (!result.success || !result.relativePath) {
                    console.error('[ImagePaste] failed to store pasted image:', result.error || 'unknown error')
                    return
                  }
                  if (this.options.getDocumentIdentity() !== documentIdentity) return
                  view.dispatch(
                    view.state.tr.replaceSelectionWith(
                      view.state.schema.nodes.image?.create({ src: result.relativePath })
                    )
                  )
                }).catch((error) => {
                  console.error('[ImagePaste] failed to store pasted image:', error)
                })
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
