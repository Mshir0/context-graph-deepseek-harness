import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssistantMessage, createUserMessage, markAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { apply, isAgentLoopRequest, summarizeGraph } from '../src/dsh-plugin.js';
import { ContextFirewallError } from '../src/context-firewall.js';
import { emptyGraph, loadGraph, normalizeGraph, saveGraph } from '../src/core.js';
import { loadFactsCache } from '../src/implementation-index.js';

test('bounds graph tool output and omits node content by default', () => {
  const graph = {
    ...emptyGraph('.'),
    nodes: [
      { id: 'a', type: 'code_module', content: 'large source body' },
      { id: 'b', type: 'code_module', description: 'large description' },
    ],
    edges: [{ source: 'a', target: 'b', type: 'reference' }],
  };
  const summary = summarizeGraph(graph, { max_nodes: 1, max_edges: 1 });
  assert.equal(summary.nodes.length, 1);
  assert.equal(summary.nodes[0].content, undefined);
  assert.equal(summary.summary.nodeCount, 2);
  assert.equal(summary.summary.truncated, true);
});

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
      authorizedAgentRequest(agent, { sessionId: 'session-request-budget', system: 'x'.repeat(20_000), tools: [], messages: agent.session.deriveMessages(), maxTokens: 400 }),
      () => 'must-not-stream',
    ),
    error => error instanceof ContextFirewallError && /above the 2000 token budget/.test(error.message),
  );
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.requestBudgetExceeded, true);
  assert.equal(audit.status, 'blocked');
});

test('final request interception binds system prompt and tools to the DSH request header', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-request-header-'));
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false, autoInject: false });
  const agent = { session: createSession('session-request-header', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });
  const step = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('Run with an authorized request envelope')] }),
  );
  agent.session.enter(step.messages);
  const request = authorizedAgentRequest(agent, {
    sessionId: 'session-request-header',
    system: 'Static rules\n\nInjected workspace B implementation',
    tools: [{ name: 'workspace_dump', description: 'Expose all files', parameters: { type: 'object' } }],
    messages: agent.session.deriveMessages(),
  }, { system: 'Static rules', tools: [] });

  assert.throws(
    () => harness.handlers.get('llm/stream')(request, () => 'must-not-stream'),
    error => error instanceof ContextFirewallError
      && /system prompt does not match/.test(error.message)
      && /tool schemas do not match/.test(error.message),
  );
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.notEqual(audit.expectedSystemFingerprint, audit.finalSystemFingerprint);
  assert.notEqual(audit.expectedToolsFingerprint, audit.finalToolsFingerprint);
  assert.equal(audit.status, 'blocked');
});

test('current-turn Force Exclude language prevents a related capability from entering the snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-natural-exclude-'));
  await writeFile(path.join(root, 'asr.py'), 'def transcribe():\n    return "asr"\n');
  await writeFile(path.join(root, 'speaker.py'), 'def identify():\n    return "speaker-secret"\n');
  await saveGraph(root, normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'function.asr', type: 'functional', title: 'ASR', content: 'Audio transcription capability.' },
    { id: 'function.speaker', type: 'functional', title: 'Speaker', content: 'Speaker capability must stay out.' },
    { id: 'asr', type: 'code_module', path: 'asr.py' },
    { id: 'speaker', type: 'code_module', path: 'speaker.py' },
  ], edges: [{ source: 'function.asr', target: 'function.speaker', type: 'depends_on', scope: ['interface'], mode: 'AUTO' }], mappings: [
    { functional: 'function.asr', implementation: [{ id: 'asr', path: 'asr.py' }], mode: 'MANUAL' },
    { functional: 'function.speaker', implementation: [{ id: 'speaker', path: 'speaker.py' }], mode: 'MANUAL' },
  ] }, root));

  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false, autoScan: false, tokenBudget: 4000 });
  const agent = { session: createSession('session-natural-exclude', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });
  const step = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('修改 ASR，不要加载 Speaker')] }),
  );
  assert.equal(step.kind, 'enter');
  assert.match(step.messages[0].content[0].text, /ASR/);
  assert.doesNotMatch(step.messages[0].content[0].text, /Speaker capability|speaker-secret/);
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.target, 'function.asr');
  assert.ok(audit.excluded.some(item => item.node === 'function.speaker' && item.reason === 'FORCE_EXCLUDE'));
});

