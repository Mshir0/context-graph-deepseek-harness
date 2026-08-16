import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { registerContextGraphRoutes } from '../src/dsh-routes.js';

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
