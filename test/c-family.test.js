import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeProject, emptyGraph, reconcileGraphs } from '../src/core.js';
import { analyzeDependencies } from '../src/dependency-skill.js';
import { materializeImplementationIndex } from '../src/implementation-index.js';
import { analyzeContextProject } from '../src/project-analysis.js';

test('scans C and C++ source/header modules, includes, symbols, and interfaces', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-c-family-'));
  await mkdir(path.join(root, 'include'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'include', 'api.hpp'), [
    '#pragma once',
    'class Api {',
    'public:',
    '    Api();',
    '    int value() const noexcept;',
    '};',
    'int api_call(int value);',
  ].join('\n'));
  await writeFile(path.join(root, 'include', 'c_header.h'), [
    '#ifndef C_HEADER_H',
    '#define C_HEADER_H',
    'int c_helper(int value);',
    '#endif',
  ].join('\n'));
  await writeFile(path.join(root, 'src', 'api.cpp'), [
    '#include "api.hpp"',
    '#include "c_header.h"',
    'Api::Api() {}',
    'int Api::value() const noexcept { return 42; }',
    'int api_call(int value) { return c_helper(value); }',
  ].join('\n'));
  await writeFile(path.join(root, 'main.cpp'), [
    '#include "include/api.hpp"',
    '#include "include/c_header.h"',
    '#include <vector>',
    'int main() { return api_call(1); }',
  ].join('\n'));

  const codeGraph = await analyzeProject(root);
  const byPath = new Map(codeGraph.modules.map(module => [module.path, module]));
  assert.equal(codeGraph.errors.length, 0);
  assert.equal(byPath.get('main.cpp')?.language, 'cpp');
  assert.equal(byPath.get('src/api.cpp')?.language, 'cpp');
  assert.equal(byPath.get('include/api.hpp')?.language, 'cpp');
  assert.equal(byPath.get('include/c_header.h')?.language, 'c');
  assert.ok(byPath.get('include/api.hpp')?.symbols.some(symbol => symbol.name === 'Api' && symbol.kind === 'class'));
  assert.ok(byPath.get('include/api.hpp')?.symbols.some(symbol => symbol.name === 'value' || symbol.name === 'Api.value'));
  assert.deepEqual(byPath.get('main.cpp')?.imports.sort(), ['include/api.hpp', 'include/c_header.h', 'vector'].sort());

  const scan = reconcileGraphs(codeGraph, emptyGraph(root));
  assert.ok(scan.graph.nodes.some(node => node.id === 'include.api.hpp'));
  assert.ok(scan.graph.nodes.some(node => node.id === 'include.c_header.h'));
  assert.ok(scan.suggestions.some(item => item.source === 'main' && item.target === 'include.api.hpp'));
  assert.ok(scan.suggestions.some(item => item.source === 'main' && item.target === 'include.c_header.h'));

  const facts = await analyzeDependencies(root);
  assert.equal(facts.errors.length, 0);
  assert.ok(facts.modules.some(module => module.id === 'include.api.hpp'));
  assert.ok(facts.modules.some(module => module.id === 'include.c_header.h'));
  assert.ok(facts.relationships.some(item => item.from === 'main' && item.to === 'include.api.hpp' && item.type === 'IMPORT'));
  assert.ok(facts.relationships.some(item => item.from === 'src.api' && item.to === 'include.c_header.h' && item.type === 'IMPORT'));
  assert.ok(facts.interfaces.some(item => item.module === 'include.api.hpp' && /value/.test(item.symbol || '')));
  assert.ok(facts.interfaces.some(item => item.module === 'include.c_header.h' && item.symbol === 'c_helper'));

  const implementationIndex = materializeImplementationIndex(facts);
  assert.ok(implementationIndex.nodes.some(node => node.id === 'include.api.hpp:Api'));
  assert.ok(implementationIndex.nodes.some(node => node.id === 'include.c_header.h:c_helper'));
});

test('keeps source and header ids aligned when stems collide', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-c-collision-'));
  await writeFile(path.join(root, 'foo.c'), 'int c_entry(void) { return 0; }\n');
  await writeFile(path.join(root, 'foo.cpp'), 'int cpp_entry() { return 0; }\n');
  await writeFile(path.join(root, 'foo.h'), 'int c_entry(void);\n');
  const [codeGraph, dependencyFacts] = await Promise.all([analyzeProject(root), analyzeDependencies(root)]);
  const codeIds = new Set(codeGraph.modules.map(module => module.id));
  const dependencyIds = new Set(dependencyFacts.modules.map(module => module.id));
  assert.deepEqual([...codeIds].sort(), ['foo.c', 'foo.cpp', 'foo.h'].sort());
  assert.deepEqual([...dependencyIds].sort(), [...codeIds].sort());
});

test('invalidates a changed C++ header and refreshes its interface facts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-graph-c-header-cache-'));
  await writeFile(path.join(root, 'api.hpp'), 'class Api {\npublic:\n  int value() const;\n};\n');
  await writeFile(path.join(root, 'api.cpp'), '#include "api.hpp"\nint Api::value() const { return 1; }\n');
  await analyzeContextProject(root);
  await writeFile(path.join(root, 'api.hpp'), 'class Api {\npublic:\n  long value() const;\n};\n');
  const refreshed = await analyzeContextProject(root);
  assert.equal(refreshed.analysisMode, 'incremental');
  assert.deepEqual(refreshed.invalidation.changed, ['api.hpp']);
  assert.ok(refreshed.facts.interfaces.some(contract => contract.qualified_id === 'api.hpp:Api.value' && contract.output === 'long'));
});
