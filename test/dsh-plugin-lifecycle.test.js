import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssistantMessage, createUserMessage, markAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { apply, isAgentLoopRequest } from '../src/dsh-plugin.js';
import { ContextFirewallError } from '../src/context-firewall.js';
import { loadGraph } from '../src/core.js';
import { loadFactsCache } from '../src/implementation-index.js';

function createHarnessContext() {
  const handlers = new Map();
  const tools = new Map();
  const sections = [];
  const warnings = [];
  let runtimeContextSuppressions = 0;
  const ctx = {
    logger: { warn(message) { warnings.push(message); } },
    on(event, handler) { handlers.set(event, handler); },
    systemPrompt: {
      section(value) { sections.push(value); },
      suppressRuntimeContext() { runtimeContextSuppressions += 1; return () => {}; },
    },
    tools: { register(tool) { tools.set(tool.name, tool); } },
  };
  return { ctx, handlers, tools, sections, warnings, get runtimeContextSuppressions() { return runtimeContextSuppressions; } };
}

test('enforce mode requires the official runtime Context suppression API', () => {
  const harness = createHarnessContext();
  delete harness.ctx.systemPrompt.suppressRuntimeContext;
  assert.throws(
    () => apply(harness.ctx, { webUi: false, firewallMode: 'enforce' }),
    /requires the DSH runtime Context suppression API/,
  );
});

test('audit mode observes requests without suppressing runtime context', () => {
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false, firewallMode: 'audit' });
  assert.equal(harness.runtimeContextSuppressions, 0);
});

test('final request interception enforces the configured total request budget', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-request-budget-'));
  const harness = createHarnessContext();
  apply(harness.ctx, {
    webUi: false,
    autoInject: false,
    firewallMode: 'enforce',
    tokenBudget: 1000,
    requestTokenBudget: 2000,
    outputReserveTokens: 200,
    tokenSafetyRatio: 1.15,
  });
  const agent = { session: createSession('session-request-budget', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });
  const step = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('Run a bounded request')] }),
  );
  agent.session.enter(step.messages);

  assert.throws(
    () => harness.handlers.get('llm/stream')(
      markAgentLoopRequest({ sessionId: 'session-request-budget', system: 'x'.repeat(20_000), tools: [], messages: agent.session.deriveMessages(), maxTokens: 400 }),
      () => 'must-not-stream',
    ),
    error => error instanceof ContextFirewallError && /above the 2000 token budget/.test(error.message),
  );
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.requestBudgetExceeded, true);
  assert.equal(audit.status, 'blocked');
});

function userMessage(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
}

function toolMessage(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'tool', callId: 'call-test' } });
}

function runtimeMessage(text = 'dynamic workspace snapshot') {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'project' } });
}

function createSession(id, cwd) {
  const events = [];
  const surfaceNodes = [];
  const surface = {};
  Object.defineProperty(surface, 'nodes', { get: () => [...surfaceNodes] });
  const session = {
    id,
    header: { cwd },
    events,
    surface,
    append(type, data, options = {}) {
      const event = { seq: events.length, type, data, ...options };
      if (options.surfaceOp === 'append') surfaceNodes.push(event.seq);
      else if (options.surfaceOp?.op === 'replace') {
        const start = surfaceNodes.indexOf(options.surfaceOp.start);
        const end = surfaceNodes.indexOf(options.surfaceOp.end);
        surfaceNodes.splice(start, end - start + 1, event.seq);
      }
      events.push(event);
      return event;
    },
    enter(messages) {
      for (const message of messages) this.append('user/message', message, { surfaceOp: 'append' });
    },
    deriveMessages() {
      return surfaceNodes.map(seq => {
        const event = events[seq];
        if (event?.type === 'user/message') return event.data;
        if (event?.type === 'assistant/message' && event.data?.message?.content?.length) return event.data.message;
        if (event?.type === 'tool/result') return event.data?.message;
        return null;
      }).filter(Boolean);
    },
  };
  return session;
}

