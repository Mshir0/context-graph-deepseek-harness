import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileContext, emptyGraph, normalizeGraph, validateGraph } from '../src/core.js';
import { applyFunctionalInference, inferFunctionalModules, mergeFunctionalNodes, splitFunctionalNode } from '../src/semantic-functional.js';

function implementationGraph(root) {
  return normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'asr', type: 'code_module', path: 'src/asr/asr.py' },
    { id: 'whisper', type: 'code_module', path: 'src/asr/whisper.py' },
    { id: 'decoder', type: 'code_module', path: 'src/asr/decoder.py' },
    { id: 'timestamp', type: 'code_module', path: 'src/asr/timestamp.py' },
    { id: 'speaker', type: 'code_module', path: 'src/speaker/tracker.py' },
  ], edges: [] }, root);
}

const facts = {
  relationships: [
    { from: 'asr', to: 'whisper', type: 'IMPORT', confidence: 0.9 },
    { from: 'asr', to: 'decoder', type: 'IMPORT', confidence: 0.9 },
    { from: 'decoder', to: 'timestamp', type: 'CALL', confidence: 0.9 },
  ],
};

test('infers one ASR functional node for connected implementation files', () => {
  const proposal = inferFunctionalModules(implementationGraph('/tmp/semantic-functional'), facts);
  const asr = proposal.nodes.find(node => node.id === 'function.asr');
  assert.ok(asr);
  assert.deepEqual(proposal.mappings.find(mapping => mapping.functional === asr.id).implementation.map(item => item.id).sort(), ['asr', 'decoder', 'timestamp', 'whisper']);
  assert.ok(!proposal.edges.some(edge => edge.source === 'function.asr' && ['asr', 'decoder', 'timestamp', 'whisper'].includes(edge.target)));
});

test('functional inference groups a capability by path domain and preserves cross-domain evidence', () => {
  const graph = implementationGraph('/tmp/semantic-domains');
  const proposal = inferFunctionalModules(graph, { relationships: [
    ...facts.relationships,
    { from: 'asr', to: 'speaker', type: 'CALL', confidence: 0.92, evidence: [{ file: 'src/asr/asr.py', line: 10 }] },
  ] });
  const asr = proposal.mappings.find(mapping => mapping.functional === 'function.asr');
  const speaker = proposal.mappings.find(mapping => mapping.functional === 'function.speaker');
  assert.deepEqual(asr.implementation.map(item => item.id).sort(), ['asr', 'decoder', 'timestamp', 'whisper']);
  assert.deepEqual(speaker.implementation.map(item => item.id), ['speaker']);
  assert.ok(proposal.edges.some(edge => edge.source === 'function.asr' && edge.target === 'function.speaker' && edge.type === 'depends_on'));
});

test('twenty unrelated files in one capability directory infer one functional node', () => {
  const root = '/tmp/twenty-files';
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: Array.from({ length: 20 }, (_, index) => ({ id: `asr.part_${index}`, type: 'code_module', path: `src/asr/part_${index}.py` })), edges: [] }, root);
  const proposal = inferFunctionalModules(graph, { relationships: [] });
  assert.equal(proposal.nodes.length, 1);
  assert.equal(proposal.nodes[0].id, 'function.asr');
  assert.equal(proposal.mappings[0].implementation.length, 20);
});

