import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditFinalRequest,
  ContextFirewallError,
  contextWithoutCurrentTask,
  createContextAudit,
  createContextSnapshot,
  filterNewTurnMessages,
  inspectRawContext,
  inspectSessionSurface,
  placeContextSnapshot,
  validateCompiledContext,
} from '../src/context-firewall.js';

function compiled(overrides = {}) {
  return {
    target: 'function.editor',
    task: 'Fix editor saving',
    tokenBudget: 2000,
    estimatedTokens: 120,
    overBudget: false,
    included: [{ node: 'function.editor', nodeType: 'functional', scope: 'content', label: 'Editor', tokens: 50 }],
    excluded: [],
    context: '## User task\n\nFix editor saving\n\n## Editor\n\nEditor capability',
    reusableContextFingerprint: 'reusable',
    ...overrides,
  };
}

test('validates budgets, force excludes, raw conversation, and compiler validation', async () => {
  const valid = await validateCompiledContext(compiled(), { target: 'function.editor' });
  assert.equal(valid.valid, true);

  const invalid = await validateCompiledContext(compiled({
    overBudget: true,
    included: [{ node: 'raw-message', nodeType: 'conversation', scope: 'content', label: 'Raw' }],
    validation: { valid: false, errors: [{ code: 'MISSING_HARD_CONTEXT', message: 'Hard context is missing' }] },
  }), { target: 'function.editor', forceExclude: ['function.editor', 'raw-message'] });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some(message => message.includes('token budget')));
  assert.ok(invalid.errors.some(message => message.includes('force-excluded')));
  assert.ok(invalid.errors.some(message => message.includes('Raw conversation')));
  assert.ok(invalid.errors.includes('Hard context is missing'));
  assert.ok(invalid.details.some(detail => detail.code === 'MISSING_HARD_CONTEXT'));
  assert.ok(invalid.actionRequired.some(action => action.type === 'resolve_force_exclude_target_conflict'));

  const authorizedRaw = await validateCompiledContext(compiled({
    included: [{ node: 'raw-message', nodeType: 'conversation', scope: 'content', label: 'Raw' }],
  }), { target: 'function.editor', allowRawConversation: true });
  assert.equal(authorizedRaw.valid, true);

  const callbackRejected = await validateCompiledContext(compiled(), { validate: () => false });
  assert.equal(callbackRejected.valid, false);
});

test('snapshot omits the duplicated current task and keeps compiled context', () => {
  assert.equal(contextWithoutCurrentTask(compiled().context, compiled().task), '## Editor\n\nEditor capability');
  const snapshot = createContextSnapshot(compiled(), 'function.editor');
  assert.equal(snapshot.source.kind, 'plugin');
  assert.doesNotMatch(snapshot.content[0].text, /Fix editor saving/);
  assert.match(snapshot.content[0].text, /Editor capability/);
  assert.match(snapshot.content[0].text, /firewall="enforced"/);

  const headingTask = 'Fix editor\n\n## User supplied heading\n\nKeep this inside the task';
  const rendered = `## User task\n\n${headingTask}\n\n## Editor\n\nEditor capability`;
  assert.equal(contextWithoutCurrentTask(rendered, headingTask), '## Editor\n\nEditor capability');
});

test('step filtering keeps trusted input and rejects unapproved plugin instructions or snapshots', () => {
  const messages = [
    { role: 'user', source: { kind: 'user' } },
    { role: 'user', source: { kind: 'plugin', plugin: 'rules', form: 'instructions' } },
    { role: 'user', source: { kind: 'plugin', plugin: 'workspace', form: 'snapshot', sections: [] } },
    { role: 'user', source: { kind: 'tool', callId: 'call-1' } },
    { role: 'user', source: { kind: 'client-input' } },
    { role: 'system', source: { kind: 'agent-instructions', form: 'instructions' } },
  ];
  assert.deepEqual(filterNewTurnMessages(messages), [messages[0], messages[3], messages[4], messages[5]]);
  assert.deepEqual(filterNewTurnMessages(messages, { allowedInstructionPlugins: ['rules'] }), [messages[0], messages[1], messages[3], messages[4], messages[5]]);
});

