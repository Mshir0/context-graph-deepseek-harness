#!/usr/bin/env python3
"""Read PDF outlines, selected text, code blocks, and tables."""

import json
import sys
from pathlib import Path


def fail(message: str, code: str = "PDF_ANALYSIS_FAILED") -> None:
    print(json.dumps({"error": message, "code": code}, ensure_ascii=False))
    raise SystemExit(1)


try:
    import fitz  # type: ignore
except ImportError:
    fitz = None

try:
    from pypdf import PdfReader  # type: ignore
except ImportError:
    PdfReader = None

try:
    import pdfplumber  # type: ignore
except ImportError:
    pdfplumber = None

if fitz is None and PdfReader is None:
    fail("PDF support requires PyMuPDF or pypdf. Install one with: python3 -m pip install pymupdf", "PDF_DEPENDENCY_MISSING")


def open_document(filename: str):
    path = Path(filename)
    if path.suffix.lower() != ".pdf":
        fail("Only .pdf files are supported", "PDF_FILE_REQUIRED")
    try:
        return fitz.open(path) if fitz is not None else PdfReader(str(path))
    except Exception as error:
        fail(f"Unable to open PDF: {error}", "PDF_OPEN_FAILED")


def pypdf_outline(document) -> list:
    flattened = []

    def visit(items, level=1):
        for item in items or []:
            if isinstance(item, list):
                visit(item, level + 1)
                continue
            try:
                page = document.get_destination_page_number(item) + 1
                title = str(item.title)
            except Exception:
                continue
            flattened.append([level, title, page])

    visit(document.outline)
    return flattened


def outline(filename: str) -> dict:
    document = open_document(filename)
    if fitz is not None:
        raw = document.get_toc(simple=True) or []
        page_count = document.page_count
        metadata_title = document.metadata.get("title")
    else:
        raw = pypdf_outline(document)
        page_count = len(document.pages)
        metadata_title = (document.metadata or {}).get("/Title")
    sections = []
    for index, item in enumerate(raw):
        level, title, page = item[:3]
        start = max(1, min(page_count, int(page)))
        end = page_count
        for following in raw[index + 1:]:
            if int(following[0]) <= int(level):
                end = max(start, min(page_count, int(following[2]) - 1))
                break
        sections.append({
            "index": index,
            "level": max(1, int(level)),
            "title": str(title).strip() or f"Section {index + 1}",
            "pageStart": start,
            "pageEnd": end,
        })
    return {
        "title": str(metadata_title or Path(filename).stem),
        "pageCount": page_count,
        "sections": sections,
    }


def extract(filename: str, page_start: str, page_end: str) -> dict:
    document = open_document(filename)
    page_count = document.page_count if fitz is not None else len(document.pages)
    start = max(1, int(page_start))
    end = min(page_count, int(page_end))
    if end < start:
        fail("Invalid PDF page range", "PDF_PAGE_RANGE_INVALID")
    pages = []
    for page_number in range(start, end + 1):
        if fitz is not None:
            text = document.load_page(page_number - 1).get_text("text").strip()
        else:
            text = (document.pages[page_number - 1].extract_text() or "").strip()
        if text:
            pages.append(f"[Page {page_number}]\n{text}")
    return {"pageStart": start, "pageEnd": end, "text": "\n\n".join(pages)}


MONOSPACE_FONTS = ("courier", "mono", "consolas", "menlo", "code", "terminal")
CODE_MARKERS = ("def ", "class ", "function ", "const ", "let ", "var ", "import ", "from ", "curl ", "http ", "#include", "=>", "{", "}", ";", "//", "<?", "SELECT ", "POST ", "GET ")


def guess_language(text: str) -> str:
    lower = text.lower()
    if "#include" in lower or "std::" in lower:
        return "cpp"
    if "def " in lower or "import " in lower and ":" in text:
        return "python"
    if "const " in lower or "let " in lower or "=>" in text:
        return "javascript"
    if "curl " in lower or lower.lstrip().startswith(("get ", "post ", "put ", "delete ")):
        return "http"
    if "select " in lower and " from " in lower:
        return "sql"
    if text.lstrip().startswith(("{", "[")):
        return "json"
    return "text"


def code_like_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    return line[:1].isspace() or any(marker.lower() in stripped.lower() for marker in CODE_MARKERS) or stripped.startswith(("$ ", "> ", "... "))