test('compiler follows semantic context then narrows to task-relevant implementation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'semantic-functional-'));
  await mkdir(path.join(root, '.context'), { recursive: true });
  await mkdir(path.join(root, 'src', 'asr'), { recursive: true });
  await mkdir(path.join(root, 'src', 'speaker'), { recursive: true });
  await writeFile(path.join(root, '.context', 'project.md'), 'Keep timestamps synchronized.');
  await writeFile(path.join(root, 'src', 'asr', 'timestamp.py'), 'def normalize_timestamp(): pass');
  await writeFile(path.join(root, 'src', 'asr', 'asr.py'), 'def transcribe(): pass');
  await writeFile(path.join(root, 'src', 'speaker', 'tracker.py'), 'def track(): pass');
  const base = implementationGraph(root);
  const proposal = inferFunctionalModules(base, facts);
  let graph = applyFunctionalInference(base, proposal);
  graph.nodes.push(
    { id: 'task.timestamp', type: 'task', title: 'Fix ASR timestamp', content: 'Modify ASR timestamp processing.' },
    { id: 'requirement.sync', type: 'requirement', title: 'Synchronize subtitle', content: 'Timestamp must remain synchronized.' },
  );
  graph.edges.push(
    { source: 'task.timestamp', target: 'function.asr', type: 'targets', scope: ['context'], mode: 'MANUAL' },
    { source: 'requirement.sync', target: 'function.asr', type: 'affects', scope: ['content'], mode: 'MANUAL' },
  );
  graph = normalizeGraph(graph, root);
  assert.deepEqual(validateGraph(graph), []);
  const result = await compileContext({ projectPath: root, graph, entry: 'task.timestamp', task: 'Fix ASR timestamp processing', tokenBudget: 4000 });
  const included = new Set(result.included.map(item => item.node));
  assert.ok(included.has('function.asr'));
  assert.ok(included.has('timestamp'));
  assert.ok(!included.has('speaker'));
});

test('compiler keeps dependent Functional nodes at interface scope when contracts are sufficient', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'functional-interface-boundary-'));
  await writeFile(path.join(root, 'a.py'), 'def change_a():\n    return True\n');
  await writeFile(path.join(root, 'b.py'), 'def internal_b():\n    return "private-b"\n');
  await writeFile(path.join(root, 'c.py'), 'def internal_c():\n    return "private-c"\n');
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task.a', type: 'task', content: '修改 A' },
    { id: 'function.a', type: 'functional', title: 'A', content: 'A capability' },
    { id: 'function.b', type: 'functional', title: 'B', content: 'B capability' },
    { id: 'function.c', type: 'functional', title: 'C', content: 'C capability' },
    { id: 'interface.b', type: 'interface', title: 'B contract', content: 'BInput -> BOutput' },
    { id: 'interface.c', type: 'interface', title: 'C contract', content: 'CInput -> COutput' },
    { id: 'impl.a', type: 'implementation_file', path: 'a.py' },
    { id: 'impl.b', type: 'implementation_file', path: 'b.py' },
    { id: 'impl.c', type: 'implementation_file', path: 'c.py' },
  ], edges: [
    { source: 'task.a', target: 'function.a', type: 'targets', scope: ['context'], mode: 'MANUAL' },
    { source: 'function.a', target: 'function.b', type: 'depends_on', scope: ['interface'], mode: 'MANUAL' },
    { source: 'function.a', target: 'function.c', type: 'depends_on', scope: ['interface'], mode: 'MANUAL' },
    { source: 'function.b', target: 'interface.b', type: 'provides', scope: ['interface'], mode: 'MANUAL' },
    { source: 'function.c', target: 'interface.c', type: 'provides', scope: ['interface'], mode: 'MANUAL' },
  ], mappings: [
    { functional: 'function.a', implementation: [{ id: 'impl.a', path: 'a.py' }] },
    { functional: 'function.b', implementation: [{ id: 'impl.b', path: 'b.py' }] },
    { functional: 'function.c', implementation: [{ id: 'impl.c', path: 'c.py' }] },
  ] }, root);

  const result = await compileContext({ projectPath: root, graph, entry: 'task.a', task: '修改 A', tokenBudget: 4000 });
  const included = new Set(result.included.map(item => item.node));
  assert.ok(included.has('function.a'));
  assert.ok(included.has('function.b'));
  assert.ok(included.has('function.c'));
  assert.ok(included.has('interface.b'));
  assert.ok(included.has('interface.c'));
  assert.ok(included.has('impl.a'));
  assert.ok(!included.has('impl.b'));
  assert.ok(!included.has('impl.c'));
  assert.doesNotMatch(result.context, /private-b|private-c/);
});

