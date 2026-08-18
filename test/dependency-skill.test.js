import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeDependencies, checkConsistency, detectGraphChanges, extractInterface, findCallers, proposeContextEdges, summarizeConsistency } from '../src/dependency-skill.js';
import { analyzeContextProject } from '../src/project-analysis.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-skill-'));
  await writeFile(path.join(root, 'b.py'), 'class Base:\n    pass\n\nclass Processor(Base):\n    def process(self, data: str) -> str:\n        return data\n');
  await writeFile(path.join(root, 'a.py'), 'from b import Base, Processor\n\nclass Derived(Base):\n    pass\n\ndef run(data):\n    processor = Processor()\n    value = processor.process(data)\n    return getattr(processor, value)\n');
  return root;
}

async function cFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-skill-c-'));
  await mkdir(path.join(root, 'include'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'include', 'foo.hpp'), `#pragma once
namespace demo {
class Worker {
public:
    int run(int value);
};
int helper(int value);
}
`);
  await writeFile(path.join(root, 'src', 'foo.cpp'), `#include "../include/foo.hpp"
namespace demo {
int helper(int value) { return value + 1; }
int Worker::run(int value) { return helper(value); }
}
`);
  await writeFile(path.join(root, 'main.cpp'), `#include "include/foo.hpp"
int main() { demo::Worker worker; return worker.run(1); }
`);
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

test('extracts C/C++ headers, includes, symbols, and conservative calls without clang', async () => {
  const facts = await analyzeDependencies(await cFixture());
  assert.equal(facts.language, 'cpp');
  assert.deepEqual(facts.modules.map(item => item.id), ['include.foo.hpp', 'main', 'src.foo']);
  assert.equal(facts.modules.find(item => item.id === 'include.foo.hpp').language, 'cpp');
  const include = facts.relationships.find(item => item.from === 'src.foo' && item.type === 'IMPORT');
  assert.equal(include.to, 'include.foo.hpp');
  assert.ok(facts.interfaces.some(item => item.qualified_id === 'include.foo.hpp:demo.Worker'));
  assert.ok(facts.interfaces.some(item => item.qualified_id === 'include.foo.hpp:demo.helper'));
  const helperCall = facts.relationships.find(item => item.from === 'src.foo' && item.type === 'CALL' && item.symbol === 'helper');
  assert.equal(helperCall?.to, 'src.foo');
  assert.equal(helperCall?.to_symbol_id, 'src.foo:demo.helper');
  const sourceMethod = facts.modules.find(item => item.id === 'src.foo')?.symbols.find(item => item.id === 'src.foo:demo.Worker.run');
  assert.equal(sourceMethod?.subkind, 'method');
  assert.equal(sourceMethod?.container, 'include.foo.hpp:demo.Worker');
  assert.equal(facts.interfaces.find(item => item.qualified_id === 'src.foo:demo.Worker.run')?.container, 'include.foo.hpp:demo.Worker');
  const methodCall = facts.relationships.find(item => item.from === 'main' && item.type === 'CALL' && item.to_symbol_id === 'include.foo.hpp:demo.Worker.run');
  assert.equal(methodCall?.to, 'include.foo.hpp');
  assert.equal(methodCall?.to_symbol_id, 'include.foo.hpp:demo.Worker.run');
});

test('keeps same-stem C source/header modules distinct', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-skill-c-collision-'));
  await writeFile(path.join(root, 'foo.cpp'), 'int foo() { return 0; }\n');
  await writeFile(path.join(root, 'foo.hpp'), 'int foo();\n');
  const facts = await analyzeDependencies(root);
  assert.deepEqual(facts.modules.map(item => item.id), ['foo', 'foo.hpp']);
  assert.equal(new Set(facts.modules.map(item => item.id)).size, 2);
});

