#!/usr/bin/env python3
"""Read-only Python and C/C++ dependency/interface fact extractor."""
import ast
import json
import re
import sys
from pathlib import Path

IGNORED = {".git", ".context", "node_modules", ".venv", "venv", "__pycache__"}
C_EXTENSIONS = {".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"}
C_HEADER_EXTENSIONS = {".h", ".hh", ".hpp", ".hxx"}
C_SOURCE_EXTENSIONS = C_EXTENSIONS - C_HEADER_EXTENSIONS
C_LANGUAGE = {".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hh": "cpp", ".hpp": "cpp", ".hxx": "cpp"}

# The C-family extractor is deliberately conservative. It is a fallback for
# hosts without clang/libclang, not a replacement for a standards-compliant
# parser. The masking pass below preserves line offsets while preventing
# comments, strings, and preprocessor bodies from becoming false symbols.
C_INCLUDE_RE = re.compile(r"^\s*#\s*include\s*[<\"]([^>\"]+)[>\"]", re.MULTILINE)
C_SCOPE_RE = re.compile(r"\b(namespace|class|struct)\s+([A-Za-z_]\w*(?:::\w+)*)[^{};]*\{")
C_FUNCTION_RE = re.compile(
    r"(?m)^[ \t]*(?P<before>[^\n;{}=]*?)\b"
    r"(?P<name>(?:[A-Za-z_]\w*::)*~?[A-Za-z_]\w*)\s*"
    r"\((?P<params>[^()\n;{}]*)\)\s*"
    r"(?P<qual>(?:(?:const|volatile|noexcept|override|final|constexpr|requires)\b[^\n{};]*)?)"
    r"(?P<term>[;{])"
)
C_CALL_RE = re.compile(r"(?<![A-Za-z0-9_])(?P<name>(?:[A-Za-z_]\w*\s*(?:::|->|\.)\s*)*[A-Za-z_]\w*)\s*\(")
C_IDENTIFIER_RE = re.compile(r"[A-Za-z_]\w*")
C_CONTROL_NAMES = {"if", "for", "while", "switch", "catch", "sizeof", "decltype", "return", "new", "delete", "alignof", "static_cast", "dynamic_cast", "const_cast", "reinterpret_cast"}

def dotted(node):
    if isinstance(node, ast.Name): return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return None

def annotation(node): return ast.unparse(node) if node is not None else "unknown"

def symbol_id(module, name): return f"{module}:{name}"

