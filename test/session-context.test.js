import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionContextSettings, updateSessionContextSettings } from '../src/session-context.js';

test('uses plugin defaults when a session has no overrides', () => {
  assert.deepEqual(resolveSessionContextSettings({}, { autoInject: true, tokenBudget: 6000 }), {
    autoInject: true, tokenBudget: 6000, reuseContext: true, maxImplementationFiles: 2, semanticDepth: 2, target: null, include: [], exclude: [],
  });
});

test('updates session-only controls and clears injection fingerprints', () => {
  const sessions = new Map([['session-1', { projectPath: '/tmp/project', fingerprint: 'old', reusableFingerprint: 'old-context' }]]);
  const next = updateSessionContextSettings(sessions, 'session-1', { autoInject: false, tokenBudget: 4000, reuseContext: false, maxImplementationFiles: 1, semanticDepth: 1, include: ['asr', 'asr'], exclude: ['speaker'] }, { autoInject: true, tokenBudget: 6000 });
  assert.deepEqual(next, { autoInject: false, tokenBudget: 4000, reuseContext: false, maxImplementationFiles: 1, semanticDepth: 1, target: null, include: ['asr'], exclude: ['speaker'] });
  assert.equal(sessions.get('session-1').fingerprint, undefined);
  assert.equal(sessions.get('session-1').reusableFingerprint, undefined);
});

test('rejects invalid budgets and inactive sessions', () => {
  const sessions = new Map([['session-1', {}]]);
  assert.throws(() => updateSessionContextSettings(sessions, 'session-1', { tokenBudget: 999 }, {}), /tokenBudget/);
  assert.throws(() => updateSessionContextSettings(sessions, 'missing', { autoInject: true }, {}), /not active/);
});
