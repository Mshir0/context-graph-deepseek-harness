import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_EXTRACT_PAGES = 200;

function pdfError(message, code = 'PDF_ANALYSIS_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function workspacePdf(projectPath, requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) throw pdfError('PDF path is required', 'PDF_PATH_REQUIRED');
  const root = await realpath(path.resolve(projectPath));
  const requested = path.resolve(root, requestedPath);
  let filename;
  try { filename = await realpath(requested); }
  catch (error) { throw pdfError(`PDF file does not exist: ${requestedPath}`, error.code || 'PDF_NOT_FOUND'); }
  const relative = path.relative(root, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw pdfError('PDF must be inside the active DSH workspace', 'PDF_OUTSIDE_WORKSPACE');
  if (path.extname(filename).toLowerCase() !== '.pdf') throw pdfError('Only .pdf files are supported', 'PDF_FILE_REQUIRED');
  if (!(await stat(filename)).isFile()) throw pdfError('PDF path must reference a file', 'PDF_FILE_REQUIRED');
  return { root, filename, relative: relative.replaceAll(path.sep, '/') };
}

function parseAnalyzerOutput(stdout, stderr = '') {
  let parsed;
  try { parsed = JSON.parse(String(stdout || '').trim()); }
  catch { throw pdfError(String(stderr || stdout || 'PDF analyzer returned invalid output').trim()); }
  if (parsed?.error) throw pdfError(parsed.error, parsed.code);
  return parsed;
}

export async function runPdfAnalyzer(command, filename, range = {}) {
  const candidates = [process.env.CONTEXT_GRAPH_PDF_PYTHON, process.env.DEPENDENCY_SKILL_PYTHON, ...(process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'])].filter(Boolean);
  const args = [path.join(HERE, 'analyze_pdf.py'), command, filename];
  if (command === 'extract') args.push(String(range.pageStart), String(range.pageEnd));
  let lastError;
  for (const executable of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(executable, args, { maxBuffer: 32 * 1024 * 1024 });
      return parseAnalyzerOutput(stdout, stderr);
    } catch (error) {
      lastError = error;
      const output = String(error.stdout || '').trim();
      if (output) return parseAnalyzerOutput(output, error.stderr);
    }
  }
  throw pdfError(lastError?.message || 'Python 3 is required for PDF analysis', 'PDF_ANALYZER_UNAVAILABLE');
}

function documentId(relative) {
  return `pdf.${createHash('sha256').update(relative.toLowerCase()).digest('hex').slice(0, 16)}`;
}

function fileHash(filename) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filename);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function cleanOutline(value, pageCount) {
  const sections = Array.isArray(value?.sections) ? value.sections : [];
  return sections.map((section, index) => ({
    index: Number.isInteger(section.index) ? section.index : index,
    level: Math.max(1, Number(section.level) || 1),
    title: String(section.title || `Section ${index + 1}`).trim(),
    pageStart: Math.max(1, Math.min(pageCount, Number(section.pageStart) || 1)),
    pageEnd: Math.max(1, Math.min(pageCount, Number(section.pageEnd) || pageCount)),
  })).map(section => ({ ...section, pageEnd: Math.max(section.pageStart, section.pageEnd) }));
}

export async function scanPdfDocument({ projectPath, filePath, graph, analyze = runPdfAnalyzer }) {
  const file = await workspacePdf(projectPath, filePath);
  const outline = await analyze('outline', file.filename);
  const pageCount = Math.max(1, Number(outline.pageCount) || 1);
  const sections = cleanOutline(outline, pageCount);
  const hash = await fileHash(file.filename);
  const id = documentId(file.relative);
  const previous = new Map((graph.nodes || []).filter(node => node.metadata?.pdfFile === file.relative).map(node => [node.id, node]));
  const generatedIds = new Set([id, ...sections.map(section => `${id}.section.${section.index + 1}`)]);
  const next = structuredClone(graph);
  next.nodes = next.nodes.filter(node => node.metadata?.pdfFile !== file.relative || node.mode === 'MANUAL' || generatedIds.has(node.id));
  next.edges = next.edges.filter(edge => edge.metadata?.pdfFile !== file.relative);

  const now = new Date().toISOString();
  const title = String(outline.title || path.basename(file.relative, '.pdf')).trim();
  const oldDocument = previous.get(id);
  const manualDocument = oldDocument?.mode === 'MANUAL';
  const documentNode = {
    ...(oldDocument || {}),
    id,
    type: 'documentation',
    title,
    label: title,
    content: manualDocument && oldDocument.content ? oldDocument.content : `PDF document: ${file.relative}\nPages: ${pageCount}\nOutline sections: ${sections.length}`,
    description: manualDocument && oldDocument.description ? oldDocument.description : `PDF document with ${pageCount} pages and ${sections.length} outline sections.`,
    source: file.relative,
    created_by: manualDocument ? oldDocument.created_by : 'analyzer',
    status: 'active',
    mode: manualDocument ? 'MANUAL' : 'AUTO',
    x: oldDocument?.x ?? 80,
    y: oldDocument?.y ?? 80,
    updated_at: now,
    metadata: { ...(oldDocument?.metadata || {}), kind: 'pdf_document', pdfFile: file.relative, documentHash: hash, pageCount, outlineSections: sections.length },
  };
  const nodeById = new Map(next.nodes.map(node => [node.id, node]));
  nodeById.set(id, documentNode);
  const stack = [];
  const createdSections = [];
  for (const section of sections) {
    const sectionId = `${id}.section.${section.index + 1}`;
    const old = previous.get(sectionId);
    const manual = old?.mode === 'MANUAL';
    const unchanged = manual || old?.metadata?.documentHash === hash && old.metadata?.pageStart === section.pageStart && old.metadata?.pageEnd === section.pageEnd;
    const node = {
      ...(old || {}),
      id: sectionId,
      type: 'documentation',
      title: section.title,
      label: section.title,
      content: unchanged ? String(old?.content || '') : '',
      description: `${file.relative}, pages ${section.pageStart}-${section.pageEnd}`,
      source: `${file.relative}#page=${section.pageStart}`,
      created_by: manual ? old.created_by : 'analyzer',
      status: 'active',
      mode: manual ? 'MANUAL' : 'AUTO',
      x: old?.x ?? 80 + section.level * 240,
      y: old?.y ?? 80 + (section.index + 1) * 130,
      updated_at: now,
      metadata: { ...(old?.metadata || {}), kind: 'pdf_section', pdfFile: file.relative, documentId: id, documentHash: hash, outlineIndex: section.index, level: section.level, pageStart: section.pageStart, pageEnd: section.pageEnd, extracted: unchanged && Boolean(old?.content) },
    };
    nodeById.set(sectionId, node);
    while (stack.length && stack.at(-1).level >= section.level) stack.pop();
    const parent = stack.at(-1)?.id || id;
    next.edges.push({ source: parent, target: sectionId, type: 'contains', scope: ['content'], mode: 'AUTO', confidence: 1, metadata: { analyzer: 'pdf-outline', pdfFile: file.relative } });
    stack.push({ id: sectionId, level: section.level });
    createdSections.push(node);
  }
  next.nodes = [...nodeById.values()];
  return { graph: next, document: documentNode, sections: createdSections, outlineAvailable: sections.length > 0 };
}

function searchTerms(task) {
  const text = String(task || '').toLowerCase();
  const terms = new Set(text.match(/[a-z_][a-z0-9_.:-]{1,}/g) || []);
  for (const sequence of text.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    terms.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2));
  }
  return [...terms];
}

