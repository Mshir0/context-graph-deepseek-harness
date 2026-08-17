import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { materializeImplementationIndex, qualifiedSymbolId } from './implementation-index.js';

const DEFAULT_SCOPES = ['symbol', 'interface', 'test'];

export function estimateContextTokens(text) {
  return Math.ceil([...String(text || '')].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : 0.25), 0));
}

function normalizedScopes(value) {
  const items = Array.isArray(value) ? value : value ? [value] : DEFAULT_SCOPES;
  return new Set(items.map(item => String(item).toLowerCase()));
}

function safeFile(projectPath, relativePath) {
  const root = path.resolve(projectPath);
  const file = path.resolve(root, relativePath);
  const relation = path.relative(root, file);
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`Context file is outside project: ${relativePath}`);
  return file;
}

function targetNode(index, target) {
  const exact = index.nodes.find(node => node.id === target || node.metadata?.qualified_id === target);
  if (exact) return exact;
  const matches = index.nodes.filter(node => node.title === target || node.label === target || node.path === target || node.id.endsWith(`:${target}`));
  return matches.length === 1 ? matches[0] : null;
}

function taskTerms(value) {
  return String(value || '').toLowerCase().match(/[a-z_][a-z0-9_.-]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
}

function symbolScore(symbol, terms) {
  const text = `${symbol.id} ${symbol.name} ${symbol.signature || ''} ${symbol.path}`.toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

async function symbolFragment(projectPath, symbol) {
  if (!symbol.path) return '';
  const source = await readFile(safeFile(projectPath, symbol.path), 'utf8');
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, symbol.start_line || symbol.line || 1);
  const end = Math.max(start, symbol.end_line || start);
  return lines.slice(start - 1, Math.min(lines.length, end)).join('\n').trim();
}

function interfaceText(contract) {
  if (contract.signature) return contract.signature;
  const inputs = (contract.input || []).map(item => `${item.name}: ${item.type || 'unknown'}`).join(', ');
  return `${contract.kind || 'symbol'} ${contract.symbol || contract.qualified_id || ''}(${inputs}) -> ${contract.output || 'unknown'}`;
}

function isTestModule(module) {
  const file = String(module.path || '').toLowerCase();
  return /(^|\/)tests?(\/|$)/.test(file) || /(^|\/)test_[^/]+\.[^.]+$/.test(file) || /_test\.[^.]+$/.test(file);
}

function relationTargets(relation, node, symbol) {
  if (relation.to === node.metadata?.module || relation.to === node.id) return true;
  const ids = [symbol?.id, symbol?.name, node.metadata?.qualified_id].filter(Boolean);
  return ids.some(id => relation.to_symbol_id === id || relation.symbol === id || String(relation.symbol || '').endsWith(`.${String(id).split(':').at(-1)}`));
}

function addCandidate(candidates, seen, candidate) {
  if (!candidate.content?.trim() || seen.has(candidate.id)) return;
  seen.add(candidate.id);
  candidates.push({ ...candidate, content: candidate.content.trim() });
}

function functionalNeighbors(graph, functionalId) {
  const nodeMap = new Map((graph?.nodes || []).map(node => [node.id, node]));
  const result = [];
  const seen = new Set();
  for (const edge of graph?.edges || []) {
    const other = edge.source === functionalId ? edge.target : edge.target === functionalId ? edge.source : null;
    if (!other || seen.has(other) || !nodeMap.has(other)) continue;
    seen.add(other);
    result.push(nodeMap.get(other));
  }
  return result;
}

function mappedImplementationIds(graph, functionalId) {
  return [...new Set((graph?.mappings || []).filter(mapping => mapping.functional === functionalId)
    .flatMap(mapping => mapping.implementation || []).map(item => typeof item === 'string' ? item : item.id).filter(Boolean))];
}

function forceExcludeIds(graph, request, provider) {
  const result = new Set();
  const add = values => {
    for (const value of Array.isArray(values) ? values : []) if (typeof value === 'string' && value) result.add(value);
  };
  add(graph?.overrides?.exclude);
  add(request?.forceExclude || request?.force_exclude);
  add(provider?.forceExclude || provider?.force_exclude);
  for (const node of graph?.nodes || []) if (String(node.mode || '').toUpperCase() === 'FORCE_EXCLUDE') result.add(node.id);
  for (const edge of graph?.edges || []) if (String(edge.mode || '').toUpperCase() === 'FORCE_EXCLUDE' || edge.type === 'force_exclude') result.add(edge.target);
  for (const mapping of graph?.mappings || []) {
    if (String(mapping.mode || '').toUpperCase() === 'FORCE_EXCLUDE') add((mapping.implementation || []).map(item => typeof item === 'string' ? item : item.id));
    for (const item of mapping.implementation || []) if (typeof item === 'object' && String(item.mode || '').toUpperCase() === 'FORCE_EXCLUDE') result.add(item.id);
  }
  return result;
}

function exclusionPredicate(index, forceExclude) {
  const nodeMap = new Map((index.nodes || []).map(node => [node.id, node]));
  const symbolMap = new Map((index.symbols || []).map(symbol => [symbol.id, symbol]));
  const parents = new Map();
  for (const edge of index.edges || []) if (edge.type === 'contains') {
    const values = parents.get(edge.target) || [];
    values.push(edge.source);
    parents.set(edge.target, values);
  }
  return (id, node = nodeMap.get(id)) => {
    const pending = [id, node?.id, node?.metadata?.qualified_id, node?.metadata?.module];
    const symbol = symbolMap.get(node?.metadata?.qualified_id || id);
    if (symbol) pending.push(symbol.id, symbol.module, symbol.container);
    const seen = new Set();
    while (pending.length) {
      const value = pending.shift();
      if (!value || seen.has(value)) continue;
      if (forceExclude.has(value)) return true;
      seen.add(value);
      pending.push(...(parents.get(value) || []));
      const parentNode = nodeMap.get(value);
      if (parentNode?.metadata?.module) pending.push(parentNode.metadata.module);
    }
    return false;
  };
}

function forceExcludedTarget(target) {
  const error = new Error(`Context target is force-excluded: ${target}`);
  error.code = 'CONTEXT_FORCE_EXCLUDED';
  return error;
}

async function semanticNodeContent(projectPath, node) {
  const content = node.content || node.description || '';
  if (content.trim()) return content;
  return node.path ? readFile(safeFile(projectPath, node.path), 'utf8') : '';
}

function truncated(value, length) {
  if (length >= value.length) return value;
  const suffix = '\n[truncated]';
  return `${value.slice(0, Math.max(0, length - suffix.length)).trimEnd()}${suffix}`;
}

function fitChunk(prefix, label, content, budget) {
  const render = value => `${prefix ? `${prefix}\n\n` : ''}## ${label}\n\n${value}`;
  if (estimateContextTokens(render(content)) <= budget) return { content, full: render(content) };
  let low = 0; let high = content.length; let best = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = truncated(content, middle);
    if (estimateContextTokens(render(candidate)) <= budget) { best = candidate; low = middle + 1; }
    else high = middle - 1;
  }
  return best ? { content: best, full: render(best) } : null;
}

