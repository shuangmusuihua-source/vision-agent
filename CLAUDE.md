# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

- **Dev**: `npm run dev` (electron-vite dev with HMR)
- **Build**: `npm run build` (electron-vite build)
- **Preview**: `npm run preview` (preview production build)
- **Pack**: `npm run pack` (electron-builder --dir, no installer)
- **Dist**: `npm run dist` (electron-builder, creates DMG)
- **Postinstall**: `npm run postinstall` (electron-builder install-app-deps)

No test framework is configured.

## Architecture

Electron three-process app: Main, Preload, Renderer.

### Main Process (`src/main/`)
- `index.ts` — Electron entry. Creates BrowserWindow (hiddenInset title bar, sandbox:false), registers IPC and menu.
- `agent-manager.ts` — Core agent logic. Uses `@anthropic-ai/claude-agent-sdk` to spawn Claude CLI subprocesses. Manages sessions, permissions (5-min timeout), hooks (audit logging), and streams messages to renderer. `buildOptions()` reads from store to construct SDK Options (model, apiKey, allowedTools, permissionMode, env, skills, systemPrompt).
- `ipc-handlers.ts` — All `ipcMain.handle()` registrations. Also contains `buildGraphData()` (wikilink graph) and `search:query` (brute-force file search).
- `store.ts` — `electron-store` for persistent settings (profiles, directories, theme). Schema: `AppSettings`.
- `cron-manager.ts` — `node-cron` scheduled tasks. Tasks stored in-memory Map (lost on restart). Runs agent queries with `permissionMode: 'acceptEdits'`.
- `notification-manager.ts` — System notifications for agent/cron completion and permission timeout.
- `menu.ts` — macOS menu bar. Shortcuts: Cmd+B (sidebar), Cmd+Shift+B (agent panel), Cmd+Shift+F (search), Cmd+/ (source mode), Cmd+\ (focus mode), Cmd+S (save).

### Preload (`src/preload/index.ts`)
- `contextBridge.exposeInMainWorld('api', api)` — Exposes namespaced API to renderer.
- Namespaces: `workspace`, `settings`, `agent`, `memory`, `graph`, `cron`, `skills`, `search`, `menu`.
- Event channels use `ipcRenderer.on()` with cleanup return functions.
- Types mirrored in `src/renderer/lib/ipc.ts` on the `Window.api` interface.

### Renderer (`src/renderer/`)
- React 19 + TypeScript. No router — single-page layout.
- `App.tsx` — Root. Theme management (light/dark/system via `data-theme` attribute).
- `AppShell.tsx` — Main layout orchestrator. Three-column: Sidebar + Editor + AgentPanel. Manages workspace paths, file tabs, editor-agent linking, search, graph view. Local state (not Zustand) for tabs, sidebar collapse, workspaces.
- **State**: Zustand store at `store/agent-store.ts` (types) + `agent-store-impl.ts` (impl). Shape: messages, isStreaming, currentSessionId, agentStatus, usageInfo, permissionRequest, sessionList, lastEditedFile. Hook: `useAgent()` at `hooks/useAgent.ts` subscribes to IPC events and dispatches store updates.
- **Editor**: Tiptap with `@tiptap/markdown` (breaks:true for GFM line breaks). Custom extensions in `components/editor/extensions/`: Wikilink (`[[link]]`), CodeBlockEnhanced (language label + copy), FocusMode (dims non-active paragraphs), HeadingAnchor (hover # links), ImagePaste (clipboard images). Supports source mode (Cmd+/), focus mode (Cmd+\), auto-save (1.5s debounce), Cmd+S, context menu (Explain/Edit/Review/Ask agent).
- **Graph**: D3.js force-directed layout from wikilink parsing. `GraphView.tsx`.
- **CSS**: Vanilla CSS with custom properties. No framework. Files: `global.css` (variables, theme), `layout.css`, `editor.css`, `chat.css`, `settings.css`, `graph.css`, `drawer.css`, `search.css`. Typography variables in `:root` for future theming.

### IPC Pattern
- **Request/response**: Renderer calls `window.api.namespace.method(args)` → preload `ipcRenderer.invoke('namespace:method', args)` → main `ipcMain.handle('namespace:method', handler)`.
- **Push events**: Main calls `win.webContents.send('namespace:event', data)` → preload `ipcRenderer.on('namespace:event', handler)` → renderer callback via `window.api.namespace.onEvent(callback)`.
- Key channels: `agent:message`, `agent:complete`, `agent:error`, `agent:permissionRequest`, `agent:sessionCreated`, `cron:taskCompleted`, `menu-action`.

### Agent Permission Flow
1. SDK's `canUseTool` callback fires in main process
2. Main sends `agent:permissionRequest` to renderer with tool details
3. Renderer shows PermissionDialog, user approves/denies
4. Renderer calls `window.api.agent.respondPermission(requestId, behavior)`
5. Main resolves the pending Promise, SDK continues or aborts

### Key Configuration
- Default model: `claude-sonnet-4-20250514`
- Default allowed tools (read-only): `['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']`
- Permission mode: `'default'` with custom `canUseTool` callback
- Skills: `'all'` (auto-discovered via probe query)
- System prompt preset: `'claude_code'`
- Auto-memory directory: `<workspace>/.vision/memory/`
- Memory files: Markdown in `.vision/memory/`, listed/deleted via sidebar

## Conventions

- Icons: `@phosphor-icons/react` with `weight="regular"`. Some legacy `lucide-react` icons remain.
- CSS variables for all colors and typography. Never hardcode color values in component CSS.
- Theme switching via `data-theme` attribute on `<html>`. Light/dark/system.
- File paths use `workspace:listMarkdownFiles` for `.md` discovery, `workspace:readFile`/`workspace:writeFile` for I/O.
- Agent messages use `react-markdown` + `remark-gfm` for rendering in chat.
- The `@tiptap/markdown` extension handles md↔ProseMirror conversion. Use `contentType: 'markdown'` for setContent and `editor.getMarkdown()` for serialization. Import as `{ Markdown } from '@tiptap/markdown'` (named export, not default).