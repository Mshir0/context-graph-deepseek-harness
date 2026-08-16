import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProject, compileContext, emptyGraph, reconcileGraphs, validateGraph } from '../src/core.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('validates graph endpoints and relationship types', () => {
  const graph = emptyGraph('/tmp/project');
  graph.nodes = [{ id: 'a' }, { id: 'b' }];
  graph.edges = [{ source: 'a', target: 'b', type: 'interface', scope: ['interface'], mode: 'AUTO' }];
  assert.deepEqual(validateGraph(graph), []);
  graph.edges[0].type = 'invalid';
  assert.equal(validateGraph(graph).length, 1);
});

test('reconciles missing and stale code/context edges', () => {
  const graph = emptyGraph('/tmp/project'); graph.nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  graph.edges = [{ source: 'a', target: 'c', type: 'interface', scope: ['interface'] }];
  const result = reconcileGraphs({ modules: [{ id: 'a', path: 'a.py', imports: ['b'] }, { id: 'b', path: 'b.py', imports: [] }, { id: 'c', path: 'c.py', imports: [] }] }, graph);
  assert.ok(result.suggestions.some((item) => item.kind === 'missing' && item.target === 'b'));
  assert.ok(result.suggestions.some((item) => item.kind === 'stale' && item.target === 'c'));
});

test('scans C source files and resolves quoted includes to project modules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-c-'));
  await writeFile(path.join(root, 'hello.c'), '#include "helper.h"\nint main(void) { return helper(); }\n');
  await writeFile(path.join(root, 'helper.c'), 'int helper(void) { return 0; }\n');
  const codeGraph = await analyzeProject(root);
  assert.deepEqual(codeGraph.modules.map(module => module.id), ['hello', 'helper']);
  assert.equal(codeGraph.modules.find(module => module.id === 'hello').language, 'c');
  const result = reconcileGraphs(codeGraph, emptyGraph(root));
  assert.ok(result.suggestions.some(item => item.kind === 'missing' && item.source === 'hello' && item.target === 'helper'));
});

test('compiler prioritizes target, honors force exclude, and respects budget', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-'));
  await mkdir(path.join(root, '.context', 'modules', 'a'), { recursive: true }); await mkdir(path.join(root, '.context', 'modules', 'b'), { recursive: true });
  await writeFile(path.join(root, '.context', 'project.md'), 'Project rules'); await writeFile(path.join(root, 'a.py'), 'print("a")'); await writeFile(path.join(root, 'b.py'), 'print("b")');
  for (const module of ['a', 'b']) for (const name of ['context', 'interface', 'state', 'decisions']) await writeFile(path.join(root, '.context', 'modules', module, `${name}.md`), `${module} ${name}`);
  const graph = emptyGraph(root); graph.nodes = [{ id: 'a', path: 'a.py' }, { id: 'b', path: 'b.py', mode: 'FORCE_EXCLUDE' }]; graph.edges = [{ source: 'a', target: 'b', type: 'interface', scope: ['interface', 'state'] }];
  const result = await compileContext({ projectPath: root, graph, target: 'a', task: 'change cache', tokenBudget: 1000 });
  assert.equal(result.target, 'a'); assert.ok(result.included.some((item) => item.label === 'User task')); assert.ok(result.excluded.some((item) => item.module === 'b' && item.reason === 'FORCE_EXCLUDE'));
});