/**
 * Resolve a bounded, auditable context response for one module or symbol.
 * Provider data may be passed separately so the request payload remains the
 * documented `{target, scope, maxTokens, reason}` shape.
 */
export async function contextRequest(request, provider = {}) {
  const target = String(request?.target || '').trim();
  if (!target) throw new Error('contextRequest target is required');
  const maxTokens = request.maxTokens ?? request.max_tokens ?? 3000;
  if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new Error('contextRequest maxTokens must be a positive integer');
  const reason = String(request.reason || 'On-demand context request');
  const scopes = normalizedScopes(request.scope);
  const facts = provider.facts || request.facts || { modules: [] };
  const index = provider.index || request.index || materializeImplementationIndex(facts);
  const graph = provider.graph || request.graph || null;
  const projectPath = provider.projectPath || request.projectPath || facts.root;
  if (!projectPath) throw new Error('contextRequest projectPath is required');
  const forceExclude = forceExcludeIds(graph, request, provider);
  const isExcluded = exclusionPredicate(index, forceExclude);
  const graphTarget = (graph?.nodes || []).find(item => item.id === target) || null;
  const functional = graphTarget?.type === 'functional' ? graphTarget : null;
  const node = functional || targetNode(index, target);
  if (!node) throw new Error(`Unknown context target: ${target}`);
  if (forceExclude.has(target) || isExcluded(node.id, node)) throw forceExcludedTarget(target);

  const wantsAll = scopes.has('all');
  const wantsCode = wantsAll || [...scopes].some(scope => ['symbol', 'implementation', 'code', 'file'].includes(scope));
  const wantsInterface = wantsAll || scopes.has('interface') || scopes.has('contract');
  const wantsTests = wantsAll || scopes.has('test') || scopes.has('tests');
  const wantsDocumentation = wantsAll || scopes.has('documentation') || scopes.has('document') || scopes.has('docs');
  const symbolMap = new Map((index.symbols || []).map(symbol => [symbol.id, symbol]));
  const exactSymbol = functional ? null : symbolMap.get(node.metadata?.qualified_id || node.id);
  const moduleId = functional ? null : exactSymbol?.module || node.metadata?.module || node.id;
  const mappedIds = functional ? mappedImplementationIds(graph, functional.id).filter(id => !isExcluded(id, targetNode(index, id))) : [];
  const mappedNodes = mappedIds.map(id => targetNode(index, id) || (graph?.nodes || []).find(item => item.id === id)).filter(Boolean);
  const mappedSymbols = mappedNodes.map(item => symbolMap.get(item.metadata?.qualified_id || item.id)).filter(Boolean);
  const mappedFileModules = new Set(mappedNodes.filter(item => !symbolMap.has(item.metadata?.qualified_id || item.id)).map(item => item.metadata?.module || item.id));
  const terms = taskTerms(`${reason} ${target}`);
  const candidates = [];
  const seen = new Set();

  const semanticTarget = graphTarget || functional;
  if (semanticTarget) {
    for (const neighbor of functionalNeighbors(graph, semanticTarget.id)) {
      if (isExcluded(neighbor.id, neighbor)) continue;
      const allowed = neighbor.type === 'interface' ? wantsInterface
        : neighbor.type === 'test' ? wantsTests
          : neighbor.type === 'documentation' ? wantsDocumentation
            : false;
      if (!allowed) continue;
      const content = await semanticNodeContent(projectPath, neighbor);
      addCandidate(candidates, seen, {
        id: neighbor.id,
        kind: neighbor.type,
        priority: neighbor.type === 'interface' ? 970 : neighbor.type === 'test' ? 760 : 680,
        label: `${neighbor.title || neighbor.label || neighbor.id} (${neighbor.type})`,
        path: neighbor.path,
        reason: `direct ${neighbor.type} neighbor of ${semanticTarget.id}`,
        content,
      });
    }
  }

  if (wantsCode && exactSymbol) {
    addCandidate(candidates, seen, {
      id: exactSymbol.id, kind: 'symbol', priority: 1000, exact: true,
      label: `${exactSymbol.path}:${exactSymbol.start_line}-${exactSymbol.end_line} ${exactSymbol.name}`,
      path: exactSymbol.path, startLine: exactSymbol.start_line, endLine: exactSymbol.end_line,
      reason: 'exact requested symbol', content: await symbolFragment(projectPath, exactSymbol),
    });
  }

  if (wantsInterface) {
    const contracts = (facts.interfaces || []).filter(contract => {
      if (isExcluded(contract.qualified_id || '', null) || isExcluded(contract.module || '', null)) return false;
      if (functional) return mappedFileModules.has(contract.module) || mappedSymbols.some(symbol => contract.qualified_id === symbol.id || symbol.kind === 'class' && contract.container === symbol.id);
      if (exactSymbol) return contract.qualified_id === exactSymbol.id || contract.symbol === exactSymbol.name;
      return contract.module === moduleId;
    });
    for (const contract of contracts) addCandidate(candidates, seen, {
      id: `interface:${contract.qualified_id || qualifiedSymbolId(contract.module, contract.symbol || 'contract')}`,
      kind: 'interface', priority: exactSymbol ? 940 : 900,
      label: `${contract.symbol || moduleId} interface`, reason: 'interface for requested target', content: interfaceText(contract),
    });
  }

  if (wantsCode && functional) {
    for (const mappedNode of mappedNodes) {
      const mappedSymbol = symbolMap.get(mappedNode.metadata?.qualified_id || mappedNode.id);
      if (mappedSymbol) {
        addCandidate(candidates, seen, {
          id: mappedSymbol.id, kind: 'symbol', priority: 1000, exact: true,
          label: `${mappedSymbol.path}:${mappedSymbol.start_line}-${mappedSymbol.end_line} ${mappedSymbol.name}`,
          path: mappedSymbol.path, startLine: mappedSymbol.start_line, endLine: mappedSymbol.end_line,
          reason: `explicit implementation mapping from ${functional.id}`,
          content: await symbolFragment(projectPath, mappedSymbol),
        });
        continue;
      }
      const mappedModule = mappedNode.metadata?.module || mappedNode.id;
      const symbols = (index.symbols || []).filter(symbol => symbol.module === mappedModule)
        .filter(symbol => !isExcluded(symbol.id))
        .sort((left, right) => symbolScore(right, terms) - symbolScore(left, terms) || left.start_line - right.start_line);
      for (const symbol of symbols) addCandidate(candidates, seen, {
        id: symbol.id, kind: 'symbol', priority: 900 + Math.min(50, symbolScore(symbol, terms) * 10),
        label: `${symbol.path}:${symbol.start_line}-${symbol.end_line} ${symbol.name}`,
        path: symbol.path, startLine: symbol.start_line, endLine: symbol.end_line,
        reason: `implementation mapped from ${functional.id}`,
        content: await symbolFragment(projectPath, symbol),
      });
      if (!symbols.length && mappedNode.path) addCandidate(candidates, seen, {
        id: mappedNode.id, kind: 'file', priority: 600, label: mappedNode.path, path: mappedNode.path,
        reason: `implementation mapped from ${functional.id}; symbol index unavailable`,
        content: await readFile(safeFile(projectPath, mappedNode.path), 'utf8'),
      });
    }
  }

  if (wantsCode && exactSymbol?.container && exactSymbol.container !== moduleId) {
    const container = symbolMap.get(exactSymbol.container);
    if (container && !isExcluded(container.id)) addCandidate(candidates, seen, {
      id: container.id, kind: 'container', priority: 820,
      label: `${container.path}:${container.start_line}-${container.end_line} ${container.name}`,
      path: container.path, startLine: container.start_line, endLine: container.end_line,
      reason: 'containing symbol', content: await symbolFragment(projectPath, container),
    });
  }

  if (wantsCode && !exactSymbol && !functional) {
    const moduleSymbols = (index.symbols || []).filter(symbol => symbol.module === moduleId)
      .filter(symbol => !isExcluded(symbol.id))
      .sort((left, right) => symbolScore(right, terms) - symbolScore(left, terms) || left.start_line - right.start_line);
    for (const symbol of moduleSymbols) addCandidate(candidates, seen, {
      id: symbol.id, kind: 'symbol', priority: 860 + Math.min(50, symbolScore(symbol, terms) * 10),
      label: `${symbol.path}:${symbol.start_line}-${symbol.end_line} ${symbol.name}`,
      path: symbol.path, startLine: symbol.start_line, endLine: symbol.end_line,
      reason: symbolScore(symbol, terms) ? 'task-relevant symbol' : 'module symbol', content: await symbolFragment(projectPath, symbol),
    });
    if (!moduleSymbols.length && node.path) addCandidate(candidates, seen, {
      id: node.id, kind: 'file', priority: 500, label: node.path, path: node.path,
      reason: 'symbol index unavailable; file fallback', content: await readFile(safeFile(projectPath, node.path), 'utf8'),
    });
  }

  if (wantsCode && exactSymbol) {
    const relatedSymbols = [];
    for (const relation of facts.relationships || []) {
      if (String(relation.type).toUpperCase() !== 'CALL') continue;
      const sourceId = relation.from_symbol_id || (relation.from_symbol ? qualifiedSymbolId(relation.from, relation.from_symbol) : '');
      const targetId = relation.to_symbol_id || '';
      if (targetId === exactSymbol.id && sourceId) relatedSymbols.push({ id: sourceId, kind: 'caller', priority: 790, reason: 'direct caller of requested symbol' });
      if (sourceId === exactSymbol.id && targetId) relatedSymbols.push({ id: targetId, kind: 'callee', priority: 750, reason: 'direct callee of requested symbol' });
    }
    for (const relation of relatedSymbols.slice(0, 6)) {
      const symbol = symbolMap.get(relation.id);
      if (!symbol || isExcluded(symbol.id)) continue;
      const symbolModule = (facts.modules || []).find(module => module.id === symbol.module);
      if (relation.kind === 'caller' && isTestModule(symbolModule || {})) continue;
      const container = exactSymbol.container ? symbolMap.get(exactSymbol.container) : null;
      if (relation.kind === 'callee' && container && symbol.path === container.path && symbol.start_line >= container.start_line && symbol.end_line <= container.end_line) continue;
      addCandidate(candidates, seen, {
        id: symbol.id, kind: relation.kind, priority: relation.priority,
        label: `${symbol.path}:${symbol.start_line}-${symbol.end_line} ${symbol.name}`,
        path: symbol.path, startLine: symbol.start_line, endLine: symbol.end_line,
        reason: relation.reason, content: await symbolFragment(projectPath, symbol),
      });
    }
  }

  if (wantsTests) {
    const testModules = (facts.modules || []).filter(isTestModule).filter(module => !isExcluded(module.id));
    const related = new Set((facts.relationships || []).filter(relation => relationTargets(relation, node, exactSymbol) && testModules.some(module => module.id === relation.from)).map(relation => relation.from));
    for (const module of testModules) {
      const matchingTerms = terms.some(term => `${module.id} ${module.path}`.toLowerCase().includes(term));
      if (related.size && !related.has(module.id) || !related.size && !matchingTerms) continue;
      const testSymbols = (module.symbols || []).map(symbol => ({ ...symbol, module: module.id, path: module.path, id: symbol.qualified_id || symbol.id || qualifiedSymbolId(module.id, symbol.name), start_line: symbol.start_line || symbol.line || 1, end_line: symbol.end_line || symbol.line || 1 }))
        .filter(symbol => /(^|\.)test/i.test(symbol.name) && !isExcluded(symbol.id));
      for (const symbol of testSymbols) addCandidate(candidates, seen, {
        id: symbol.id, kind: 'test', priority: 720,
        label: `${symbol.path}:${symbol.start_line}-${symbol.end_line} ${symbol.name}`,
        path: symbol.path, startLine: symbol.start_line, endLine: symbol.end_line,
        reason: 'test related to requested target', content: await symbolFragment(projectPath, symbol),
      });
    }
  }

  candidates.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const included = [];
  const excluded = [];
  let context = '';
  for (const candidate of candidates) {
    const candidateBudget = candidate.exact && candidates.length > 1 ? Math.max(1, Math.floor(maxTokens * 0.7)) : maxTokens;
    const fit = fitChunk(context, candidate.label, candidate.content, Math.min(maxTokens, estimateContextTokens(context) + candidateBudget));
    if (!fit) { excluded.push({ id: candidate.id, kind: candidate.kind, reason: 'token budget' }); continue; }
    if (fit.content !== candidate.content && !candidate.exact && candidate.kind !== 'file') {
      excluded.push({ id: candidate.id, kind: candidate.kind, reason: 'token budget' });
      continue;
    }
    const previousTokens = estimateContextTokens(context);
    context = fit.full;
    included.push({
      id: candidate.id, kind: candidate.kind, path: candidate.path, startLine: candidate.startLine, endLine: candidate.endLine,
      reason: candidate.reason, tokens: estimateContextTokens(context) - previousTokens, truncated: fit.content !== candidate.content,
    });
  }

  const estimatedTokens = estimateContextTokens(context);
  if (estimatedTokens > maxTokens) throw new Error('Context Provider exceeded its hard token budget');
  return { type: 'context_response', target, scope: [...scopes], reason, maxTokens, estimatedTokens, included, excluded, context };
}