test('compiler does not cross a shared interface into unrelated sibling capabilities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'functional-shared-interface-'));
  await writeFile(path.join(root, 'a.py'), 'def handle_a():\n    return "a"\n');
  await writeFile(path.join(root, 'b.py'), 'def handle_b():\n    return "b-private"\n');
  await writeFile(path.join(root, 'c.py'), 'def handle_c():\n    return "c-private"\n');
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task.a', type: 'task', content: '修改 A' },
    { id: 'function.a', type: 'functional', title: 'A', content: 'A capability' },
    { id: 'function.b', type: 'functional', title: 'B', content: 'B capability' },
    { id: 'function.c', type: 'functional', title: 'C', content: 'C capability' },
    { id: 'interface.shared', type: 'interface', title: 'Shared Port', content: 'SharedInput -> SharedOutput' },
    { id: 'impl.a', type: 'implementation_file', path: 'a.py' },
    { id: 'impl.b', type: 'implementation_file', path: 'b.py' },
    { id: 'impl.c', type: 'implementation_file', path: 'c.py' },
  ], edges: [
    { source: 'task.a', target: 'function.a', type: 'targets', scope: ['context'], mode: 'MANUAL' },
    { source: 'function.a', target: 'interface.shared', type: 'uses', scope: ['interface'], mode: 'MANUAL' },
    { source: 'function.b', target: 'interface.shared', type: 'uses', scope: ['interface'], mode: 'MANUAL' },
    { source: 'function.c', target: 'interface.shared', type: 'uses', scope: ['interface'], mode: 'MANUAL' },
  ], mappings: [
    { functional: 'function.a', implementation: [{ id: 'impl.a', path: 'a.py' }] },
    { functional: 'function.b', implementation: [{ id: 'impl.b', path: 'b.py' }] },
    { functional: 'function.c', implementation: [{ id: 'impl.c', path: 'c.py' }] },
  ] }, root);

  const result = await compileContext({ projectPath: root, graph, entry: 'task.a', task: '修改 A', tokenBudget: 4000 });
  const included = new Set(result.included.map(item => item.node));
  assert.ok(included.has('function.a'));
  assert.ok(included.has('interface.shared'));
  assert.ok(included.has('impl.a'));
  assert.ok(!included.has('function.b'));
  assert.ok(!included.has('function.c'));
  assert.ok(!included.has('impl.b'));
  assert.ok(!included.has('impl.c'));
  assert.doesNotMatch(result.context, /b-private|c-private/);
});

test('functional merge, split, and rename only change semantic metadata and mappings', () => {
  const graph = normalizeGraph({ ...emptyGraph('/tmp/semantic-functional'), nodes: [
    { id: 'asr', type: 'code_module', path: 'src/asr.py' },
    { id: 'timestamp', type: 'code_module', path: 'src/timestamp.py' },
    { id: 'function.asr', type: 'functional', title: 'ASR' },
    { id: 'function.timestamp', type: 'functional', title: 'Timestamp Processing' },
  ], edges: [], mappings: [
    { functional: 'function.asr', implementation: [{ id: 'asr', path: 'src/asr.py' }] },
    { functional: 'function.timestamp', implementation: [{ id: 'timestamp', path: 'src/timestamp.py' }] },
  ] }, '/tmp/semantic-functional');
  const merged = mergeFunctionalNodes(graph, ['function.asr', 'function.timestamp'], { id: 'function.speech-recognition', title: 'Speech Recognition' });
  assert.equal(merged.nodes.find(node => node.id === 'asr').path, 'src/asr.py');
  assert.equal(merged.nodes.find(node => node.id === 'timestamp').path, 'src/timestamp.py');
  const split = splitFunctionalNode(merged, 'function.speech-recognition', [
    { id: 'function.asr', title: 'ASR', implementation: ['asr'] },
    { id: 'function.timestamp', title: 'Timestamp Processing', implementation: ['timestamp'] },
  ]);
  assert.deepEqual(validateGraph(normalizeGraph(split, '/tmp/semantic-functional')), []);
  assert.equal(split.nodes.find(node => node.id === 'asr').path, 'src/asr.py');
});

