import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { registerContextGraphRoutes } from '../src/dsh-routes.js';
import { emptyGraph, loadGraph, saveGraph } from '../src/core.js';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function harnessRoute(workspace = process.cwd(), sessionState = new Map()) {
  let registration;
  const ctx = {
    webServer: { register(value) { registration = value; return () => {}; } },
    workspaceRegistry: { list: () => [{ path: workspace }] },
    logger: { warn() {} },
  };
  registerContextGraphRoutes(ctx, { tokenBudget: 4321, autoInject: true }, sessionState);
  return registration;
}

async function call(handler, url, method = 'GET', body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { method, url, headers: body ? { 'content-type': 'application/json' } : {} });
  return new Promise((resolve, reject) => {
    const response = { status: 0, headers: {}, chunks: [], writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(chunk = '') { if (chunk) this.chunks.push(Buffer.from(chunk)); resolve(this); } };
    Promise.resolve(handler(req, response)).catch(reject);
  });
}

test('registers one Harness route prefix and exposes registered workspaces', async () => {
  const route = harnessRoute();
  assert.deepEqual({ kind: route.kind, path: route.path }, { kind: 'prefix', path: '/context-graph' });
  const response = await call(route.handler, '/context-graph/api/config');
  const payload = JSON.parse(Buffer.concat(response.chunks).toString('utf8'));
  assert.equal(response.status, 200);
  assert.equal(payload.projectPath, process.cwd());
  assert.equal(payload.tokenBudget, 4321);
});

test('does not expose a standalone editor and rejects unregistered paths', async () => {
  const route = harnessRoute();
  const page = await call(route.handler, '/context-graph/');
  assert.equal(page.status, 404);
  assert.match(Buffer.concat(page.chunks).toString('utf8'), /details panel/);
  const denied = await call(route.handler, '/context-graph/api/scan', 'POST', JSON.stringify({ projectPath: process.platform === 'win32' ? 'C:\\Windows' : '/tmp' }));
  assert.equal(denied.status, 403);
});

test('reads and updates Context Graph settings only for an active workspace session', async () => {
  const sessionState = new Map([['session-1', { projectPath: process.cwd(), fingerprint: 'old' }]]);
  const route = harnessRoute(process.cwd(), sessionState);
  const query = `project=${encodeURIComponent(process.cwd())}&sessionId=session-1`;
  const initial = await call(route.handler, `/context-graph/api/session-settings?${query}`);
  assert.equal(JSON.parse(Buffer.concat(initial.chunks).toString('utf8')).tokenBudget, 4321);
  const updated = await call(route.handler, '/context-graph/api/session-settings', 'POST', JSON.stringify({ projectPath: process.cwd(), sessionId: 'session-1', autoInject: false, tokenBudget: 2000, exclude: ['speaker'] }));
  const payload = JSON.parse(Buffer.concat(updated.chunks).toString('utf8'));
  assert.deepEqual(payload, { autoInject: false, tokenBudget: 2000, reuseContext: true, maxImplementationFiles: 2, semanticDepth: 2, target: null, include: [], exclude: ['speaker'] });
  assert.equal(sessionState.get('session-1').fingerprint, undefined);
  const missing = await call(route.handler, `/context-graph/api/session-settings?project=${encodeURIComponent(process.cwd())}&sessionId=missing`);
  assert.equal(missing.status, 404);
});

test('creates a task, infers a functional target, and selects the task for the active session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-route-task-'));
  const graph = emptyGraph(root);
  graph.nodes.push({ id: 'function.editor', type: 'functional', title: '编辑器功能', label: 'Editor', description: '负责编辑文档' });
  await saveGraph(root, graph);
  const sessionState = new Map([['session-1', { projectPath: root }]]);
  const route = harnessRoute(root, sessionState);
  const response = await call(route.handler, '/context-graph/api/tasks', 'POST', JSON.stringify({ projectPath: root, sessionId: 'session-1', content: '修复 Editor 保存失败的问题', taskType: 'fix' }));
  const payload = JSON.parse(Buffer.concat(response.chunks).toString('utf8'));
  assert.equal(response.status, 200);
  assert.equal(payload.target, 'function.editor');
  assert.equal(payload.task.type, 'task');
  assert.equal(payload.task.content, '修复 Editor 保存失败的问题');
  assert.equal(payload.sessionSettings.target, payload.task.id);
  assert.equal(sessionState.get('session-1').target, payload.task.id);
  assert.ok(payload.graph.edges.some(edge => edge.source === payload.task.id && edge.target === 'function.editor' && edge.type === 'targets'));
  const persisted = await loadGraph(root);
  assert.ok(persisted.nodes.some(node => node.id === payload.task.id));
});

test('rejects empty task content and unknown targets before persisting a task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-route-task-validation-'));
  const graph = emptyGraph(root);
  graph.nodes.push({ id: 'function.editor', type: 'functional', title: '编辑器功能' });
  await saveGraph(root, graph);
  const route = harnessRoute(root, new Map([['session-1', { projectPath: root }]]));
  const empty = await call(route.handler, '/context-graph/api/tasks', 'POST', JSON.stringify({ projectPath: root, sessionId: 'session-1', content: '  ' }));
  assert.equal(empty.status, 400);
  const unknown = await call(route.handler, '/context-graph/api/tasks', 'POST', JSON.stringify({ projectPath: root, sessionId: 'session-1', content: '修复保存', target: 'missing' }));
  assert.equal(unknown.status, 400);
  const persisted = await loadGraph(root);
  assert.deepEqual(persisted.nodes.map(node => node.id), ['function.editor']);
});

test('rejects task creation for a session from another workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-route-task-workspace-'));
  const otherRoot = await mkdtemp(path.join(os.tmpdir(), 'context-graph-route-other-workspace-'));
  const route = harnessRoute(root, new Map([['session-1', { projectPath: otherRoot }]]));
  const response = await call(route.handler, '/context-graph/api/tasks', 'POST', JSON.stringify({ projectPath: root, sessionId: 'session-1', content: '修复保存逻辑' }));
  assert.equal(response.status, 404);
  assert.deepEqual((await loadGraph(root)).nodes, []);
});
