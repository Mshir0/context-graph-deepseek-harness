import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('declares a native DSH web client entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.exports['./client'], './src/client/index.js');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'));
  assert.ok(manifest.files.includes('scripts/'));
  assert.ok(manifest.files.includes('CONTEXT_GRAPH_ARCHITECTURE.md'));
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
  assert.match(source, /name: 'conversation\.input\.left'/);
  assert.match(source, /function ContextCommand/);
  assert.match(source, /创建任务并发送/);
  assert.match(source, /添加到输入框/);
  assert.match(source, /request\('\/tasks'/);
  assert.match(source, /targetStore\.set\(sessionId, created\.task\.id\)/);
  assert.match(source, /session-settings/);
  assert.match(source, /自动注入当前会话/);
  assert.match(source, /复用未变化的上下文/);
  assert.match(source, /document\.addEventListener\('pointerdown', dismiss, true\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /function Inspector[\s\S]*window\.addEventListener\('pointermove'/);
  assert.match(source, /sessions\.scope\(sessionId\)/);
  assert.match(source, /conversation\.send\(text\)/);
  assert.match(source, /const selectItem = item =>/);
  assert.match(source, /DOUBLE_PRESS_MS/);
  assert.match(source, /const NODE_TYPES/);
  assert.match(source, /const CREATE_NODE_TYPES/);
  assert.match(source, /新建节点类型/);
  assert.match(source, /function truncateNodeText/);
  assert.match(source, /user-select:none/);
  assert.match(source, /rowsPerColumn/);
  assert.match(source, /fitView\(next/);
  assert.match(source, /Context Preview/);
  assert.match(source, /强制排除/);
  assert.match(source, /强制包含/);
  assert.match(source, /function ContextPreviewPanel/);
  assert.match(source, /className: 'cg-side-panel cg-preview-panel'/);
  assert.match(source, /className: 'cg-budget-bar'/);
  assert.match(source, /className: 'cg-context-item'/);
  assert.match(source, /function usePanelFocus/);
  assert.match(source, /overlayRequestRef/);
  assert.match(source, /sessionExcluded\.has\(id\)/);
  assert.match(source, /viewMode.*semantic/);
  assert.match(source, /functionalProposal/);
  assert.match(source, /functional-infer/);
  assert.match(source, /function FunctionalProposalPanel/);
  assert.match(source, /className: 'cg-side-panel cg-proposal-panel'/);
  assert.match(source, /className: 'cg-proposal-list'/);
  assert.match(source, /const proposalItems =/);
  assert.match(source, /disabled: !hasChanges/);
  assert.match(source, /确认加入图谱/);
  assert.match(source, /查看实现/);
  assert.match(source, /className: 'cg-search'/);
  assert.doesNotMatch(source, /\/context-graph\/index\.html/);
});

test('context preview renders a formal manifest, request audit, and validation state', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
  assert.match(source, /function contextManifest/);
  assert.match(source, /manifest\.included/);
  assert.match(source, /policyClass/);
  assert.match(source, /displayScore/);
  assert.match(source, /displaySource/);
  assert.match(source, /rawTokens/);
  assert.match(source, /candidateTokens/);
  assert.match(source, /selectedTokens/);
  assert.match(source, /excludedTokens/);
  assert.match(source, /finalTokens/);
  assert.match(source, /Request Context Audit/);
  assert.match(source, /request\(`\/audit\?project=/);
  assert.match(source, /latestAudit\.compiledFingerprint === result\.compiledFingerprint/);
  assert.match(source, /finalEstimatedTotalTokens/);
  assert.match(source, /validationSummary/);
  assert.match(source, /validation\.issues/);
  assert.match(source, /forceExcludeFromPreview/);
  assert.match(source, /forceIncludeFromPreview/);
  assert.match(source, /updateSessionSettings\(\{ include, exclude \}\)/);
});

test('implementation view filters and progressively expands file, class, function, and symbol nodes', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
  assert.match(source, /const IMPLEMENTATION_LEVELS/);
  assert.match(source, /function buildImplementationHierarchy/);
  assert.match(source, /edge\.type === 'contains'/);
  assert.match(source, /implementation_file/);
  assert.match(source, /implementation_class/);
  assert.match(source, /implementation_function/);
  assert.match(source, /implementation_symbol/);
  assert.match(source, /expandedImplementation/);
  assert.match(source, /toggleImplementationNode/);
  assert.match(source, /className: 'cg-node-expand'/);
  assert.match(source, /aria-label': '实现层级'/);
  assert.match(source, /const STATUSES = \[[^\n]*'stale'/);
  assert.match(source, /\.cg-node\[data-status=stale\]/);
  assert.match(source, /'data-stale': stale/);
});

test('deleting scanned implementation nodes tombstones their hierarchy without dropping overrides', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
  assert.match(source, /previous\.overrides\?\.deleted/);
  assert.match(source, /deleted: \[\.\.\.new Set/);
  assert.match(source, /include: \[\.\.\.\(previous\.overrides\?\.include/);
  assert.match(source, /exclude: \[\.\.\.\(previous\.overrides\?\.exclude/);
  assert.match(source, /isImplementationNode\(removedNode\)/);
  assert.match(source, /function containedImplementationDescendants/);
  assert.match(source, /edge\.type !== 'contains'/);
  assert.match(source, /containedImplementationDescendants\(previous, current\.id\)/);
  assert.match(source, /nodes: previous\.nodes\.filter\(node => !removedIds\.has\(node\.id\)\)/);
  assert.match(source, /edges: previous\.edges\.filter\(edge => !removedIds\.has\(edge\.source\) && !removedIds\.has\(edge\.target\)\)/);
});

test('ships a concise context firewall skill with final audit guidance', async () => {
  const skill = await readFile(new URL('../skills/context-firewall/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /^---\s+name: context-firewall\s+description:/);
  assert.match(skill, /context_compile/);
  assert.match(skill, /context_audit/);
  assert.match(skill, /surface-replace/);
  assert.match(skill, /Do not claim that history was removed/);
});