test('compiler combines multiple mapping records for one functional node', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'semantic-mappings-'));
  await writeFile(path.join(root, 'timestamp.py'), 'def timestamp(): pass');
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'function.asr', type: 'functional', title: 'ASR' },
    { id: 'asr', type: 'code_module', path: 'asr.py' },
    { id: 'timestamp', type: 'code_module', path: 'timestamp.py' },
  ], edges: [], mappings: [
    { functional: 'function.asr', implementation: [{ id: 'asr', path: 'asr.py' }] },
    { functional: 'function.asr', implementation: [{ id: 'timestamp', path: 'timestamp.py' }] },
  ] }, root);
  const result = await compileContext({ projectPath: root, graph, entry: 'function.asr', task: 'change timestamp', tokenBudget: 2000 });
  assert.ok(result.included.some(item => item.node === 'timestamp' && item.scope === 'code'));
});

test('compiler prefers a task-relevant symbol slice over its whole mapped file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'semantic-symbol-slice-'));
  await writeFile(path.join(root, 'timestamp.py'), [
    'def align_timestamp(value):',
    '    return value',
    '',
    'def unrelated_large_helper():',
    '    return "must not be selected"',
  ].join('\n'));
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'function.timestamp', type: 'functional', title: 'Timestamp', description: 'Align timestamps.' },
    { id: 'timestamp', type: 'code_module', source: 'code', path: 'timestamp.py' },
    { id: 'timestamp:align_timestamp', type: 'implementation_function', source: 'code', title: 'align_timestamp', path: 'timestamp.py', metadata: { module: 'timestamp', start_line: 1, end_line: 2 } },
    { id: 'timestamp:unrelated_large_helper', type: 'implementation_function', source: 'code', title: 'unrelated_large_helper', path: 'timestamp.py', metadata: { module: 'timestamp', start_line: 4, end_line: 5 } },
  ], edges: [
    { source: 'timestamp', target: 'timestamp:align_timestamp', type: 'contains', scope: ['code'], mode: 'AUTO' },
    { source: 'timestamp', target: 'timestamp:unrelated_large_helper', type: 'contains', scope: ['code'], mode: 'AUTO' },
  ], mappings: [{ functional: 'function.timestamp', implementation: [{ id: 'timestamp', path: 'timestamp.py' }] }] }, root);
  const result = await compileContext({ projectPath: root, graph, entry: 'function.timestamp', task: 'Modify align_timestamp', tokenBudget: 2000 });
  assert.ok(result.included.some(item => item.node === 'timestamp:align_timestamp' && item.scope === 'code'));
  assert.ok(!result.included.some(item => item.node === 'timestamp' && item.scope === 'code'));
  assert.match(result.context, /return value/);
  assert.doesNotMatch(result.context, /must not be selected/);
});

test('compiler limits mapped files and semantic traversal for a compact session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'semantic-limits-'));
  await writeFile(path.join(root, 'one.py'), 'def one(): pass');
  await writeFile(path.join(root, 'two.py'), 'def two(): pass');
  await writeFile(path.join(root, 'three.py'), 'def three(): pass');
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'task', type: 'task', content: 'Adjust capability' },
    { id: 'function.capability', type: 'functional', title: 'Capability', description: 'A compact capability.' },
    { id: 'requirement', type: 'requirement', content: 'Only relevant at depth two.' },
    { id: 'one', type: 'code_module', path: 'one.py' },
    { id: 'two', type: 'code_module', path: 'two.py' },
    { id: 'three', type: 'code_module', path: 'three.py' },
  ], edges: [
    { source: 'task', target: 'function.capability', type: 'targets', scope: ['context'] },
    { source: 'function.capability', target: 'requirement', type: 'affects', scope: ['content'] },
  ], mappings: [{ functional: 'function.capability', implementation: [{ id: 'one', path: 'one.py' }, { id: 'two', path: 'two.py' }, { id: 'three', path: 'three.py' }] }] }, root);
  const result = await compileContext({ projectPath: root, graph, entry: 'task', task: 'Adjust capability', tokenBudget: 3000, maxImplementationFiles: 1, semanticDepth: 1 });
  const code = result.included.filter(item => item.scope === 'code').map(item => item.node);
  assert.equal(code.length, 1);
  assert.ok(!result.included.some(item => item.node === 'requirement'));
});
