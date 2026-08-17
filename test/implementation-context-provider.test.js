import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeProject, emptyGraph, normalizeGraph } from '../src/core.js';
import { analyzeDependencies } from '../src/dependency-skill.js';
import { contextRequest } from '../src/context-provider.js';
import {
  loadFactsCache,
  materializeImplementationIndex,
  updateFactsCache,
} from '../src/implementation-index.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'implementation-context-'));
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await writeFile(path.join(root, 'service.py'), [
    'class TimestampAligner:',
    '    def normalize(self, value: int) -> int:',
    '        return max(0, value)',
    '',
    '    def align(self, value: int) -> int:',
    '        return self.normalize(value)',
    '',
    'def unrelated():',
    '    return "do not include"',
  ].join('\n'));
  await writeFile(path.join(root, 'tests', 'test_service.py'), [
    'from service import TimestampAligner',
    '',
    'def test_align():',
    '    aligner = TimestampAligner()',
    '    assert aligner.align(-1) == 0',
  ].join('\n'));
  return root;
}

async function factsFor(root) {
  const [scan, dependencies] = await Promise.all([analyzeProject(root), analyzeDependencies(root)]);
  return { ...dependencies, root, modules: scan.modules, relationships: dependencies.relationships, interfaces: dependencies.interfaces };
}

test('Python analyzers emit stable qualified symbols with boundaries and signatures', async () => {
  const root = await fixture();
  const scan = await analyzeProject(root);
  const service = scan.modules.find(module => module.id === 'service');
  const aligner = service.symbols.find(symbol => symbol.name === 'TimestampAligner');
  const align = service.symbols.find(symbol => symbol.name === 'TimestampAligner.align');
  assert.deepEqual(
    { id: aligner.id, container: aligner.container, start: aligner.start_line, end: aligner.end_line },
    { id: 'service:TimestampAligner', container: 'service', start: 1, end: 6 },
  );
  assert.equal(align.id, 'service:TimestampAligner.align');
  assert.equal(align.container, 'service:TimestampAligner');
  assert.equal(align.subkind, 'method');
  assert.match(align.signature, /^def align\(self, value: int\) -> int$/);
  assert.deepEqual(align.calls, ['self.normalize']);

  const dependencies = await analyzeDependencies(root);
  const dependencyAlign = dependencies.modules.find(module => module.id === 'service').symbols.find(symbol => symbol.name === 'TimestampAligner.align');
  assert.equal(dependencyAlign.qualified_id, 'service:TimestampAligner.align');
  assert.equal(dependencyAlign.container, 'service:TimestampAligner');
  assert.ok(dependencyAlign.end_line >= dependencyAlign.start_line);
  assert.ok(dependencies.interfaces.some(contract => contract.qualified_id === dependencyAlign.id && contract.signature === dependencyAlign.signature));
});

test('materializes file, class, function, contains, and symbol call graph records', async () => {
  const root = await fixture();
  const facts = await factsFor(root);
  const index = materializeImplementationIndex(facts);
  assert.equal(index.nodes.find(node => node.id === 'service').type, 'implementation_file');
  assert.equal(index.nodes.find(node => node.id === 'service:TimestampAligner').type, 'implementation_class');
  assert.equal(index.nodes.find(node => node.id === 'service:TimestampAligner.align').type, 'implementation_function');
  assert.ok(index.edges.some(edge => edge.source === 'service' && edge.target === 'service:TimestampAligner' && edge.type === 'contains'));
  assert.ok(index.edges.some(edge => edge.source === 'service:TimestampAligner' && edge.target === 'service:TimestampAligner.align' && edge.type === 'contains'));
  assert.ok(index.edges.some(edge => edge.source === 'service:TimestampAligner.align' && edge.target === 'service:TimestampAligner.normalize' && edge.type === 'calls'));
  assert.ok(index.edges.some(edge => edge.source === 'tests.test_service:test_align' && edge.target === 'service:TimestampAligner.align' && edge.type === 'calls'));

  const legacy = materializeImplementationIndex({ modules: [{ id: 'legacy', path: 'legacy.py', symbols: [{ name: 'run', kind: 'function', line: 1 }], calls: ['run'] }] });
  assert.ok(legacy.nodes.some(node => node.id === 'legacy:run' && node.type === 'implementation_function'));
  assert.ok(legacy.edges.some(edge => edge.source === 'legacy' && edge.target === 'legacy:run' && edge.type === 'calls'));
});

