---
name: convfusion-research
description: "Use for evidence-first research: problem framing, literature, hypotheses, experiments, plans, research state, traceable claims, paper figures, research IR, paper revision, patents, reports, presentations, mentor/student discovery, and downloaded research synchronization. Also use when asked to initialize, assess, continue, or audit a ConvFusion research project. Do not use for ordinary coding without a research objective."
---

# ConvFusion Research

Codex supplies reasoning, browsing, coding, experiments and document execution. ConvFusion supplies research methods, deterministic tools and persistent research assets.

## Start with the actual workspace

1. Resolve the current task directory to an absolute path and pass it as `workspace_root` to every ConvFusion tool. Never substitute the plugin installation or cache directory.
2. Call `research_workspace` with `action: status` first. This is read-only. Only use `action: init` when the user explicitly asks to create or initialize a research project.
3. Call `research_context` with the current request as `input` to read the adopted topic, research state, current process stage, gaps and relevant methods. Refresh context after material changes; do not infer current state from an older conversation.
4. Without a research project, remain read-only unless the user asked to initialize one. Opening the account/method UI does not authorize research initialization or publishing.

Trusted native lifecycle hooks refresh research context at session start, user input and tool boundaries. They save Plan snapshots and compute real turn deltas when a research turn ends. Explicit context/status tools remain available when hooks are not trusted or supported. Never describe hooks as active solely because their files are installed.

Use the user's language for discussion, plans and working notes. Write manuscripts, figures/captions, experiment code/configuration and result data in English, as in the shared research guide.

## Load the relevant methods

Call `research_methods` without `id` to list available methods. Then call it with the selected `id` to read the effective method, including user customizations. Read the full method before applying it. Choose only methods relevant to the current task.

For “导出研究方法” / “export methods”, call `research_methods` with `action: export`; set `full: true` only for the full text including Source Prompts. This deterministically writes the code-ordered effective methods to `research/methods-export.md` and returns the artifact path. Do not recreate the export manually.

The bundled reference library contains 57 research methods and one sync operation:

- process definition: `references/global-capabilities/`
- input, intent, topic proposals and direction steering: `references/research-understanding/`
- literature search, screening, full text, landscape and review: `references/literature/`
- themes, gaps, hypotheses, novelty and contributions: `references/innovation/`
- strategy, methods, pipelines and risk: `references/research-planning/`
- hardware, infrastructure, feasibility and resources: `references/resource-estimation/`
- direction ranking, selection and go/no-go decisions: `references/research-decision/`
- datasets, implementation, experiments, evaluation and results: `references/experiment/`
- manuscripts, diagrams, equations, patents, reports and slides: `references/academic-writing/`
- research, evidence, claim and pre-submission review: `references/review/`
- downloaded research synchronization: `references/sync.md`

The references describe shared research methods. Translate DSH-specific host instructions to the Codex tools below; Codex does not register the DSH `/research` slash command or Cordis slots. Do not attempt those host APIs.

## Preserve research invariants

- Keep raw artifacts, source paths, parameters and citations behind each Evidence record. Record simulated and unverified findings explicitly; never present them as verified results.
- Link Evidence to Claims and reconcile claim status. Preserve contradiction and supersession history.
- Record consequential choices with reasons, alternatives and evidence.
- Evidence/Claim/Decision writes automatically refresh the artifact-indexed portions of Research State and archive earlier state. This deterministic synchronization preserves human-written text.
- Within authorized research work, `research_state_propose` applies changes by default, archives the previous state and records the disposition. Use `apply: false` when the user requested a proposal/review first. Read-only tasks never authorize a state write. Report the actual disposition.
- Use `research_project` to inspect/evolve the topic or set research definition fields. Preserve the initial topic and change history; do not force-overwrite human-written definitions without authorization.
- Plans default to draft. Review/approval are actual lifecycle transitions; an auto-execute policy requires the user's choice.
- Use `research_plan action: revise` for revisions so previous content is archived. `history` lists snapshots and `read_version` reads one. Before carrying out a selected plan, use `handoff` to load its reviewed task input; it rejects unapproved drafts unless their explicit policy is auto-execute. Continue with Codex native tools, not a second runtime.
- Paper changes stay revision proposals until accepted or edited by the user. Outputs transform research knowledge without mutating Research State.
- Research IR validates structured designs, evidence requirements, deltas and transitions. It does not replace Evidence or silently apply Research State.

