#!/usr/bin/env python3
"""Emit a lightweight code graph for Python and C-family projects."""

import ast
import json
import os
import re
import sys
from pathlib import Path


C_EXTENSIONS = {".c": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp"}
INCLUDE_RE = re.compile(r'^\s*#\s*include\s*[<"]([^">]+)[">]', re.MULTILINE)
FUNCTION_RE = re.compile(r'^\s*(?:[A-Za-z_]\w*\s+)*[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{', re.MULTILINE)
CALL_RE = re.compile(r'\b([A-Za-z_]\w*)\s*\(')


def module_name(root: Path, file_path: Path) -> str:
    rel = file_path.relative_to(root).with_suffix("")
    parts = list(rel.parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts) or root.name


def package_name(root: Path, file_path: Path) -> str:
    rel = file_path.relative_to(root).with_suffix("")
    parts = list(rel.parts)
    if parts:
        parts.pop()
    return ".".join(parts)


def resolve_module(value, known):
    """Map an import name to one unambiguous path-derived module id."""
    value = (value or "").strip().lstrip(".")
    if not value:
        return None
    direct = [item for item in known if value == item or value.startswith(item + ".")]
    if direct:
        return max(direct, key=len)
    parts = value.split(".")
    for end in range(len(parts), 0, -1):
        alias = ".".join(parts[:end])
        matches = sorted(item for item in known if item.endswith("." + alias))
        if matches:
            return matches[0] if len(matches) == 1 else None
    return None


def resolve_import_base(current_module, is_package, imported_module, level):
    if level == 0:
        return imported_module or ""
    package = current_module if is_package else current_module.rpartition(".")[0]
    parts = package.split(".") if package else []
    ascend = level - 1
    parent = parts[:max(0, len(parts) - ascend)]
    return ".".join(parent + ((imported_module or "").split(".") if imported_module else []))


class UsageVisitor(ast.NodeVisitor):
    def __init__(self):
        self.calls = set()
        self.references = set()

    def visit_Call(self, node):
        name = dotted_name(node.func)
        if name:
            self.calls.add(name)
        self.generic_visit(node)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.references.add(node.id)

    def visit_Attribute(self, node):
        name = dotted_name(node)
        if name:
            self.references.add(name)
        self.generic_visit(node)


def dotted_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        left = dotted_name(node.value)
        return f"{left}.{node.attr}" if left else node.attr
    return None


def symbol_id(module: str, name: str) -> str:
    return f"{module}:{name}"


def symbol_signature(node) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
        result = f"{prefix} {node.name}({ast.unparse(node.args)})"
        if node.returns is not None:
            result += f" -> {ast.unparse(node.returns)}"
        return result
    if isinstance(node, ast.ClassDef):
        bases = [ast.unparse(base) for base in node.bases]
        bases.extend(ast.unparse(keyword) for keyword in node.keywords)
        suffix = f"({', '.join(bases)})" if bases else ""
        return f"class {node.name}{suffix}"
    return ""


def symbol_start_line(node) -> int:
    decorators = getattr(node, "decorator_list", [])
    return min([node.lineno, *(item.lineno for item in decorators)])


class SymbolVisitor(ast.NodeVisitor):
    """Collect nested symbol boundaries and calls without changing old module facts."""

    def __init__(self, module):
        self.module = module
        self.scope = []
        self.scope_kinds = []
        self.symbols = []
        self.current = []

    def add_symbol(self, node, kind):
        name = ".".join(self.scope + [node.name])
        qualified = symbol_id(self.module, name)
        container = symbol_id(self.module, ".".join(self.scope)) if self.scope else self.module
        subkind = kind
        if kind == "function" and self.scope_kinds and self.scope_kinds[-1] == "class":
            subkind = "method"
        item = {
            "id": qualified,
            "qualified_id": qualified,
            "name": name,
            "short_name": node.name,
            "kind": kind,
            "subkind": subkind,
            "container": container,
            "signature": symbol_signature(node),
            "line": node.lineno,
            "start_line": symbol_start_line(node),
            "end_line": getattr(node, "end_lineno", node.lineno),
            "calls": [],
        }
        self.symbols.append(item)
        return item

    def visit_ClassDef(self, node):
        item = self.add_symbol(node, "class")
        self.scope.append(node.name)
        self.scope_kinds.append("class")
        self.current.append(item)
        self.generic_visit(node)
        self.current.pop()
        self.scope_kinds.pop()
        self.scope.pop()

    def visit_FunctionDef(self, node):
        item = self.add_symbol(node, "function")
        self.scope.append(node.name)
        self.scope_kinds.append("function")
        self.current.append(item)
        self.generic_visit(node)
        self.current.pop()
        self.scope_kinds.pop()
        self.scope.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Call(self, node):
        name = dotted_name(node.func)
        if name and self.current and name not in self.current[-1]["calls"]:
            self.current[-1]["calls"].append(name)
        self.generic_visit(node)


def analyze(root: Path, selected_files=None):
    modules = []
    errors = []
    ignored = {".git", ".context", "node_modules", ".venv", "venv", "__pycache__"}
    source_files = sorted(
        file_path for file_path in root.rglob("*")
        if file_path.is_file() and (file_path.suffix == ".py" or file_path.suffix.lower() in C_EXTENSIONS)
        and not any(part in ignored for part in file_path.parts)
    )
    known_python = {module_name(root, file_path) for file_path in source_files if file_path.suffix == ".py"}
    requested = {Path(item).as_posix() for item in selected_files or []}
    if requested:
        source_files = [
            file_path for file_path in source_files
            if file_path.relative_to(root).as_posix() in requested
        ]
    for file_path in source_files:
        if file_path.suffix.lower() in C_EXTENSIONS:
            try:
                text = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                errors.append({"file": str(file_path.relative_to(root)), "error": str(exc)})
                continue
            calls = sorted(set(CALL_RE.findall(text)))
            module = module_name(root, file_path)
            symbols = []
            for match in FUNCTION_RE.finditer(text):
                name = match.group(1)
                line = text[:match.start()].count("\n") + 1
                qualified = symbol_id(module, name)
                symbols.append({
                    "id": qualified,
                    "qualified_id": qualified,
                    "name": name,
                    "short_name": name,
                    "kind": "function",
                    "subkind": "function",
                    "container": module,
                    "signature": " ".join(match.group(0).rsplit("{", 1)[0].split()),
                    "line": line,
                    "start_line": line,
                    "end_line": line,
                    "calls": [],
                })
            modules.append({
                "id": module,
                "path": str(file_path.relative_to(root)).replace(os.sep, "/"),
                "language": C_EXTENSIONS[file_path.suffix.lower()],
                "imports": sorted(set(INCLUDE_RE.findall(text))),
                "calls": calls,
                "references": [],
                "inheritance": [],
                "symbols": sorted(symbols, key=lambda item: (item["line"], item["name"])),
            })
            continue
        try:
            text = file_path.read_text(encoding="utf-8")
            tree = ast.parse(text, filename=str(file_path))
        except (OSError, UnicodeError, SyntaxError) as exc:
            errors.append({"file": str(file_path.relative_to(root)), "error": str(exc)})
            continue

        imports = []
        inheritance = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(resolve_module(alias.name, known_python) or alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                base = resolve_import_base(package_name(root, file_path), True, node.module, node.level)
                base_target = resolve_module(base, known_python)
                for alias in node.names:
                    if alias.name == "*":
                        if base_target or base:
                            imports.append(base_target or base)
                        continue
                    candidate = f"{base}.{alias.name}" if base else alias.name
                    imports.append(resolve_module(candidate, known_python) or base_target or base or candidate)
            elif isinstance(node, ast.ClassDef):
                inheritance.extend(filter(None, (dotted_name(base) for base in node.bases)))

        usage = UsageVisitor()
        usage.visit(tree)
        symbol_visitor = SymbolVisitor(module_name(root, file_path))
        symbol_visitor.visit(tree)
        modules.append({
            "id": module_name(root, file_path),
            "path": str(file_path.relative_to(root)).replace(os.sep, "/"),
            "language": "python",
            "imports": sorted(set(imports)),
            "calls": sorted(usage.calls),
            "references": sorted(usage.references),
            "inheritance": sorted(set(inheritance)),
            "symbols": sorted(symbol_visitor.symbols, key=lambda item: (item["line"], item["name"])),
        })
    return {"version": 1, "root": str(root), "modules": modules, "errors": errors}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: analyze_python.py PROJECT [relative-file ...]", file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(analyze(Path(sys.argv[1]).resolve(), sys.argv[2:]), ensure_ascii=False))
