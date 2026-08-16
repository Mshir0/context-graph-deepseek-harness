import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeDependencies, checkConsistency, detectGraphChanges, extractInterface, findCallers, proposeContextEdges } from '../src/dependency-skill.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-skill-'));
  await writeFile(path.join(root, 'b.py'), 'class Base:\n    pass\n\nclass Processor(Base):\n    def process(self, data: str) -> str:\n        return data\n');
  await writeFile(path.join(root, 'a.py'), 'from b import Base, Processor\n\nclass Derived(Base):\n    pass\n\ndef run(data):\n    processor = Processor()\n    value = processor.process(data)\n    return getattr(processor, value)\n');
  return root;
}

test('extracts Python AST dependencies, calls, interfaces, and dynamic facts', async () => {
  const facts = await analyzeDependencies(await fixture());
  const relation = (type, symbol) => facts.relationships.find(item => item.from === 'a' && item.type === type && item.symbol === symbol);
  assert.ok(relation('IMPORT', 'b'));
  assert.equal(relation('INHERIT', 'b.Base').to, 'b');
  assert.equal(relation('CALL', 'b.Processor.process').from_symbol, 'run');
  assert.equal(facts.relationships.find(item => item.type === 'OPTIONAL_DEPENDENCY').confidence, 0.42);
  assert.deepEqual(extractInterface(facts, 'b').map(item => item.symbol), ['Base', 'Processor', 'Processor.process']);
  assert.equal(findCallers(facts, 'b.Processor.process').length, 1);
});

test('proposes interfaces and preserves manual graph relationships in consistency checks', () => {
  const facts = { relationships: [{ from: 'a', to: 'b', type: 'CALL', symbol: 'b.api', confidence: 1, evidence: [{ file: 'a.py', line: 1, evidence: 'b.api()' }] }] };
  assert.deepEqual(proposeContextEdges(facts), [{ from: 'a', to: 'b', proposed_type: 'interface', recommended_scope: ['interface', 'context'], reason: 'a calls b.api', confidence: 1, evidence: facts.relationships[0].evidence }]);
  const report = checkConsistency(facts, { edges: [{ source: 'a', target: 'b', type: 'force_exclude', mode: 'FORCE_EXCLUDE' }, { source: 'b', target: 'gone', type: 'interface', mode: 'AUTO' }, { source: 'a', target: 'manual', type: 'interface', mode: 'MANUAL' }, { source: 'a', target: 'lowercase-manual', type: 'interface', mode: 'manual' }] });
  assert.equal(report.stale.length, 1);
  assert.equal(report.protected.length, 3);
  assert.ok(report.protected.some(edge => edge.source === 'a' && edge.target === 'manual' && edge.mode === 'MANUAL'));
  assert.ok(report.protected.some(edge => edge.target === 'lowercase-manual' && edge.mode === 'manual'));
  assert.equal(report.conflicts.length, 1);
});

test('reports relationship additions and removals for incremental analysis snapshots', () => {
  const aToB = { from: 'a', to: 'b', type: 'IMPORT', symbol: 'b', evidence: [{ file: 'a.py' }] };
  const untouched = { from: 'x', to: 'y', type: 'IMPORT', symbol: 'y', evidence: [{ file: 'x.py' }] };
  const aToC = { from: 'a', to: 'c', type: 'IMPORT', symbol: 'c', evidence: [{ file: 'a.py' }] };
  const changes = detectGraphChanges({ relationships: [aToB, untouched] }, { relationships: [aToC] }, { files: ['a.py'] });
  assert.deepEqual(changes.removed, [aToB]);
  assert.deepEqual(changes.added, [aToC]);
});
