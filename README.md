# 🐾 nyan-mem 🎀

> **Lightweight, Zero-API-Cost, Anti-Slop Project-Scoped Memory Engine & MCP Server**

`nyan-mem` is a local project-scoped memory engine and dashboard built on Node.js native SQLite/FTS5.

## Features

- Dual-perspective technical and layman summaries.
- Project-scoped memories and work state, plus shared `global` context.
- SQLite FTS5 full-text search.
- Local dashboard at `http://127.0.0.1:37788/`.
- MCP over stdio for legacy/single-client use, and Streamable HTTP for a shared local server.
- CLI: `node cli.cjs`.

## Prerequisite

Node.js 22 or 24 with native `node:sqlite` support.

## Start one shared local MCP + dashboard process

Windows:

```bat
set NYAN_MEM_MCP_HTTP=1
node "%USERPROFILE%\.nyan-mem\server.cjs"
```

The same process starts the dashboard and MCP HTTP endpoint. Dashboard: `http://127.0.0.1:37788/`. MCP: `http://127.0.0.1:37788/mcp`. Health: `http://127.0.0.1:37788/healthz`. Set `NYAN_MEM_PORT` before starting to select another port. The server binds only to loopback; do not expose it to LAN/internet.

Keep this process running while agents use it. Stdio remains compatible, but each stdio client starts its own process/database connection. Do not run simultaneous server processes against the same SQLite database.

### Hermes HTTP config

In `%USERPROFILE%\.hermes\config.yaml`:

```yaml
mcp_servers:
  nyan-mem:
    url: http://127.0.0.1:37788/mcp
    tools: all
```

Restart Hermes after changing the config and verify with `hermes mcp test nyan-mem`.

Cline and Gemini/Antigravity use client-specific MCP settings and version-dependent HTTP transport support. Configure their HTTP MCP UI with the same endpoint if supported; remove their old stdio entry only after verifying HTTP connection. Do not configure them to launch `server.cjs` as independent processes in shared-HTTP mode.

## Project scope and shared collaboration

Pass `project` explicitly on every memory/state call. Agents using the same project name share memory and work state; other named projects are isolated. Project-scoped reads include `global` context. Use `project: "all"` only when intentionally searching across projects. The dashboard's active project is a convenience, not a safe identity for concurrent agents.

Save durable findings/decisions and update work state; other agents can then retrieve them from the shared project. Full chat transcripts are not synchronized, and agents are not proactively notified. Reserve `global` for facts intended across projects. Existing database records are retained; use stable project names.

## Test

```sh
node --check server.cjs
node --check dashboard.cjs
node dashboard-server-test.js
node mcp-http-test.js
node test-suite.js
```

## Troubleshooting

- Check `GET /healthz` for process availability.
- A port conflict fails visibly; select an unused `NYAN_MEM_PORT` and update clients to match.
- Legacy stdio configuration remains a rollback option.

## License

MIT License © 2026 nyan-mem contributors.
