# Editor Roadmap

Remaining improvements for the markdown editor, roughly ordered by impact.

## Completed
- ~~**Dark mode polish**~~ — Code blocks, inline code, blockquotes, tables, highlights, heading anchors all tuned for dark theme.
- ~~**Content max-width + centering**~~ — 800px max-width, centered layout.
- ~~**Typography polish**~~ — CSS variables for fonts, sizes, spacing, heading hierarchy.
- ~~**Code block enhancement**~~ — Language label badge + copy button on hover.
- ~~**Cmd+S save**~~ — Inline save shortcut + menu item.
- ~~**Word count / status bar**~~ — Words and characters in bottom bar.
- ~~**Source mode**~~ — Cmd+/ toggle, monospace textarea.
- ~~**Focus/typewriter mode**~~ — Cmd+\ toggle, dims non-active paragraphs.
- ~~**Heading anchors**~~ — Hover `#` link on headings.
- ~~**Image paste**~~ — Clipboard image paste as data URL.

## High Priority
- **Search/Replace** — In-editor find and replace (not cross-file). Typora-style Cmd+F/Cmd+H overlay.
- **TOC outline** — Extract headings into a sidebar/outline view. Click to scroll. Sync highlight on scroll.

## Medium Priority
- **KaTeX math rendering** — `$inline$` and `$$block$$` syntax. Use `@tiptap/extension-mathematics` or custom node.
- **Mermaid diagrams** — Render ```mermaid code blocks as diagrams. Lazy-load mermaid.js.
- **YAML frontmatter** — Parse and display `---` blocks at doc start. Editable form or raw view.
- **Theme system** — CSS variables already in place. Allow loading custom `.css` theme files from workspace. Settings UI for built-in themes.

## Lower Priority
- **Export** — PDF and HTML export. Use browser print-to-PDF or dedicated renderer.
- **Drag-and-drop reorder** — Paragraphs and list items via drag handles.
- **Image drag-and-drop** — Drop image files from Finder into editor. Resize handles on images.