def signature(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
        value = f"{prefix} {node.name}({ast.unparse(node.args)})"
        return f"{value} -> {ast.unparse(node.returns)}" if node.returns is not None else value
    if isinstance(node, ast.ClassDef):
        bases = [ast.unparse(base) for base in node.bases]
        bases.extend(ast.unparse(keyword) for keyword in node.keywords)
        suffix = f"({', '.join(bases)})" if bases else ""
        return f"class {node.name}{suffix}"
    return ""

def start_line(node):
    decorators = getattr(node, "decorator_list", [])
    return min([node.lineno, *(item.lineno for item in decorators)])

def package_id(root, file):
    parts = list(file.relative_to(root).with_suffix("").parts)
    if parts: parts.pop()
    return ".".join(parts)

def module_id(root, file):
    parts = list(file.relative_to(root).with_suffix("").parts)
    if parts[-1:] == ["__init__"]: parts.pop()
    return ".".join(parts) or root.name


def c_base_id(root, file):
    """Return a path-derived C-family module id without its extension."""
    parts = list(file.relative_to(root).with_suffix("").parts)
    return ".".join(parts) or root.name


def c_module_ids(root, files, python_ids):
    """Assign deterministic, collision-free ids to C/C++ paths.

    Existing projects traditionally see ``src/foo.cpp`` as ``src.foo``. Keep
    that id while it is unambiguous. Headers always retain their extension so
    ``foo.cpp`` and ``foo.hpp`` cannot collapse into one module. If two source
    files share a stem, append the source extension to both (``foo.c`` and
    ``foo.cpp``).
    """
    c_files = [file for file in files if file.suffix.lower() in C_EXTENSIONS]
    by_base = {}
    for file in c_files:
        by_base.setdefault(c_base_id(root, file), []).append(file)
    result = {}
    used = set(python_ids)
    for file in c_files:
        extension = file.suffix.lower()
        base = c_base_id(root, file)
        if extension in C_HEADER_EXTENSIONS:
            candidate = f"{base}{extension}"
        elif len([item for item in by_base[base] if item.suffix.lower() in C_SOURCE_EXTENSIONS]) > 1 or base in used:
            candidate = f"{base}{extension}"
        else:
            candidate = base
        # A path can still collide with another language or a file whose name
        # contains a dot. Resolve the rare remainder without guessing.
        if candidate in used or candidate in result.values():
            candidate = f"{base}{extension}"
            suffix = 2
            while candidate in used or candidate in result.values():
                candidate = f"{base}{extension}.{suffix}"
                suffix += 1
        result[file] = candidate
        used.add(candidate)
    return result


def _mask_c_source(source):
    """Blank comments/strings/preprocessor bodies while retaining newlines."""
    chars = list(source)
    length = len(chars)
    index = 0
    line_start = True
    while index < length:
        char = chars[index]
        if char == "\n":
            line_start = True
            index += 1
            continue
        if line_start and char in " \t\r":
            index += 1
            continue
        if line_start and char == "#":
            # Keep an include's original text for C_INCLUDE_RE, but remove
            # all other preprocessor directives from symbol scanning.
            end = index
            while end < length:
                if chars[end] == "\n":
                    break
                if chars[end] == "\\" and end + 1 < length and chars[end + 1] == "\n":
                    end += 2
                    continue
                end += 1
            if not source[index:end].lstrip().startswith("#include") and not re.match(r"#\s*include", source[index:end].lstrip()):
                for position in range(index, end):
                    chars[position] = " "
            line_start = False
            index = end
            continue
        line_start = False
        if char == "/" and index + 1 < length and chars[index + 1] == "/":
            end = index + 2
            while end < length and chars[end] != "\n":
                chars[end] = " "
                end += 1
            chars[index] = chars[index + 1] = " "
            index = end
            continue
        if char == "/" and index + 1 < length and chars[index + 1] == "*":
            chars[index] = chars[index + 1] = " "
            index += 2
            while index < length:
                if chars[index] == "*" and index + 1 < length and chars[index + 1] == "/":
                    chars[index] = chars[index + 1] = " "
                    index += 2
                    break
                if chars[index] != "\n":
                    chars[index] = " "
                index += 1
            continue
        if char in {'"', "'"}:
            quote = char
            chars[index] = " "
            index += 1
            while index < length:
                if chars[index] == "\\":
                    chars[index] = " "
                    if index + 1 < length and chars[index + 1] != "\n":
                        chars[index + 1] = " "
                    index += 2
                    continue
                if chars[index] == quote:
                    chars[index] = " "
                    index += 1
                    break
                if chars[index] != "\n":
                    chars[index] = " "
                index += 1
            continue
        index += 1
    return "".join(chars)


def _brace_pairs(masked):
    opening = []
    pairs = {}
    for index, char in enumerate(masked):
        if char == "{": opening.append(index)
        elif char == "}" and opening:
            start = opening.pop()
            pairs[start] = index
            pairs[index] = start
    return pairs


def _line_number(source, position):
    return source.count("\n", 0, position) + 1


def _c_evidence(file, source, start, end=None):
    end = start if end is None else max(start, end)
    return {"file": str(file).replace("\\", "/"), "line": _line_number(source, start), "end_line": _line_number(source, end), "evidence": source[start:end].strip()}


def _normal_c_name(value):
    return re.sub(r"\s*::\s*", ".", str(value or "").strip()).replace("->", ".").replace(".", ".").strip(".")


def _split_c_params(value):
    params, current, depth = [], [], 0
    for char in value:
        if char in "(<[{": depth += 1
        elif char in ")>]}" and depth: depth -= 1
        if char == "," and depth == 0:
            item = "".join(current).strip()
            if item: params.append(item)
            current = []
        else:
            current.append(char)
    item = "".join(current).strip()
    if item: params.append(item)
    result = []
    for item in params:
        item = item.split("=", 1)[0].strip()
        if item in {"void", "..."}:
            continue
        names = list(C_IDENTIFIER_RE.finditer(item))
        name = names[-1].group(0) if names else f"arg{len(result) + 1}"
        type_text = item[:names[-1].start()].strip() if names else item
        if not type_text:
            type_text = "unknown"
        result.append({"name": name, "type": type_text})
    return result


def _c_scope(regions, position):
    containing = [item for item in regions if item["start"] <= position < item["end"]]
    containing.sort(key=lambda item: (item["start"], item["end"]))
    return [part for item in containing for part in item.get("scope", item["name"]).split(".") if part]


def _c_resolve_include(root, file, include, path_to_module):
    """Resolve a quoted/system include only when it maps to one workspace file."""
    include = include.replace("\\", "/")
    candidates = []
    try:
        relative = (file.parent / include).resolve().relative_to(root).as_posix()
        candidates.append(relative)
    except ValueError:
        pass
    normalized = include.lstrip("./")
    candidates.append(normalized)
    exact = [path_to_module.get(item) for item in candidates if path_to_module.get(item)]
    if exact:
        return exact[0]
    matches = [module for path, module in path_to_module.items() if path == normalized or path.endswith("/" + normalized)]
    return matches[0] if len(set(matches)) == 1 else None


def _c_parse_file(root, file, module, language, path_to_module, known_modules):
    """Extract conservative C/C++ facts for one file."""
    relative = file.relative_to(root).as_posix()
    source = file.read_text(encoding="utf-8")
    masked = _mask_c_source(source)
    pairs = _brace_pairs(masked)
    regions = []
    class_regions = []
    for match in C_SCOPE_RE.finditer(masked):
        opening = match.end() - 1
        closing = pairs.get(opening)
        if closing is None:
            continue
        kind, raw_name = match.group(1), _normal_c_name(match.group(2))
        prefix_regions = _c_scope(regions, match.start())
        full_name = ".".join(prefix_regions + ([raw_name] if raw_name else []))
        region = {"kind": kind, "name": full_name, "scope": raw_name, "start": match.start(), "open": opening, "end": closing + 1}
        regions.append(region)
        if kind in {"class", "struct"}:
            class_regions.append(region)
    regions.sort(key=lambda item: item["start"])

    symbols_by_id = {}
    interfaces_by_id = {}
    definitions = []
    # A candidate inside an already detected function body is a call or a
    # local expression, not a declaration. C and C++ do not allow nested named
    # functions, so this conservative filter is safe for the supported syntax.
    function_bodies = []
    candidates = list(C_FUNCTION_RE.finditer(masked))
    for match in candidates:
        term = match.group("term")
        start = match.start()
        if any(body_start < start < body_end for body_start, body_end in function_bodies):
            continue
        raw_name = _normal_c_name(match.group("name"))
        if not raw_name or raw_name.split(".", 1)[0] in C_CONTROL_NAMES:
            continue
        scope = _c_scope(regions, start)
        current_class = next(reversed([region for region in regions if region["kind"] in {"class", "struct"} and region["start"] <= start < region["end"]]), None)
        # A bare no-return declaration is only accepted as a constructor or a
        # destructor within its class. This prevents ``helper();`` call sites
        # from becoming fake interfaces.
        before = match.group("before").strip()
        if not before and "::" not in raw_name and not (current_class and raw_name.lstrip("~") == current_class["name"].split(".")[-1]):
            continue
        qualified_raw = raw_name
        if "::" in match.group("name") or "." in raw_name:
            if scope and not raw_name.startswith(".".join(scope) + "."):
                # Out-of-class definitions inside a namespace inherit that
                # namespace, while a fully-qualified name remains absolute.
                qualified_raw = ".".join(scope + [raw_name])
        else:
            qualified_raw = ".".join(scope + [raw_name]) if scope else raw_name
        qualified_raw = qualified_raw.strip(".")
        symbol = symbol_id(module, qualified_raw)
        line = _line_number(source, start)
        closing = pairs.get(match.end() - 1) if term == "{" else None
        end = (closing + 1) if closing is not None else match.end()
        signature = " ".join(source[start:match.end()].strip().split())
        params = _split_c_params(match.group("params"))
        prefix = before
        output = prefix.split()
        if output and output[-1] in {"static", "inline", "virtual", "explicit", "constexpr", "consteval", "friend", "extern"}:
            output.pop()
        output_text = " ".join(output).strip() or "unknown"
        subkind = "method" if current_class else "function"
        container = symbol_id(module, current_class["name"]) if current_class else module
        details = {
            "id": symbol, "qualified_id": symbol, "name": qualified_raw,
            "short_name": raw_name.split(".")[-1], "kind": "function", "subkind": subkind,
            "container": container, "signature": signature, "line": line,
            "start_line": line, "end_line": _line_number(source, end), "calls": [],
        }
        # Prefer a definition over a declaration when a header contains an
        # inline declaration/definition pair with the same qualified symbol.
        if symbol not in symbols_by_id or term == "{":
            symbols_by_id[symbol] = details
            interfaces_by_id[symbol] = {
                "module": module, "symbol": qualified_raw, "qualified_id": symbol,
                "container": container, "signature": signature, "start_line": line,
                "end_line": _line_number(source, end), "kind": "function", "input": params,
                "output": output_text, "confidence": 0.85,
                "evidence": [_c_evidence(relative, source, start, end)],
            }
        if term == "{" and closing is not None:
            function_bodies.append((match.end() - 1, closing))
            definitions.append((symbol, match.end() - 1, closing))

    for region in class_regions:
        symbol = symbol_id(module, region["name"])
        text_start = region["start"]
        text_end = region["open"]
        match = re.search(r"\b(?:class|struct)\s+[A-Za-z_]\w*(?:::\w*)*", masked[text_start:text_end])
        signature = " ".join(source[text_start:text_end].strip().split()) + " {"
        line = _line_number(source, text_start)
        details = {
            "id": symbol, "qualified_id": symbol, "name": region["name"],
            "short_name": region["name"].split(".")[-1], "kind": "class", "subkind": region["kind"],
            "container": module, "signature": signature, "line": line,
            "start_line": line, "end_line": _line_number(source, region["end"]), "calls": [],
        }
        symbols_by_id.setdefault(symbol, details)
        interfaces_by_id.setdefault(symbol, {
            "module": module, "symbol": region["name"], "qualified_id": symbol,
            "container": module, "signature": signature, "start_line": line,
            "end_line": _line_number(source, region["end"]), "kind": "class", "input": [],
            "output": region["name"], "confidence": 0.9,
            "evidence": [_c_evidence(relative, source, text_start, region["end"])],
        })

    imports = []
    relations = []

    def add_relation(target, kind, start, end=None, from_symbol=None, symbol_name=None, confidence=1.0, **extra):
        if not target or target == "?":
            return
        evidence = [_c_evidence(relative, source, start, end)]
        relation = {
            "from": module, "from_symbol": from_symbol, "from_symbol_id": symbol_id(module, from_symbol) if from_symbol else None,
            "to": target, "type": kind, "symbol": symbol_name, "confidence": confidence,
            "evidence": evidence, **extra,
        }
        key = (relation["from"], relation["from_symbol"], relation["to"], relation["type"], relation["symbol"], evidence[0]["line"])
        if not any((item["from"], item.get("from_symbol"), item["to"], item["type"], item.get("symbol"), item["evidence"][0]["line"]) == key for item in relations):
            relations.append(relation)

    include_modules = set()
    for match in C_INCLUDE_RE.finditer(source):
        include = match.group(1).strip()
        target = _c_resolve_include(root, file, include, path_to_module)
        if target and target != module:
            include_modules.add(target)
            imports.append(target)
            add_relation(target, "IMPORT", match.start(), match.end(), symbol_name=include)

    # Keep inheritance declarations for the second pass, after all files have
    # contributed their class symbols. The parser does not guess external or
    # ambiguous base classes.
    inheritance_specs = []
    for region in class_regions:
        header = masked[region["start"]:region["open"]]
        if ":" not in header:
            continue
        bases = header.rsplit(":", 1)[1]
        for base in re.split(r",", bases):
            base_name = re.sub(r"\b(public|protected|private|virtual)\b", "", base).strip()
            normalized = _normal_c_name(base_name)
            if normalized:
                inheritance_specs.append((region, normalized))

    return {
        "module": {"id": module, "path": relative, "language": language, "imports": sorted(set(imports)), "symbols": list(symbols_by_id.values())},
        "relations": relations,
        "interfaces": list(interfaces_by_id.values()),
        "definitions": definitions,
        "inheritance": inheritance_specs,
        "include_modules": include_modules,
        "source": source,
        "masked": masked,
        "relative": relative,
    }


def _c_call_target(raw_name, source_module, source_symbol, symbol_index, include_modules):
    """Resolve a direct/qualified call when there is exactly one safe target."""
    normalized = _normal_c_name(raw_name)
    if not normalized or normalized.split(".", 1)[0] in C_CONTROL_NAMES:
        return None
    exact = list(symbol_index.get(normalized, []))
    # A qualified C++ call can be written without its namespace prefix when
    # used from the same namespace. Match a unique suffix, never an arbitrary
    # first candidate.
    if not exact:
        exact = [item for name, values in symbol_index.items() if name.endswith("." + normalized) for item in values]
    if not exact and "." in normalized:
        # Member expressions such as ``worker.run()`` do not carry a static
        # class type in this lightweight parser. Resolve the method suffix
        # only when the suffix is unique or is provided by an included header.
        exact = list(symbol_index.get(normalized.rsplit(".", 1)[-1], []))
    if not exact and "." not in normalized:
        local = [item for item in symbol_index.get(normalized, []) if item["module"] == source_module]
        exact = local
        if not exact:
            included = [item for item in symbol_index.get(normalized, []) if item["module"] in include_modules]
            exact = included
    if len({(item["module"], item["id"]) for item in exact}) > 1:
        local = [item for item in exact if item["module"] == source_module]
        local_unique = {(item["module"], item["id"]) for item in local}
        if len(local_unique) == 1:
            exact = local
        elif include_modules:
            included = [item for item in exact if item["module"] in include_modules]
            if included:
                exact = included
    unique = {(item["module"], item["id"]) for item in exact}
    if len(unique) != 1:
        local = [item for item in exact if item["module"] == source_module]
        local_unique = {(item["module"], item["id"]) for item in local}
        if len(local_unique) == 1:
            exact = local
            unique = local_unique
    if len(unique) != 1 and include_modules:
        included = [item for item in exact if item["module"] in include_modules]
        included_unique = {(item["module"], item["id"]) for item in included}
        if len(included_unique) == 1:
            exact = included
            unique = included_unique
    if len(unique) != 1:
        return None
    return exact[0]


def _c_add_calls(parsed, symbol_index):
    """Add resolved CALL relationships and scoped call facts to parsed files."""
    for item in parsed:
        module = item["module"]["id"]
        for symbol_id_value, body_start, body_end in item["definitions"]:
            source_symbol = next((symbol for symbol in item["module"]["symbols"] if symbol["id"] == symbol_id_value), None)
            if source_symbol is None:
                continue
            calls = []
            segment = item["masked"][body_start + 1:body_end]
            offset = body_start + 1
            local_types = {
                match.group("variable"): _normal_c_name(match.group("type"))
                for match in re.finditer(
                    r"(?m)(?:^|(?<=[;{}]))\s*(?P<type>(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*)\s*(?:[*&]\s*)?(?P<variable>[A-Za-z_]\w*)\s*(?=[=;(])",
                    segment,
                )
                if match.group("type") not in {"auto", "return", "throw", "new", "delete"}
            }
            for match in C_CALL_RE.finditer(segment):
                raw_name = re.sub(r"\s+", "", match.group("name"))
                if raw_name.split(".", 1)[0] in C_CONTROL_NAMES:
                    continue
                call_name = raw_name
                head, separator, tail = raw_name.partition(".")
                if separator and head in local_types:
                    call_name = f"{local_types[head]}.{tail}"
                target = _c_call_target(call_name, module, source_symbol["name"], symbol_index, item["include_modules"])
                if target is None:
                    continue
                if target["id"] not in calls:
                    calls.append(target["id"])
                start = offset + match.start()
                evidence = _c_evidence(item["relative"], item["source"], start, offset + match.end())
                relation = {
                    "from": module, "from_symbol": source_symbol["name"], "from_symbol_id": source_symbol["id"],
                    "to": target["module"], "to_symbol_id": target["id"], "type": "CALL", "symbol": call_name,
                    "confidence": 0.8 if "." in call_name else 0.7, "evidence": [evidence],
                }
                key = (relation["from"], relation["from_symbol"], relation["to"], relation["type"], relation["symbol"], evidence["line"])
                if not any((existing["from"], existing.get("from_symbol"), existing["to"], existing["type"], existing.get("symbol"), existing["evidence"][0]["line"]) == key for existing in item["relations"]):
                    item["relations"].append(relation)
            source_symbol["calls"] = calls


def _c_link_method_containers(parsed, symbol_index):
    """Attach out-of-class definitions to the unique scanned class node."""
    classes = {}
    for values in symbol_index.values():
        for candidate in values:
            if candidate.get("kind") != "class":
                continue
            classes.setdefault(candidate["name"], {})[(candidate["module"], candidate["id"])] = candidate
            classes.setdefault(candidate["short_name"], {})[(candidate["module"], candidate["id"])] = candidate
    for item in parsed:
        for symbol in item["module"]["symbols"]:
            if symbol.get("kind") != "function" or "." not in symbol.get("name", ""):
                continue
            class_name = symbol["name"].rsplit(".", 1)[0]
            candidates = list(classes.get(class_name, {}).values())
            if not candidates:
                candidates = list(classes.get(class_name.rsplit(".", 1)[-1], {}).values())
            # An unqualified method name can be overloaded in several classes;
            # fail closed rather than linking it to an arbitrary declaration.
            if len({(candidate["module"], candidate["id"]) for candidate in candidates}) != 1:
                continue
            container = candidates[0]
            symbol["container"] = container["id"]
            symbol["subkind"] = "method"
            for interface in item["interfaces"]:
                if interface.get("qualified_id") == symbol.get("qualified_id"):
                    interface["container"] = container["id"]


def _analyze_c_family(root, files, id_by_file, known_ids, resolution_files=None):
    selected_paths = {file.resolve() for file in files}
    resolution_files = list(resolution_files if resolution_files is not None else files)
    path_to_module = {file.relative_to(root).as_posix(): module for file, module in id_by_file.items()}
    parsed = []
    errors = []
    # The first pass collects symbols so calls and inheritance can resolve
    # against declarations in either source files or headers.
    preliminary = {"symbols": []}
    for file in resolution_files:
        extension = file.suffix.lower()
        try:
            result = _c_parse_file(root, file, id_by_file[file], C_LANGUAGE[extension], path_to_module, preliminary)
            parsed.append(result)
            preliminary["symbols"].extend({**symbol, "module": result["module"]["id"]} for symbol in result["module"]["symbols"])
        except (UnicodeError, OSError) as exc:
            errors.append({"file": file.relative_to(root).as_posix(), "error": str(exc)})
    symbol_index = {}
    for item in parsed:
        for symbol in item["module"]["symbols"]:
            enriched = {**symbol, "module": item["module"]["id"]}
            full_name = symbol["name"]
            symbol_index.setdefault(full_name, []).append(enriched)
            symbol_index.setdefault(symbol["short_name"], []).append(enriched)
    # Resolve inheritance now that every file's classes are known.
    classes = {}
    for values in symbol_index.values():
        for symbol in values:
            if symbol.get("kind") == "class":
                classes.setdefault(symbol["name"], {})[(symbol["module"], symbol["id"])] = symbol
                classes.setdefault(symbol["short_name"], {})[(symbol["module"], symbol["id"])] = symbol
    for item in parsed:
        module = item["module"]["id"]
        for region, base_name in item.get("inheritance", []):
            namespace = region["name"].rsplit(".", 1)[0] if "." in region["name"] else ""
            candidates_for_base = []
            if namespace and "." not in base_name:
                candidates_for_base = list(classes.get(f"{namespace}.{base_name}", {}).values())
            if not candidates_for_base:
                candidates_for_base = list(classes.get(base_name, {}).values())
            if not candidates_for_base:
                candidates_for_base = list(classes.get(base_name.split(".")[-1], {}).values())
            unique = {(candidate["module"], candidate["id"]) for candidate in candidates_for_base}
            if len(unique) != 1:
                local = [candidate for candidate in candidates_for_base if candidate["module"] == module]
                local_unique = {(candidate["module"], candidate["id"]) for candidate in local}
                included = [candidate for candidate in candidates_for_base if candidate["module"] in item["include_modules"]]
                included_unique = {(candidate["module"], candidate["id"]) for candidate in included}
                if len(local_unique) == 1:
                    candidates_for_base, unique = local, local_unique
                elif len(included_unique) == 1:
                    candidates_for_base, unique = included, included_unique
            if len(unique) != 1:
                continue
            target_symbol = candidates_for_base[0]
            start = region["start"]
            end = region["open"]
            evidence = _c_evidence(item["relative"], item["source"], start, end)
            item["relations"].append({
                "from": module, "from_symbol": region["name"], "from_symbol_id": symbol_id(module, region["name"]),
                "to": target_symbol["module"], "to_symbol_id": target_symbol["id"], "type": "INHERIT",
                "symbol": base_name, "confidence": 0.8, "evidence": [evidence],
            })
    _c_link_method_containers(parsed, symbol_index)
    _c_add_calls(parsed, symbol_index)
    selected = [item for item in parsed if (root / item["relative"]).resolve() in selected_paths]
    modules = [item["module"] for item in selected]
    relations = [relation for item in selected for relation in item["relations"]]
    interfaces = [contract for item in selected for contract in item["interfaces"]]
    selected_relatives = {file.relative_to(root).as_posix() for file in files}
    return modules, relations, interfaces, [error for error in errors if error.get("file") in selected_relatives]

def source_evidence(file, source, node):
    return {"file": str(file).replace("\\", "/"), "line": node.lineno, "end_line": getattr(node, "end_lineno", node.lineno), "evidence": ast.get_source_segment(source, node) or ""}

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
        self.alias_targets, self.instance_targets, self.scope_kinds = {}, {}, []

    def current_symbol(self): return ".".join(self.scope) or None
    def current_symbol_id(self):
        name = self.current_symbol()
        return symbol_id(self.module, name) if name else None

    def relation(self, target, kind, node, symbol=None, confidence=1.0, **extra):
        relation = {"from": self.module, "from_symbol": self.current_symbol(), "from_symbol_id": self.current_symbol_id(), "to": target, "type": kind, "symbol": symbol, "confidence": confidence, "evidence": [source_evidence(self.file, self.source, node)], **extra}
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

    def resolve_target(self, value):
        head, separator, tail = value.partition(".")
        target = self.instance_targets.get(head) or self.alias_targets.get(head)
        if target:
            module, prefix = target
            suffix = ".".join(item for item in [prefix, tail if separator else ""] if item)
            return module, symbol_id(module, suffix) if suffix else None
        if head == "self" and self.scope:
            class_index = next((index for index in range(len(self.scope_kinds) - 1, -1, -1) if self.scope_kinds[index] == "class"), None)
            if class_index is not None and separator:
                name = ".".join(self.scope[:class_index + 1] + [tail])
                return self.module, symbol_id(self.module, name)
        resolved = self.resolve_name(value)
        module = longest_module(resolved, self.known)
        if module == self.module and value:
            return module, symbol_id(module, value)
        if module and resolved.startswith(module + "."):
            return module, symbol_id(module, resolved[len(module) + 1:])
        return module, None

    def reference(self, value, kind, node):
        resolved = self.resolve_name(value)
        target, target_symbol = self.resolve_target(value)
        if target and (target != self.module or kind == "CALL" and target_symbol):
            extra = {"to_symbol_id": target_symbol} if target_symbol else {}
            self.relation(target, kind, node, resolved, **extra)

    def visit_Import(self, node):
        for item in node.names:
            binding = item.asname or item.name.split(".")[0]
            self.aliases[binding] = item.name if item.asname else binding
            target = longest_module(item.name, self.known)
            if target: self.alias_targets[binding] = (target, "")
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
                target_symbol = symbol_id(target, item.name) if target == base_target else None
                self.relation(target, "IMPORT", node, symbol, **({"to_symbol_id": target_symbol} if target_symbol else {}))
            binding = item.asname or item.name
            self.aliases[binding] = imported
            if target:
                self.alias_targets[binding] = (target, item.name if target == base_target else "")

    def visit_FunctionDef(self, node):
        name = ".".join(self.scope + [node.name])
        qualified = symbol_id(self.module, name)
        container = symbol_id(self.module, ".".join(self.scope)) if self.scope else self.module
        subkind = "method" if self.scope_kinds and self.scope_kinds[-1] == "class" else "function"
        details = {"id": qualified, "qualified_id": qualified, "name": name, "short_name": node.name, "kind": "function", "subkind": subkind, "container": container, "signature": signature(node), "line": node.lineno, "start_line": start_line(node), "end_line": getattr(node, "end_lineno", node.lineno)}
        self.symbols.append(details)
        inputs = [{"name": arg.arg, "type": annotation(arg.annotation)} for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs]
        self.interfaces.append({"module": self.module, "symbol": name, "qualified_id": qualified, "container": container, "signature": details["signature"], "start_line": details["start_line"], "end_line": details["end_line"], "kind": "function", "input": inputs, "output": annotation(node.returns), "confidence": 1.0, "evidence": [source_evidence(self.file, self.source, node)]})
        self.scope.append(node.name); self.scope_kinds.append("function"); self.generic_visit(node); self.scope_kinds.pop(); self.scope.pop()
    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        name = ".".join(self.scope + [node.name])
        qualified = symbol_id(self.module, name)
        container = symbol_id(self.module, ".".join(self.scope)) if self.scope else self.module
        details = {"id": qualified, "qualified_id": qualified, "name": name, "short_name": node.name, "kind": "class", "subkind": "class", "container": container, "signature": signature(node), "line": node.lineno, "start_line": start_line(node), "end_line": getattr(node, "end_lineno", node.lineno)}
        self.symbols.append(details)
        self.interfaces.append({"module": self.module, "symbol": name, "qualified_id": qualified, "container": container, "signature": details["signature"], "start_line": details["start_line"], "end_line": details["end_line"], "kind": "class", "input": [], "output": name, "confidence": 1.0, "evidence": [source_evidence(self.file, self.source, node)]})
        self.scope.append(node.name); self.scope_kinds.append("class")
        for base in node.bases:
            value = dotted(base)
            if value: self.reference(value, "INHERIT", base)
        self.generic_visit(node); self.scope_kinds.pop(); self.scope.pop()

    def visit_Assign(self, node):
        if isinstance(node.value, ast.Call):
            value = dotted(node.value.func)
            if value:
                resolved = self.resolve_name(value)
                _, target_symbol = self.resolve_target(value)
                for assignment_target in node.targets:
                    if isinstance(assignment_target, ast.Name):
                        self.instances[assignment_target.id] = resolved
                        if target_symbol:
                            module, name = target_symbol.split(":", 1)
                            self.instance_targets[assignment_target.id] = (module, name)
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
    all_files = [
        item for item in sorted(root.rglob("*"))
        if item.is_file() and item.suffix.lower() in C_EXTENSIONS.union({".py"})
        and not any(part in IGNORED for part in item.parts)
    ]
    requested = {Path(item).as_posix() for item in selected_files or []}
    files = [item for item in all_files if not requested or item.relative_to(root).as_posix() in requested]
    python_files = [item for item in all_files if item.suffix.lower() == ".py"]
    c_files = [item for item in all_files if item.suffix.lower() in C_EXTENSIONS]
    python_ids = {module_id(root, item) for item in python_files}
    c_ids = c_module_ids(root, c_files, python_ids)
    known = python_ids | set(c_ids.values())
    modules, relations, interfaces, errors = [], [], [], []
    for file in files:
        relative = file.relative_to(root).as_posix()
        if file.suffix.lower() in C_EXTENSIONS:
            continue
        try:
            facts = Facts(module_id(root, file), relative, file.read_text(encoding="utf-8"), known, file.name == "__init__.py", package_id(root, file)); facts.visit(facts.tree)
            modules.append({"id": facts.module, "path": relative, "language": "python", "symbols": facts.symbols}); relations.extend(facts.relations); interfaces.extend(facts.interfaces)
        except (SyntaxError, UnicodeError, OSError) as exc:
            errors.append({"file": relative, "error": str(exc)})
    selected_c_files = [file for file in c_files if not requested or file.relative_to(root).as_posix() in requested]
    if selected_c_files:
        c_modules, c_relations, c_interfaces, c_errors = _analyze_c_family(root, selected_c_files, c_ids, known, resolution_files=c_files)
    else:
        c_modules, c_relations, c_interfaces, c_errors = [], [], [], []
    modules.extend(c_modules); relations.extend(c_relations); interfaces.extend(c_interfaces); errors.extend(c_errors)
    languages = {module.get("language") for module in modules if module.get("language")}
    language = next(iter(languages)) if len(languages) == 1 else "mixed" if languages else "python"
    return {"version": 1, "language": language, "modules": modules, "relationships": relations, "interfaces": interfaces, "errors": errors, "analyzed_files": [item.relative_to(root).as_posix() for item in files]}

if __name__ == "__main__":
    if len(sys.argv) < 2: raise SystemExit("usage: dependency_skill.py PROJECT [relative-file ...]")
    print(json.dumps(analyze(sys.argv[1], sys.argv[2:]), ensure_ascii=False))