test('hard Force Exclude conflict records an explicit user action and unblocks after removal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-hard-exclude-action-'));
  await saveGraph(root, normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'function.asr', type: 'functional', title: 'ASR', content: 'Audio transcription capability.' },
    { id: 'interface.audio', type: 'requirement', title: 'Audio contract', content: 'Audio input must be available.', mode: 'FORCE_EXCLUDE' },
  ], edges: [{ source: 'function.asr', target: 'interface.audio', type: 'affects', scope: ['content'], mode: 'AUTO' }] }, root));
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false, autoScan: false, tokenBudget: 4000 });
  const agent = { session: createSession('session-hard-exclude-action', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });
  const first = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('修改 ASR')] }),
  );
  assert.equal(first.kind, 'reject');
  const blockedAudit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(blockedAudit.status, 'blocked');
  assert.equal(blockedAudit.validation.actionRequired[0].type, 'resolve_force_exclude_hard_conflict');
  assert.deepEqual(blockedAudit.validation.actionRequired[0].nodes, ['interface.audio']);
  assert.match(blockedAudit.error, /remove the exclusion and retry/);

  const graph = await loadGraph(root);
  graph.nodes.find(node => node.id === 'interface.audio').mode = 'MANUAL';
  await saveGraph(root, graph);
  const second = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 2, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('修改 ASR')] }),
  );
  assert.equal(second.kind, 'enter');
  assert.equal((await harness.tools.get('context_audit').execute({}, { agent })).includes('resolve_force_exclude_hard_conflict'), false);
});

function userMessage(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
}

test('accepts string-form user content from browser clients', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-string-input-'));
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false, autoInject: false, firewallMode: 'enforce' });
  const agent = { session: createSession('session-string-input', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });
  const step = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [{ role: 'user', content: '请处理一个较长的请求内容', source: { kind: 'user' } }] }),
  );
  assert.equal(step.kind, 'enter');
  assert.ok(step.messages.some(message => message.role === 'user' && message.content === '请处理一个较长的请求内容'));
});

function toolMessage(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'tool', callId: 'call-test' } });
}

function runtimeMessage(text = 'dynamic workspace snapshot') {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'project' } });
}

function authorizedAgentRequest(agent, input, authorized = input) {
  agent.session.authorizeRequest({ system: authorized.system, tools: authorized.tools });
  return markAgentLoopRequest(input);
}

function createSession(id, cwd) {
  const events = [];
  const surfaceNodes = [];
  let requestHeader = null;
  const surface = {};
  Object.defineProperty(surface, 'nodes', { get: () => [...surfaceNodes] });
  const session = {
    id,
    header: { cwd },
    events,
    surface,
    authorizeRequest(header) { requestHeader = structuredClone(header); },
    requestHeader() { return requestHeader; },
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
    authorizedAgentRequest(agent, { sessionId: 'session-lifecycle', system: 'Static instructions', tools: [], messages: firstVisible }),
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
    authorizedAgentRequest(agent, { sessionId: 'session-lifecycle', system: 'Static instructions', tools: [], messages: toolVisible }),
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
  const streamed = stream(authorizedAgentRequest(agent, { sessionId: 'session-lifecycle', system: 'Static instructions', tools: [], messages: Object.freeze(visible) }), () => 'streamed');
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
    () => stream(authorizedAgentRequest(agent, { sessionId: 'session-lifecycle', system: 'Static instructions', tools: [], messages: [oldUser, ...visible, oldAssistant] }), () => 'leaked'),
    error => error instanceof ContextFirewallError && /message list does not match/.test(error.message),
  );
  assert.equal(harness.warnings.length, 1);
  assert.equal(disposers.length, 1);
});