test('resolves namespace inheritance and fails closed for ambiguous member calls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-skill-c-namespace-'));
  await writeFile(path.join(root, 'types.hpp'), `namespace beta {
class Base {};
}
namespace alpha {
class Base {};
class Derived : public Base {};
class First {
public:
    int run();
};
class Second {
public:
    int run();
};
int typed() { First item; return item.run(); }
int unknown() { return item.run(); }
}
`);
  const facts = await analyzeDependencies(root);
  const inheritance = facts.relationships.find(item => item.type === 'INHERIT' && item.from_symbol === 'alpha.Derived');
  assert.equal(inheritance?.to_symbol_id, 'types.hpp:alpha.Base');
  const typedCall = facts.relationships.find(item => item.type === 'CALL' && item.from_symbol === 'alpha.typed');
  assert.equal(typedCall?.to_symbol_id, 'types.hpp:alpha.First.run');
  assert.equal(facts.relationships.some(item => item.type === 'CALL' && item.from_symbol === 'alpha.unknown'), false);
});

test('incremental source analysis keeps unchanged header symbols and interfaces', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-skill-c-incremental-'));
  await writeFile(path.join(root, 'api.hpp'), 'class Api {\npublic:\n    int value();\n};\n');
  await writeFile(path.join(root, 'api.cpp'), '#include "api.hpp"\nint Api::value() { return 1; }\n');
  const selected = await analyzeDependencies(root, { files: ['api.cpp'] });
  assert.deepEqual(selected.analyzed_files, ['api.cpp']);
  assert.deepEqual(selected.modules.map(item => item.id), ['api']);
  assert.equal(selected.modules[0].symbols.find(item => item.id === 'api:Api.value')?.container, 'api.hpp:Api');
  const initial = await analyzeContextProject(root);
  assert.ok(initial.facts.modules.find(item => item.id === 'api.hpp')?.symbols.some(item => item.id === 'api.hpp:Api'));
  await writeFile(path.join(root, 'api.cpp'), '#include "api.hpp"\nint Api::value() { return 2; }\n');
  const incremental = await analyzeContextProject(root);
  assert.equal(incremental.analysisMode, 'incremental');
  assert.deepEqual(incremental.analyzedFiles, ['api.cpp']);
  assert.ok(incremental.facts.modules.find(item => item.id === 'api.hpp')?.symbols.some(item => item.id === 'api.hpp:Api'));
  assert.ok(incremental.facts.interfaces.some(item => item.qualified_id === 'api.hpp:Api.value'));
  assert.equal(incremental.facts.modules.find(item => item.id === 'api')?.symbols.find(item => item.id === 'api:Api.value')?.container, 'api.hpp:Api');
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

test('bounds consistency details and supports module scope', () => {
  const report = {
    missing: [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd' },
      { from: 'a', to: 'e' },
    ],
    stale: [{ source: 'a', target: 'gone' }],
    protected: [{ source: 'manual', target: 'kept' }],
    conflicts: [],
  };
  const summary = summarizeConsistency(report, { modules: ['a'], maxItems: 2 });
  assert.deepEqual(summary.counts, { missing: 2, stale: 1, protected: 0, conflicts: 0 });
  assert.deepEqual(summary.returned, { missing: 2, stale: 0, protected: 0, conflicts: 0 });
  assert.equal(summary.omitted, 1);
  assert.deepEqual(summary.missing.map(item => item.to), ['b', 'e']);
});

test('reports relationship additions and removals for incremental analysis snapshots', () => {
  const aToB = { from: 'a', to: 'b', type: 'IMPORT', symbol: 'b', evidence: [{ file: 'a.py' }] };
  const untouched = { from: 'x', to: 'y', type: 'IMPORT', symbol: 'y', evidence: [{ file: 'x.py' }] };
  const aToC = { from: 'a', to: 'c', type: 'IMPORT', symbol: 'c', evidence: [{ file: 'a.py' }] };
  const changes = detectGraphChanges({ relationships: [aToB, untouched] }, { relationships: [aToC] }, { files: ['a.py'] });
  assert.deepEqual(changes.removed, [aToB]);
  assert.deepEqual(changes.added, [aToC]);
});
