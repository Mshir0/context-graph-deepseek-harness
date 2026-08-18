import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyGraph, validateGraph } from '../src/core.js';
import { extractPdfLayout, extractPdfSections, findPdfSections, pdfPythonCandidates, scanPdfDocument } from '../src/document-pdf.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-pdf-'));
  await writeFile(path.join(root, 'architecture.pdf'), '%PDF-1.7\nfixture');
  return root;
}

const outlineAnalyzer = async command => {
  assert.equal(command, 'outline');
  return {
    title: 'System Architecture',
    pageCount: 80,
    sections: [
      { index: 0, level: 1, title: 'Introduction', pageStart: 1, pageEnd: 9 },
      { index: 1, level: 1, title: 'Authentication', pageStart: 10, pageEnd: 29 },
      { index: 2, level: 2, title: 'Token Validation', pageStart: 16, pageEnd: 22 },
      { index: 3, level: 1, title: 'Error Handling', pageStart: 30, pageEnd: 45 },
    ],
  };
};

test('prefers explicit, project, plugin, and absolute system Python candidates', () => {
  const env = {
    CONTEXT_GRAPH_PDF_PYTHON: '/configured/python',
    VIRTUAL_ENV: '/stale/venv',
    HOME: '/home/tester',
  };
  const candidates = pdfPythonCandidates('/workspace/project', { env, platform: 'linux', pluginRoot: '/plugin' });
  assert.equal(candidates[0], '/configured/python');
  assert.ok(candidates.includes(path.join('/workspace/project', '.venv-pdf', 'bin', 'python')));
  assert.ok(candidates.includes(path.join('/plugin', '.venv-pdf', 'bin', 'python')));
  assert.ok(candidates.includes(path.join('/home/tester', 'context-graph-deepseek-harness', '.venv-pdf', 'bin', 'python')));
  assert.ok(candidates.includes('/usr/bin/python3'));
});

test('scans a native PDF outline into documentation nodes and hierarchy edges', async () => {
  const root = await fixture();
  const result = await scanPdfDocument({ projectPath: root, filePath: 'architecture.pdf', graph: emptyGraph(root), analyze: outlineAnalyzer });
  assert.equal(result.outlineAvailable, true);
  assert.equal(result.document.metadata.kind, 'pdf_document');
  assert.equal(result.sections.length, 4);
  assert.deepEqual(validateGraph(result.graph), []);
  const auth = result.sections.find(node => node.title === 'Authentication');
  const token = result.sections.find(node => node.title === 'Token Validation');
  assert.ok(result.graph.edges.some(edge => edge.source === auth.id && edge.target === token.id && edge.type === 'contains'));
  assert.equal(auth.path, undefined);
  assert.equal(auth.content, '');
});

test('matches outline titles before extracting selected page ranges', async () => {
  const root = await fixture();
  const scanned = await scanPdfDocument({ projectPath: root, filePath: 'architecture.pdf', graph: emptyGraph(root), analyze: outlineAnalyzer });
  const matched = findPdfSections(scanned.graph, { document: 'architecture.pdf', task: '检查 authentication token validation 错误处理', maxSections: 3 });
  assert.equal(matched.matches[0].title, 'Token Validation');
  assert.ok(matched.matches.some(item => item.title === 'Authentication'));

  const calls = [];
  const analyze = async (command, _filename, range) => {
    calls.push({ command, range });
    return { text: `Token validation contract for pages ${range.pageStart}-${range.pageEnd}.` };
  };
  const selected = matched.matches.slice(0, 2).map(item => item.id);
  const extracted = await extractPdfSections({ projectPath: root, graph: scanned.graph, sectionIds: selected, maxTokens: 200, apply: true, analyze });
  assert.equal(extracted.applied, true);
  assert.equal(calls.length, 2);
  assert.match(extracted.context, /Source: architecture\.pdf, pages/);
  for (const id of selected) {
    const node = extracted.graph.nodes.find(item => item.id === id);
    assert.equal(node.metadata.extracted, true);
    assert.match(node.content, /Source: architecture\.pdf/);
  }
});

test('rescanning a changed PDF invalidates previously extracted section text', async () => {
  const root = await fixture();
  const first = await scanPdfDocument({ projectPath: root, filePath: 'architecture.pdf', graph: emptyGraph(root), analyze: outlineAnalyzer });
  const section = first.sections[1];
  section.content = 'Old extracted text';
  section.metadata.extracted = true;
  await writeFile(path.join(root, 'architecture.pdf'), '%PDF-1.7\nchanged fixture');
  const second = await scanPdfDocument({ projectPath: root, filePath: 'architecture.pdf', graph: first.graph, analyze: outlineAnalyzer });
  const refreshed = second.graph.nodes.find(node => node.id === section.id);
  assert.equal(refreshed.content, '');
  assert.equal(refreshed.metadata.extracted, false);
});

test('reports PDFs without native outlines without inventing chapters', async () => {
  const root = await fixture();
  const result = await scanPdfDocument({ projectPath: root, filePath: 'architecture.pdf', graph: emptyGraph(root), analyze: async () => ({ title: 'Flat PDF', pageCount: 4, sections: [] }) });
  assert.equal(result.outlineAvailable, false);
  assert.equal(result.sections.length, 0);
  assert.equal(result.graph.nodes.length, 1);
});

test('extracts code blocks and tables as page-cited section child nodes', async () => {
  const root = await fixture();
  const scanned = await scanPdfDocument({ projectPath: root, filePath: 'architecture.pdf', graph: emptyGraph(root), analyze: outlineAnalyzer });
  const section = scanned.sections.find(node => node.title === 'Authentication');
  const analyze = async (command, _filename, range) => {
    assert.equal(command, 'layout');
    assert.deepEqual(range, { pageStart: 10, pageEnd: 29 });
    return {
      backend: 'pymupdf',
      codeBlocks: [{ page: 12, bbox: [72, 100, 520, 240], language: 'python', confidence: 0.96, text: 'def authenticate(token):\n    return verify(token)' }],
      tables: [{ page: 14, bbox: [72, 260, 520, 420], columns: ['Parameter', 'Type', 'Required'], rows: [['token', 'string', 'yes']], markdown: '| Parameter | Type | Required |\n| --- | --- | --- |\n| token | string | yes |' }],
    };
  };
  const result = await extractPdfLayout({ projectPath: root, graph: scanned.graph, sectionIds: [section.id], maxTokens: 500, apply: true, analyze });
  assert.equal(result.codeBlocks.length, 1);
  assert.equal(result.tables.length, 1);
  assert.ok(result.estimatedTokens <= 500);
  assert.match(result.context, /```python/);
  assert.match(result.context, /"Parameter"/);
  assert.deepEqual(validateGraph(result.graph), []);
  const codeNode = result.graph.nodes.find(node => node.metadata?.kind === 'pdf_code_block');
  const tableNode = result.graph.nodes.find(node => node.metadata?.kind === 'pdf_table');
  assert.deepEqual(codeNode.metadata.bbox, [72, 100, 520, 240]);
  assert.equal(tableNode.metadata.page, 14);
  assert.ok(result.graph.edges.some(edge => edge.source === section.id && edge.target === codeNode.id && edge.metadata?.analyzer === 'pdf-layout'));
  assert.ok(result.graph.edges.some(edge => edge.source === section.id && edge.target === tableNode.id && edge.metadata?.analyzer === 'pdf-layout'));
});
