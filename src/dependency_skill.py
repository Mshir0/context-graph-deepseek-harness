#!/usr/bin/env python3
"""Read-only Python dependency and interface fact extractor."""
import ast
import json
import sys
from pathlib import Path

IGNORED = {".git", ".context", "node_modules", ".venv", "venv", "__pycache__"}

def dotted(node):
    if isinstance(node, ast.Name): return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return None

def annotation(node): return ast.unparse(node) if node is not None else "unknown"

def package_id(root, file):
    parts = list(file.relative_to(root).with_suffix("").parts)
    if parts: parts.pop()
    return ".".join(parts)

def module_id(root, file):
    parts = list(file.relative_to(root).with_suffix("").parts)
    if parts[-1:] == ["__init__"]: parts.pop()
    return ".".join(parts) or root.name

def source_evidence(file, source, node):
    return {"file": str(file).replace("\\", "/"), "line": node.lineno, "evidence": ast.get_source_segment(source, node) or ""}

def longest_module(value, known):
    """Resolve an import/reference name to the canonical scanned module id.

    Module ids are derived from paths relative to the analysis root.  A
    workspace can therefore contain an extra directory above the importable
    package (for example ``starlette/starlette/datastructures.py`` scanned
    from the workspace parent).  In that layout the canonical id is
    ``starlette.starlette.datastructures`` while the source imports
    ``starlette.datastructures``.  Treat a known id that ends with the import
    name as an alias, while retaining the path-derived id as the relationship
    target.  Exact/prefix matches remain preferred so normal projects keep
    their existing behaviour.
    """
    value = (value or "").strip().lstrip(".")
    if not value: return None
    exact = [item for item in known if value == item or value.startswith(item + ".")]
    if exact: return max(exact, key=len)
    # References include a symbol suffix (``package.module.Class``), so try
    # each import-prefix before applying the package-root alias.  This keeps
    # both ``from package.module import Class`` and a later ``Class()``
    # reference attached to the same canonical module.
    parts = value.split(".")
    for end in range(len(parts), 0, -1):
        alias = ".".join(parts[:end])
        aliases = sorted(item for item in known if item.endswith("." + alias))
        if aliases:
            # Two source roots may expose the same import package.  Guessing
            # here would create a convincing but false dependency edge.
            return aliases[0] if len(aliases) == 1 else None
    return None

