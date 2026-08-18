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
5. Use `apply=true` only when the extracted, page-cited text should become durable Context Graph content.
6. Link a saved PDF section to a Task, Requirement, Decision, Interface, or Functional node with a reviewed `MANUAL` edge when it materially supports that context.

PDF nodes use the existing `documentation` type. Check `metadata.kind` for `pdf_document` or `pdf_section`, and preserve `metadata.pdfFile`, `pageStart`, `pageEnd`, and `documentHash` as provenance. A PDF without a native outline is reported as `outlineAvailable: false`; OCR and inferred tables of contents are outside the first-version workflow.
