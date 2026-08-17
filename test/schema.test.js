import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONTEXT_NODE_TYPES,
  MODES,
  RELATION_TYPES,
  SCOPES,
} from '../src/core.js';

function sorted(values) {
  return [...values].sort();
}

test('JSON Schema enums stay aligned with the runtime graph contract', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/context-graph.schema.json', import.meta.url), 'utf8'));
  const node = schema.properties.nodes.items.properties;
  const edge = schema.properties.edges.items.properties;

  assert.deepEqual(sorted(node.type.enum), sorted(CONTEXT_NODE_TYPES));
  assert.deepEqual(sorted(node.mode.enum), sorted(MODES));
  assert.deepEqual(sorted(edge.type.enum), sorted(RELATION_TYPES));
  assert.deepEqual(sorted(edge.mode.enum), sorted(MODES));
  assert.deepEqual(sorted(schema.$defs.scope.items.enum), sorted(SCOPES));
});
