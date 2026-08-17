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
  assert.equal(structured.created_by, 'user');
  assert.equal(structured.confidence, structured.metadata.confidence);
  assert.deepEqual(structured.derived_from, ['user-message-1']);
  assert.equal(structured.last_verified, structured.created_at);
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

test('detects generic same-slot conflicts and proposes a reviewable edge', () => {
  const graph = normalizeGraph({ ...emptyGraph('/tmp/project'), nodes: [
    { id: 'r1', type: 'requirement', content: '存储必须使用 SQLite', subject: '存储', slot: 'value', value: 'sqlite', status: 'active' },
    { id: 'r2', type: 'requirement', content: '存储必须使用 PostgreSQL', subject: '存储', slot: 'value', value: 'postgresql', status: 'active' },
  ], edges: [] }, '/tmp/project');
  const [conflict] = detectContextConflicts(graph);
  assert.deepEqual(conflict.nodes, ['r1', 'r2']);
  assert.equal(conflict.proposal.type, 'conflicts_with');
  assert.equal(conflict.proposal.mode, 'MANUAL');
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
  assert.match(result.compiledFingerprint, /^[a-f0-9]{64}$/);

  const explicitRaw = await compileContext({ projectPath: root, graph, entry: 'task', task: '修改 Recorder', tokenBudget: 4000, include: ['conversation'] });
  assert.ok(explicitRaw.included.some(item => item.node === 'conversation' && item.forceInclude === true));
  assert.match(explicitRaw.context, /unrelated raw history/);
  assert.equal(explicitRaw.validation.valid, true);
});

test('one hundred raw conversation messages stay trace-only after structured extraction', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-long-conversation-'));
  const raw = Array.from({ length: 100 }, (_, index) => ({
    id: `conversation.message.${index + 1}`,
    type: 'conversation',
    content: `Historical raw message ${index + 1}`,
    status: 'archived',
    metadata: { raw: true, layer: 'raw' },
  }));
  const structured = [
    ...Array.from({ length: 3 }, (_, index) => ({ id: `requirement.${index + 1}`, type: 'requirement', content: `Active requirement ${index + 1}` })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: `constraint.${index + 1}`, type: 'constraint', content: `Active constraint ${index + 1}` })),
    { id: 'decision.1', type: 'decision', content: 'Current architecture decision', priority: 'critical' },
  ];
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task.current', type: 'task', content: 'Implement the current capability' },
    { id: 'function.current', type: 'functional', content: 'Current capability' },
    ...structured,
    ...raw,
  ], edges: [
    { source: 'task.current', target: 'function.current', type: 'targets', scope: ['context'], mode: 'MANUAL' },
    ...structured.map(node => ({ source: node.id, target: 'function.current', type: node.type === 'constraint' ? 'constrains' : node.type === 'requirement' ? 'affects' : 'applies_to', scope: ['content'], mode: 'MANUAL' })),
    ...raw.map(node => ({ source: 'task.current', target: node.id, type: 'derived_from', scope: ['content'], mode: 'AUTO' })),
  ] }, root);

  const result = await compileContext({ projectPath: root, graph, entry: 'task.current', task: 'Implement the current capability', tokenBudget: 4000 });
  const included = new Set(result.included.map(item => item.node));
  for (const node of structured) assert.ok(included.has(node.id));
  assert.ok(!result.included.some(item => item.nodeType === 'conversation'));
  assert.equal(result.excluded.filter(item => item.nodeType === 'conversation').length, 100);
  assert.ok(result.rawTokens > 0);
});

test('a stale required interface is reported as missing Hard Context', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-stale-interface-'));
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task.current', type: 'task', content: 'Change the API consumer' },
    { id: 'function.consumer', type: 'functional', content: 'API consumer' },
    { id: 'interface.provider', type: 'interface', content: 'Provider.call() -> Result', status: 'stale' },
  ], edges: [
    { source: 'task.current', target: 'function.consumer', type: 'targets', scope: ['context'], mode: 'MANUAL' },
    { source: 'function.consumer', target: 'interface.provider', type: 'depends_on', scope: ['interface'], mode: 'AUTO' },
  ] }, root);

  const result = await compileContext({ projectPath: root, graph, entry: 'task.current', task: 'Change the API consumer', tokenBudget: 2000 });
  const omitted = result.excluded.find(item => item.node === 'interface.provider');
  assert.equal(omitted.policyClass, 'hard');
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.errors.some(error => error.code === 'MISSING_HARD_CONTEXT'));
});

