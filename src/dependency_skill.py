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

def module_id(root, file):
    parts = list(file.relative_to(root).with_suffix("").parts)
    if parts[-1:] == ["__init__"]: parts.pop()
    return ".".join(parts) or root.name

def source_evidence(file, source, node):
    return {"file": str(file).replace("\\", "/"), "line": node.lineno, "evidence": ast.get_source_segment(source, node) or ""}

def longest_module(value, known):
    matches = [item for item in known if value == item or value.startswith(item + ".")]
    return max(matches, key=len) if matches else None

class Facts(ast.NodeVisitor):
    def __init__(self, module, file, source, known):
        self.module, self.file, self.source, self.known = module, file, source, known
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
        parent = self.module.split(".")[:-1]
        parent = parent[:max(0, len(parent) - level + 1)]
        return ".".join(parent + ((module or "").split(".") if module else []))

    def reference(self, value, kind, node):
        head = value.split(".")[0]
        resolved = self.instances.get(head) or self.aliases.get(head) or value
        target = longest_module(resolved, self.known)
        if target and target != self.module: self.relation(target, kind, node, resolved)

    def visit_Import(self, node):
        for item in node.names:
            self.aliases[item.asname or item.name.split(".")[0]] = item.name
            target = longest_module(item.name, self.known)
            if target and target != self.module: self.relation(target, "IMPORT", node, item.name)

    def visit_ImportFrom(self, node):
        base = self.resolve_import(node.module, node.level)
        target = longest_module(base, self.known)
        if target and target != self.module: self.relation(target, "IMPORT", node, base)
        for item in node.names:
            if item.name != "*": self.aliases[item.asname or item.name] = f"{base}.{item.name}" if base else item.name

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
                resolved = self.aliases.get(value.split(".")[0], value)
                for target in node.targets:
                    if isinstance(target, ast.Name): self.instances[target.id] = resolved
        self.generic_visit(node)

    def visit_Call(self, node):
        value = dotted(node.func)
        if value in {"getattr", "__import__"} or (value and "load_" in value): self.relation("?", "OPTIONAL_DEPENDENCY", node, value, 0.42, dynamic=True, reason="Runtime symbol resolution required")
        elif value:
            head = value.split(".")[0]
            resolved = self.instances.get(head) or self.aliases.get(head) or value
            if head in self.instances and "." in value:
                resolved = f"{resolved}.{value.split('.', 1)[1]}"
            self.reference(resolved, "CALL", node)
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
            facts = Facts(module_id(root, file), relative, file.read_text(encoding="utf-8"), known); facts.visit(facts.tree)
            modules.append({"id": facts.module, "path": relative, "language": "python", "symbols": facts.symbols}); relations.extend(facts.relations); interfaces.extend(facts.interfaces)
        except (SyntaxError, UnicodeError, OSError) as exc: errors.append({"file": relative, "error": str(exc)})
    return {"version": 1, "language": "python", "modules": modules, "relationships": relations, "interfaces": interfaces, "errors": errors, "analyzed_files": [item.relative_to(root).as_posix() for item in files]}

if __name__ == "__main__":
    if len(sys.argv) < 2: raise SystemExit("usage: dependency_skill.py PROJECT [relative-file ...]")
    print(json.dumps(analyze(sys.argv[1], sys.argv[2:]), ensure_ascii=False))
