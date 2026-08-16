import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeDependencies, proposeContextEdges, validateRelationship } from '../src/dependency-skill.js';
import { analyzeProject, emptyGraph, reconcileGraphs } from '../src/core.js';

test('resolves imports from a nested Python package to canonical path module ids', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-python-package-'));
  const packageRoot = path.join(root, 'starlette', 'starlette');
  await mkdir(path.join(packageRoot, 'middleware'), { recursive: true });
  await writeFile(path.join(packageRoot, '__init__.py'), '');
  await writeFile(path.join(packageRoot, 'datastructures.py'), 'class Headers:\n    pass\n');
  await writeFile(path.join(packageRoot, 'types.py'), 'class Scope:\n    pass\n');
  await writeFile(path.join(packageRoot, 'middleware', '__init__.py'), '');
  await writeFile(path.join(packageRoot, 'middleware', 'request_id.py'), [
    'from starlette.datastructures import Headers',
    'from starlette.types import Scope',
    '',
    'class RequestIdMiddleware:',
    '    def __call__(self, scope: Scope):',
    '        return Headers(scope=scope)',
  ].join('\n'));

  const facts = await analyzeDependencies(root);
  const source = 'starlette.starlette.middleware.request_id';
  const relationships = facts.relationships.filter(item => item.from === source);

  assert.deepEqual(facts.errors, []);
  assert.ok(facts.modules.some(item => item.id === 'starlette.starlette.datastructures'));
  assert.ok(facts.modules.some(item => item.id === 'starlette.starlette.types'));
  assert.ok(relationships.some(item => item.type === 'IMPORT' && item.to === 'starlette.starlette.datastructures'));
  assert.ok(relationships.some(item => item.type === 'IMPORT' && item.to === 'starlette.starlette.types'));
  assert.ok(relationships.some(item => item.type === 'CALL' && item.to === 'starlette.starlette.datastructures'));
  assert.ok(relationships.some(item => item.type === 'REFERENCE' && item.to === 'starlette.starlette.datastructures'));
  assert.ok(relationships.some(item => item.type === 'REFERENCE' && item.to === 'starlette.starlette.types'));
  assert.equal(validateRelationship(facts, { source, target: 'starlette.starlette.datastructures' }).supported, true);
  assert.ok(proposeContextEdges(facts, source).some(item => item.from === source && item.to === 'starlette.starlette.datastructures'));

  const codeGraph = await analyzeProject(root);
  const scan = reconcileGraphs(codeGraph, emptyGraph(root));
  assert.ok(scan.suggestions.some(item => item.kind === 'missing' && item.source === source && item.target === 'starlette.starlette.datastructures'));
  assert.ok(scan.suggestions.some(item => item.kind === 'missing' && item.source === source && item.target === 'starlette.starlette.types'));
});

test('rejects ambiguous package-root aliases instead of guessing a dependency', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-python-ambiguous-'));
  for (const vendor of ['vendor_one', 'vendor_two']) {
    const packageRoot = path.join(root, vendor, 'pkg');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, '__init__.py'), '');
    await writeFile(path.join(packageRoot, 'api.py'), 'class Client:\n    pass\n');
  }
  await writeFile(path.join(root, 'consumer.py'), 'from pkg.api import Client\n\ndef build():\n    return Client()\n');

  const facts = await analyzeDependencies(root);
  const candidates = new Set(['vendor_one.pkg.api', 'vendor_two.pkg.api']);
  assert.ok(!facts.relationships.some(item => item.from === 'consumer' && candidates.has(item.to)));

  const scan = reconcileGraphs(await analyzeProject(root), emptyGraph(root));
  assert.ok(!scan.suggestions.some(item => item.source === 'consumer' && candidates.has(item.target)));
});

test('resolves package and parent relative imports from __init__ and regular modules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-python-relative-'));
  const apiRoot = path.join(root, 'services', 'api');
  const packageRoot = path.join(apiRoot, 'pkg');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(root, 'services', '__init__.py'), '');
  await writeFile(path.join(apiRoot, '__init__.py'), '');
  await writeFile(path.join(apiRoot, 'shared.py'), 'class Shared:\n    pass\n');
  await writeFile(path.join(packageRoot, 'submod.py'), 'class Thing:\n    pass\n');
  await writeFile(path.join(packageRoot, '__init__.py'), [
    'from . import submod',
    'from .submod import Thing',
    'from ..shared import Shared',
  ].join('\n'));
  await writeFile(path.join(packageRoot, 'worker.py'), 'from ..shared import Shared\n\ndef build():\n    return Shared()\n');

  const facts = await analyzeDependencies(root);
  const hasImport = (source, target) => facts.relationships.some(item => item.type === 'IMPORT' && item.from === source && item.to === target);
  assert.equal(hasImport('services.api.pkg', 'services.api.pkg.submod'), true);
  assert.equal(hasImport('services.api.pkg', 'services.api.shared'), true);
  assert.equal(hasImport('services.api.pkg.worker', 'services.api.shared'), true);

  const scan = reconcileGraphs(await analyzeProject(root), emptyGraph(root));
  const hasSuggestion = (source, target) => scan.suggestions.some(item => item.kind === 'missing' && item.source === source && item.target === target);
  assert.equal(hasSuggestion('services.api.pkg', 'services.api.pkg.submod'), true);
  assert.equal(hasSuggestion('services.api.pkg', 'services.api.shared'), true);
  assert.equal(hasSuggestion('services.api.pkg.worker', 'services.api.shared'), true);
});

test('resolves relative imports when the package directory is the scan root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-python-root-package-'));
  await writeFile(path.join(root, '__init__.py'), 'from . import submod\n');
  await writeFile(path.join(root, 'submod.py'), 'class Value:\n    pass\n');

  const facts = await analyzeDependencies(root);
  assert.ok(facts.relationships.some(item => item.from === path.basename(root) && item.to === 'submod' && item.type === 'IMPORT'));
  const scan = reconcileGraphs(await analyzeProject(root), emptyGraph(root));
  assert.ok(scan.suggestions.some(item => item.kind === 'missing' && item.source === path.basename(root) && item.target === 'submod'));
});
