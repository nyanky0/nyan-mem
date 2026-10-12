# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user is a developer/operator managing local AI-agent memory on Windows. Secondary users are local agents using the MCP tools. The initial public audience installs and runs the open-source application themselves.

## Product Purpose

nyan-mem stores searchable durable memories and work state for AI agents, scoped by project with a deliberately shared global scope. A human manages projects, memories, settings, and verifies local service connections in the dashboard. Success means agents on the same project can retrieve reliable shared context while unrelated projects remain isolated.

## Positioning

A self-hosted, local-first memory service and dashboard that lets multiple local agents share durable project-scoped context through MCP, backed by the user's local SQLite data.

## Operating Context

The first supported release targets Windows. One local server process serves the dashboard and MCP HTTP endpoint. Several local agents may access it; agents assigned the same project share records. The database and server remain on the user's machine.

## Capabilities and Constraints

Confirmed: MCP HTTP and stdio transports; dashboard for project, memory, work-state, and configuration management; global and project-scoped memories; local SQLite persistence; project memory sharing across agents; initial release distributed as open-source via GitHub, with Windows support first. Current MCP calls need explicit project scope for reliable concurrent collaboration. Do not claim automatic synchronization of full conversations or proactive recall. Installer is a future release goal; publisher identity and code signing remain undecided. Multi-project assignment of one memory is a requested product capability and requires a data-model decision before implementation.

## Brand Commitments

Keep the product name nyan-mem. User-facing interface should use purposeful icons rather than decorative colored emoji, and avoid self-congratulatory anti-slop or AI-meta language. Provide Indonesian and English UI language selection.

## Evidence on Hand

The repository contains a working Node.js/SQLite application, browser dashboard, MCP server, and local client configuration examples. Do not invent user counts, hosted-service availability, or connection telemetry that the local server cannot actually observe.

## Product Principles

- Local ownership and data transparency.
- Make project scope explicit and predictable.
- Surface real server, API, and client connection state without fabricated health signals.
- Keep memory retrieval and project management quick to understand.
- Preserve recoverability of user data during setup, updates, and project changes.

## Accessibility & Inclusion

Support keyboard-accessible navigation and forms, clear focus indication, readable contrast, and reduced-motion preferences. Desktop-first Windows utility; narrow windows should remain usable.
