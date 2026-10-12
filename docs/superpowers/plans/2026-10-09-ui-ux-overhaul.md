# nyan-mem UI/UX Overhaul Implementation Plan

> **For agentic workers:** Use the executing-plans or subagent-driven-development workflow to implement tasks sequentially. Each step must be verified before continuing.

**Goal:** Deliver the approved nyan-mem dashboard overhaul and memory-review lifecycle while preserving existing MCP behavior and providing a tested rollback path.

**Architecture:** Keep the current single Node.js process and loopback dashboard/MCP HTTP architecture. Extend the existing SQLite schema through transactional, versioned migrations; make dashboard and MCP use the same retrieval eligibility rules; implement the dashboard in the existing static frontend unless evidence during implementation justifies a small focused split. Deploy by stopping the old process cleanly, backing up DB/config, installing a tested release, and verifying before retiring rollback artifacts.

**Tech Stack:** Node.js 22/24 with `node:sqlite`, SQLite FTS5, native HTTP server, existing HTML/CSS/JavaScript frontend and assert-based Node test scripts. No new dependency unless a demonstrated requirement cannot be met natively.

**Spec:** `docs/ui-ux-grill.md`; product context `PRODUCT.md`; current behavior in `dashboard.cjs`, `server.cjs`, `public/index.html`, and `README.md`.

## Global Constraints

- Keep dashboard and MCP bound to loopback; do not weaken local security.
- Preserve compatibility with existing SQLite databases and existing MCP clients/tools.
- Pending memories remain usable by agents; deletion removes them from retrieval immediately.
- Never auto-merge, auto-discard, silently overwrite, or silently modify agent configuration.
- Trash retention is 30 days; restore returns trusted state and prior available assignments; unavailable projects are not recreated.
- Global-promotion suggestions do not move or merge sources; edits to sources never mutate Global automatically.
- Do not claim agent reload, connection, invocation, or telemetry without observable verification.
- Keep the processing timeline out of this overhaul.
- English is default; Indonesian is selectable. Light/dark themes follow Windows initially and remember explicit choice.
- Back up the active DB/config before deployment; never run two writers against the same SQLite DB.

---

## Existing Structure and Change Boundaries

- `dashboard.cjs`: SQLite initialization, dashboard HTTP routes, memory/project/settings APIs. Add versioned migrations and dashboard lifecycle endpoints here, following its current patterns.
- `server.cjs`: MCP tools and retrieval/save behavior. Update retrieval eligibility and preserve tool protocol compatibility.
- `public/index.html`: current monolithic dashboard UI, styles, modals, and browser logic. Implement approved dashboard/navigation/detail/review/Trash flows here unless testability requires a minimal focused extraction.
- `test-suite.js`, `dashboard-server-test.js`, `mcp-http-test.js`: existing lightweight verification entry points; extend with isolated temporary database tests rather than depending only on the live user DB.
- `README.md`: install/use/update/uninstall and MCP setup documentation; document verified behavior and rollback.
- `docs/ui-ux-grill.md`: approved UX requirements; do not silently change product decisions during coding.
- `docs/superpowers/plans/2026-10-09-ui-ux-overhaul.md`: this execution checklist.

## Task 1: Establish Baseline and Safe Test Harness

**Files:**
- Modify: `test-suite.js` and/or add one focused test script beside existing tests.
- Read only: `dashboard.cjs`, `server.cjs`, `README.md`.

- [ ] Record current schema, existing MCP tool names, API routes, and test outcomes using the current test scripts.
- [x] Add one focused isolated integration script (`test-suite.js`) using an ephemeral loopback port and temporary `NYAN_MEM_DIR`; verify it never touches the live DB.
- [ ] Apply transactional migrations and safely complete lifecycle state storage, FTS sync, review/merge/provenance, and project assignment semantics.
- [ ] Run `node --check` on server files and all existing test scripts; run each documented test command.
- [ ] Save the baseline outputs outside the repository temp/log directory.

