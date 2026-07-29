# Domain language

## Workspace

A user-authorized directory that groups documents, editor sessions, generated
outputs, and automation targets. A workspace path is stable for the lifetime of
every session that belongs to it.

## Workspace lifecycle

The coordinated creation, ordering, and deletion of a Workspace. Deletion stops
workspace-owned execution, pauses future automation, moves the directory to the
Trash, and removes application-owned session metadata and authorization state.
The Main process is the authority for lifecycle results; the Renderer projects
those results into visible state.

## Workspace session

An app-owned session whose stable app session ID is associated with exactly one
Workspace path. Its workspace ownership never changes after creation.

## Workspace session transcript

The chronological conversation history attached to a materialized Workspace
session through its SDK session ID. History pages are requested newest-first,
while messages inside each page remain in chronological order. Page cursors are
opaque Main-issued values and must never be interpreted by the Renderer.

## Workspace automation

A scheduled task targeting a Workspace, one of its Workspace sessions, or a
directory contained by it. Deleting the Workspace pauses the task rather than
silently deleting its history.
