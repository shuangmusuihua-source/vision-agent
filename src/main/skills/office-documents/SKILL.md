---
name: office-documents
description: Create, read, edit, inspect, render, and validate editable Microsoft Office documents with sumi's managed OfficeCLI runtime. Use for Word (.docx), Excel (.xlsx), or PowerPoint (.pptx) tasks, including modifying an existing file or template, preserving Office structure and formatting, generating charts or formulas, filling templates, checking layout, and delivering an editable Office file.
---

# Office Documents

Use `officecli` as the document engine. Keep every delivered file in the current session directory so sumi can discover it as a generated artifact.

## Runtime boundaries

- Start with `officecli --version`. If the command is unavailable, tell the user to enable “Office 文档” under Skills. Do not install it yourself.
- Never run `officecli install`, `officecli mcp`, `officecli config`, or `officecli watch`. sumi owns installation, updates, and preview lifecycle.
- Do not download document libraries or replace OfficeCLI with ad-hoc Python/Node libraries.
- Use quoted file paths. Never overwrite an input file unless the user explicitly asks. By default, copy an existing document into the session directory and edit the copy.
- Disable no safeguards and do not modify files outside the user-provided input paths and the current session directory.

## Workflow

1. Inspect the input before editing.
   - Use `officecli view <file> outline` for structure.
   - Use `officecli get <file> / --depth 2 --json` when structured element data is needed.
   - Use `officecli view <file> issues --json` to establish a quality baseline.
2. Plan stable paths and mutations. Query or inspect elements instead of guessing indexes or property names.
3. Create or edit the document.
   - Create: `officecli create <output.docx|output.xlsx|output.pptx>`.
   - Prefer `officecli batch <file> --input <commands.json> --stop-on-error --json` for multiple related edits.
   - Prefer `officecli merge <template> <output> <data.json>` for repeatable template population.
   - For an unsupported property, inspect built-in help such as `officecli pptx set shape` before retrying.
4. Flush resident changes with `officecli save <file>` before another program reads the file. Use `officecli close <file>` when the task is complete.
5. Verify before delivery.
   - Run `officecli validate <file>`.
   - Run `officecli view <file> issues --json` and fix material problems.
   - Render with `officecli view <file> screenshot -o <preview-path>` and inspect representative pages or sheets. Check the full document when its size is reasonable.
6. Report the final editable file and briefly identify the checks performed. Do not leave blueprint JSON, screenshots, or temporary files as primary deliverables unless the user requests them.

## Editing principles

- Preserve the source theme, page or slide size, styles, formulas, number formats, charts, comments, and accessibility metadata unless the request changes them.
- Treat formula results and document renderings as values to verify, not as proof that the business logic is correct.
- Use existing templates as the layout authority. Prefer localized edits over reconstructing an entire document.
- Keep visual changes restrained and consistent with the source. Fix overflow, clipping, overlap, broken formulas, and missing alt text when detected.
- If OfficeCLI cannot preserve a feature, explain the limitation and avoid silently flattening or deleting it.