**Acceptance:** baseline is reproducible against a fresh temp DB, and live DB remains untouched.

## Task 2: Versioned, Transactional SQLite Migrations

**Files:**
- Modify: `dashboard.cjs` (migration setup near `initDb`).
- Test: isolated migration script/test.

- [ ] Inspect current full schema, triggers/indexes, FTS synchronization, all SQL reads/writes, and DB open lifecycle before choosing columns/tables.
- [ ] Replace silent `ALTER TABLE` try/catch accumulation with a schema-version ledger and ordered idempotent migrations; preserve existing installations.
- [ ] Define storage for memory status/review kind/deletion timestamp, multi-project assignment/provenance, and merge/promotion relationships only after confirming legacy data mapping.
- [ ] Ensure FTS excludes deleted memories and remains synchronized through insert/update/delete/restore using transaction-safe native SQLite mechanisms.
- [ ] Implement 30-day purge and explicit permanent-delete operations; make purge idempotent and preserve unrelated source records.
- [ ] Test fresh DB, legacy DB upgrade, interrupted/repeated migration, backup/restore, FTS integrity, and failure rollback.

**Acceptance:** migration is repeatable, old data remains readable, and failure leaves a recoverable DB.

## Task 3: Shared Memory Lifecycle and Retrieval Semantics

**Files:**
- Modify: `dashboard.cjs`, `server.cjs`.
- Test: lifecycle/retrieval integration tests against isolated DB.

- [ ] Centralize or rigorously align eligibility rules across dashboard and MCP: pending remains retrievable; trashed/permanently deleted never is; restored is trusted and retrievable.
- [ ] Preserve project isolation and current Global behavior. Implement assignment membership without making Global-only items leak into project-scoped reads.
- [ ] Add memory detail read/update APIs with validation, stable IDs, updated timestamps, and optimistic conflict detection that returns latest version plus conflict information rather than overwriting.
- [ ] Add assignment/unassignment and Split/Fork endpoints with explicit confirmation semantics enforced by UI and validated server-side.
- [ ] Add approval, deletion-to-Trash, restore, permanent delete, and Empty Trash operations; preserve scope and provenance on restore, omitting assignments to deleted projects without recreating them.
- [ ] Add deletion date/countdown fields and safe handling for invalid/missing timestamps.
- [ ] Test lifecycle transitions, cross-project isolation, shared assignments, restore to unavailable project, conflict handling, and MCP reads after each transition.

**Acceptance:** dashboard and every MCP retrieval path agree on the same lifecycle and scope rules.

## Task 4: Review Queue and Human Decisions

**Files:**
- Modify: `dashboard.cjs`, `server.cjs`, `public/index.html`.
- Test: review action API and lifecycle tests.

- [ ] Add Review sections: New Memories, Possible Duplicates, Needs Confirmation; keep them distinct from work-state/Todo.
- [ ] New Memories: Approve immediately exits Review and marks trusted; Delete asks brief confirmation and moves to Trash.
- [ ] Possible Duplicates: detection only within active scope; cross-project analysis is reserved for Global promotion suggestions. Do not auto-resolve.
- [ ] Keep both requires a manually saved edit to either/both candidate explanations before either becomes trusted/leaves review.
- [ ] Merge requires preview and confirmation; create the reviewed result and move source items to restorable Trash while preserving provenance. A restored source remains independent; a later similarity may be flagged again but never auto-merged.
- [ ] Delete-new requires brief confirmation and moves only the new candidate to Trash.
- [ ] Needs Confirmation records the user decision and removes the resolved request from that queue.
- [ ] Persist rejected Global-promotion reasoning as visible/editable user preference; deleting it stops influence immediately and follows Trash policy.
- [ ] Test every action, confirmation-required operation, and agent retrieval effect.

**Acceptance:** no review choice silently changes or destroys a memory; actions match the approved brief.

