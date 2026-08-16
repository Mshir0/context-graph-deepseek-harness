import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('declares a native DSH web client entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.exports['./client'], './src/client/index.js');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'));
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'));
});

test('client replaces the details slot and sends through scoped conversation', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
  assert.match(source, /slots\.register\(\{[\s\S]*name: 'details'/);
  assert.match(source, /priority: -100/);
  assert.match(source, /sessions\.scope\(sessionId\)/);
  assert.match(source, /conversation\.send\(text\)/);
  assert.doesNotMatch(source, /\/context-graph\/index\.html/);
});