test('audits the frozen final request and rejects missing or unauthorized snapshots', () => {
  const snapshot = createContextSnapshot(compiled(), 'function.editor');
  const options = Object.freeze({
    sessionId: 'session-1',
    system: 'System rules',
    messages: Object.freeze([
      snapshot,
      { role: 'user', content: [{ type: 'text', text: 'Critical plugin instructions' }], source: { kind: 'plugin', plugin: 'rules', form: 'instructions' } },
      { role: 'user', content: [{ type: 'text', text: 'Fix saving' }], source: { kind: 'user' } },
    ]),
    tools: Object.freeze([{ name: 'read', description: 'Read a file', parameters: {} }]),
  });
  const previous = createContextAudit({
    status: 'allowed',
    mode: 'enforce',
    task: compiled().task,
    target: 'function.editor',
    result: compiled(),
    validation: { valid: true, errors: [], warnings: [] },
    expectedMessages: options.messages,
  });
  const authorizedRequestHeader = { system: options.system, tools: options.tools };
  const audited = auditFinalRequest(previous, options, { authorizedRequestHeader });
  assert.equal(audited.validation.valid, true);
  assert.equal(audited.finalSnapshotCount, 1);
  assert.equal(audited.finalMessageCount, 3);
  assert.ok(audited.finalTokens > 0);
  assert.equal(typeof audited.finalSystemFingerprint, 'string');
  assert.equal(typeof audited.finalToolsFingerprint, 'string');
  assert.equal(typeof audited.finalPayloadFingerprint, 'string');
  assert.equal(Object.isFrozen(options), true);

  const leaked = auditFinalRequest(audited, { ...options, messages: [snapshot, { role: 'user', content: [], source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' } }] }, { authorizedRequestHeader });
  assert.equal(leaked.status, 'blocked');
  assert.equal(leaked.validation.valid, false);
  assert.match(leaked.error, /unauthorized dynamic plugin/);

  const missing = auditFinalRequest(audited, { ...options, messages: [{ role: 'user', content: [], source: { kind: 'user' } }] }, { authorizedRequestHeader });
  assert.equal(missing.validation.valid, false);
  assert.match(missing.error, /exactly one Context Graph snapshot/);

  const oldHistory = { role: 'assistant', content: [{ type: 'text', text: 'Old assistant history' }], source: { kind: 'model', provider: 'test', model: 'test' } };
  const historyLeak = auditFinalRequest(previous, { ...options, messages: [...options.messages, oldHistory] }, { authorizedRequestHeader });
  assert.equal(historyLeak.validation.valid, false);
  assert.match(historyLeak.error, /message list does not match/);

  const tamperedSnapshot = createContextSnapshot(compiled({ context: '## Editor\n\nTampered capability' }), 'function.editor');
  const tampered = auditFinalRequest(previous, { ...options, messages: [tamperedSnapshot, ...options.messages.slice(1)] }, { authorizedRequestHeader });
  assert.equal(tampered.validation.valid, false);
  assert.match(tampered.error, /does not match the context compiled for this turn/);

  const appendedSnapshot = { ...snapshot, content: [...snapshot.content, { type: 'text', text: 'uncompiled raw workspace content' }] };
  const appended = auditFinalRequest(previous, { ...options, messages: [appendedSnapshot, ...options.messages.slice(1)] }, { authorizedRequestHeader });
  assert.equal(appended.validation.valid, false);
  assert.match(appended.error, /does not match the context compiled for this turn/);

  const systemLeak = auditFinalRequest(previous, { ...options, system: `${options.system}\n\nRaw workspace B` }, { authorizedRequestHeader });
  assert.equal(systemLeak.validation.valid, false);
  assert.match(systemLeak.error, /system prompt does not match/);

  const toolLeak = auditFinalRequest(previous, { ...options, tools: [...options.tools, { name: 'workspace_dump' }] }, { authorizedRequestHeader });
  assert.equal(toolLeak.validation.valid, false);
  assert.match(toolLeak.error, /tool schemas do not match/);

  const noEnvelopeBaseline = auditFinalRequest(previous, options);
  assert.equal(noEnvelopeBaseline.validation.valid, false);
  assert.match(noEnvelopeBaseline.error, /no authorized request-header baseline/);
});

test('blocks a final payload that exceeds the request budget including output reserve', () => {
  const snapshot = createContextSnapshot(compiled(), 'function.editor');
  const messages = [snapshot, { role: 'user', content: [{ type: 'text', text: 'Fix saving' }], source: { kind: 'user' } }];
  const previous = createContextAudit({
    status: 'allowed', mode: 'enforce', task: compiled().task, target: 'function.editor', result: compiled(),
    validation: { valid: true, errors: [], warnings: [] }, expectedMessages: messages,
  });
  const audited = auditFinalRequest(previous, {
    sessionId: 'session-1', system: 'x'.repeat(20_000), messages, tools: [], maxTokens: 800,
  }, { requestTokenBudget: 2000, outputReserveTokens: 500, tokenSafetyRatio: 1.15, authorizedRequestHeader: { system: 'x'.repeat(20_000), tools: [] } });

  assert.equal(audited.status, 'blocked');
  assert.equal(audited.validation.valid, false);
  assert.equal(audited.requestBudgetExceeded, true);
  assert.equal(audited.outputReserveTokens, 800);
  assert.ok(audited.finalEstimatedTotalTokens > audited.requestTokenBudget);
  assert.match(audited.error, /above the 2000 token budget/);
});

test('raw audit separates graph, surface, and current-step token estimates', () => {
  const session = { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'old visible request' }] }] };
  const raw = inspectRawContext(session, [{ role: 'user', content: [{ type: 'text', text: 'current request' }] }]);
  assert.equal(raw.surfaceMessages, 1);
  assert.equal(raw.stepMessages, 1);
  assert.ok(raw.surfaceRawTokens > 0);
  assert.ok(raw.stepRawTokens > 0);
});