## Task 5: Global Promotion and Provenance

**Files:**
- Modify: `dashboard.cjs`, `server.cjs`, `public/index.html`.
- Test: promotion/provenance lifecycle tests.

- [ ] Detect repeated patterns across projects only to create review suggestions; show related source memories/projects and editable proposed Global text.
- [ ] Approval requires confirmation and creates a separate linked Global memory; retain all source records and assignments.
- [ ] Later source edits never mutate Global; optionally surface a review-needed signal if implementable from observable change data.
- [ ] Deleting Global moves only Global to Trash, preserves links there; restore recovers links; permanent purge removes Global and its links only.
- [ ] Test duplicate/overlapping source, source deletion, Global deletion/restore/purge, and project-scope retrieval.

**Acceptance:** promotion is additive and traceable; no source is moved or implicitly merged.

## Task 6: Trash Operations and Expiry

**Files:**
- Modify: `dashboard.cjs`, `public/index.html`.
- Test: Trash API tests.

- [ ] Add distinct primary-nav Trash view with a simple unfiltered list: deletion date, days remaining, Restore, Delete permanently.
- [ ] Individual permanent deletion asks brief confirmation and shows a success toast.
- [ ] Show exactly one Empty Trash action only when items exist; confirmation states the current item count; success toast reports actual deleted count.
- [ ] Empty state says “Trash is empty”; hide Empty Trash in that state.
- [ ] Automatically purge at 30 days without notification. Ensure purge runs at a safe startup/request boundary without long-lived timer preventing process exit; do not expose item content in logs.
- [ ] Restore prior scope/assignments/provenance, trusted and agent-available; if source project no longer exists, do not recreate or assign elsewhere. Show a temporary result toast with restored scope/assignments or no-assignment result.
- [ ] Test exactly-at-expiry boundaries, timezone handling, bulk count, idempotency, restore, and silent auto-purge.

**Acceptance:** Trash behavior is deterministic, recoverable until expiry, and permanently purged only as specified.

## Task 7: Memories List and Detail UI

**Files:**
- Modify: `public/index.html`; only necessary API changes in `dashboard.cjs`.
- Test: DOM/API behavior checks and manual responsive checklist.

- [ ] Build compact rows with concise summary, scope/project, review status, updated time, and useful existing tags.
- [ ] Add debounced search; X at right of search bar clears only query. Add project/scope and status filters, newest/oldest sort, and optional tag filter only where tags already exist.
- [ ] `Clear filters` clears filters only, retaining query; do not add combined Clear all.
- [ ] Empty search/filter result shows “No memories match”; offer Clear filters only if a filter is active.
- [ ] Preserve page sizes 10/25/50/100 and ensure pagination changes query/display only, never memory save behavior.
- [ ] Detail exposes edit/delete/assign/unassign/Split-Fork and process details only there; scope/fork confirmation explains impact.
- [ ] On concurrent edit, show saved version alongside draft and require explicit user choice; never silent overwrite.
- [ ] Verify keyboard access, focus management, reduced-motion behavior, and narrow browser layout.

**Acceptance:** list and detail controls are functional, accessible, and remain usable in narrow windows.

## Task 8: Dashboard, Navigation, Theme, and Localization

**Files:**
- Modify: `public/index.html`, `dashboard.cjs` as required.
- Test: settings persistence and UI smoke checks.

- [ ] Home focuses on projects and observable connection summary; project cards show exclusive memory count and last activity. Do not invent telemetry.
- [ ] Add primary navigation for Global, Memories, Review, Trash, Status, Projects, Settings, and quick Write Memory.
- [ ] Implement Signal Garden light and Carbon Ledger dark themes; first run follows Windows preference, explicit selection persists.
- [ ] English default and Indonesian toggle persist across reload.
- [ ] Use black cat motif (black in light, white in dark), purposeful icons, no decorative colored emoji or user-facing AI-meta labels.
- [ ] Ensure Review badge links directly to Review; new-memory notices respect configured channels.
- [ ] Test persistence, theme/system fallback, keyboard navigation, and responsive layouts.

