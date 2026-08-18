---
name: context-maintenance
description: Maintain Context Graph after code or structured context changes. Use for dependency drift, conflict detection, superseded requirements, stale automatic edges, and incremental updates while preserving user overrides.
---

# Context Maintenance

Use `dependency_detect_changes`, `dependency_check_consistency`, and `context_detect_conflicts`. For a repository-wide graph, pass the files changed in the current task to `dependency_check_consistency`; only request an unscoped check when the user explicitly asks for a full-project audit. Keep `max_items` small and use the returned counts instead of requesting omitted details unless they block the task. Return proposals for review. Never automatically delete manual edges or old requirements; represent an explicit replacement with `supersedes` and retain provenance.
