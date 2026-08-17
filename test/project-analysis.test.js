import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyGraph, normalizeGraph } from '../src/core.js';
import { loadFactsCache } from '../src/implementation-index.js';
import { analyzeContextProject, applyContextInvalidation } from '../src/project-analysis.js';

test('code invalidation marks automatic contracts and functional mappings stale without overwriting manual nodes', () => {
  const root = '/tmp/context-invalidation';
  const graph = normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'service', type: 'code_module', source: 'code', path: 'service.py' },
    { id: 'interface.service', type: 'interface', source: 'derived', mode: 'AUTO', metadata: { module: 'service', qualified_id: 'service:run' } },
    { id: 'interface.manual', type: 'interface', source: 'user', mode: 'MANUAL', metadata: { module: 'service' } },
    { id: 'function.service', type: 'functional', source: 'derived', mode: 'AUTO' },
  ], mappings: [{ functional: 'function.service', implementation: [{ id: 'service', path: 'service.py' }], mode: 'AUTO' }] }, root);
  const next = applyContextInvalidation(graph, {
    changed: ['service.py'],
    invalidated: { files: ['service.py'], modules: ['service'], symbols: ['service:run'], interfaces: ['service:run'] },
  });

  assert.equal(next.nodes.find(node => node.id === 'interface.service').status, 'stale');
  assert.equal(next.nodes.find(node => node.id === 'function.service').status, 'stale');
  assert.equal(next.mappings[0].metadata.status, 'stale');
  assert.equal(next.nodes.find(node => node.id === 'interface.manual').status, 'active');
  assert.equal(next.nodes.find(node => node.id === 'interface.manual').metadata.invalidation_status, 'review_required');
  assert.ok(next.cache.invalidated.includes('service'));
});

test('read-only project analysis reports changes without creating or advancing the persisted cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-analysis-read-only-'));
  await writeFile(path.join(root, 'worker.py'), 'def run():\n    return 1\n');

  const coldPreview = await analyzeContextProject(root, { persistCache: false });
  assert.equal(coldPreview.cachePersisted, false);
  assert.deepEqual(coldPreview.invalidation.changed, ['worker.py']);
  assert.equal(await loadFactsCache(root), null);

  const initial = await analyzeContextProject(root);
  assert.equal(initial.cachePersisted, true);
  const persisted = await loadFactsCache(root);
  const originalHash = persisted.files['worker.py'].hash;

  await writeFile(path.join(root, 'worker.py'), 'def run():\n    return 2\n');
  const preview = await analyzeContextProject(root, { persistCache: false });
  assert.deepEqual(preview.invalidation.changed, ['worker.py']);
  assert.equal((await loadFactsCache(root)).files['worker.py'].hash, originalHash);

  const committed = await analyzeContextProject(root);
  assert.deepEqual(committed.invalidation.changed, ['worker.py']);
  assert.notEqual((await loadFactsCache(root)).files['worker.py'].hash, originalHash);
});

test('project analysis reuses unchanged facts and analyzes only changed files when the module set is stable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-analysis-incremental-'));
  await writeFile(path.join(root, 'worker.py'), 'def run():\n    return 1\n');
  await writeFile(path.join(root, 'helper.py'), 'def help_worker():\n    return 1\n');

  const initial = await analyzeContextProject(root);
  assert.equal(initial.analysisMode, 'full');
  assert.deepEqual(initial.invalidation.changed, ['helper.py', 'worker.py']);

  const reused = await analyzeContextProject(root);
  assert.equal(reused.analysisMode, 'cache');
  assert.deepEqual(reused.analyzedFiles, []);
  assert.deepEqual(reused.invalidation.changed, []);

  await writeFile(path.join(root, 'worker.py'), 'def run():\n    return 2\n');
  const incremental = await analyzeContextProject(root);
  assert.equal(incremental.analysisMode, 'incremental');
  assert.deepEqual(incremental.analyzedFiles, ['worker.py']);
  assert.deepEqual(incremental.invalidation.changed, ['worker.py']);
  assert.ok(incremental.facts.modules.some(module => module.id === 'helper'));
  assert.ok(incremental.facts.modules.some(module => module.id === 'worker'));

  await writeFile(path.join(root, 'new_module.py'), 'def added():\n    return True\n');
  const structural = await analyzeContextProject(root);
  assert.equal(structural.analysisMode, 'full');
  assert.ok(structural.analyzedFiles.includes('new_module.py'));
  assert.ok(structural.facts.modules.some(module => module.id === 'new_module'));
});