test('reinitializes firewall state when a completed conversation reuses its session id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-session-reuse-'));
  await writeFile(path.join(root, 'worker.py'), 'def save(value):\n    return value\n');
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false });
  const firstAgent = { session: createSession('session-reused', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent: firstAgent });
  const first = await harness.handlers.get('agent/pre-step')(
    { agent: firstAgent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('Conversation A: update worker save')] }),
  );
  assert.equal(first.kind, 'enter');
  assert.equal(first.messages[0].source?.plugin, 'context-graph');
  firstAgent.session.enter(first.messages);
  const stream = harness.handlers.get('llm/stream');
  assert.equal(stream(authorizedAgentRequest(firstAgent, { sessionId: 'session-reused', system: 'Static rules', tools: [], messages: firstAgent.session.deriveMessages() }), () => 'a-streamed'), 'a-streamed');

  // Harness can restart a conversation with the same logical session id while
  // exposing a fresh surface and resetting its turn counter.
  const secondAgent = { session: createSession('session-reused', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent: secondAgent });
  const second = await harness.handlers.get('agent/pre-step')(
    { agent: secondAgent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('Conversation B: review worker save')] }),
  );
  assert.equal(second.kind, 'enter');
  assert.equal(second.messages[0].source?.plugin, 'context-graph');
  secondAgent.session.enter(second.messages);
  assert.equal(stream(authorizedAgentRequest(secondAgent, { sessionId: 'session-reused', system: 'Static rules', tools: [], messages: secondAgent.session.deriveMessages() }), () => 'b-streamed'), 'b-streamed');
  assert.equal(JSON.parse(await harness.tools.get('context_audit').execute({}, { agent: secondAgent })).status, 'allowed');

  // A wrapper restart may retain the same Session object. A reset turn number
  // must still be distinguished by the new user message id.
  const thirdAgent = { session: secondAgent.session, ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent: thirdAgent });
  const third = await harness.handlers.get('agent/pre-step')(
    { agent: thirdAgent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('Conversation C: verify worker save')] }),
  );
  assert.equal(third.kind, 'enter');
  assert.deepEqual(third.messages.length, 1);
  thirdAgent.session.enter(third.messages);
  assert.equal(stream(authorizedAgentRequest(thirdAgent, { sessionId: 'session-reused', system: 'Static rules', tools: [], messages: thirdAgent.session.deriveMessages() }), () => 'c-streamed'), 'c-streamed');
});