## Tool routing

- `research_workspace`, `research_context`, `research_methods`: workspace inspection, current context and effective methods.
- `research_project`, `research_plan`: research definition and plan lifecycle.
- `research_evidence`, `research_claim`, `research_decision`: traceable research asset graph.
- `research_state_read`, `research_state_propose`: state, reconciliation, artifact sync and reviewable updates.
- `research_paper`, `research_output`: papers, maturity/gaps, revisions and other outputs.
- `research_literature_search`, `research_paper_download`, `research_paper_latex`: literature, full text and LaTeX workflows.
- `research_diagram`, `research_schematic`: validated Diagram IR and publication figures. For paper schematics, follow the paper-diagrams method's routing rather than inventing an unverified render/export result.
- `research_action_construction`: inspect and evaluate candidate research actions/designs.
- `research_ir`: typed research designs, revisions, evidence coverage and state transitions.
- `research_ui`: open the interactive workbench for methods, progress and ConvFusion.com accounts, publishing, finding mentors/students, proposals and file exchange. Pass the task workspace when opening it from a research conversation. The same tool accepts `{}` for global/sidebar and side-panel entrypoints, opening without a selected directory; the user can choose a directory in the UI. This never initializes research. Show the returned local URL when the host does not render the MCP Apps resource.
- `research_sync`: prepare synchronization of a downloaded research ZIP. This is read-only and does not extract or overwrite files.

## Finding guidance and other network actions

When the user wants a mentor/student or a network account, open `research_ui`. The user enters credentials, selects the research/files, sees fee information and confirms publish/proposal/accept/recharge actions in the interface. Do not request an API key in chat, bypass the UI via `research_ui_action`, purchase a brief, accept a paid proposal, or publish private work on the user's behalf without explicit instructions.

The browser fallback is served by the local MCP process; keep that process running while using it. A task-bound MCP Apps view can prepare an editable sync request and send it only after the user presses Send to Codex. Global views and browsers offer copy/paste; never send a selected global directory's request into an unrelated chat. Do not claim that a permanent Codex sidebar entry has been installed just because the interface opens.

## Synchronizing downloaded research

When the user asks to synchronize a ZIP (including a request copied from the interface):

1. Call `research_sync` with the ZIP path and current task workspace. Read the returned identity facts and the effective `sync` method via `research_methods`.
2. Perform the method's read-only archive/local comparison and report all additions, local-only files and conflicts. Stop for the required user confirmation before writing.
3. After confirmation, merge the same research; for a different research, preserve the existing research as the specified backup before replacing it. Never silently overwrite either side or decide scientific conflicts for the user.
4. Inspect archive entries before extraction. Reject absolute paths, traversal, links escaping the research root and unbounded expansion. Preserve the original ZIP.
5. Record actual file dispositions and backup location. Refresh context and workspace status afterward.

## Execute and verify

Use Codex native capabilities for the approved research work. Inspect real artifacts, measurements, source pages and rendered outputs, then record Evidence/Claims/Decisions and reviewable updates. After authorized native file changes, use `research_state_propose` with `action: sync` to refresh artifact indexes and research definition before refreshing context. Do not run this write operation during a read-only audit. Re-read workspace status/context and report what changed, what remains unverified and the next evidence-bearing action.

Native Stop hooks may request continuation only for a user request to start/continue/execute research, when the next step is clear, the configured round budget remains, and the user has neither interrupted nor requested read-only/Plan work. An isolated export, account or UI request does not authorize further research. Respect a blocking choice or exhausted budget; do not reset that budget yourself. Settings in the workbench can disable continuation or change its limit. Context injection and continuation never authorize private publishing, paid actions or scientific choices that require the user.

See `assets/codex-adapter.md` for transport, persistence and compatibility boundaries.