def fitz_code_blocks(page, page_number: int) -> list:
    results = []
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        lines = []
        mono_chars = 0
        total_chars = 0
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = "".join(str(span.get("text", "")) for span in spans).rstrip()
            if text:
                lines.append(text)
            for span in spans:
                length = len(str(span.get("text", "")))
                total_chars += length
                if any(name in str(span.get("font", "")).lower() for name in MONOSPACE_FONTS):
                    mono_chars += length
        if not lines:
            continue
        mono_ratio = mono_chars / max(1, total_chars)
        code_ratio = sum(1 for line in lines if code_like_line(line)) / len(lines)
        if mono_ratio < 0.45 and code_ratio < 0.6:
            continue
        if len(lines) == 1 and mono_ratio < 0.8:
            continue
        text = "\n".join(lines).strip()
        results.append({
            "page": page_number,
            "bbox": [round(float(value), 2) for value in block.get("bbox", [0, 0, 0, 0])],
            "language": guess_language(text),
            "text": text,
            "confidence": round(max(mono_ratio, code_ratio), 3),
        })
    return results


def pypdf_code_blocks(text: str, page_number: int) -> list:
    groups = []
    current = []
    for line in text.splitlines():
        if code_like_line(line):
            current.append(line.rstrip())
        else:
            if len(current) >= 2:
                groups.append(current)
            current = []
    if len(current) >= 2:
        groups.append(current)
    return [{"page": page_number, "bbox": None, "language": guess_language("\n".join(lines)), "text": "\n".join(lines).strip(), "confidence": 0.5} for lines in groups]


def normalize_table(raw):
    rows = []
    for raw_row in raw or []:
        row = [str(cell or "").replace("\n", " ").strip() for cell in raw_row]
        if any(row):
            rows.append(row)
    if not rows:
        return None
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    columns = rows[0]
    body = rows[1:]
    escaped = lambda value: value.replace("|", "\\|")
    markdown = "| " + " | ".join(escaped(value) for value in columns) + " |\n"
    markdown += "| " + " | ".join("---" for _ in columns) + " |"
    for row in body:
        markdown += "\n| " + " | ".join(escaped(value) for value in row) + " |"
    return {"columns": columns, "rows": body, "markdown": markdown}


def fitz_tables(page, page_number: int) -> list:
    if not hasattr(page, "find_tables"):
        return []
    try:
        found = page.find_tables()
    except Exception:
        return []
    results = []
    for table in getattr(found, "tables", []):
        normalized = normalize_table(table.extract())
        if normalized:
            results.append({"page": page_number, "bbox": [round(float(value), 2) for value in table.bbox], **normalized})
    return results


def plumber_tables(filename: str, start: int, end: int) -> list:
    if pdfplumber is None:
        return []
    results = []
    try:
        with pdfplumber.open(filename) as document:
            for page_number in range(start, end + 1):
                page = document.pages[page_number - 1]
                for table in page.find_tables():
                    normalized = normalize_table(table.extract())
                    if normalized:
                        results.append({"page": page_number, "bbox": [round(float(value), 2) for value in table.bbox], **normalized})
    except Exception:
        return []
    return results


def layout(filename: str, page_start: str, page_end: str) -> dict:
    document = open_document(filename)
    page_count = document.page_count if fitz is not None else len(document.pages)
    start = max(1, int(page_start))
    end = min(page_count, int(page_end))
    if end < start:
        fail("Invalid PDF page range", "PDF_PAGE_RANGE_INVALID")
    code_blocks = []
    tables = []
    for page_number in range(start, end + 1):
        if fitz is not None:
            page = document.load_page(page_number - 1)
            code_blocks.extend(fitz_code_blocks(page, page_number))
            tables.extend(fitz_tables(page, page_number))
        else:
            text = document.pages[page_number - 1].extract_text() or ""
            code_blocks.extend(pypdf_code_blocks(text, page_number))
    if not tables:
        tables = plumber_tables(filename, start, end)
    return {"pageStart": start, "pageEnd": end, "codeBlocks": code_blocks, "tables": tables, "backend": "pymupdf" if fitz is not None else "pypdf"}


def main() -> None:
    if len(sys.argv) < 3:
        fail("Usage: analyze_pdf.py outline <file> | extract/layout <file> <start> <end>")
    command, filename = sys.argv[1], sys.argv[2]
    if command == "outline":
        result = outline(filename)
    elif command == "extract" and len(sys.argv) == 5:
        result = extract(filename, sys.argv[3], sys.argv[4])
    elif command == "layout" and len(sys.argv) == 5:
        result = layout(filename, sys.argv[3], sys.argv[4])
    else:
        fail(f"Unknown PDF command: {command}")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
