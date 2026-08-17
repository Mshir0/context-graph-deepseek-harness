import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeAttribute, inferTarget, inferTurnExclusions, latestUserText, preview } from '../src/dsh-context.js';

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

test('treats explicit current-turn exclusions as negative context rather than target mentions', () => {
  const nodes = [
    { id: 'function.asr', title: 'ASR' },
    { id: 'function.speaker', title: 'Speaker' },
    { id: 'function.database', title: 'Database' },
    { id: 'constraint.memory', title: '显存' },
  ];
  assert.deepEqual(inferTurnExclusions('修改 ASR，不要加载 Speaker 和 Database。', nodes), {
    exclude: ['function.speaker', 'function.database'],
    ambiguous: [],
  });
  assert.equal(inferTarget('修改 ASR，不要加载 Speaker。', nodes), 'function.asr');
  assert.deepEqual(inferTurnExclusions('不能明显增加显存占用', nodes).exclude, []);
  assert.deepEqual(inferTurnExclusions('不要排除 Speaker', nodes).exclude, []);
  assert.deepEqual(inferTurnExclusions('Fix ASR without increasing 显存', nodes).exclude, []);
  assert.deepEqual(inferTurnExclusions('Update ASR; do not include Speaker and Database.', nodes).exclude, ['function.speaker', 'function.database']);
});

test('reports an ambiguous exclusion alias instead of choosing one node', () => {
  const nodes = [
    { id: 'function.asr', title: 'ASR' },
    { id: 'function.speaker', title: 'Speaker' },
    { id: 'implementation.speaker', label: 'Speaker' },
  ];
  const result = inferTurnExclusions('修改 ASR，不要加载 Speaker', nodes);
  assert.deepEqual(result.exclude, []);
  assert.deepEqual(result.ambiguous, [{ alias: 'speaker', candidates: ['function.speaker', 'implementation.speaker'] }]);
  assert.equal(inferTarget('修改 ASR，不要加载 Speaker', nodes), 'function.asr');
});

test('preview hides compiled content by default', () => {
  const result = { target: 'a', tokenBudget: 100, estimatedTokens: 50, overBudget: false, included: [], excluded: [], manifest: { selectedTokens: 50 }, validation: { valid: true }, context: 'secret context' };
  const summary = preview(result, false);
  assert.equal('context' in summary, false);
  assert.deepEqual(summary.manifest, result.manifest);
  assert.deepEqual(summary.validation, result.validation);
  assert.equal(preview(result, true).context, 'secret context');
  assert.equal(escapeAttribute('a"<&'), 'a&quot;&lt;&amp;');
});
