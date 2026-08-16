---
name: context-graph
description: Manage focused engineering context with separate Code and Context Graphs. Use when initializing project context memory, selecting relevant modules for a coding task, reviewing dependency drift, or preparing context for DeepSeek and other coding agents.
---

# Context Graph Workflow

1. Run `context_graph_scan` when `.context/graph.json` is missing or code structure changed.
2. Treat scan results as proposals. Ask for confirmation before accepting or removing a relationship unless the user explicitly requested automatic reconciliation.
3. Keep Code Graph facts separate from Context Graph policy. An import usually proposes an `interface` edge with `interface` scope, not full source inclusion.
4. Before changing a module, run `context_compile` with the task, target module, and available token budget.
5. Honor `FORCE_EXCLUDE` and `FORCE_INCLUDE`. If exclusion risks contract consistency, explain the conflict instead of silently overriding it.
6. Update `.context/modules/<module>/state.md` after meaningful implementation changes and `decisions.md` only for durable architectural decisions.
7. Use `context_git_summary` for relevant recent history; do not load the entire repository history.

Start the visual editor with `node src/server.js` from the plugin root. It edits the same `.context/graph.json` used by the MCP tools.
