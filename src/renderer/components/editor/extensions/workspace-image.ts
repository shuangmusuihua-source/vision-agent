import Image, { type ImageOptions } from '@tiptap/extension-image'

interface ImageAssetReadResult {
  success: boolean
  mimeType?: string
  bytes?: Uint8Array
}

interface WorkspaceImageOptions extends ImageOptions {
  getDocumentPath: () => string
  loadImageAsset: (documentPath: string, relativePath: string) => Promise<ImageAssetReadResult>
}

function isBrowserImageSource(src: string): boolean {
  return /^(?:data:|blob:|https?:)/i.test(src)
}

export const WorkspaceImage = Image.extend<WorkspaceImageOptions>({
  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
      resize: false,
      ...this.parent?.(),
      getDocumentPath: () => '',
      loadImageAsset: async () => ({ success: false }),
    }
  },

  addNodeView() {
    return ({ node }) => {
      const image = document.createElement('img')
      let objectUrl: string | null = null
      let renderSequence = 0
      let renderedKey = ''

      const revokeObjectUrl = () => {
        if (!objectUrl) return
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
      }

      const applyAttributes = (attrs: Record<string, unknown>) => {
        for (const name of ['alt', 'title', 'width', 'height'] as const) {
          const value = attrs[name]
          if (value === null || value === undefined || value === '') {
            image.removeAttribute(name)
          } else {
            image.setAttribute(name, String(value))
          }
        }
      }

      const render = (attrs: Record<string, unknown>) => {
        applyAttributes(attrs)
        const src = typeof attrs.src === 'string' ? attrs.src : ''
        const documentPath = this.options.getDocumentPath()
        const nextKey = `${documentPath}\0${src}`
        if (renderedKey === nextKey) return
        renderedKey = nextKey
        renderSequence += 1
        const sequence = renderSequence
        revokeObjectUrl()
        image.removeAttribute('src')

        if (!src) return
        if (isBrowserImageSource(src)) {
          image.src = src
          return
        }

        void this.options.loadImageAsset(documentPath, src).then((result) => {
          if (sequence !== renderSequence || !result.success || !result.bytes || !result.mimeType) return
          const bytes = new Uint8Array(result.bytes.byteLength)
          bytes.set(result.bytes)
          objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.mimeType }))
          image.src = objectUrl
        }).catch(() => {})
      }

      render(node.attrs)

      return {
        dom: image,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false
          render(updatedNode.attrs)
          return true
        },
        destroy: () => {
          renderSequence += 1
          revokeObjectUrl()
        },
      }
    }
  },
})