test('DSH lifecycle replaces prior model-visible history on each new user turn', async () => {
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
  assert.ok(harness.handlers.has('llm/stream'));
  assert.ok(harness.tools.has('context_graph_scan'));
  assert.ok(harness.tools.has('context_request'));
  assert.ok(harness.sections.some(section => section.name === 'context-graph:policy'));
  assert.equal(harness.runtimeContextSuppressions, 1);

  const disposers = [];
  const agent = {
    session: createSession('session-lifecycle', root),
    ctx: { effect(effect) { disposers.push(effect()); } },
  };
  harness.handlers.get('agent/session-start')({ agent });

  const firstMessages = [userMessage('Update request_id middleware response handling'), runtimeMessage()];
  const first = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: firstMessages }),
  );

  const graph = await loadGraph(root);
  assert.ok(graph.nodes.some(node => node.id === 'starlette.starlette.middleware.request_id'));
  assert.ok(graph.nodes.some(node => node.id === 'starlette.starlette.datastructures'));
  const requested = JSON.parse(await harness.tools.get('context_request').execute({
    target: 'starlette.starlette.middleware.request_id:RequestIdMiddleware.__call__',
    scope: ['interface'],
    reason: 'Verify the middleware call contract',
    max_tokens: 120,
  }, { agent }));
  assert.equal(requested.type, 'context_response');
  assert.ok(requested.estimatedTokens <= 120);
  assert.match(requested.context, /__call__/);
  assert.equal(first.messages.length, 2);
  const injected = first.messages[0];
  assert.equal(injected.source?.kind, 'plugin');
  assert.equal(injected.source?.plugin, 'context-graph');
  assert.match(injected.content?.[0]?.text || '', /^<context-graph target="starlette\.starlette\.middleware\.request_id"/);
  assert.match(injected.content?.[0]?.text || '', /<\/context-graph>$/);
  assert.doesNotMatch(injected.content?.[0]?.text || '', /Update request_id middleware response handling/);
  assert.ok(!first.messages.some(message => message.source?.plugin === '@deepseek-ai/dsh-system-prompt'));
  agent.session.enter(first.messages);
  const firstVisible = agent.session.deriveMessages();
  assert.equal(harness.handlers.get('llm/stream')(
    markAgentLoopRequest({ sessionId: 'session-lifecycle', system: 'Static instructions', tools: [], messages: firstVisible }),
    () => 'first-streamed',
  ), 'first-streamed');
  const assistant = createAssistantMessage({
    content: [{ type: 'tool-call', id: 'call-test', name: 'read', arguments: '{}' }],
    source: { provider: 'test', model: 'test' },
  });
  const chunk = agent.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: '' } });
  agent.session.append('assistant/message', { turn: 1, step: 1, message: assistant }, { surfaceOp: 'append', sourceEventSeqs: [chunk.seq] });
  const toolCall = agent.session.append('tool/call', { turn: 1, step: 1, callId: 'call-test', name: 'read', arguments: '{}' });
  const toolResult = toolMessage('tool result from the current turn');
  agent.session.append('tool/result', { turn: 1, step: 1, message: toolResult }, { surfaceOp: 'append', sourceEventSeqs: [toolCall.seq] });

  const toolStep = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 2, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  );
  assert.deepEqual(toolStep.messages, []);
  assert.equal(agent.session.events.filter(event => event.surfaceOp?.op === 'replace').length, 0);
  const toolVisible = agent.session.deriveMessages();
  assert.deepEqual(toolVisible, [first.messages[0], first.messages[1], assistant, toolResult]);
  assert.equal(harness.handlers.get('llm/stream')(
    markAgentLoopRequest({ sessionId: 'session-lifecycle', system: 'Static instructions', tools: [], messages: toolVisible }),
    () => 'tool-streamed',
  ), 'tool-streamed');

  const secondMessages = [userMessage('Refine request_id middleware error handling'), runtimeMessage('dynamic second-turn snapshot')];
  const second = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 2, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: secondMessages }),
  );
  assert.deepEqual(second.messages, [secondMessages[0]]);
  const replacement = agent.session.events.find(event => event.surfaceOp?.op === 'replace');
  assert.ok(replacement);
  assert.deepEqual(replacement.sourceEventSeqs, [0, 1, 3, 5]);
  assert.equal(replacement.data.source.plugin, 'context-graph');
  agent.session.enter(second.messages);

  const visible = agent.session.deriveMessages();
  assert.equal(visible.length, 2);
  assert.equal(visible[0].source.plugin, 'context-graph');
  assert.match(visible[1].content[0].text, /Refine request_id/);
  assert.ok(!visible.some(message => message.content?.[0]?.text?.includes('Update request_id')));
  assert.ok(!visible.some(message => message.content?.[0]?.text?.includes('tool result')));
  assert.equal(agent.session.events.length, 8);

  const stream = harness.handlers.get('llm/stream');
  const streamed = stream(markAgentLoopRequest({ sessionId: 'session-lifecycle', system: 'Static instructions', tools: [], messages: Object.freeze(visible) }), () => 'streamed');
  assert.equal(streamed, 'streamed');

  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.status, 'allowed');
  assert.equal(audit.action, 'surface-replace');
  assert.equal(audit.turn, 2);
  assert.equal(audit.validation.valid, true);
  assert.equal(audit.finalSnapshotCount, 1);
  assert.equal(audit.finalMessageCount, 2);
  assert.equal(audit.expectedMessageCount, 2);
  assert.equal(audit.expectedMessagesFingerprint, audit.finalMessagesFingerprint);
  assert.ok(audit.finalTokens > 0);
  assert.deepEqual(harness.warnings, []);

  const oldUser = userMessage('Old user history must stay excluded');
  const oldAssistant = { id: 'old-assistant', role: 'assistant', content: [{ type: 'text', text: 'Old assistant history must stay excluded' }], source: { kind: 'model', provider: 'test', model: 'test' } };
  assert.throws(
    () => stream(markAgentLoopRequest({ sessionId: 'session-lifecycle', system: 'Static instructions', tools: [], messages: [oldUser, ...visible, oldAssistant] }), () => 'leaked'),
    error => error instanceof ContextFirewallError && /message list does not match/.test(error.message),
  );
  assert.equal(harness.warnings.length, 1);
  assert.equal(disposers.length, 1);
});

