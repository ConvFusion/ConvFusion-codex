# Codex adapter contract

## Ownership

Codex owns the agent runtime, execution and approvals. The shared ConvFusion core owns research formats, identifiers, validation, history, scientific methods and network protocol. The pinned DSH baseline is recorded in `assets/dsh-baseline.json` at the plugin root.

Every tool receives the task's absolute `workspace_root`. New research data belongs under `<task>/workspace/`; existing flat research layouts remain readable. Neither the MCP process cwd nor the plugin cache is a research workspace.

## Context and methods

Use `research_context` to obtain current research guidance and `research_methods` to read customized methods. The method library lives at `skills/convfusion-research/references/` and contains 57 methods plus the sync operation. The source library is read-only; personal customizations are separate.

DSH-only registration, context injection and automatic continuation are not invoked by Codex. Research context is refreshed explicitly through tools and the skill. Shared DSH compatibility source remains available but is not the Codex UI entrypoint.

## Workbench

`research_ui` registers the task workspace and returns both an MCP Apps resource and a loopback browser URL. The self-contained frontend reuses the shared community/settings/progress views. The adapter supplies workspace identity, persistence and transport; it does not implement a second mentorship backend.

The MCP resource is `ui://convfusion/workbench-v1.html`, with MIME type `text/html;profile=mcp-app`. Host rendering support varies. The browser fallback runs only on `127.0.0.1`, validates host/origin, and requires a per-session capability bound to the task root. Keep the MCP process running while using it.

Local settings and network identity/cache files are stored under `$CONVFUSION_CODEX_HOME`, or `$CODEX_HOME/convfusion` (default `~/.codex/convfusion`). They are separate from DSH settings and the plugin cache. Credentials are stored with owner-only file permissions and are not returned in account state or research context.

The app-only `research_ui_action` transports user interaction. It is not a model-facing shortcut for credentials, purchases, publishing or accepting paid guidance. Downloads remain ZIP files until the user authorizes the sync workflow.

## Review and synchronization

Artifact indexes synchronize automatically without replacing human-written state. Judgment-bearing state proposals remain pending by default in Codex. Explicitly authorized application uses `research_state_propose` with `apply: true` or `action: apply`.

Sync prepares ZIP/identity facts with `research_sync`, then follows the sync method: read-only comparison, user confirmation, semantic merging or backup/replacement as appropriate. Do not equate downloading with synchronization.

## Optional dependencies

Core local research and the web workbench use Node.js 20+. Diagram export and schematic rendering also require the Python/renderer dependencies reported by their tools. LaTeX compilation requires a supported compiler. Report actual missing dependencies rather than describing an unexecuted export as successful.
