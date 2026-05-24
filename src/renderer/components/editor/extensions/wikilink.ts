import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Suggestion } from '@tiptap/suggestion'
import type { SuggestionOptions } from '@tiptap/suggestion'

export const WikilinkPluginKey = new PluginKey('wikilink')
export const WikilinkSuggestionKey = new PluginKey('wikilinkSuggestion')

export interface WikilinkOptions {
  HTMLAttributes: Record<string, string>
  onOpen: (target: string) => void
  suggestion: Omit<SuggestionOptions, 'editor'>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      setWikilink: (attributes: { target: string }) => ReturnType
    }
  }
}

export const Wikilink = Node.create<WikilinkOptions>({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onOpen: () => {},
      suggestion: {
        char: '[',
        allowToIncludeChar: true,
        allowedPrefixes: null,
        pluginKey: WikilinkSuggestionKey,
        items: () => [],
        render: () => ({})
      } as Omit<SuggestionOptions, 'editor'>
    }
  },

  addAttributes() {
    return {
      target: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-target'),
        renderHTML: (attributes) => {
          if (!attributes.target) return {}
          return { 'data-target': attributes.target }
        }
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="wikilink"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-type': 'wikilink', class: 'wikilink' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `[[${HTMLAttributes['data-target'] || ''}]]`
    ]
  },

  renderMarkdown(node, helpers, context) {
    return `[[${node.attrs?.target || ''}]]`
  },

  parseMarkdown(token, helpers) {
    const match = token.raw?.match(/^\[\[([^\]]+)\]\]/)
    if (!match) return null as any
    return helpers.createNode('wikilink', { target: match[1] })
  },

  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start(src: string) {
      return src.indexOf('[[')
    },
    tokenize(src: string, tokens, helpers) {
      const match = src.match(/^\[\[([^\]]+)\]\]/)
      if (match) {
        return { type: 'wikilink', raw: match[0], text: match[1] }
      }
      return undefined
    }
  },

  addCommands() {
    return {
      setWikilink:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes
          })
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-]': ({ editor }) => {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to)
        if (text) {
          editor.chain().focus().deleteSelection().setWikilink({ target: text }).run()
          return true
        }
        return false
      }
    }
  },

  addProseMirrorPlugins() {
    const onOpen = this.options.onOpen

    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion
      }),
      new Plugin({
        key: WikilinkPluginKey,
        props: {
          handleClick(view, _pos, event) {
            const target = (event.target as HTMLElement).closest('.wikilink')
            if (target) {
              const linkTarget = target.getAttribute('data-target')
              if (linkTarget) {
                onOpen(linkTarget)
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