test('reuseContext preserves an unchanged snapshot identity without retaining conversation history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-snapshot-reuse-'));
  await writeFile(path.join(root, 'worker.py'), 'def save(value):\n    return value\n');
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false });
  const agent = { session: createSession('session-snapshot-reuse', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });

  const firstUser = userMessage('Update worker save behavior');
  const first = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [firstUser] }),
  );
  const firstSnapshot = first.messages[0];
  agent.session.enter(first.messages);

  const secondUser = userMessage('Review worker save behavior');
  const second = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 2, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [secondUser] }),
  );
  const replacement = agent.session.events.find(event => event.surfaceOp?.op === 'replace');
  assert.equal(replacement.data.id, firstSnapshot.id);
  assert.deepEqual(second.messages, [secondUser]);
  agent.session.enter(second.messages);
  assert.deepEqual(agent.session.deriveMessages(), [firstSnapshot, secondUser]);
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.contextReused, true);
});

test('reuseContext false creates a fresh snapshot for unchanged context', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-snapshot-refresh-'));
  await writeFile(path.join(root, 'worker.py'), 'def save(value):\n    return value\n');
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false });
  const agent = { session: createSession('session-snapshot-refresh', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });
  await harness.tools.get('context_session_config').execute({ reuse_context: false }, { agent });

  const first = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('Update worker save behavior')] }),
  );
  agent.session.enter(first.messages);
  const secondUser = userMessage('Review worker save behavior');
  const second = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 2, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [secondUser] }),
  );
  const replacement = agent.session.events.find(event => event.surfaceOp?.op === 'replace');
  assert.notEqual(replacement.data.id, first.messages[0].id);
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.contextReused, false);
});

test('context_request tool honors session Force Exclude and does not consume later scan invalidation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-tool-provider-exclude-'));
  await writeFile(path.join(root, 'speaker.py'), 'def track(frame):\n    return frame\n');
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false });
  const agent = { session: createSession('session-provider-exclude', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });

  await harness.tools.get('context_graph_scan').execute({}, { agent });
  const originalHash = (await loadFactsCache(root)).files['speaker.py'].hash;
  await writeFile(path.join(root, 'speaker.py'), 'def track(frame):\n    return str(frame)\n');
  await harness.tools.get('context_session_config').execute({ exclude: ['speaker'] }, { agent });

  await assert.rejects(
    harness.tools.get('context_request').execute({ target: 'speaker:track', scope: ['symbol'], reason: 'Inspect tracking', max_tokens: 80 }, { agent }),
    error => error.code === 'CONTEXT_FORCE_EXCLUDED',
  );
  assert.equal((await loadFactsCache(root)).files['speaker.py'].hash, originalHash);

  const scan = JSON.parse(await harness.tools.get('context_graph_scan').execute({}, { agent }));
  assert.deepEqual(scan.invalidation.changed, ['speaker.py']);
  assert.notEqual((await loadFactsCache(root)).files['speaker.py'].hash, originalHash);
});

