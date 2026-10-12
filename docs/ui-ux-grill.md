# nyan-mem UI/UX overhaul — grill

## Product and audience
- Local-first memory tool for AI agents: agents search/save project-scoped memories and work state; people use a browser dashboard to manage projects, review memories, configure connections/storage, and check local service health.
- Primary human user is a developer/operator on Windows with several local agents; secondary users are other developers installing from the open-source GitHub release.
- First supported platform: Windows. Keep design and implementation portable where practical; do not claim untested platform support.

## Confirmed product requirements

### Home and navigation
- Dashboard home focuses on projects and glanceable connection status; project cards show project name, count of memories exclusive to that project (exclude Global/shared assignments), and last activity time. Last activity includes memory creation/edits and agent memory activity when observable, with the event and timestamp available; if none, show localized “No activity yet”. Do not surface active/recent task or memory-processing status on home; show process detail only inside memory detail. Review badge links to new items.
- Show a concise MCP/API/agent connection summary on the dashboard; detailed errors and technical diagnostics live on a separate Status page.
- New/pending memory notifications link to the Review inbox; use an in-dashboard badge/count. Notification channels are configurable: dashboard badge ON by default, end-of-turn prompt notice ON only where verified supported, Windows notifications OFF by default.
- Trash is a simple list without search or filters; items show deletion date, days remaining, and Restore/Delete permanently actions. Permanent deletion requires brief confirmation. Provide one `Empty Trash` action to permanently delete all items at once, with confirmation stating the item count; hide it when Trash is empty. Items reaching 30 days are silently purged. Restore returns prior scope/assignments and provenance links, approved/trusted and agent-available; if a source project no longer exists, restore without assignment and never recreate or assign to another project. Show a temporary restore notification summarizing scope/assignments, or that it was restored without assignments. Individual permanent deletion shows a brief toast; Empty Trash toast states the number deleted. When empty, show an explicit empty state such as “Trash is empty”.
- Global memories are hidden in a named-project view. Open Global explicitly to view them. Never allow renaming reserved project `global`.
- Write Memory opens a quick modal. Default scope is the current project or Global, but users can add/remove other projects and Global before saving.
- Confirmed wizard flow: (1) choose language, (2) show API URL/key fields prefilled only from an existing detected configuration; leave them blank if none exists, (3) verify API connection (must succeed to complete setup), (4) show database location prefilled with the recommended default path; user can accept it or change it, (5) detect supported agents, (6) review per-agent config changes, select agents, and approve, (7) verify reload/connection and offer the full-test prompt. Agent setup may be skipped and completed later in Settings.
- Desktop-first, but usable when the browser narrows: reflow content rather than require wide viewport.

### Visual design and interaction
- Signal Garden is the app's light theme; Carbon Ledger is its dark theme. These are paired themes for the same UI.
- First launch follows Windows/system theme. If user explicitly switches theme, persist and restore their choice.
- Black-cat brand motif: monochrome icon/detail and occasional larger character in appropriate empty/brand moments; cat is black in light mode, white in dark mode. No decorative colored emoji; use meaningful icons. Remove user-facing anti-slop/AI-meta labels.
- Compact memory rows show concise summary, project/scope, review status, and last-updated time; show tags where useful. Memories supports debounced search, project/scope and status filters, optional tag filtering, and newest/oldest sorting. Tag-entry UI is not specified; do not assume users can create tags until designed. Empty results show “No memories match”. `Clear filters` resets filters only and preserves query; X at the search bar's right clears only the query. Keep these controls separate; no combined `Clear all`.
- Memory-list page sizes: 10/25/50/100; pagination affects display/query load, not memory save/distillation behavior.
- Motion is brief and purposeful, respects reduced-motion settings; avoid decorative scroll effects for data-heavy management.

