import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeAttribute, inferTarget, latestUserText, preview } from '../src/dsh-context.js';

test('extracts the latest human message and ignores plugin context', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'change auth cache' }] },
    { role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'injected' }] },
  ];
  assert.equal(latestUserText(messages), 'change auth cache');
});

test('infers the most specific module mentioned by the task', () => {
  const nodes = [{ id: 'auth' }, { id: 'auth.cache', path: 'src/auth/cache.py' }];
  assert.equal(inferTarget('Fix auth.cache eviction', nodes), 'auth.cache');
  assert.equal(inferTarget('Unrelated task', nodes), null);
});

test('preview hides compiled content by default', () => {
  const result = { target: 'a', tokenBudget: 100, estimatedTokens: 50, overBudget: false, included: [], excluded: [], context: 'secret context' };
  assert.equal('context' in preview(result, false), false);
  assert.equal(preview(result, true).context, 'secret context');
  assert.equal(escapeAttribute('a"<&'), 'a&quot;&lt;&amp;');
});