class Facts(ast.NodeVisitor):
    def __init__(self, module, file, source, known, is_package=False, package=None):
        self.module, self.file, self.source, self.known = module, file, source, known
        self.package = package if package is not None else module if is_package else module.rpartition(".")[0]
        self.tree = ast.parse(source, filename=file)
        self.relations, self.interfaces, self.symbols = [], [], []
        self.aliases, self.instances, self.scope = {}, {}, []

    def current_symbol(self): return ".".join(self.scope) or None

    def relation(self, target, kind, node, symbol=None, confidence=1.0, **extra):
        relation = {"from": self.module, "from_symbol": self.current_symbol(), "to": target, "type": kind, "symbol": symbol, "confidence": confidence, "evidence": [source_evidence(self.file, self.source, node)], **extra}
        key = (relation["from"], relation["from_symbol"], relation["to"], relation["type"], relation["symbol"], relation["evidence"][0]["line"])
        if not any((item["from"], item.get("from_symbol"), item["to"], item["type"], item.get("symbol"), item["evidence"][0]["line"]) == key for item in self.relations): self.relations.append(relation)

    def resolve_import(self, module, level):
        if level == 0: return module or ""
        package = self.package.split(".") if self.package else []
        ascend = level - 1
        parent = package[:max(0, len(package) - ascend)]
        return ".".join(parent + ((module or "").split(".") if module else []))

    def resolve_name(self, value):
        head, separator, tail = value.partition(".")
        resolved = self.instances.get(head) or self.aliases.get(head)
        if not resolved: return value
        return f"{resolved}.{tail}" if separator else resolved

    def reference(self, value, kind, node):
        resolved = self.resolve_name(value)
        target = longest_module(resolved, self.known)
        if target and target != self.module: self.relation(target, kind, node, resolved)

    def visit_Import(self, node):
        for item in node.names:
            binding = item.asname or item.name.split(".")[0]
            self.aliases[binding] = item.name if item.asname else binding
            target = longest_module(item.name, self.known)
            if target and target != self.module: self.relation(target, "IMPORT", node, item.name)

    def visit_ImportFrom(self, node):
        base = self.resolve_import(node.module, node.level)
        base_target = longest_module(base, self.known)
        for item in node.names:
            if item.name == "*":
                if base_target and base_target != self.module: self.relation(base_target, "IMPORT", node, base)
                continue
            imported = f"{base}.{item.name}" if base else item.name
            target = longest_module(imported, self.known) or base_target
            if target and target != self.module:
                symbol = imported if target != base_target else base
                self.relation(target, "IMPORT", node, symbol)
            self.aliases[item.asname or item.name] = imported

    def visit_FunctionDef(self, node):
        name = ".".join(self.scope + [node.name]); self.symbols.append({"name": name, "kind": "function", "line": node.lineno})
        inputs = [{"name": arg.arg, "type": annotation(arg.annotation)} for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs]
        self.interfaces.append({"module": self.module, "symbol": name, "kind": "function", "input": inputs, "output": annotation(node.returns), "confidence": 1.0, "evidence": [source_evidence(self.file, self.source, node)]})
        self.scope.append(node.name); self.generic_visit(node); self.scope.pop()
    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        name = ".".join(self.scope + [node.name]); self.symbols.append({"name": name, "kind": "class", "line": node.lineno})
        self.interfaces.append({"module": self.module, "symbol": name, "kind": "class", "input": [], "output": name, "confidence": 1.0, "evidence": [source_evidence(self.file, self.source, node)]})
        for base in node.bases:
            value = dotted(base)
            if value: self.reference(value, "INHERIT", base)
        self.scope.append(node.name); self.generic_visit(node); self.scope.pop()

    def visit_Assign(self, node):
        if isinstance(node.value, ast.Call):
            value = dotted(node.value.func)
            if value:
                resolved = self.resolve_name(value)
                for target in node.targets:
                    if isinstance(target, ast.Name): self.instances[target.id] = resolved
        self.generic_visit(node)

    def visit_Call(self, node):
        value = dotted(node.func)
        if value in {"getattr", "__import__"} or (value and "load_" in value): self.relation("?", "OPTIONAL_DEPENDENCY", node, value, 0.42, dynamic=True, reason="Runtime symbol resolution required")
        elif value:
            self.reference(value, "CALL", node)
        self.generic_visit(node)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load) and node.id in self.aliases: self.reference(node.id, "REFERENCE", node)

def analyze(root, selected_files=None):
    root = Path(root).resolve()
    all_files = [item for item in sorted(root.rglob("*.py")) if not any(part in IGNORED for part in item.parts)]
    known = {module_id(root, item) for item in all_files}; requested = {Path(item).as_posix() for item in selected_files or []}
    files = [item for item in all_files if not requested or item.relative_to(root).as_posix() in requested]
    modules, relations, interfaces, errors = [], [], [], []
    for file in files:
        relative = file.relative_to(root).as_posix()
        try:
            facts = Facts(module_id(root, file), relative, file.read_text(encoding="utf-8"), known, file.name == "__init__.py", package_id(root, file)); facts.visit(facts.tree)
            modules.append({"id": facts.module, "path": relative, "language": "python", "symbols": facts.symbols}); relations.extend(facts.relations); interfaces.extend(facts.interfaces)
        except (SyntaxError, UnicodeError, OSError) as exc: errors.append({"file": relative, "error": str(exc)})
    return {"version": 1, "language": "python", "modules": modules, "relationships": relations, "interfaces": interfaces, "errors": errors, "analyzed_files": [item.relative_to(root).as_posix() for item in files]}

if __name__ == "__main__":
    if len(sys.argv) < 2: raise SystemExit("usage: dependency_skill.py PROJECT [relative-file ...]")
    print(json.dumps(analyze(sys.argv[1], sys.argv[2:]), ensure_ascii=False))
