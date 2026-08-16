---
name: context-compiler
description: Compile and preview relevant modular context from any Context Graph entry. Use before an LLM step to select Tasks, Requirements, Constraints, Decisions, code, and minimal interfaces under a token budget while excluding raw or unrelated history.
---

# Context Compiler

Call `context_compile` with an `entry`, task, and optional include/exclude ids. Review included nodes, excluded nodes, relationship reasons, scopes, and estimated tokens. Raw Conversation nodes remain trace-only unless provenance is explicitly needed.