test('project context persists across sessions and plugin restarts without leaking session state or raw history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-cross-session-'));
  await writeFile(path.join(root, 'request_id.py'), [
    'def attach_request_id(response, request_id):',
    '    response.headers["x-request-id"] = request_id',
    '    return response',
  ].join('\n'));

  const firstHarness = createHarnessContext();
  apply(firstHarness.ctx, { webUi: false, autoScan: false });
  const firstDisposers = [];
  const firstAgent = {
    session: createSession('session-persistence-a', root),
    ctx: { effect(effect) { firstDisposers.push(effect()); } },
  };
  firstHarness.handlers.get('agent/session-start')({ agent: firstAgent });

  await firstHarness.tools.get('context_graph_scan').execute({}, { agent: firstAgent });
  const initialCache = await loadFactsCache(root);
  assert.ok(initialCache?.files['request_id.py']);
  const initialProjectMemory = await readFile(path.join(root, '.context', 'project.md'), 'utf8');
  const initialModuleMemory = await readFile(path.join(root, '.context', 'modules', 'request_id', 'interface.md'), 'utf8');

  const durableNodes = [
    { id: 'function.request_id_durability', type: 'functional', title: 'Request ID durability', content: 'Preserve one request identifier across request state and response headers.' },
    { id: 'requirement.request_id_echo', type: 'requirement', title: 'Echo Request ID', content: 'The response header must echo the request identifier stored in request state.' },
    { id: 'constraint.request_id_api', type: 'constraint', title: 'Keep public API stable', content: 'Do not change the public Request, Response, or Router interfaces.' },
    { id: 'decision.request_id_header', type: 'decision', title: 'Use X-Request-ID', content: 'Use X-Request-ID as the canonical transport header.' },
    { id: 'task.request_id_initial', type: 'task', title: 'Initial Request ID task', content: 'Implement the initial Request ID middleware behavior.' },
    { id: 'function.unrelated', type: 'functional', title: 'Unrelated reporting', content: 'This unrelated capability must not be selected for Request ID work.' },
  ];
  for (const node of durableNodes) {
    await firstHarness.tools.get('context_graph_add_node').execute({ node_json: JSON.stringify(node) }, { agent: firstAgent });
  }
  await firstHarness.tools.get('context_extract').execute({
    text: 'RAW_SESSION_A_ONLY_7F3C',
    source: 'user',
    conversation_id: 'conversation-session-a',
    message_id: 'message-session-a',
    apply: true,
  }, { agent: firstAgent });

  const durableEdges = [
    { source: 'function.request_id_durability', target: 'requirement.request_id_echo', type: 'requires', scope: ['content'], mode: 'MANUAL' },
    { source: 'function.request_id_durability', target: 'constraint.request_id_api', type: 'constrained_by', scope: ['content'], mode: 'MANUAL' },
    { source: 'function.request_id_durability', target: 'decision.request_id_header', type: 'applies_to', scope: ['content'], mode: 'MANUAL' },
    { source: 'task.request_id_initial', target: 'function.request_id_durability', type: 'targets', scope: ['content', 'code'], mode: 'MANUAL' },
  ];
  for (const edge of durableEdges) {
    await firstHarness.tools.get('context_graph_add_edge').execute({ edge_json: JSON.stringify(edge) }, { agent: firstAgent });
  }
  await firstHarness.tools.get('functional_map_implementation').execute({
    functional: 'function.request_id_durability',
    implementation_ids: ['request_id'],
    mode: 'MANUAL',
  }, { agent: firstAgent });

  await firstHarness.tools.get('context_select').execute({
    target: 'function.request_id_durability',
    include: ['decision.request_id_header'],
    exclude: ['function.unrelated'],
  }, { agent: firstAgent });
  await firstHarness.tools.get('context_session_config').execute({
    token_budget: 2000,
    reuse_context: false,
    max_implementation_files: 1,
    semantic_depth: 1,
  }, { agent: firstAgent });

  const firstTurn = await firstHarness.handlers.get('agent/pre-step')(
    { agent: firstAgent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('SESSION_A_SURFACE_ONLY: update Request ID durability')] }),
  );
  assert.equal(firstTurn.kind, 'enter');
  firstAgent.session.enter(firstTurn.messages);
  assert.equal(firstDisposers.length, 1);

  const secondDisposers = [];
  const secondAgent = {
    session: createSession('session-persistence-b', root),
    ctx: { effect(effect) { secondDisposers.push(effect()); } },
  };
  firstHarness.handlers.get('agent/session-start')({ agent: secondAgent });
  const secondAuditBeforeTurn = JSON.parse(await firstHarness.tools.get('context_audit').execute({}, { agent: secondAgent }));
  assert.equal(secondAuditBeforeTurn.status, 'unavailable');
  const secondSettings = JSON.parse(await firstHarness.tools.get('context_session_config').execute({}, { agent: secondAgent }));
  assert.deepEqual(secondSettings, {
    autoInject: true,
    tokenBudget: 6000,
    reuseContext: true,
    maxImplementationFiles: 2,
    semanticDepth: 2,
    target: null,
    include: [],
    exclude: [],
  });

  const graphInSecondSession = JSON.parse(await firstHarness.tools.get('context_graph_get').execute({}, { agent: secondAgent }));
  assert.ok(graphInSecondSession.nodes.some(node => node.id === 'function.request_id_durability'));
  assert.ok(graphInSecondSession.nodes.some(node => node.id === 'message-session-a' && node.metadata?.raw === true));
  assert.ok(!graphInSecondSession.nodes.some(node => node.content?.includes('SESSION_A_SURFACE_ONLY')));
  assert.ok(graphInSecondSession.edges.some(edge => edge.source === 'function.request_id_durability' && edge.target === 'requirement.request_id_echo' && edge.mode === 'MANUAL'));
  assert.ok(graphInSecondSession.mappings.some(mapping => mapping.functional === 'function.request_id_durability' && mapping.mode === 'MANUAL' && mapping.implementation.some(item => item.id === 'request_id')));

  const secondTurn = await firstHarness.handlers.get('agent/pre-step')(
    { agent: secondAgent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('SESSION_B_CURRENT: review Request ID durability constraints')] }),
  );
  assert.equal(secondTurn.kind, 'enter');
  const secondSnapshot = secondTurn.messages[0].content[0].text;
  assert.match(secondSnapshot, /Echo Request ID/);
  assert.match(secondSnapshot, /Keep public API stable/);
  assert.match(secondSnapshot, /Use X-Request-ID/);
  assert.match(secondSnapshot, /attach_request_id code/);
  assert.doesNotMatch(secondSnapshot, /RAW_SESSION_A_ONLY_7F3C/);
  assert.doesNotMatch(secondSnapshot, /SESSION_A_SURFACE_ONLY/);
  secondAgent.session.enter(secondTurn.messages);
  const secondVisible = secondAgent.session.deriveMessages();
  assert.equal(secondVisible.length, 2);
  assert.doesNotMatch(JSON.stringify(secondVisible), /RAW_SESSION_A_ONLY_7F3C|SESSION_A_SURFACE_ONLY/);
  assert.equal(firstHarness.handlers.get('llm/stream')(
    authorizedAgentRequest(secondAgent, { sessionId: 'session-persistence-b', system: 'Static instructions', tools: [], messages: secondVisible }),
    () => 'second-session-streamed',
  ), 'second-session-streamed');
  const secondFinalAudit = JSON.parse(await firstHarness.tools.get('context_audit').execute({}, { agent: secondAgent }));
  assert.equal(secondFinalAudit.status, 'allowed');
  assert.equal(secondFinalAudit.finalSnapshotCount, 1);
  assert.equal(secondFinalAudit.finalMessageCount, 2);
  const firstSettingsStillIsolated = JSON.parse(await firstHarness.tools.get('context_session_config').execute({}, { agent: firstAgent }));
  assert.equal(firstSettingsStillIsolated.tokenBudget, 2000);
  assert.equal(firstSettingsStillIsolated.target, 'function.request_id_durability');
  assert.deepEqual(firstSettingsStillIsolated.exclude, ['function.unrelated']);
  firstDisposers[0]();
  secondDisposers[0]();

  const restartedHarness = createHarnessContext();
  apply(restartedHarness.ctx, { webUi: false, autoScan: false });
  const restartedAgent = {
    session: createSession('session-persistence-after-restart', root),
    ctx: { effect() {} },
  };
  restartedHarness.handlers.get('agent/session-start')({ agent: restartedAgent });
  const restartedSettings = JSON.parse(await restartedHarness.tools.get('context_session_config').execute({}, { agent: restartedAgent }));
  assert.equal(restartedSettings.target, null);
  assert.equal(restartedSettings.tokenBudget, 6000);
  assert.deepEqual(restartedSettings.include, []);
  assert.deepEqual(restartedSettings.exclude, []);
  assert.equal(JSON.parse(await restartedHarness.tools.get('context_audit').execute({}, { agent: restartedAgent })).status, 'unavailable');

  const restartedGraph = JSON.parse(await restartedHarness.tools.get('context_graph_get').execute({}, { agent: restartedAgent }));
  assert.ok(restartedGraph.nodes.some(node => node.id === 'task.request_id_initial'));
  assert.ok(restartedGraph.nodes.some(node => node.id === 'constraint.request_id_api'));
  assert.ok(durableEdges.every(expected => restartedGraph.edges.some(edge => edge.source === expected.source && edge.target === expected.target && edge.type === expected.type && edge.mode === 'MANUAL')));
  assert.ok(restartedGraph.mappings.some(mapping => mapping.functional === 'function.request_id_durability'
    && mapping.mode === 'MANUAL'
    && mapping.implementation.some(item => item.id === 'request_id')));
  assert.ok((await loadFactsCache(root))?.files['request_id.py']);
  assert.equal(await readFile(path.join(root, '.context', 'project.md'), 'utf8'), initialProjectMemory);
  assert.equal(await readFile(path.join(root, '.context', 'modules', 'request_id', 'interface.md'), 'utf8'), initialModuleMemory);
  const restartScan = JSON.parse(await restartedHarness.tools.get('context_graph_scan').execute({}, { agent: restartedAgent }));
  assert.deepEqual(restartScan.invalidation.changed, []);
  assert.deepEqual(restartScan.invalidation.deleted, []);
  assert.ok(restartScan.invalidation.unchanged.includes('request_id.py'));

  const restartedTurn = await restartedHarness.handlers.get('agent/pre-step')(
    { agent: restartedAgent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userMessage('SESSION_C_CURRENT: verify Request ID durability decision')] }),
  );
  assert.equal(restartedTurn.kind, 'enter');
  const restartedSnapshot = restartedTurn.messages[0].content[0].text;
  assert.match(restartedSnapshot, /Use X-Request-ID/);
  assert.doesNotMatch(restartedSnapshot, /RAW_SESSION_A_ONLY_7F3C|SESSION_A_SURFACE_ONLY|SESSION_B_CURRENT/);
  restartedAgent.session.enter(restartedTurn.messages);
  const restartedVisible = restartedAgent.session.deriveMessages();
  assert.doesNotMatch(JSON.stringify(restartedVisible), /RAW_SESSION_A_ONLY_7F3C|SESSION_A_SURFACE_ONLY|SESSION_B_CURRENT/);
  assert.equal(restartedHarness.handlers.get('llm/stream')(
    authorizedAgentRequest(restartedAgent, { sessionId: 'session-persistence-after-restart', system: 'Static instructions', tools: [], messages: restartedVisible }),
    () => 'restarted-session-streamed',
  ), 'restarted-session-streamed');
  const restartedFinalAudit = JSON.parse(await restartedHarness.tools.get('context_audit').execute({}, { agent: restartedAgent }));
  assert.equal(restartedFinalAudit.status, 'allowed');
  assert.equal(restartedFinalAudit.finalSnapshotCount, 1);
  assert.equal(restartedFinalAudit.finalMessageCount, 2);
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

