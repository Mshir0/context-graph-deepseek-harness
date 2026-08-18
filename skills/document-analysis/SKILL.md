---
name: document-analysis
description: Inspect a workspace PDF outline, match task-relevant chapters, and extract only selected page ranges into Context Graph. Use for PDF manuals, specifications, reports, and architecture documents.
---

# Document Analysis

Use PDF content progressively. Never read or inject the entire document by default.

1. Call `document_scan` with a workspace-relative PDF path. Review the native outline and page ranges.
2. Call `document_find_sections` with the document id and the current task. Do not invent a match when it returns no sections.
3. Present the matched titles and page ranges when user confirmation is needed.
4. Call `document_extract_sections` only for the selected section ids and with a bounded `max_tokens` value.
5. When the task needs API examples, request/response schemas, parameter tables, or code, call `document_extract_layout` for the same selected section ids. Prefer its fenced code and Markdown+JSON tables over flattened page text.
6. Use `apply=true` only when the extracted, page-cited text or layout artifacts should become durable Context Graph content.
7. Link a saved PDF section to a Task, Requirement, Decision, Interface, or Functional node with a reviewed `MANUAL` edge when it materially supports that context.

PDF nodes use the existing `documentation` type. Check `metadata.kind` for `pdf_document`, `pdf_section`, `pdf_code_block`, or `pdf_table`, and preserve `metadata.pdfFile`, page, `bbox`, page ranges, and `documentHash` as provenance. A PDF without a native outline is reported as `outlineAvailable: false`; OCR and inferred tables of contents remain outside this workflow.