**Acceptance:** no dead controls; visible counts/status derive from real data only.

## Task 9: Agent Setup, Status, and Full-Test Prompt

**Files:**
- Modify: `dashboard.cjs`, `server.cjs`, `public/index.html`, `README.md`; add only client-specific setup code if required.
- Test: client-config detection, diff, backup, and verification tests with fixture configs.

- [ ] Inventory actual config formats and supported automation for Hermes, Cline, Gemini, Antigravity IDE, and Antigravity 2.0; treat each independently.
- [ ] Show detected/configured/healthy/reload-needed/reload-verified/recent-activity as distinct observable states.
- [ ] Generate exact per-client diff; choose one/many/all; require explicit approval; backup before writing; change only approved keys; provide rollback/manual guidance.
- [ ] Attempt reload only if officially supported and verifiable; verify with a fresh connection/tool discovery or observable activity.
- [ ] Provide localized copyable temporary full-test prompt: write tagged test item, read it back, clean up; distinguish cleanup verified/unverified. Copying or config presence is not proof.
- [ ] Verify notification toggles: dashboard ON default, prompt notice only for verified support, Windows OFF default.
- [ ] Test with fixture configs and never expose secret values in diff/logs.

**Acceptance:** setup claims match observed states; no credentials in logs or summaries.

## Task 10: Safe Upgrade, Rollback, and User-Data Protection

**Files:**
- Modify: `README.md`; add/update release or upgrade scripts only if the current deployment truly needs them.
- Test: upgrade/rollback rehearsal using a copied DB/config and isolated ports.

- [ ] Identify the actual running process, launch method, configured port, database path, and client endpoints before deployment; never infer from defaults alone.
- [ ] Build/test the candidate in a separate directory and use a copied DB for any parallel test; never run two writers against the same SQLite file.
- [ ] Upgrade sequence: confirm port availability, stop old MCP cleanly, verify it exited, back up DB/config outside repository, replace application atomically, run migrations, start new process, verify health/API/MCP tools and smoke operations.
- [ ] Preserve old release and backup until acceptance checks pass. Rollback: stop new process, restore old files and matching DB snapshot, restart old process, verify health and test read.
- [ ] Document install/update/uninstall separately; uninstall preserves user data by default.
- [ ] Test interrupted-upgrade and failed-migration recovery from copies before touching the user's active instance.

**Acceptance:** rehearsed upgrade and rollback work on copies; active service is never overwritten while running.

## Task 11: End-to-End Regression and Documentation

**Files:**
- Modify: existing tests and `README.md`; update `PRODUCT.md` only if the user approves and tracked-status handling is decided.

- [ ] Run `node --check` on changed JS, all isolated unit/integration tests, existing dashboard and MCP HTTP tests, and the full regression suite.
- [ ] Test old DB migration, MCP tool compatibility, project isolation, Global behavior, review/retrieval, merge/restore, Trash expiry, and onboarding rollback.
- [ ] Confirm no test wrote to the live DB and no credentials appeared in output.
- [ ] Update README with verified commands, support boundaries, API/MCP endpoints, and rollback steps.
- [ ] Produce a concise release checklist and leave the old release/backup until user confirms the upgraded service is stable.

**Acceptance:** all tests pass with recorded real output; known failures are reported, not hidden.

## Review Gates

- After Task 2, review the schema migration/data mapping before proceeding.
- After Tasks 3–6, verify state transitions and retrieval behavior before UI integration.
- After Task 8, user reviews the dashboard behavior/theme/responsive pass.
- Before Task 10, user explicitly approves the maintenance window for the currently running MCP; do not stop/restart it without that approval.
- Remove rollback artifacts only after the upgraded service has been accepted.
