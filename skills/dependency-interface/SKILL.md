---
name: dependency-interface
description: Analyze Python, C, and C++ module, symbol, call, inheritance, and interface relationships for a Context Graph project. Use when an agent needs evidence-backed dependency facts, callers/callees, interface contracts, context-edge proposals, or Context Graph consistency checks without modifying source code or graph storage.
---

# Dependency Interface

Use the plugin tools as a read-only fact layer. Start with `dependency_discover_modules`, then call `dependency_analyze_module` or `dependency_analyze_dependencies` for a target. Every asserted relationship must retain its evidence and confidence.

Use `dependency_find_callers`, `dependency_find_callees`, and `dependency_extract_interface` before changing cross-module APIs. Prefer the extracted contract over loading an unrelated module's whole source.

Treat `dependency_propose_context_edges` and `dependency_check_consistency` as non-binding recommendations. Only call `context_graph_save` after a user or agent has explicitly reviewed the proposed graph JSON. Never remove or override `FORCE_INCLUDE` or `FORCE_EXCLUDE` relationships from automated analysis.

For a code change, retain the prior Dependency Skill JSON, call `dependency_detect_changes` with it and the changed project-relative Python, C, or C++ files, then review added and removed facts. C/C++ extraction supports `.c`, `.cc`, `.cpp`, `.cxx`, `.h`, `.hh`, `.hpp`, and `.hxx`; it is intentionally conservative around macros, overloads, and unresolved external symbols. Dynamic facts have low confidence and must not be represented as confirmed dependencies.
