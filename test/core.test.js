import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProject, compileContext, createTaskNode, emptyGraph, reconcileGraphs, validateGraph } from '../src/core.js';
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

test('places newly scanned modules in free graph positions without moving existing nodes', () => {
  const graph = emptyGraph('/tmp/project');
  graph.nodes = [{ id: 'existing', path: 'existing.c', x: 80, y: 80 }];
  const result = reconcileGraphs({ modules: [{ id: 'existing', path: 'existing.c', imports: [] }, { id: 'new-file', path: 'new-file.c', imports: [] }] }, graph);
  const existing = result.graph.nodes.find(node => node.id === 'existing');
  const added = result.graph.nodes.find(node => node.id === 'new-file');
  assert.deepEqual({ x: existing.x, y: existing.y }, { x: 80, y: 80 });
  assert.ok(Math.abs(added.x - existing.x) >= 220 || Math.abs(added.y - existing.y) >= 140);
});

test('repairs overlapping positions retained from an earlier scan', () => {
  const graph = emptyGraph('/tmp/project');
  graph.nodes = [{ id: 'first', x: 80, y: 80 }, { id: 'second', x: 80, y: 80 }];
  const result = reconcileGraphs({ modules: [{ id: 'first', imports: [] }, { id: 'second', imports: [] }] }, graph);
  const [first, second] = result.graph.nodes;
  assert.deepEqual({ x: first.x, y: first.y }, { x: 80, y: 80 });
  assert.ok(Math.abs(second.x - first.x) >= 220 || Math.abs(second.y - first.y) >= 140);
});

test('removes deleted automatic implementation nodes and their graph references on rescan', () => {
  const graph = emptyGraph('/tmp/project');
  graph.nodes = [
    { id: 'live', type: 'code_module', source: 'code', path: 'live.py' },
    { id: 'deleted', type: 'code_module', source: 'code', path: 'deleted.py' },
    { id: 'manual', type: 'code_module', source: 'user', path: 'manual.py' },
    { id: 'function.live', type: 'functional', source: 'user', title: 'Live Capability' },
  ];
  graph.edges = [{ source: 'function.live', target: 'deleted', type: 'implemented_by', scope: [], mode: 'AUTO' }];
  graph.mappings = [{ functional: 'function.live', implementation: [{ id: 'live', path: 'live.py' }, { id: 'deleted', path: 'deleted.py' }] }];
  const result = reconcileGraphs({ modules: [{ id: 'live', path: 'live.py', imports: [] }] }, graph);
  assert.deepEqual(result.removed, ['deleted']);
  assert.ok(!result.graph.nodes.some(node => node.id === 'deleted'));
  assert.ok(result.graph.nodes.some(node => node.id === 'manual'));
  assert.ok(!result.graph.edges.some(edge => edge.source === 'deleted' || edge.target === 'deleted'));
  assert.deepEqual(result.graph.mappings[0].implementation.map(item => item.id), ['live']);
  assert.deepEqual(validateGraph(result.graph), []);
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

test('creates an immutable task node linked to its selected target', () => {
  const graph = emptyGraph('/tmp/project');
  graph.nodes.push({ id: 'function.editor', type: 'functional', title: '编辑器功能', x: 80, y: 80 });
  const original = structuredClone(graph);
  const created = createTaskNode(graph, { content: '修复编辑器的保存逻辑', taskType: 'fix', target: 'function.editor' });
  assert.deepEqual(graph, original);
  assert.equal(created.task.type, 'task');
  assert.equal(created.task.content, '修复编辑器的保存逻辑');
  assert.equal(created.task.metadata.taskType, 'fix');
  assert.ok(created.graph.nodes.some(node => node.id === created.task.id));
  assert.deepEqual(created.graph.edges.find(edge => edge.source === created.task.id && edge.target === 'function.editor' && edge.type === 'targets')?.scope, ['code', 'context']);
  assert.deepEqual(validateGraph(created.graph), []);
});

test('requires content when creating a task node', () => {
  assert.throws(() => createTaskNode(emptyGraph('/tmp/project'), { content: '  ' }), /Task content is required/);
});

test('task target edges include source code when the selected target is a module', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-task-code-'));
  await writeFile(path.join(root, 'worker.py'), 'def save_document(): return True\n');
  const graph = emptyGraph(root);
  graph.nodes.push({ id: 'worker', type: 'code_module', path: 'worker.py' });
  const created = createTaskNode(graph, { content: '修复保存逻辑', target: 'worker' });
  const result = await compileContext({ projectPath: root, graph: created.graph, entry: created.task.id, task: '修复保存逻辑', tokenBudget: 2000 });
  assert.ok(result.included.some(item => item.node === 'worker' && item.scope === 'code'));
});

test('does not pull historical tasks into a shared target context', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-task-isolation-'));
  const graph = emptyGraph(root);
  graph.nodes = [
    { id: 'function.editor', type: 'functional', title: '编辑器', content: '管理编辑器功能' },
    { id: 'task-history', type: 'task', title: '旧任务', content: '迁移旧版存储格式' },
    { id: 'task-current', type: 'task', title: '当前任务', content: '修复当前保存失败' },
  ];
  graph.edges = [
    { source: 'task-history', target: 'function.editor', type: 'targets', scope: ['code', 'context'], mode: 'MANUAL' },
    { source: 'task-current', target: 'function.editor', type: 'targets', scope: ['code', 'context'], mode: 'MANUAL' },
  ];
  const result = await compileContext({ projectPath: root, graph, entry: 'task-current', task: '继续修复当前保存失败', tokenBudget: 2000, semanticDepth: 2 });
  assert.ok(result.included.some(item => item.node === 'task-current'));
  assert.ok(!result.included.some(item => item.node === 'task-history'));
});

test('does not inject a persisted task twice when the sent message contains it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-task-dedup-'));
  const content = '修复文档保存失败';
  const created = createTaskNode(emptyGraph(root), { content });
  const result = await compileContext({ projectPath: root, graph: created.graph, entry: created.task.id, task: `任务类型：开发\n目标模块：自动识别\n\n${content}`, tokenBudget: 2000 });
  const taskItems = result.included.filter(item => item.node === created.task.id);
  assert.deepEqual(taskItems.map(item => item.scope), ['task']);
});
