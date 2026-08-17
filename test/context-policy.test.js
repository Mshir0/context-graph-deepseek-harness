import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateContextBudget,
  buildContextManifest,
  createContextAudit,
  validateCompiledContext,
} from '../src/context-policy.js';

const candidate = (id, content, values = {}) => ({
  node: id,
  module: id,
  nodeType: 'note',
  label: id,
  content,
  priority: 600,
  reason: 'test candidate',
  source: 'test',
  ...values,
});

test('policy keeps Hard Context, excludes optional overflow, and emits a complete manifest', () => {
  const allocation = allocateContextBudget([
    candidate('task', 'current task', { scope: 'task', required: true, priority: 1000 }),
    candidate('requirement', 'active requirement', { nodeType: 'requirement', status: 'active', priority: 900 }),
    candidate('code', 'x'.repeat(400), { nodeType: 'implementation_file', scope: 'code', priority: 700 }),
    candidate('old-note', 'y'.repeat(400), { nodeType: 'note', priority: 100 }),
  ], { tokenBudget: 80 });
  const manifest = buildContextManifest({ task: 'current task', target: 'task', tokenBudget: 80, allocation });

  assert.deepEqual(manifest.included.map(item => item.node), ['task', 'requirement']);
  assert.ok(manifest.excluded.some(item => item.node === 'code'));
  assert.ok(manifest.included.every(item => Number.isFinite(item.score) && item.source && item.contentHash));
  assert.equal(manifest.validation.valid, true);
  assert.ok(manifest.candidateTokens >= manifest.selectedTokens);
  assert.equal(manifest.finalTokens, null);
  assert.match(manifest.finalTokenScope, /pending/);
});

test('policy blocks a request when Hard Context alone exceeds the budget', () => {
  const allocation = allocateContextBudget([
    candidate('task', 'z'.repeat(800), { scope: 'task', required: true, priority: 1000 }),
  ], { tokenBudget: 20 });
  const manifest = buildContextManifest({ task: 'oversized', target: 'task', tokenBudget: 20, allocation });

  assert.equal(manifest.validation.valid, false);
  assert.ok(manifest.validation.errors.some(error => error.code === 'BUDGET_EXCEEDED'));
});

test('validation rejects raw, force-excluded, and duplicate selected context', () => {
  const selected = [
    { node: 'blocked', nodeType: 'note', scope: 'content', tokens: 3, contentHash: 'same' },
    { node: 'raw', nodeType: 'conversation', scope: 'conversation', tokens: 3, contentHash: 'same' },
  ];
  const result = validateCompiledContext({ tokenBudget: 50, included: selected, forceExclude: ['blocked'] });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'FORCE_EXCLUDE_LEAK'));
  assert.ok(result.errors.some(error => error.code === 'RAW_CONTEXT_LEAK'));
  assert.ok(result.errors.some(error => error.code === 'DUPLICATE_CONTENT'));
});

test('raw conversation is excluded and audit reports raw/candidate/selected/final totals', () => {
  const allocation = allocateContextBudget([
    candidate('structured', 'one durable requirement', { nodeType: 'requirement', status: 'active' }),
    candidate('raw', 'the original conversation', { nodeType: 'conversation', scope: 'conversation', raw: true }),
  ], { tokenBudget: 100 });
  const manifest = buildContextManifest({ task: 'test', target: 'structured', tokenBudget: 100, allocation, rawTokens: 1200 });
  const audit = createContextAudit(manifest, { finalTokens: 30 });

  assert.deepEqual(manifest.included.map(item => item.node), ['structured']);
  assert.ok(manifest.excluded.some(item => item.node === 'raw' && /raw context/.test(item.reason)));
  assert.equal(audit.rawTokens, 1200);
  assert.equal(audit.candidateTokens, manifest.candidateTokens);
  assert.equal(audit.selectedTokens, manifest.selectedTokens);
  assert.equal(audit.finalTokens, 30);
});

test('policy keeps raw conversations and raw logs independently disabled', () => {
  const allocation = allocateContextBudget([
    candidate('conversation', 'old user request', { nodeType: 'conversation', scope: 'conversation', raw: true }),
    candidate('log', 'very noisy log', { nodeType: 'raw_log', scope: 'raw_log', raw: true }),
  ], { tokenBudget: 400, policy: { conversation: { enabled: true }, rawLogs: { enabled: false } } });
  assert.deepEqual(allocation.included.map(item => item.node), ['conversation']);
  assert.ok(allocation.excluded.some(item => item.node === 'log' && /raw logs/.test(item.reason)));
});

test('inactive Hard types are excluded unless explicitly forced and Force Exclude conflicts block', () => {
  const archived = allocateContextBudget([
    candidate('archived-requirement', 'old requirement', { nodeType: 'requirement', status: 'archived' }),
  ], { tokenBudget: 100 });
  assert.deepEqual(archived.included, []);
  assert.ok(archived.excluded.some(item => item.node === 'archived-requirement'));

  const forced = allocateContextBudget([
    candidate('provenance', 'old conversation needed for review', { nodeType: 'conversation', scope: 'conversation', raw: true, status: 'archived', forceInclude: true }),
  ], { tokenBudget: 100 });
  assert.deepEqual(forced.included.map(item => item.node), ['provenance']);

  const conflict = allocateContextBudget([], {
    tokenBudget: 100,
    preExcluded: [candidate('required', 'must remain', { nodeType: 'requirement', status: 'active', reason: 'FORCE_EXCLUDE' })],
  });
  const manifest = buildContextManifest({ task: 'test', target: 'required', tokenBudget: 100, allocation: conflict });
  assert.equal(manifest.validation.valid, false);
  assert.ok(manifest.validation.errors.some(error => error.code === 'FORCE_EXCLUDE_HARD_CONFLICT'));
  assert.deepEqual(manifest.validation.actionRequired[0].nodes, ['required']);
  assert.equal(manifest.validation.actionRequired[0].type, 'resolve_force_exclude_hard_conflict');
  assert.equal(manifest.validation.actionRequired[0].options.length, 2);
});