### Memory, review, project scope
- Durable high-confidence information is captured automatically by configured agents without requiring “save this”: confirmed decisions, stable project facts, important discoveries, and milestone/task outcomes. Do not auto-capture transient chat, unresolved speculation, or secrets.
- Initial policy defaults to auto-capture → Pending Review; users may disable automatic capture. Defer auto-approve-by-category.
- Pending memories are immediately usable by agents. Approve removes the item from Review and keeps it in ordinary Memories as trusted. Delete immediately excludes it from agent retrieval/use and moves it to Trash for 30 days, then purges; user may permanently delete earlier.
- Restoring any trashed memory, including a linked Global memory, returns it as approved/trusted and immediately available to agents; restore provenance links where applicable. If a restored merged source is still similar to the merged result, MCP may flag it again for review, never auto-merge.
- Review Inbox is separate from Todo/Work State and divided into sections/tabs: New Memories, Possible Duplicates, and Needs Confirmation. Confirmation requests include ambiguous scope, Global promotion, and split/fork; notify in the agent prompt when supported, while keeping requests in Review.
- Suspected duplicates appear only in Possible Duplicates until reviewed. Detection follows active scope: in a named project compare memories available in that project (including shared assignments, excluding Global-only/other projects); in Global compare Global memories only. Actions: Keep both (manual edit required to clarify), Merge (preview/confirm, preserve provenance and move source memories to restorable 30-day Trash), or Delete the new candidate to Trash. Until resolved, pending candidates remain agent-usable; never auto-merge/discard.
- For Global-promotion candidates only, detect repeated patterns across projects in the background; put suggestions in Review with related memories/source projects and an editable proposed Global version. Approval requires confirmation, creates a separate linked Global memory, and leaves source project memories intact; never auto-move/merge. Later edits to linked source memories never update Global automatically; they may flag that the Global version could need review. Deleting linked Global moves only that item to Trash; retain provenance links there, restore them with Global, and on permanent purge remove only Global and its links.
- New Memories review actions: Approve immediately marks trusted and removes the item from Review without confirmation; Delete requires brief confirmation and moves it to Trash. Duplicate candidates use their resolution choices above. Needs Confirmation records the decision and removes the resolved request from that queue.
- Deleting a persisted rejection rule immediately stops it influencing future suggestions; retain it in Trash for 30 days under the standard restore/purge policy.
- Project creation is explicit; do not create projects merely because a prompt mentions a name. If a clearly targeted project is missing, request creation/selection rather than silently using another scope.
- Opening a memory detail exposes its available actions: edit, delete, assign/unassign projects/Global, and split/fork shared memories. Scope changes and split/fork require a confirmation dialog explaining impact; Delete asks brief confirmation about 30-day Trash. On concurrent edit conflict, show latest saved version alongside the user's draft for comparison and never silently overwrite.
- Future, not current overhaul scope: per-memory processing timeline for actual processing events only (received, processing started/completed/failed); exclude later user/agent actions.

### Agent/MCP onboarding and verification
- MCP configured/installed, connected/healthy, and recent tool activity are separate states. Config presence is not proof of runtime connection or invocation; show only facts the app can observe.
- Provide one localized, copyable full-test prompt. It directs an agent to write a clearly tagged temporary record, read it back, then delete/clean it. Isolate/expire test data; report cleanup as verified or not verified. Do not treat copying, config presence, or unverified self-report as proof.
- Agent setup: detect supported clients; show status and exact per-agent config diffs; let user choose one, several, or all; require approval; back up configs; change only approved entries; report results and reload status; offer rollback, manual repair guide, and full-test prompt.
- Attempt automatic reload only where officially supported and verifiable. Confirm with fresh connection/tool discovery or observed post-reload activity. Otherwise show “Reload required / Not verified” and manual steps; never claim reload just because a command returned success.
- Configure supported agents to read Global + project context at task start, proactively save durable checkpoints at milestones/end, and report new pending-review items at answer end. Per-client behavior must be tested. Explain limitations for unsupported/failed clients.
- User-configurable notification toggles: dashboard pending badge (default ON), prompt notice (ON only where client support is verified), Windows notification (default OFF).

### Distribution
- Initial release is open-source on GitHub, Windows first.
- Provide familiar terminal one-line install command from README (e.g. PowerShell), which installs/starts nyan-mem with visible status and no silent agent config edits. Then offer reviewed agent setup.
- Document separate terminal update and uninstall commands in GitHub README.
- Publisher identity/code signing can be decided before public binary distribution.

## Product truths and non-goals
- Use real functions/data only: no fake metrics, invented feeds, dead controls, or unsupported connection claims.
- Keep agents in the same project sharing records; isolate other projects; Global remains intentionally shared.
- Dashboard/MCP remain local loopback; do not weaken security during UI work.
- Current redesign does not implement the future processing timeline unless separately approved.

## Grill state
- Confirmed product and functional requirements are above.
- Initial automatic agent support targets: Hermes, Cline, Gemini CLI/config, and Google Antigravity (including IDE and Antigravity 2.0). Detect each separately and label support only after its setup/reload/test path is verified; do not conflate Gemini and Antigravity configs.
- Continue one focused question per turn. After key decisions are resolved, present a consolidated design brief for approval. Only then inspect implementation details deeply, plan, and build.
