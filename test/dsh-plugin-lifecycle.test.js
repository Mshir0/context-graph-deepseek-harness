import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../src/dsh-plugin.js';
import { loadGraph } from '../src/core.js';

function createHarnessContext() {
  const handlers = new Map();
  const tools = new Map();
  const sections = [];
  const warnings = [];
  const ctx = {
    logger: { warn(message) { warnings.push(message); } },
    on(event, handler) { handlers.set(event, handler); },
    systemPrompt: { section(value) { sections.push(value); } },
    tools: { register(tool) { tools.set(tool.name, tool); } },
  };
  return { ctx, handlers, tools, sections, warnings };
}

function userMessage(text) {
  return { role: 'user', content: [{ type: 'text', text }] };
}

test('DSH lifecycle auto-scans a nested Python workspace, injects context, and reuses unchanged context', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-dsh-lifecycle-'));
  const packageRoot = path.join(root, 'starlette', 'starlette');
  await mkdir(path.join(packageRoot, 'middleware'), { recursive: true });
  await writeFile(path.join(packageRoot, '__init__.py'), '');
  await writeFile(path.join(packageRoot, 'datastructures.py'), 'class Headers:\n    pass\n');
  await writeFile(path.join(packageRoot, 'middleware', '__init__.py'), '');
  await writeFile(path.join(packageRoot, 'middleware', 'request_id.py'), [
    'from starlette.datastructures import Headers',
    '',
    'class RequestIdMiddleware:',
    '    def __call__(self, scope):',
    '        return Headers(scope=scope)',
  ].join('\n'));

  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false });

  assert.ok(harness.handlers.has('agent/session-start'));
  assert.ok(harness.handlers.has('agent/pre-step'));
  assert.ok(harness.tools.has('context_graph_scan'));
  assert.ok(harness.sections.some(section => section.name === 'context-graph:policy'));

  const disposers = [];
  const agent = {
    session: { id: 'session-lifecycle', header: { cwd: root } },
    ctx: { effect(effect) { disposers.push(effect()); } },
  };
  harness.handlers.get('agent/session-start')({ agent });

  const firstMessages = [userMessage('Update request_id middleware response handling')];
  const first = await harness.handlers.get('agent/pre-step')(
    { agent, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: firstMessages }),
  );

  const graph = await loadGraph(root);
  assert.ok(graph.nodes.some(node => node.id === 'starlette.starlette.middleware.request_id'));
  assert.ok(graph.nodes.some(node => node.id === 'starlette.starlette.datastructures'));
  assert.equal(first.messages.length, firstMessages.length + 1);
  const injected = first.messages.at(-1);
  assert.equal(injected.source?.kind, 'plugin');
  assert.equal(injected.source?.plugin, 'context-graph');
  assert.match(injected.content?.[0]?.text || '', /^<context-graph target="starlette\.starlette\.middleware\.request_id"/);
  assert.match(injected.content?.[0]?.text || '', /<\/context-graph>$/);

  const secondMessages = [...first.messages, userMessage('Refine request_id middleware error handling')];
  const second = await harness.handlers.get('agent/pre-step')(
    { agent, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: secondMessages }),
  );

  assert.deepEqual(second.messages, secondMessages);
  assert.equal(second.messages.filter(message => message.source?.kind === 'plugin').length, 1);
  assert.deepEqual(harness.warnings, []);
  assert.equal(disposers.length, 1);
});
