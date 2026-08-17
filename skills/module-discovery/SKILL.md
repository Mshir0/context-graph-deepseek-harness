---
name: module-discovery
description: Discover project code modules and symbols for Context Graph. Use before scanning a new workspace, after files are added or removed, or when an agent needs stable module ids without changing business code.
---

# Module Discovery

Call `dependency_discover_modules` for Python, C, or C++ facts or `context_graph_scan` for the plugin's supported project scan. Use changed project-relative source or header files for incremental dependency analysis. Treat discovered code as `code_module` nodes and review scan proposals before saving relationships.
