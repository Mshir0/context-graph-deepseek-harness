import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileContext, emptyGraph, normalizeGraph, validateGraph } from '../src/core.js';
import { applyExtraction, detectContextConflicts, extractContext } from '../src/context-extraction.js';

test('extracts requirements, constraints, and assistant decisions with raw provenance', () => {
  const requirement = extractContext('视频必须使用 H.265。', { source: 'user', conversationId: 'conversation-1', messageId: 'user-message-1' });
  const constraint = extractContext('字幕时间戳不能发生变化。', { source: 'user', conversationId: 'conversation-1', messageId: 'user-message-2' });
  const decision = extractContext('ASR 和 Speaker 应保持独立。', { source: 'assistant', conversationId: 'conversation-1', messageId: 'assistant-message-1' });
  assert.equal(requirement.nodes.find(node => node.type === 'requirement').source, 'user');
  assert.ok(constraint.nodes.some(node => node.type === 'constraint'));
  assert.ok(decision.nodes.some(node => node.type === 'decision'));
  const structured = requirement.nodes.find(node => node.type === 'requirement');
  assert.ok(requirement.edges.some(edge => edge.source === structured.id && edge.target === 'user-message-1' && edge.type === 'derived_from'));
  assert.ok(requirement.edges.some(edge => edge.source === 'user-message-1' && edge.target === 'conversation-1' && edge.type === 'contains'));
});

test('splits one request into a requirement and a constraint without inventing targets', () => {
  const extraction = extractContext('我要增加双主播支持，并且不能明显增加显存占用。', { source: 'user', conversationId: 'conversation-2', messageId: 'user-message-3' });
  assert.ok(extraction.nodes.some(node => node.type === 'requirement'));
  assert.ok(extraction.nodes.some(node => node.type === 'constraint'));
  assert.ok(extraction.edges.every(edge => !['affects', 'targets', 'constrains'].includes(edge.type)));
});

test('preserves replaced requirements and records supersedes', () => {
  let graph = normalizeGraph({ ...emptyGraph('/tmp/project'), nodes: [{ id: 'r1', type: 'requirement', title: 'H.264', content: '视频必须使用 H.264', status: 'active' }], edges: [] }, '/tmp/project');
  const extraction = extractContext('视频编码改成 H.265。', { source: 'user', conversationId: 'c2', messageId: 'm2', graph });
  graph = applyExtraction(graph, extraction);
  const replacement = graph.nodes.find(node => node.metadata?.supersedes === 'r1');
  assert.ok(replacement);
  assert.equal(graph.nodes.find(node => node.id === 'r1').status, 'superseded');
  assert.ok(graph.edges.some(edge => edge.source === replacement.id && edge.target === 'r1' && edge.type === 'supersedes'));
});

test('detects unresolved mutually exclusive requirements', () => {
  const graph = normalizeGraph({ ...emptyGraph('/tmp/project'), nodes: [
    { id: 'r1', type: 'requirement', content: 'Use H.264', status: 'active' },
    { id: 'r2', type: 'requirement', content: 'Use H.265', status: 'active' },
  ], edges: [] }, '/tmp/project');
  assert.equal(detectContextConflicts(graph).length, 1);
});

test('compiles relevant modular context from a task and excludes raw or forced nodes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-context-'));
  await mkdir(path.join(root, '.context', 'modules', 'encoder'), { recursive: true });
  await mkdir(path.join(root, '.context', 'modules', 'subtitle'), { recursive: true });
  await writeFile(path.join(root, 'recorder.py'), 'def record(): pass');
  await writeFile(path.join(root, '.context', 'modules', 'encoder', 'interface.md'), 'Encoder interface');
  await writeFile(path.join(root, '.context', 'modules', 'subtitle', 'interface.md'), 'Subtitle interface');
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task', type: 'task', title: 'H.265 task', content: '修改 Recorder，使其支持 H.265' },
    { id: 'recorder', type: 'code_module', path: 'recorder.py' },
    { id: 'encoder', type: 'code_module' }, { id: 'subtitle', type: 'code_module' },
    { id: 'requirement', type: 'requirement', title: 'H.265', content: '视频必须使用 H.265', priority: 'high' },
    { id: 'constraint', type: 'constraint', title: 'timestamp', content: '字幕时间戳不能变化', priority: 'high' },
    { id: 'conversation', type: 'conversation', content: 'unrelated raw history', metadata: { raw: true } },
    { id: 'speaker', type: 'code_module', content: 'Speaker contract', mode: 'FORCE_INCLUDE' },
    { id: 'c', type: 'note', content: 'must stay out', mode: 'FORCE_EXCLUDE' },
  ], edges: [
    { source: 'task', target: 'recorder', type: 'targets', scope: ['code', 'context'], mode: 'MANUAL' },
    { source: 'requirement', target: 'recorder', type: 'affects', scope: ['content'], mode: 'MANUAL' },
    { source: 'constraint', target: 'recorder', type: 'constrains', scope: ['content'], mode: 'MANUAL' },
    { source: 'recorder', target: 'encoder', type: 'interface', scope: ['interface'], mode: 'AUTO' },
    { source: 'recorder', target: 'subtitle', type: 'interface', scope: ['interface'], mode: 'AUTO' },
    { source: 'task', target: 'conversation', type: 'derived_from', scope: ['content'], mode: 'AUTO' },
    { source: 'task', target: 'c', type: 'related_to', scope: ['content'], mode: 'AUTO' },
  ] }, root);
  assert.deepEqual(validateGraph(graph), []);
  const result = await compileContext({ projectPath: root, graph, entry: 'task', task: '修改 Recorder', tokenBudget: 4000 });
  const included = new Set(result.included.map(item => item.node));
  assert.ok(included.has('task')); assert.ok(included.has('recorder')); assert.ok(included.has('encoder')); assert.ok(included.has('subtitle')); assert.ok(included.has('requirement')); assert.ok(included.has('constraint')); assert.ok(included.has('speaker'));
  assert.ok(!included.has('conversation')); assert.ok(!included.has('c'));
  assert.ok(result.excluded.some(item => item.node === 'c' && item.reason === 'FORCE_EXCLUDE'));
  assert.ok(result.included.every(item => item.reason));
});