test('serves exact symbol, interface, and related test context under a hard budget', async () => {
  const root = await fixture();
  const facts = await factsFor(root);
  const index = materializeImplementationIndex(facts);
  const result = await contextRequest({
    target: 'service:TimestampAligner.align',
    scope: ['symbol', 'interface', 'test'],
    maxTokens: 220,
    reason: 'Change TimestampAligner.align while preserving its contract and test behavior',
  }, { projectPath: root, facts, index });
  assert.ok(result.estimatedTokens <= 220);
  assert.equal(result.included[0].id, 'service:TimestampAligner.align');
  assert.ok(result.included.some(item => item.kind === 'interface'));
  assert.ok(result.included.some(item => item.kind === 'test'));
  assert.match(result.context, /def align\(self, value: int\)/);
  assert.match(result.context, /def test_align\(\)/);
  assert.doesNotMatch(result.context, /do not include/);

  const tiny = await contextRequest({ target: 'service:TimestampAligner.align', scope: ['symbol'], maxTokens: 20, reason: 'align' }, { projectPath: root, facts, index });
  assert.ok(tiny.estimatedTokens <= 20);
  assert.equal(tiny.included[0].id, 'service:TimestampAligner.align');
  assert.equal(tiny.included[0].truncated, true);
});

test('serves an explicitly connected document for an implementation target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-provider-docs-'));
  await writeFile(path.join(root, 'worker.py'), 'def run():\n    return True\n');
  const facts = await analyzeDependencies(root);
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'worker', type: 'code_module', path: 'worker.py', source: 'code' },
    { id: 'docs.worker', type: 'documentation', content: 'Worker retries are intentionally disabled.' },
  ], edges: [
    { source: 'worker', target: 'docs.worker', type: 'documents', scope: ['content'], mode: 'MANUAL' },
  ] }, root);

  const response = await contextRequest({
    target: 'worker',
    scope: ['documentation'],
    reason: 'Review worker behavior',
    maxTokens: 100,
  }, { projectPath: root, graph, facts });

  assert.equal(response.included[0]?.id, 'docs.worker');
  assert.match(response.context, /retries are intentionally disabled/);
  assert.ok(response.estimatedTokens <= 100);
});

test('resolves Functional targets through direct semantic neighbors and explicit implementation mappings only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'functional-context-provider-'));
  await writeFile(path.join(root, 'helper.py'), 'def noisy_dependency():\n    return "unrelated implementation"\n');
  await writeFile(path.join(root, 'speaker.py'), [
    'from helper import noisy_dependency',
    '',
    'class SpeakerService:',
    '    def track(self, frame: bytes) -> str:',
    '        noisy_dependency()',
    '        return "speaker-id"',
  ].join('\n'));
  const facts = await factsFor(root);
  const index = materializeImplementationIndex(facts);
  const graph = {
    nodes: [
      { id: 'function.speaker', type: 'functional', title: 'Speaker Recognition' },
      { id: 'interface.speaker', type: 'interface', title: 'Speaker Port', content: 'SpeakerPort.track(frame) -> speaker_id' },
      { id: 'test.speaker', type: 'test', title: 'Speaker contract test', content: 'Track returns one stable speaker id.' },
      { id: 'docs.speaker', type: 'documentation', title: 'Speaker notes', content: 'Speaker tracking design notes.' },
      { id: 'function.unrelated', type: 'functional', title: 'Unrelated' },
      { id: 'interface.unrelated', type: 'interface', title: 'Unrelated Port', content: 'Must not be selected.' },
    ],
    edges: [
      { source: 'interface.speaker', target: 'function.speaker', type: 'provides' },
      { source: 'test.speaker', target: 'function.speaker', type: 'tests' },
      { source: 'docs.speaker', target: 'function.speaker', type: 'documents' },
      { source: 'interface.unrelated', target: 'function.unrelated', type: 'provides' },
    ],
    mappings: [{ functional: 'function.speaker', implementation: [{ id: 'speaker:SpeakerService.track' }] }],
  };

  const interfaces = await contextRequest({
    target: 'function.speaker', scope: ['interface'], maxTokens: 180, reason: 'Inspect the Speaker contract',
  }, { projectPath: root, facts, index, graph });
  assert.ok(interfaces.estimatedTokens <= 180);
  assert.ok(interfaces.included.some(item => item.id === 'interface.speaker'));
  assert.ok(interfaces.included.every(item => item.kind === 'interface'));
  assert.match(interfaces.context, /SpeakerPort\.track/);
  assert.doesNotMatch(interfaces.context, /stable speaker id|design notes|Must not be selected/);

  const semanticTests = await contextRequest({ target: 'function.speaker', scope: ['test'], maxTokens: 80, reason: 'Inspect tests' }, { projectPath: root, facts, index, graph });
  assert.deepEqual(semanticTests.included.map(item => item.id), ['test.speaker']);
  const documentation = await contextRequest({ target: 'function.speaker', scope: ['documentation'], maxTokens: 80, reason: 'Inspect docs' }, { projectPath: root, facts, index, graph });
  assert.deepEqual(documentation.included.map(item => item.id), ['docs.speaker']);

  const implementation = await contextRequest({
    target: 'function.speaker', scope: ['implementation'], maxTokens: 120, reason: 'Change speaker tracking',
  }, { projectPath: root, facts, index, graph });
  assert.ok(implementation.estimatedTokens <= 120);
  assert.deepEqual(implementation.included.map(item => item.id), ['speaker:SpeakerService.track']);
  assert.match(implementation.context, /def track\(self, frame: bytes\) -> str/);
  assert.doesNotMatch(implementation.context, /def noisy_dependency|unrelated implementation/);
});

