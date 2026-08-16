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


def analyze(root: Path):
    modules = []
    errors = []
    ignored = {".git", ".context", "node_modules", ".venv", "venv", "__pycache__"}
    source_files = sorted(
        file_path for file_path in root.rglob("*")
        if file_path.is_file() and (file_path.suffix == ".py" or file_path.suffix.lower() in C_EXTENSIONS)
    )
    for file_path in source_files:
        if any(part in ignored for part in file_path.parts):
            continue
        if file_path.suffix.lower() in C_EXTENSIONS:
            try:
                text = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                errors.append({"file": str(file_path.relative_to(root)), "error": str(exc)})
                continue
            calls = sorted(set(CALL_RE.findall(text)))
            symbols = [
                {"name": match.group(1), "kind": "function", "line": text[:match.start()].count("\n") + 1}
                for match in FUNCTION_RE.finditer(text)
            ]
            modules.append({
                "id": module_name(root, file_path),
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
        symbols = []
        inheritance = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                base = "." * node.level + (node.module or "")
                imports.extend(f"{base}.{alias.name}".rstrip(".") for alias in node.names)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                symbols.append({"name": node.name, "kind": "function", "line": node.lineno})
            elif isinstance(node, ast.ClassDef):
                symbols.append({"name": node.name, "kind": "class", "line": node.lineno})
                inheritance.extend(filter(None, (dotted_name(base) for base in node.bases)))

        usage = UsageVisitor()
        usage.visit(tree)
        modules.append({
            "id": module_name(root, file_path),
            "path": str(file_path.relative_to(root)).replace(os.sep, "/"),
            "language": "python",
            "imports": sorted(set(imports)),
            "calls": sorted(usage.calls),
            "references": sorted(usage.references),
            "inheritance": sorted(set(inheritance)),
            "symbols": sorted(symbols, key=lambda item: (item["line"], item["name"])),
        })
    return {"version": 1, "root": str(root), "modules": modules, "errors": errors}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: analyze_python.py PROJECT", file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(analyze(Path(sys.argv[1]).resolve()), ensure_ascii=False))
