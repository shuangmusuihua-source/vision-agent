import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import yaml from 'js-yaml'

export const FrontmatterPluginKey = new PluginKey('frontmatter')

export interface FrontmatterOptions {
  HTMLAttributes: Record<string, string>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    frontmatter: {
      setFrontmatter: (attributes: { content: string }) => ReturnType
      removeFrontmatter: () => ReturnType
    }
  }
}

export const Frontmatter = Node.create<FrontmatterOptions>({
  name: 'frontmatter',
  group: 'block',
  atom: true,
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {}
    }
  },

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-frontmatter') || '',
        renderHTML: (attributes) => {
          if (!attributes.content) return {}
          return { 'data-frontmatter': attributes.content }
        }
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="frontmatter"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'frontmatter', class: 'frontmatter-block' },
        this.options.HTMLAttributes,
        HTMLAttributes
      )
    ]
  },

  addCommands() {
    return {
      setFrontmatter:
        (attributes) =>
        ({ commands, state }) => {
          const existing = state.doc.firstChild
          if (existing?.type.name === this.name) {
            return commands.updateAttributes(this.name, attributes)
          }
          return commands.insertContentAt(0, {
            type: this.name,
            attrs: attributes
          })
        },
      removeFrontmatter:
        () =>
        ({ commands, state }) => {
          const first = state.doc.firstChild
          if (first?.type.name === this.name) {
            return commands.deleteRange({ from: 0, to: first.nodeSize })
          }
          return false
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { empty, $anchor } = editor.state.selection
        if (!empty) return false
        // Only delete entire frontmatter when cursor is at the very start of the node
        if ($anchor.parentOffset !== 0) return false
        const parent = $anchor.parent
        if (parent.type.name !== this.name) return false
        // Only trigger if cursor is at doc position 0 (start of frontmatter node)
        if ($anchor.pos !== 1) return false
        return editor.commands.removeFrontmatter()
      }
    }
  },

  addNodeView() {
    return ({ node }) => {
      const container = document.createElement('div')
      container.className = 'frontmatter-block'
      container.setAttribute('data-type', 'frontmatter')

      const header = document.createElement('div')
      header.className = 'frontmatter-header'

      const label = document.createElement('span')
      label.className = 'frontmatter-label'
      label.textContent = 'YAML'

      const toggle = document.createElement('button')
      toggle.className = 'frontmatter-toggle'
      toggle.textContent = '▾'

      header.appendChild(label)
      header.appendChild(toggle)

      const body = document.createElement('div')
      body.className = 'frontmatter-body'

      let collapsed = false

      const renderBody = () => {
        body.innerHTML = ''
        const raw = (node.attrs.content as string) || ''
        if (!raw) return

        try {
          const parsed = yaml.load(raw) as Record<string, unknown> | null
          if (parsed && typeof parsed === 'object') {
            const table = document.createElement('table')
            table.className = 'frontmatter-table'
            for (const [key, value] of Object.entries(parsed)) {
              const row = document.createElement('tr')
              const keyCell = document.createElement('td')
              keyCell.className = 'frontmatter-key'
              keyCell.textContent = key
              const valCell = document.createElement('td')
              valCell.className = 'frontmatter-value'
              valCell.textContent = String(value ?? '')
              row.appendChild(keyCell)
              row.appendChild(valCell)
              table.appendChild(row)
            }
            body.appendChild(table)
          }
        } catch {
          const pre = document.createElement('pre')
          pre.className = 'frontmatter-raw'
          pre.textContent = raw
          body.appendChild(pre)
        }
      }

      renderBody()

      toggle.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        collapsed = !collapsed
        body.style.display = collapsed ? 'none' : ''
        toggle.textContent = collapsed ? '▸' : '▾'
      })

      container.appendChild(header)
      container.appendChild(body)

      return {
        dom: container,
        contentDOM: undefined,
        update(newNode) {
          if (newNode.type.name !== 'frontmatter') return false
          node = newNode
          renderBody()
          return true
        }
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: FrontmatterPluginKey,
        props: {
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement
            const toggle = target.closest('.frontmatter-toggle')
            if (toggle) return true
            return false
          }
        }
      })
    ]
  }
})
