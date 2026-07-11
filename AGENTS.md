# AGENTS.md

This is the canonical development guide for the repository. Keep it aligned with the code; do not copy architecture descriptions into another root-level guide.

## Product

`sumi` is a macOS Electron workspace for AI-assisted research and document work. It combines Markdown editing, isolated workspace sessions, Claude Agent SDK execution, a knowledge graph, scheduled tasks, attachments, and built-in/community Skills.

## Commands

- `npm run dev` — Electron development mode with renderer HMR
- `npm run build` — production bundles for main, preload, and renderer
- `npm run preview` — preview the production renderer
- `npm test` / `npm run test:watch` — Vitest tests in `tests/**/*.test.ts`
- `npm run pack` — unpacked `.app` plus packaged-Skill verification
- `npm run dist` — DMG/ZIP plus packaged-Skill verification
- `npm run release` — publish through electron-builder
- `npm run postinstall` — install Electron native dependencies

Before handing off a code change, run tests and a production build in proportion to risk. Packaging changes should also run `npm run pack`.

## Runtime architecture

Electron uses two OS process roles plus a preload isolation boundary:

- Main process: `src/main/`
- Renderer process: `src/renderer/`
- Preload bridge in the renderer's isolated context: `src/preload/index.ts`
- Cross-process contracts: `src/shared/`

The BrowserWindow uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`. Renderer code must access privileged operations only through `window.api`.

See `docs/architecture.md` for the current module map and `docs/session-runtime-architecture.md` for session routing invariants.

### Main process

- `index.ts` — boot, BrowserWindow, Sentry, updater, indexing, Skill initialization, persisted cron restoration
- `ipc-handlers.ts` — top-level IPC registration; concrete handlers live in `handlers/`
- `query-runner.ts` — builds interactive query options and consumes the Claude SDK stream
- `session-runtime.ts` — active query lifecycle, session envelopes, permissions, AskUser, abort, batching, generation activity routing
- `pending-interactions.ts` — permission and AskUser registration, timeout, SDK cancellation, notification cleanup, resolution, and session-scoped rejection
- `generation-activity-projector.ts` — projects SDK content-block streams into session-routed live generation activity
- `agent-options.ts` — Claude SDK options, environment allowlist, CLI/native binary resolution
- `inline-rewrite-runner.ts` — ephemeral, tool-free AI rewrites for editor selections; prewarms a one-shot SDK process while the user types
- `session-store.ts` — SDK transcript listing, paging, rename, delete, and compaction filtering
- `persistence/` — electron-store adapters for profiles, settings, workspaces, and app session metadata
- `file-index-service.ts` — workspace search and knowledge graph index
- `skill-init.ts`, `builtin-skill-installer.ts`, `community-skill-installer.ts` — Skill installation and discovery
- `cron-manager.ts` — persisted scheduled tasks with a restricted tool set

Main-process code imports directly from the owning runtime module or persistence adapter; do not add pass-through facades.

### IPC

`src/shared/ipc-types.ts` is the source of truth for request/response and event payloads. Preload exposes typed methods grouped under `workspace`, `editor`, `settings`, `agent`, `memory`, `graph`, `cron`, `skills`, `attachments`, `search`, `menu`, and `update`.

New session-affecting push events must carry an `AgentSessionEnvelope`; never infer ownership from the currently visible workspace or panel.

### Renderer

- React 19, TypeScript, Zustand, no router
- `App.tsx` — application root, settings cache, theme, global providers
- `components/layout/AppShell.tsx` — main layout and feature orchestration
- `store/agent-store.ts` / `agent-store-impl.ts` — per-context and per-session agent state
- `store/session-slot-state.ts` — app/SDK session ID resolution, live/cache slot routing, mirroring, and LRU ownership
- `store/ui-slice.ts` — application UI state
- `hooks/useAgent.ts` — singleton agent IPC subscriptions and actions
- `notifications/notification-inbox.ts` — in-app notification retention, persistence, toast timing, read state, and detail selection
- `automation/automation-task-draft.ts` — automation draft transitions, schedule derivation, target construction, linked-URL policy, and task registration
- `components/editor/MarkdownEditor.tsx` — Tiptap Markdown editor, including selection-scoped AI rewrite review
- `components/chat/AssistantMarkdown.tsx` — Streamdown chat rendering with Shiki, KaTeX, GFM, and Mermaid
- `components/graph/GraphView.tsx` — `react-force-graph-2d` visualization

## Agent and session rules

- Claude Agent SDK is the execution runtime; do not reimplement the agent loop.
- App session IDs are stable UI/product identifiers. SDK session IDs are transcript handles attached after materialization.
- Workspace sessions write generated files under `<workspace>/.sumi/sessions/<hash>/`; Ask sessions use the app-data `.sumi/ask-sessions/` area.
- File access must pass the session-scoped authorization checks in `session-file-access.ts`.
- Tool approval and AskUser requests are session-routed and time out after five minutes.
- Renderer inactivity is only a notice; it must not automatically abort a healthy long-running task.

## Persistence

`electron-store` holds profiles, authorized directories, workspace records, app session metadata, theme, cron tasks, enabled/disabled Skills, and compaction IDs. Claude SDK JSONL remains the transcript source. Session working directories are the source for generated output discovery.

Do not introduce a second store for the same authority without documenting the ownership boundary.

## Editor and UI conventions

- Use CSS custom properties from `src/renderer/styles/global.css`; do not hardcode component colors.
- Global element resets must not change button foreground colors in interaction states. Button variants own their hover, active, and focus colors through the `--button-*` tokens so `currentColor` icons retain contrast.
- Theme switching uses `data-theme` on `<html>`.
- Use Lucide React icons.
- Tiptap Markdown must use `contentType: 'markdown'`, `editor.getMarkdown()`, and the named `Markdown` export from `@tiptap/markdown`.
- Preserve source-mode save ordering through `SourceSaveController`.
- AI inline rewrites are ephemeral until accepted; preview decorations must never enter Markdown autosave.
- Global asynchronous errors should remain recoverable and use the dismissible application error banner.

## File and change discipline

- Treat user worktree changes as owned by the user; do not overwrite unrelated edits.
- Prefer focused owning modules; do not introduce pass-through facades.
- Update `src/shared/ipc-types.ts`, preload, and renderer types together when changing IPC.
- Built-in Skill changes must keep `skills-manifest.json`, `builtin.ts`, resources, and packaged verification aligned. See `src/main/skills/BUILTIN-SKILL-ARCHITECTURE.md`.
- Add or update tests for session routing, persistence, path authorization, IPC contracts, or error policies when those areas change.

## Documentation policy

- `AGENTS.md` is the canonical development guide.
- `README.md` describes the product and setup.
- `docs/architecture.md` and `docs/session-runtime-architecture.md` describe current implementation.
- Do not commit point-in-time audit reports or copied SDK manuals as current documentation. Put durable decisions into the canonical documents and rely on Git history for obsolete plans.