test('prepends on an empty surface and replaces existing surface nodes without deleting events', () => {
  const empty = { surface: { nodes: [] } };
  const snapshot = createContextSnapshot(compiled(), 'function.editor');
  assert.deepEqual(placeContextSnapshot(empty, snapshot), { action: 'prepend', surfaceNodesBefore: 0 });

  const calls = [];
  const session = {
    events: [{ seq: 0 }, { seq: 1 }, { seq: 2 }],
    surface: { nodes: [0, 2] },
    append(type, data, options) {
      calls.push({ type, data, options });
      const event = { seq: this.events.length, type, data, ...options };
      this.events.push(event);
      this.surface.nodes = [event.seq];
      return event;
    },
  };
  const placement = placeContextSnapshot(session, snapshot);
  assert.equal(placement.action, 'surface-replace');
  assert.equal(placement.replacementSeq, 3);
  assert.deepEqual(calls[0].options, {
    surfaceOp: { op: 'replace', start: 0, end: 2 },
    sourceEventSeqs: [0, 2],
  });
  assert.equal(session.events.length, 4);
});

test('audit placement leaves both empty and existing Session Surfaces unchanged', () => {
  const snapshot = createContextSnapshot(compiled(), 'function.editor', { mode: 'audit' });
  assert.match(snapshot.content[0].text, /firewall="audit"/);
  const empty = { surface: { nodes: [] } };
  assert.deepEqual(placeContextSnapshot(empty, snapshot, { mode: 'audit' }), {
    action: 'audit-prepend',
    surfaceNodesBefore: 0,
    warning: 'Audit mode leaves the existing Session Surface unchanged',
  });

  let appended = false;
  const existing = {
    surface: { nodes: [2, 4] },
    append() { appended = true; },
  };
  assert.equal(placeContextSnapshot(existing, snapshot, { mode: 'audit' }).surfaceNodesBefore, 2);
  assert.equal(appended, false);
});

test('enforce mode rejects unknown history when the Surface API is unavailable', () => {
  const snapshot = createContextSnapshot(compiled(), 'function.editor');
  const session = { deriveMessages: () => [{ role: 'user' }] };
  assert.deepEqual(inspectSessionSurface(session), { known: false, nodes: [], canReplace: false });
  assert.throws(() => placeContextSnapshot(session, snapshot), error => error instanceof ContextFirewallError && error.code === 'CONTEXT_SURFACE_UNAVAILABLE');
});

test('a known empty history can receive the first snapshot without a Surface API', () => {
  const snapshot = createContextSnapshot(compiled(), 'function.editor');
  const session = { deriveMessages: () => [] };
  assert.deepEqual(placeContextSnapshot(session, snapshot), { action: 'prepend', surfaceNodesBefore: 0 });
});
