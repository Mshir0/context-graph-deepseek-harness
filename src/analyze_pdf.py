#!/usr/bin/env python3
"""Read PDF outlines and selected page text through PyMuPDF."""

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


def main() -> None:
    if len(sys.argv) < 3:
        fail("Usage: analyze_pdf.py outline <file> | extract <file> <start> <end>")
    command, filename = sys.argv[1], sys.argv[2]
    if command == "outline":
        result = outline(filename)
    elif command == "extract" and len(sys.argv) == 5:
        result = extract(filename, sys.argv[3], sys.argv[4])
    else:
        fail(f"Unknown PDF command: {command}")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
