---
name: context-extraction
description: Extract traceable Task, Requirement, Constraint, Decision, Issue, and Note proposals from user or assistant messages for Modular Context Graph. Use when important conversation content should become durable structured context, when requirements change or conflict, or when an agent must preserve source provenance without loading full conversation history.
---

# Context Extraction

Call `context_extract` with one source message and its stable conversation/message ids. Review the returned raw Conversation/Message nodes, structured nodes, `derived_from` edges, confidence, and warnings.

Keep extraction conservative. Do not convert unclassified prose into requirements. Do not invent target modules or edges; use `target = unknown` conceptually until code evidence or a user identifies the target. Leave `apply` false until the proposal has been reviewed, then call again with the same ids and `apply=true`.

Use `context_detect_conflicts` after adding or changing requirements, constraints, or decisions. Preserve old nodes. When a new statement explicitly replaces an earlier one, create `supersedes` and mark the earlier node `superseded`; otherwise propose `conflicts_with` for review.

Keep raw Conversation nodes trace-only. Compile from a structured Task, Requirement, Issue, Test, or CodeModule entry with `context_compile`; do not include entire conversations unless structured context is insufficient and provenance must be inspected.

Treat user-created nodes and `MANUAL`, `FORCE_INCLUDE`, or `FORCE_EXCLUDE` edges as authoritative. Never delete or rewrite them through automatic maintenance.