test('keeps a generic dialog message when no Context Graph target can be inferred', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-target-fallback-'));
  await saveGraph(root, normalizeGraph({ ...emptyGraph(root), nodes: [
    { id: 'function.audio', type: 'functional', title: 'Audio processing', content: 'Audio capability.' },
    { id: 'function.video', type: 'functional', title: 'Video processing', content: 'Video capability.' },
  ] }, root));
  const harness = createHarnessContext();
  apply(harness.ctx, { webUi: false, autoScan: false });
  const agent = { session: createSession('session-target-fallback', root), ctx: { effect() {} } };
  harness.handlers.get('agent/session-start')({ agent });

  const user = userMessage('继续刚才的讨论');
  const decision = await harness.handlers.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [user] }),
  );
  assert.equal(decision.kind, 'enter');
  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[0].source?.plugin, 'context-graph');
  assert.match(decision.messages[0].content[0].text, /target="context\.none"/);
  assert.equal(decision.messages[1], user);
  agent.session.enter(decision.messages);
  const visible = agent.session.deriveMessages();
  assert.equal(visible.length, 2);
  assert.equal(visible[1], user);
  assert.match(visible[0].content[0].text, /target="context\.none"/);
  assert.equal(harness.handlers.get('llm/stream')(
    authorizedAgentRequest(agent, { sessionId: 'session-target-fallback', system: 'Static rules', tools: [], messages: visible }),
    () => 'fallback-streamed',
  ), 'fallback-streamed');
  const audit = JSON.parse(await harness.tools.get('context_audit').execute({}, { agent }));
  assert.equal(audit.status, 'allowed');
  assert.equal(audit.graphInjection, 'fallback-context-free');
  assert.equal(audit.finalSnapshotCount, 1);
  assert.equal(audit.finalMessageCount, 2);
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
  assert.equal(stream(authorizedAgentRequest(agent, { sessionId: 'session-context-free', system: 'Static rules', tools: [], messages: agent.session.deriveMessages() }), () => 'streamed'), 'streamed');
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
    () => stream(authorizedAgentRequest(agent, { sessionId: 'session-context-free', system: 'Static rules', tools: [], messages: agent.session.deriveMessages() }), () => 'leaked'),
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