test('enforce mode rejects existing history when the Session Surface API is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-no-surface-'));
  await writeFile(path.join(root, 'worker.py'), 'def save(): return True\n');
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false });
  const agent = {
    session: { id: 'session-no-surface', header: { cwd: root }, deriveMessages: () => [userMessage('old history')] },
    ctx: { effect() {} },
  };
  harness.handlers.get('agent/session-start')({ agent });
  const decision = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('Update worker save')] }),
  );
  assert.deepEqual(decision, { kind: 'reject' });
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.status, 'blocked');
  assert.match(audit.error, /Surface replacement API/);
  assert.equal(harness.warnings.length, 1);
});

test('Context Firewall rejects a new turn when compiled-context validation fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-invalid-context-'));
  await writeFile(path.join(root, 'worker.py'), 'def save(): return True\n');
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false, validateContext: () => ({ valid: false, errors: ['policy denied'] }) });
  const agent = {
    session: createSession('session-invalid-context', root),
    ctx: { effect() {} },
  };
  harness.handlers.get('agent/session-start')({ agent });
  const decision = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('Update worker save')] }),
  );
  assert.deepEqual(decision, { kind: 'reject' });
  assert.equal(agent.session.events.length, 0);
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.status, 'blocked');
  assert.ok(audit.validation.errors.includes('policy denied'));
});

test('autoInject false uses an enforced context-free snapshot instead of leaking history or blocking', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-context-free-'));
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false, autoInject: false, firewallMode: 'enforce' });
  const agent = {
    session: createSession('session-context-free', root),
    ctx: { effect() {} },
  };
  harness.handlers.get('agent/session-start')({ agent });

  const user = userMessage('Run without project graph context');
  const entered = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [user, runtimeMessage()] }),
  );
  assert.equal(entered.kind, 'enter');
  assert.equal(entered.messages.length, 2);
  assert.equal(entered.messages[0].source?.plugin, 'context-graph');
  assert.match(entered.messages[0].content[0].text, /target="context\.none"/);
  assert.doesNotMatch(entered.messages[0].content[0].text, /project graph context/i);
  assert.equal(entered.messages[1], user);
  agent.session.enter(entered.messages);

  const stream = harness.handlers.get('llm/stream');
  assert.equal(stream(markAgentLoopRequest({ sessionId: 'session-context-free', system: 'Static rules', tools: [], messages: agent.session.deriveMessages() }), () => 'streamed'), 'streamed');
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.status, 'allowed');
  assert.equal(audit.graphInjection, 'disabled');
  assert.equal(audit.finalSnapshotCount, 1);
  assert.equal(audit.validation.valid, true);

  agent.session.enter([userMessage('Injected user tail')]);
  const followupTool = toolMessage('legitimate tool result');
  const followup = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 2, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [followupTool] }),
  );
  assert.deepEqual(followup.messages, [followupTool]);
  agent.session.enter(followup.messages);
  assert.throws(
    () => stream(markAgentLoopRequest({ sessionId: 'session-context-free', system: 'Static rules', tools: [], messages: agent.session.deriveMessages() }), () => 'leaked'),
    error => error instanceof ContextFirewallError && /message list does not match/.test(error.message),
  );
});

test('final request interception fails closed for an unaudited Agent request only', () => {
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false });
  const stream = harness.handlers.get('llm/stream');
  let calls = 0;
  const next = () => { calls += 1; return 'streamed'; };

  const marked = markAgentLoopRequest({ sessionId: 'session-missing', system: '', tools: [], messages: [] });
  assert.equal(isAgentLoopRequest(marked), true);
  assert.throws(
    () => stream(marked, next),
    error => error instanceof ContextFirewallError && error.code === 'CONTEXT_FINAL_PAYLOAD_BLOCKED',
  );
  assert.equal(calls, 0);

  const manual = { sessionId: 'session-missing', messages: [] };
  assert.equal(isAgentLoopRequest(manual), false);
  assert.equal(stream(manual, next), 'streamed');
  assert.equal(isAgentLoopRequest({ sessionId: 'session-missing', purpose: 'compaction', messages: [] }), false);
  assert.equal(stream({ sessionId: 'session-missing', purpose: 'compaction', messages: [] }, next), 'streamed');
  assert.equal(isAgentLoopRequest({ messages: [] }), false);
  assert.equal(stream({ messages: [] }, next), 'streamed');
  assert.equal(calls, 3);
});
