# Shared Local HTTP Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Serve dashboard and MCP over one loopback HTTP process while preserving stdio, with explicit per-request project scope shared across local agents.

**Architecture:** Add MCP Streamable HTTP at a distinct route on the dashboard's existing `127.0.0.1` listener. Reuse `handleToolCall` and the current SQLite connection. Leave global memory visible in project scope, keep cross-project `all` explicit, and preserve omitted-project fallback solely for backwards compatibility.

**Tech Stack:** Node.js 24, built-in `node:http`, built-in `node:sqlite`, current assert-based test suite.

**Spec:** `docs/superpowers/specs/2026-10-07-shared-http-memory-design.md`

## Global Constraints

- Bind HTTP exclusively to `127.0.0.1`.
- Preserve stdio MCP and existing dashboard behavior.
- One long-running server process owns the SQLite connection.
- Explicit per-call project scope is authoritative; never depend on shared active project for scoped calls.
- Named project searches include `global`; `all` is explicit.
- No new dependencies, schema migrations, wildcard CORS, or remote exposure.
- Test before implementation, prove RED then GREEN.
- Push to the configured GitHub remote only after verification.

---

## File map

- `server.cjs`: MCP tool handlers, stdio protocol, shared process startup.
- `dashboard.cjs`: existing HTTP server, routes, and exported server handle/startup.
- `test-suite.js`: existing HTTP API integration tests.
- `mcp-http-test.js` (create): built-in assert-based MCP HTTP protocol/scope/concurrency regression tests, isolated test DB and ephemeral listener.
- `README.md`: local startup, endpoint, per-client config, scope and collaboration contract.
- `docs/superpowers/specs/2026-10-07-shared-http-memory-design.md`: approved design.

## Task 1: Expose an injectable dashboard HTTP server for MCP route integration

**Files:** Modify `dashboard.cjs`; test in `mcp-http-test.js`.

- [ ] Add a failing test that starts dashboard on ephemeral loopback port and verifies the returned server can be closed cleanly.
- [ ] Run `node mcp-http-test.js`; confirm expected failure because `startServer` does not expose a server handle/port.
- [ ] Make `startServer(port, options)` listen only on `127.0.0.1`, return its server, and allow a route callback or request handler to claim the MCP endpoint before dashboard fallback. Keep existing default behavior and existing callers valid.
- [ ] Re-run the focused test and verify it passes.
- [ ] Run existing `node test-suite.js` to detect startup/API regressions.

## Task 2: Add HTTP JSON-RPC transport to MCP server

**Files:** Modify `server.cjs`; extend `mcp-http-test.js`.

- [ ] Add failing tests for HTTP initialize, initialized notification, ping, tools/list, tools/call success, unsupported method, malformed JSON, wrong HTTP method, oversized body, and no stack trace in errors.
- [ ] Run focused tests; confirm failures are due to missing MCP route.
- [ ] Implement a bounded HTTP request parser and route (e.g. `/mcp`) that calls existing MCP dispatch/`handleToolCall`, emits valid MCP/JSON-RPC responses and protocol headers, and never logs payloads. Reuse the dashboard's listener; keep dashboard and stdio handlers active.
- [ ] Ensure bind/listen errors are surfaced and readiness is not logged before listening succeeds.
- [ ] Re-run focused tests and confirm they pass; verify dashboard still responds on `/` in the same process.

## Task 3: Lock down per-call project scope and verify multi-agent sharing

**Files:** Modify `server.cjs` only if tests reveal a defect; extend `mcp-http-test.js`.

- [ ] Add failing scope tests: explicit project takes priority over active project; same project shares saved memory/state; another project cannot see it; global remains visible; `all` is explicit; concurrent active-project switch does not change explicit project calls.
- [ ] Add two independent HTTP client sessions making concurrent writes/reads to a shared project and verify no loss or cross-scope leakage.
- [ ] Run the tests and establish RED for any existing defect.
- [ ] Make the smallest handler change needed. Preserve omitted project fallback for stdio/backward compatibility; make all HTTP examples send project explicitly. Validate project type/length, query size, and bounded limit at the request/tool boundary without changing existing storage semantics.
- [ ] Re-run focused tests; then full existing suite.

## Task 4: Document one-process startup and agent configuration

**Files:** Modify `README.md`.

- [ ] Document one command/process starts dashboard and MCP; dashboard URL and MCP `/mcp` URL; loopback-only constraint; no separate dashboard task.
- [ ] Document stdio compatibility and recommend HTTP for shared single-process multi-agent use.
- [ ] Give verified config examples for Hermes, Cline, and Gemini/Antigravity, with exact transport syntax based on current client documentation/config support. If any client does not support Streamable HTTP, state limitation and use a compatible supported transport without spawning duplicate database-owning processes; do not invent configuration fields.
- [ ] Explain project scope per tool call, same-project collaboration, global context, explicit all-project search, active-project fallback, and limitations: no automatic transcript sync or guaranteed proactive recall.
- [ ] Explain stable project naming and startup/recovery/port-conflict troubleshooting.
- [ ] Validate README examples against available clients/config where possible; mark unverified client syntax accurately.

## Task 5: Final verification, commit, push, and live setup

**Files:** all above.

- [ ] Run `node --check server.cjs`, `node --check dashboard.cjs`, `node --check mcp-http-test.js`, `node mcp-http-test.js`, and `node test-suite.js`; record actual output and exit statuses.
- [ ] Test stdio with `hermes mcp test nyan-mem` and confirm dashboard + MCP coexist on loopback in one process.
- [ ] Review `git diff --check`, `git diff --stat`, and full diff; verify no DB/backups/secrets are staged.
- [ ] Commit with a focused conventional commit message.
- [ ] Push to configured `origin` only after all acceptance tests pass; read back remote branch/commit via `git ls-remote` and compare SHA.
- [ ] Update the local MCP client configurations only after endpoint is live and tested. Configure Hermes, Cline, and Gemini/Antigravity to share the same HTTP process and project scope; retain a safe stdio rollback path until each client is verified.
- [ ] Verify each configured client can connect and call a read-only tool; then confirm dashboard loads and project isolation/shared scope behavior after restart.

## Self-review

- Covers all 10 acceptance criteria in the approved design.
- No schema change or data reassignment; existing data remains.
- Main implementation risk is whether each target client supports Streamable HTTP and exact config shape; Task 4 explicitly requires verification rather than assumptions.
- Main behavior boundary: HTTP clients must send explicit `project`; active-project fallback remains only for compatibility and is not described as safe for concurrent agents.
