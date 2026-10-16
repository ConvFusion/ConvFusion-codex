# Codex adapter contract

## Ownership

Codex owns the agent runtime, execution and approvals. The shared ConvFusion core owns research formats, identifiers, validation, history, scientific methods and network protocol. The pinned DSH baseline is recorded in `assets/dsh-baseline.json` at the plugin root.

Every tool receives the task's absolute `workspace_root`. New research data belongs under `<task>/workspace/`; existing flat research layouts remain readable. Neither the MCP process cwd nor the plugin cache is a research workspace.

## Context and methods

Use `research_context` to obtain current research guidance and `research_methods` to read customized methods. The method library lives at `skills/convfusion-research/references/` and contains 57 methods plus the sync operation. The source library is read-only; personal customizations are separate.

Packaged native Hooks handle SessionStart, UserPromptSubmit, PreToolUse, Stop and Interrupt. Session/user/tool boundaries refresh the same effective context as `research_context`, including the shared research and language guide. Hooks register encountered task directories; the long-lived workbench refreshes that registry from disk. No internal Codex database or transcript format is assumed.

Codex must trust the installed hook definitions before running them. Installation alone does not activate them. Without trusted hooks, explicit MCP and Skill entrypoints still work; automatic context, native-edit snapshot capture and turn reports cannot be claimed as active. Shared DSH compatibility source remains available but is not the Codex runtime entrypoint.

Hook state is isolated by canonical task path and native session id. Only snapshots, bounded observation metadata, continuation disposition and progress reports are persisted in the private adapter home. Raw tool arguments and user prompts are not recorded. Stop reuses shared asset-diff and advance logic, enforces a bounded continuation budget, and delegates continuation to Codex's native Stop decision. Read-only prompts, Plan mode and user interrupts prevent research writes and continuation.

## Workbench

`research_ui` registers the task workspace and returns both an MCP Apps resource and a loopback browser URL. The self-contained frontend reuses the shared community/settings/progress views. The adapter supplies workspace identity, persistence and transport; it does not implement a second mentorship backend.

The MCP resource is `ui://convfusion/workbench-v1.html`, with MIME type `text/html;profile=mcp-app`. Host rendering support varies. The browser fallback runs only on `127.0.0.1`, validates host/origin, and requires a per-session capability bound to the task root. Keep the MCP process running while using it.

Local settings and network identity/cache files are stored under `$CONVFUSION_CODEX_HOME`, or `$CODEX_HOME/convfusion` (default `~/.codex/convfusion`). They are separate from DSH settings and the plugin cache. Credentials are stored with owner-only file permissions and are not returned in account state or research context.

The app-only `research_ui_action` transports user interaction. It is not a model-facing shortcut for credentials, purchases, publishing or accepting paid guidance. Downloads remain ZIP files until the user authorizes the sync workflow. A task-bound MCP Apps view offers an editable sync request with an explicit send action; browsers and global views retain copy/paste. It never silently submits or replaces the host chat draft.

## Review and synchronization

Artifact indexes synchronize automatically without replacing human-written state. As in DSH, authorized `research_state_propose` calls apply by default while archiving the old state and recording the disposition; `apply: false` retains a reviewable proposal. Read-only requests do not authorize either operation.

Plan creation and mutation archive snapshots before/after changes. Native hook boundaries reconcile external Markdown edits during authorized research work. `research_plan` exposes revision, history, snapshot reading and reviewed handoff input; reads remain read-only. `research_methods action=export` and the workbench use the shared deterministic exporter, including user customizations and optional full source prompts.

Sync prepares ZIP/identity facts with `research_sync`, then follows the sync method: read-only comparison, user confirmation, semantic merging or backup/replacement as appropriate. Do not equate downloading with synchronization.

## Optional dependencies

Core local research and the web workbench use Node.js 20+. Diagram export and schematic rendering also require the Python/renderer dependencies reported by their tools. LaTeX compilation requires a supported compiler. Report actual missing dependencies rather than describing an unexecuted export as successful.