export function findPdfSections(graph, { document, task, maxSections = 5 } = {}) {
  const selector = String(document || '').trim();
  const documentNode = (graph.nodes || []).find(node => node.metadata?.kind === 'pdf_document' && (node.id === selector || node.metadata.pdfFile === selector));
  if (!documentNode) throw pdfError(`Unknown PDF document: ${selector}`, 'PDF_DOCUMENT_NOT_FOUND');
  const terms = searchTerms(task);
  if (!terms.length) return { document: documentNode.id, task: String(task || ''), matches: [] };
  const matches = (graph.nodes || []).filter(node => node.metadata?.kind === 'pdf_section' && node.metadata.documentId === documentNode.id).map(node => {
    const title = String(node.title || '').toLowerCase();
    let score = title && String(task || '').toLowerCase().includes(title) ? 20 : 0;
    for (const term of terms) if (title.includes(term)) score += term.length >= 4 ? 4 : 2;
    return { id: node.id, title: node.title, level: node.metadata.level, pageStart: node.metadata.pageStart, pageEnd: node.metadata.pageEnd, score };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.pageStart - right.pageStart).slice(0, Math.max(1, Math.min(20, Number(maxSections) || 5)));
  return { document: documentNode.id, task: String(task || ''), matches };
}

export async function extractPdfSections({ projectPath, graph, sectionIds, maxTokens = 12000, apply = false, analyze = runPdfAnalyzer }) {
  if (!Array.isArray(sectionIds) || !sectionIds.length || sectionIds.some(id => typeof id !== 'string')) throw pdfError('sectionIds must be a non-empty array', 'PDF_SECTIONS_REQUIRED');
  const nodes = new Map((graph.nodes || []).map(node => [node.id, node]));
  const sections = [...new Set(sectionIds)].map(id => nodes.get(id));
  if (sections.some(node => node?.metadata?.kind !== 'pdf_section')) throw pdfError('Every section id must reference a PDF outline section', 'PDF_SECTION_NOT_FOUND');
  const limit = Math.max(100, Math.min(50000, Number(maxTokens) || 12000));
  let remainingChars = limit * 4;
  const extracted = [];
  const next = structuredClone(graph);
  const nextNodes = new Map(next.nodes.map(node => [node.id, node]));
  for (const section of sections) {
    const pageStart = Number(section.metadata.pageStart);
    const pageEnd = Number(section.metadata.pageEnd);
    if (pageEnd - pageStart + 1 > MAX_EXTRACT_PAGES) throw pdfError(`Section exceeds the ${MAX_EXTRACT_PAGES}-page extraction limit: ${section.id}`, 'PDF_SECTION_TOO_LARGE');
    const file = await workspacePdf(projectPath, section.metadata.pdfFile);
    const result = await analyze('extract', file.filename, { pageStart, pageEnd });
    const sourceText = String(result.text || '').trim();
    const text = sourceText.slice(0, Math.max(0, remainingChars));
    remainingChars -= text.length;
    const content = `Source: ${section.metadata.pdfFile}, pages ${pageStart}-${pageEnd}\n\n${text}`.trim();
    extracted.push({ id: section.id, title: section.title, pageStart, pageEnd, truncated: text.length < sourceText.length, estimatedTokens: Math.ceil(content.length / 4), content });
    if (apply) {
      const node = nextNodes.get(section.id);
      node.content = content;
      node.description = `${section.metadata.pdfFile}, pages ${pageStart}-${pageEnd}`;
      node.updated_at = new Date().toISOString();
      node.metadata = { ...node.metadata, extracted: true, extractedAt: node.updated_at };
    }
    if (remainingChars <= 0) break;
  }
  return { graph: next, applied: apply, maxTokens: limit, estimatedTokens: extracted.reduce((sum, item) => sum + item.estimatedTokens, 0), sections: extracted, context: extracted.map(item => `## ${item.title}\n\n${item.content}`).join('\n\n') };
}
