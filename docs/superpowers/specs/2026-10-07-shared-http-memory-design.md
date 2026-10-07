# nyan-mem Shared Local HTTP Memory — Design

## Goal
Run one local nyan-mem process that serves its dashboard and MCP over HTTP, so all local agents share durable, project-scoped memory and collaboration state without switching a global active project.

## Current evidence
- `server.cjs` starts `dashboard.cjs` and handles MCP JSON-RPC over stdio.
- `dashboard.cjs` binds its dashboard to `127.0.0.1` and uses the same SQLite database.
- Tool handlers currently derive omitted project scope from a database-wide `active_project`; switching it is unsafe with concurrent agents.
- The database already stores projects, memories, and work state. Existing per-project and `global` data should be retained.

## Architecture
Use one long-running Node process, started once by the user/session, with dashboard and MCP Streamable HTTP on the existing local dashboard listener using distinct routes. Keep stdio transport supported for backwards compatibility and run the same tool handlers for both transports. Bind exclusively to `127.0.0.1`. MCP clients connect to one stable URL; no external dependencies or public network access.

MCP calls must resolve scope from explicit per-call `project` first. For compatibility, omitted project falls back to the current active project, but the HTTP clients must be configured with project-specific defaults or prompts instruct them to pass the project. Changing active project must not affect in-flight or later calls from clients that specify scope. `global` memories remain visible alongside a named project's data as today; explicit `all` remains an intentional cross-project query. Do not add agent-specific partitions: agents working on the same project share its records. Keep attribution (`source_agent`) optional only if the caller supplies it; do not rely on it for authorization or isolation.

The single process owns one SQLite connection, avoiding multi-process SQLite contention. Start dashboard once and report readiness/port errors clearly. Preserve the current UI and APIs. Add an MCP endpoint on the same loopback listener, with bounded request bodies, correct JSON-RPC errors, protocol initialization/tool discovery/call handling, and no permissive CORS. No authentication is required for loopback-only use in this first version; do not bind to LAN. Expose a health/status response that does not disclose memory contents or secrets.

## Scope and collaboration contract
- Same canonical project identifier => shared memory and work state across all agents.
- Different project identifier => no cross-project records except `global` by the current documented behavior.
- Shared `active_project` is dashboard/default convenience only; it is not a reliable identity for concurrent agent calls.
- Each HTTP MCP client should be configured to pass the intended project scope. Provide concise setup examples for Hermes, Cline, and Gemini/Antigravity, documenting their supported remote MCP transport syntax and any client-specific limitation. Do not claim automatic workspace-path discovery unless implemented and tested.
- Agents collaborate by saving durable findings/decisions and updating work state, then searching/reading that shared project scope. This is durable shared memory, not automatic sharing of full chat transcripts or guaranteed proactive notification.

## Data compatibility
No schema migration is required for the initial transport/scope change. Existing records, project names, `global` records, settings, backups, and dashboard behavior remain intact. Avoid renaming projects or reassigning data automatically. Explain project ID/name semantics and provide a manual mapping/setup procedure if clients start from repository paths.

## Security and reliability requirements
- Bind only to IPv4 loopback (`127.0.0.1`); reject or avoid wildcard binding.
- Do not log request bodies, memory contents, or API keys.
- Bound HTTP request size and reject malformed/unsupported JSON-RPC requests safely.
- Do not add permissive CORS; dashboard remains usable locally.
- Use parameterized SQL as existing handlers do; validate project/limit/query inputs at the MCP boundary.
- Ensure errors are returned without stack traces or secrets.
- Keep stdio backward-compatible and keep its stdout protocol channel free of ordinary logs.
- Handle concurrent HTTP tool calls through the existing single process/DB connection; verify concurrent reads/writes and scope isolation.
- Startup fails visibly if the dashboard/MCP listener cannot bind; do not silently report healthy.

## Verification / acceptance criteria
1. Existing test suite passes (report unrelated baseline/environment failures honestly).
2. MCP initialize, tools/list, ping, tools/call work over HTTP through a real MCP client or protocol harness.
3. Dashboard serves on its current loopback URL when the unified process starts; no separate dashboard task/process is needed.
4. Two independent HTTP clients can concurrently read/write one project and observe shared results.
5. A different project cannot read the first project's non-global data; global visibility matches documented behavior; `all` is explicit.
6. Explicit project calls remain correctly scoped despite concurrent active-project switching.
7. stdio MCP still passes `hermes mcp test` or equivalent transport-level test.
8. Request size, malformed input, unsupported method, listener conflict, and invalid project input produce safe, clear errors.
9. Documentation covers single-process startup, local URL, all agent client configs, scope rules, recovery and limitations.
10. Changes are committed and pushed to the existing GitHub remote only after full verification.

## Out of scope
- Remote/LAN access, TLS, cloud deployment, cross-machine synchronization.
- Agent-specific private memory, automatic agent identity/authZ, chat transcript sync, push notifications.
- Automatic repository path-to-project mapping until each target MCP client can supply that context reliably.
- Search ranking, vector embeddings, caching, or other performance work without measured need.
