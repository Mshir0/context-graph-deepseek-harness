---
name: interface-contract
description: Extract Python, C, and C++ function and class interface contracts for minimal cross-module context. Use before changing an API or when Context Compiler should include an interface instead of an entire dependency source file.
---

# Interface Contract

Call `dependency_extract_interface` for the target module. Prefer `interface` and `contract` scopes on cross-module edges. Load dependency source only when the extracted contract is insufficient for the task.