test('on-demand context cannot bypass graph, node, parent-module, or session Force Exclude policy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'functional-context-exclude-'));
  await writeFile(path.join(root, 'speaker.py'), [
    'class SpeakerService:',
    '    def track(self, frame: bytes) -> str:',
    '        return "speaker-id"',
  ].join('\n'));
  const facts = await factsFor(root);
  const index = materializeImplementationIndex(facts);
  const base = {
    nodes: [
      { id: 'function.speaker', type: 'functional', title: 'Speaker Recognition' },
      { id: 'interface.speaker', type: 'interface', title: 'Speaker Port', content: 'SpeakerPort.track(frame) -> speaker_id' },
    ],
    edges: [{ source: 'interface.speaker', target: 'function.speaker', type: 'provides' }],
    mappings: [{ functional: 'function.speaker', implementation: [{ id: 'speaker:SpeakerService.track' }] }],
    overrides: { include: [], exclude: [], deleted: [] },
  };

  const graphExcluded = structuredClone(base);
  graphExcluded.overrides.exclude.push('function.speaker');
  await assert.rejects(
    contextRequest({ target: 'function.speaker', scope: ['interface'], maxTokens: 80, reason: 'Need contract' }, { projectPath: root, facts, index, graph: graphExcluded }),
    error => error.code === 'CONTEXT_FORCE_EXCLUDED',
  );

  const neighborExcluded = structuredClone(base);
  neighborExcluded.nodes.find(node => node.id === 'interface.speaker').mode = 'FORCE_EXCLUDE';
  const interfaces = await contextRequest(
    { target: 'function.speaker', scope: ['interface'], maxTokens: 80, reason: 'Need contract' },
    { projectPath: root, facts, index, graph: neighborExcluded },
  );
  assert.ok(!interfaces.included.some(item => item.id === 'interface.speaker'));
  assert.doesNotMatch(interfaces.context, /SpeakerPort/);

  const sessionExcluded = await contextRequest(
    { target: 'function.speaker', scope: ['implementation'], maxTokens: 80, reason: 'Need implementation' },
    { projectPath: root, facts, index, graph: base, forceExclude: ['speaker'] },
  );
  assert.deepEqual(sessionExcluded.included, []);
  assert.equal(sessionExcluded.context, '');

  const parentExcluded = structuredClone(base);
  parentExcluded.nodes.push({ id: 'speaker', type: 'code_module', mode: 'FORCE_EXCLUDE' });
  await assert.rejects(
    contextRequest({ target: 'speaker:SpeakerService.track', scope: ['symbol'], maxTokens: 80, reason: 'Need implementation' }, { projectPath: root, facts, index, graph: parentExcluded }),
    error => error.code === 'CONTEXT_FORCE_EXCLUDED',
  );
});

test('persists file hashes and reports changed and deleted cache invalidation', async () => {
  const root = await fixture();
  const initialFacts = await factsFor(root);
  const initial = await updateFactsCache(root, initialFacts);
  assert.deepEqual(initial.invalidation.changed, ['service.py', 'tests/test_service.py']);
  assert.deepEqual(initial.invalidation.deleted, []);
  assert.ok(await loadFactsCache(root));

  await writeFile(path.join(root, 'service.py'), [
    'class TimestampAligner:',
    '    def align(self, value: int) -> int:',
    '        return value + 1',
  ].join('\n'));
  const changedFacts = await analyzeDependencies(root, { files: ['service.py'] });
  const changed = await updateFactsCache(root, changedFacts, { incremental: true, analyzedFiles: ['service.py'] });
  assert.deepEqual(changed.invalidation.changed, ['service.py']);
  assert.deepEqual(changed.invalidation.deleted, []);
  assert.ok(changed.invalidation.invalidated.modules.includes('service'));
  assert.ok(changed.invalidation.invalidated.interfaces.includes('service:TimestampAligner.align'));
  assert.ok(changed.cache.files['tests/test_service.py']);

  await unlink(path.join(root, 'tests', 'test_service.py'));
  const deleted = await updateFactsCache(root, { modules: [], relationships: [], interfaces: [], errors: [] }, { incremental: true, analyzedFiles: ['tests/test_service.py'] });
  assert.deepEqual(deleted.invalidation.deleted, ['tests/test_service.py']);
  assert.ok(deleted.invalidation.invalidated.modules.includes('tests.test_service'));
  assert.ok(deleted.invalidation.invalidated.symbols.includes('tests.test_service:test_align'));
  assert.equal(deleted.cache.files['tests/test_service.py'], undefined);
});
