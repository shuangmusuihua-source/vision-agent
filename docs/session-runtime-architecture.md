# Session Runtime Architecture

## Goal

The product has two session entry points:

- Ask sumi: one app-level general assistant session.
- Workspace sessions: many sessions under many user-created workspaces.

All sessions must be isolated and may run concurrently. A background session's
messages, permission requests, AskUser questions, skill output, artifacts, and
completion state must return to that same session, even when the visible UI has
switched to another workspace or session.

## SDK Primitives We Use

Claude Agent SDK remains the agent runtime. The app should not reimplement the
agent loop.

- `query()` runs the agent and streams SDK messages.
- `resume` resumes a concrete SDK session.
- `cwd` / `dir` binds SDK session storage to a workspace/app directory.
- `canUseTool` handles tool approval and `AskUserQuestion`.
- `hooks.PostToolUse` records generated file artifacts after successful tool use.
- `listSessions()`, `getSessionMessages()`, `renameSession()`, `deleteSession()`,
  and `forkSession()` remain the source for SDK transcript operations.
- A future `SessionStore` adapter can mirror SDK transcripts to external storage,
  but it does not replace app-owned product metadata.

## App-Owned Control Plane

The SDK owns execution; the app owns product routing.

### Session Identity

Every live event must carry an `AgentSessionEnvelope`:

```ts
type AgentSessionEnvelope = {
  context: 'editor' | 'ask'
  sessionId: string
  clientSessionKey: string
  sdkSessionId?: string
  workspacePath: string
}
```

- `sessionId` / `clientSessionKey` is the app-owned stable key used by UI slots.
- `sdkSessionId` is the Claude SDK transcript handle used for resume/history.
- `workspacePath` is the owner directory for file I/O and session history lookup.
- Events must be routed by app session id first, never by visible context alone.

### SessionRuntimeController

`src/main/session-runtime.ts` is the main-process runtime control plane.

It owns:

- active SDK query handles keyed by app session id
- AbortController lifecycle
- SDK session materialization into the app envelope
- SDK-message-to-IPC routing with mandatory session envelope
- text-delta batching, flush, and cleanup
- skill-output bridge lifecycle
- session-scoped abort and pending permission cleanup

It does not own:

- model/tool option construction
- renderer UI state
- persisted session records
- artifact persistence

The controller intentionally owns SDK message conversion at the routing seam:
raw SDK events enter once, then the controller fans them out to skill output,
batched text deltas, and `agent:event`. This keeps ordering and envelope
attachment in one module.

### Event Protocol

The following main-to-renderer event families must include the envelope:

- `agent:event`
- `agent:sessionCreated`
- `agent:permissionRequest`
- `agent:permissionTimeout`
- `agent:askUser`
- `agent:askUserTimeout`
- `agent:notification`
- `skill:output`

If a new event affects a session, it must be emitted through the runtime
controller or use `withSessionEnvelope()` before crossing IPC.

## Persistence Boundaries

- `workspace-store.ts`: app session metadata, workspace ownership, titles, counts.
- `session-store.ts`: SDK transcript listing/history/mutation, always dir-scoped
  when the owning workspace is known.
- `artifact-store.ts`: app-owned session artifact registry keyed by app session id.
- `query-runner.ts`: builds SDK options and runs `query()`, but does not own live
  session routing state.

## Invariants

1. A session belongs to exactly one workspace/app directory for its lifetime.
2. App session id is stable; SDK session id is metadata attached after
   materialization.
3. Background events never mutate the visible slot unless that session is visible.
4. Permission and AskUser pending promises are registered by app session id.
5. Artifacts are recorded by app session id and normalized against the owning
   workspace path.
6. Aborting by app session id or SDK session id resolves to the same active run.
7. Text-delta batching must preserve the same envelope as non-text SDK events.

## Extension Rule

When adding a new feature, first decide which layer owns it:

- SDK execution feature: use an SDK option, hook, custom tool, or SessionStore.
- Product routing feature: add to `SessionRuntimeController` / envelope protocol.
- Durable product metadata: add to the matching persistence adapter.
- Renderer presentation only: consume already-routed session data; do not infer
  session ownership from the currently visible UI.
