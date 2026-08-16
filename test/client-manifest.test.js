import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('declares a native DSH web client entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.exports['./client'], './src/client/index.js');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'));
});

test('client registers a DSH lazy module factory with the package id', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
  let handoff;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { handoff = value; } } } });
  assert.equal(handoff.id, 'dsh-context-graph');
  const client = handoff.factory(specifier => {
    assert.equal(specifier, 'react');
    return {};
  });
  assert.deepEqual(Array.from(client.inject), ['slots', 'sessions']);
  assert.equal(typeof client.apply, 'function');
});

test('client adds a conversation view tab and sends through scoped conversation', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
  assert.match(source, /__ModuleLoader__\.load/);
  assert.match(source, /slots\.register\(\{[\s\S]*name: 'conversation\.view'/);
  assert.match(source, /id: 'context-graph'/);
  assert.match(source, /sessions\.scope\(sessionId\)/);
  assert.match(source, /conversation\.send\(text\)/);
  assert.match(source, /onDoubleClick: event =>[\s\S]*setInspected\(\{ kind: 'node'/);
  assert.doesNotMatch(source, /\/context-graph\/index\.html/);
});