test('a stale Functional target of the current task blocks compilation as missing Hard Context', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-stale-functional-'));
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task.current', type: 'task', content: 'Change the stale capability' },
    { id: 'function.stale', type: 'functional', content: 'Stale capability', status: 'stale' },
  ], edges: [
    { source: 'task.current', target: 'function.stale', type: 'targets', scope: ['context'], mode: 'MANUAL' },
  ] }, root);

  const result = await compileContext({ projectPath: root, graph, entry: 'task.current', task: 'Change the stale capability', tokenBudget: 2000 });
  const omitted = result.excluded.find(item => item.node === 'function.stale');
  assert.equal(omitted.policyClass, 'hard');
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.errors.some(error => error.code === 'MISSING_HARD_CONTEXT'));
});

test('directional Force Include and Force Exclude edges override modular traversal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-edge-overrides-'));
  await writeFile(path.join(root, 'feature.py'), 'def feature():\n    return "implementation"\n');
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task.current', type: 'task', content: 'Change the feature' },
    { id: 'function.feature', type: 'functional', content: 'Feature capability' },
    { id: 'feature', type: 'code_module', path: 'feature.py' },
    { id: 'note.required', type: 'note', content: 'Explicitly requested review note' },
  ], edges: [
    { source: 'task.current', target: 'function.feature', type: 'targets', scope: ['context'], mode: 'MANUAL' },
    { source: 'function.feature', target: 'feature', type: 'implemented_by', scope: ['code'], mode: 'FORCE_EXCLUDE' },
    { source: 'function.feature', target: 'note.required', type: 'related_to', scope: ['content'], mode: 'FORCE_INCLUDE' },
  ], mappings: [
    { functional: 'function.feature', implementation: [{ id: 'feature', path: 'feature.py' }], mode: 'AUTO' },
  ] }, root);

  const result = await compileContext({ projectPath: root, graph, entry: 'task.current', task: 'Change the feature', tokenBudget: 2000 });
  assert.ok(!result.included.some(item => item.node === 'feature'));
  assert.ok(result.excluded.some(item => item.node === 'feature' && item.reason === 'FORCE_EXCLUDE'));
  assert.ok(result.included.some(item => item.node === 'note.required' && item.forceInclude === true && item.reason === 'FORCE_INCLUDE'));
});

test('session Force Include loads an implementation node source instead of an empty context entry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-force-implementation-'));
  await writeFile(path.join(root, 'worker.py'), 'def run_job():\n    return "done"\n');
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task.current', type: 'task', content: 'Review the worker' },
    { id: 'function.current', type: 'functional', content: 'Current capability' },
    { id: 'worker', type: 'code_module', path: 'worker.py' },
  ], edges: [
    { source: 'task.current', target: 'function.current', type: 'targets', scope: ['context'], mode: 'MANUAL' },
  ] }, root);

  const result = await compileContext({
    projectPath: root,
    graph,
    entry: 'task.current',
    task: 'Review the worker',
    tokenBudget: 2000,
    include: ['worker'],
  });

  const source = result.included.find(item => item.node === 'worker' && item.scope === 'code');
  assert.ok(source);
  assert.equal(source.forceInclude, true);
  assert.equal(source.reason, 'FORCE_INCLUDE');
  assert.match(result.context, /def run_job/);
});

test('functional mapping Force modes control mapped implementation selection', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-mapping-overrides-'));
  await writeFile(path.join(root, 'required.py'), 'def required_impl():\n    return "required"\n');
  await writeFile(path.join(root, 'blocked.py'), 'def blocked_impl():\n    return "blocked"\n');
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'function.current', type: 'functional', content: 'Current capability' },
    { id: 'required', type: 'code_module', path: 'required.py' },
    { id: 'blocked', type: 'code_module', path: 'blocked.py', mode: 'FORCE_INCLUDE' },
  ], edges: [], mappings: [
    { functional: 'function.current', implementation: [{ id: 'required', path: 'required.py' }], mode: 'FORCE_INCLUDE' },
    { functional: 'function.current', implementation: [{ id: 'blocked', path: 'blocked.py' }], mode: 'FORCE_EXCLUDE' },
  ] }, root);

  const result = await compileContext({
    projectPath: root,
    graph,
    entry: 'function.current',
    task: 'Review current capability',
    tokenBudget: 2000,
  });

  assert.ok(result.included.some(item => item.node === 'required' && item.scope === 'code' && item.forceInclude === true));
  assert.ok(!result.included.some(item => item.node === 'blocked'));
  assert.ok(result.excluded.some(item => item.node === 'blocked' && item.reason === 'FORCE_EXCLUDE'));
});
