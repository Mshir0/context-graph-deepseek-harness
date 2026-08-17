import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const IMPLEMENTATION_INDEX_VERSION = 1;
export const FACTS_CACHE_VERSION = 1;
const DEFAULT_CACHE_FILE = path.join('.context', 'cache', 'implementation-facts.json');

const posix = value => String(value || '').replaceAll('\\', '/');
const unique = values => [...new Set(values.filter(Boolean))];

export function qualifiedSymbolId(moduleId, symbolName) {
  return `${moduleId}:${symbolName}`;
}

function normalizedContainer(moduleId, symbol) {
  if (symbol.container) {
    if (symbol.container === moduleId || String(symbol.container).includes(':')) return symbol.container;
    if (String(symbol.container).startsWith(`${moduleId}.`)) return qualifiedSymbolId(moduleId, String(symbol.container).slice(moduleId.length + 1));
    return qualifiedSymbolId(moduleId, symbol.container);
  }
  const parts = String(symbol.name || '').split('.');
  parts.pop();
  return parts.length ? qualifiedSymbolId(moduleId, parts.join('.')) : moduleId;
}

function normalizedSymbol(module, symbol) {
  const name = String(symbol.name || symbol.short_name || symbol.id || 'symbol');
  const id = symbol.qualified_id || (String(symbol.id || '').includes(':') ? symbol.id : '') || qualifiedSymbolId(module.id, name);
  const kind = symbol.kind || 'symbol';
  const startLine = Number.isInteger(symbol.start_line) ? symbol.start_line : Number.isInteger(symbol.line) ? symbol.line : 1;
  const endLine = Number.isInteger(symbol.end_line) ? Math.max(startLine, symbol.end_line) : startLine;
  return {
    ...symbol,
    id,
    qualified_id: id,
    name,
    short_name: symbol.short_name || name.split('.').at(-1),
    kind,
    container: normalizedContainer(module.id, symbol),
    signature: symbol.signature || '',
    line: Number.isInteger(symbol.line) ? symbol.line : startLine,
    start_line: startLine,
    end_line: endLine,
    calls: Array.isArray(symbol.calls) ? symbol.calls : [],
  };
}

function nodeType(kind) {
  if (kind === 'class') return 'implementation_class';
  if (kind === 'function' || kind === 'method') return 'implementation_function';
  return 'implementation_symbol';
}

function addAlias(aliases, value, id) {
  if (!value) return;
  const key = String(value);
  const ids = aliases.get(key) || new Set();
  ids.add(id);
  aliases.set(key, ids);
}

function uniqueAlias(aliases, values) {
  for (const value of values) {
    const matches = aliases.get(value);
    if (matches?.size === 1) return [...matches][0];
  }
  return null;
}

function resolveCallTarget(aliases, value, source, targetModule = '') {
  if (!value) return null;
  const raw = String(value);
  const sourceContainer = source.container?.includes(':') ? source.container.split(':', 2)[1] : '';
  const className = sourceContainer ? sourceContainer.split('.').at(-1) : '';
  const withoutSelf = raw.startsWith('self.') && className ? `${className}.${raw.slice(5)}` : raw;
  return uniqueAlias(aliases, [
    raw,
    withoutSelf,
    targetModule ? qualifiedSymbolId(targetModule, raw) : '',
    targetModule ? `${targetModule}.${raw}` : '',
    qualifiedSymbolId(source.module, withoutSelf),
    `${source.module}.${withoutSelf}`,
  ]);
}

/**
 * Convert analyzer output into graph-ready implementation nodes and edges.
 * Old `{name, kind, line}` symbol records remain accepted.
 */
export function materializeImplementationIndex(input, { includeFileNodes = true } = {}) {
  const facts = Array.isArray(input) ? { modules: input } : input || {};
  const modules = Array.isArray(facts.modules) ? facts.modules : [];
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();
  const symbols = [];
  const aliases = new Map();

  const addNode = node => {
    if (!nodeIds.has(node.id)) { nodes.push(node); nodeIds.add(node.id); }
  };
  const addEdge = edge => {
    const key = `${edge.source}\0${edge.target}\0${edge.type}`;
    if (edge.source !== edge.target && !edgeIds.has(key)) { edges.push(edge); edgeIds.add(key); }
  };

  for (const module of modules) {
    if (!module?.id) continue;
    if (includeFileNodes) addNode({
      id: module.id,
      type: 'implementation_file',
      title: module.id,
      label: module.id,
      path: posix(module.path),
      source: 'code',
      status: 'active',
      mode: 'AUTO',
      metadata: { layer: 'implementation', kind: 'file', module: module.id, language: module.language || '' },
    });
    for (const value of module.symbols || []) {
      const symbol = { ...normalizedSymbol(module, value), module: module.id, path: posix(module.path) };
      symbols.push(symbol);
      addNode({
        id: symbol.id,
        type: nodeType(symbol.kind),
        title: symbol.name,
        label: symbol.short_name,
        path: symbol.path,
        source: 'code',
        status: 'active',
        mode: 'AUTO',
        metadata: {
          layer: 'implementation', module: module.id, kind: symbol.kind, subkind: symbol.subkind || symbol.kind,
          qualified_id: symbol.id, container: symbol.container, signature: symbol.signature,
          start_line: symbol.start_line, end_line: symbol.end_line,
        },
      });
      addAlias(aliases, symbol.id, symbol.id);
      addAlias(aliases, symbol.name, symbol.id);
      addAlias(aliases, symbol.short_name, symbol.id);
      addAlias(aliases, `${module.id}.${symbol.name}`, symbol.id);
    }
  }

  const symbolMap = new Map(symbols.map(symbol => [symbol.id, symbol]));
  for (const symbol of symbols) {
    if (nodeIds.has(symbol.container)) addEdge({ source: symbol.container, target: symbol.id, type: 'contains', scope: ['code'], mode: 'AUTO', confidence: 1 });
    for (const call of symbol.calls) {
      const target = resolveCallTarget(aliases, typeof call === 'string' ? call : call.name || call.target, symbol);
      if (target) addEdge({ source: symbol.id, target, type: 'calls', scope: ['code'], mode: 'AUTO', confidence: typeof call === 'object' && Number.isFinite(call.confidence) ? call.confidence : 0.8 });
    }
  }

  // Older analyzer snapshots expose only module-level call names. Preserve a
  // lower-confidence file-to-symbol call edge until a scoped symbol fact is
  // available.
  for (const module of modules) for (const call of module.calls || []) {
    const target = resolveCallTarget(aliases, typeof call === 'string' ? call : call.name || call.target, { module: module.id, container: module.id });
    if (includeFileNodes && target && nodeIds.has(module.id)) addEdge({ source: module.id, target, type: 'calls', scope: ['code'], mode: 'AUTO', confidence: 0.55, metadata: { aggregate: true } });
  }

  for (const relation of facts.relationships || []) {
    if (String(relation.type).toUpperCase() !== 'CALL') continue;
    const source = relation.from_symbol_id
      || uniqueAlias(aliases, [qualifiedSymbolId(relation.from, relation.from_symbol || ''), `${relation.from}.${relation.from_symbol || ''}`, relation.from_symbol])
      || (includeFileNodes && nodeIds.has(relation.from) ? relation.from : null);
    const sourceSymbol = symbolMap.get(source) || { module: relation.from, container: relation.from };
    const target = relation.to_symbol_id
      || resolveCallTarget(aliases, relation.symbol, sourceSymbol, relation.to)
      || (includeFileNodes && nodeIds.has(relation.to) ? relation.to : null);
    if (source && target && nodeIds.has(source) && nodeIds.has(target)) addEdge({
      source, target, type: 'calls', scope: ['code'], mode: 'AUTO', confidence: Number.isFinite(relation.confidence) ? relation.confidence : 0.8,
      metadata: { evidence: relation.evidence || [] },
    });
  }

  return { version: IMPLEMENTATION_INDEX_VERSION, nodes, edges, modules: modules.map(module => module.id), symbols };
}

export async function hashImplementationFile(projectPath, relativePath) {
  const root = path.resolve(projectPath);
  const file = path.resolve(root, relativePath);
  const relation = path.relative(root, file);
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`Implementation file is outside project: ${relativePath}`);
  const content = await readFile(file);
  const details = await stat(file);
  return { hash: createHash('sha256').update(content).digest('hex'), size: details.size, mtime_ms: details.mtimeMs };
}

function factsForFile(facts, file) {
  const evidenceInFile = item => (item.evidence || []).some(evidence => posix(evidence.file) === file);
  return {
    modules: (facts.modules || []).filter(module => posix(module.path) === file),
    relationships: (facts.relationships || []).filter(evidenceInFile),
    interfaces: (facts.interfaces || []).filter(item => evidenceInFile(item) || posix(item.file) === file),
    errors: (facts.errors || []).filter(error => posix(error.file) === file),
  };
}

function mergeIncrementalFacts(previous, current, analyzedFiles) {
  const scope = new Set(analyzedFiles.map(posix));
  const keepModule = module => !scope.has(posix(module.path));
  const keepEvidence = item => !(item.evidence || []).some(evidence => scope.has(posix(evidence.file)));
  const keepError = error => !scope.has(posix(error.file));
  return {
    ...(previous || {}),
    ...current,
    modules: [...(previous?.modules || []).filter(keepModule), ...(current.modules || [])],
    relationships: [...(previous?.relationships || []).filter(keepEvidence), ...(current.relationships || [])],
    interfaces: [...(previous?.interfaces || []).filter(keepEvidence), ...(current.interfaces || [])],
    errors: [...(previous?.errors || []).filter(keepError), ...(current.errors || [])],
    analyzed_files: unique([
      ...(previous?.modules || []).filter(keepModule).map(module => posix(module.path)),
      ...(current.modules || []).map(module => posix(module.path)),
      ...(current.analyzed_files || []).map(posix),
      ...analyzedFiles.map(posix),
    ]).sort(),
  };
}

export async function buildFactsCache(projectPath, facts) {
  const files = {};
  const paths = unique([
    ...(facts.modules || []).map(module => posix(module.path)),
    ...(facts.analyzed_files || []).map(posix),
    ...(facts.errors || []).map(error => posix(error.file)),
  ]).sort();
  for (const file of paths) {
    try {
      const fingerprint = await hashImplementationFile(projectPath, file);
      const fileFacts = factsForFile(facts, file);
      files[file] = {
        ...fingerprint,
        modules: unique(fileFacts.modules.map(module => module.id)).sort(),
        symbols: unique(fileFacts.modules.flatMap(module => (module.symbols || []).map(symbol => symbol.qualified_id || symbol.id || qualifiedSymbolId(module.id, symbol.name)))).sort(),
        interfaces: unique(fileFacts.interfaces.map(contract => contract.qualified_id || qualifiedSymbolId(contract.module, contract.symbol || 'contract'))).sort(),
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { version: FACTS_CACHE_VERSION, analyzer_version: IMPLEMENTATION_INDEX_VERSION, project_path: path.resolve(projectPath), updated_at: new Date().toISOString(), files, facts };
}

export function diffFactsCache(previous, next) {
  const before = previous?.files || {};
  const after = next?.files || {};
  const changed = Object.keys(after).filter(file => !before[file] || before[file].hash !== after[file].hash).sort();
  const deleted = Object.keys(before).filter(file => !after[file]).sort();
  const unchanged = Object.keys(after).filter(file => before[file]?.hash === after[file].hash).sort();
  const affectedFiles = [...changed, ...deleted];
  const affectedModules = unique(affectedFiles.flatMap(file => [...(before[file]?.modules || []), ...(after[file]?.modules || [])])).sort();
  const affectedSymbols = unique(affectedFiles.flatMap(file => [...(before[file]?.symbols || []), ...(after[file]?.symbols || [])])).sort();
  const affectedInterfaces = unique(affectedFiles.flatMap(file => [...(before[file]?.interfaces || []), ...(after[file]?.interfaces || [])])).sort();
  return { changed, deleted, unchanged, invalidated: { files: affectedFiles.sort(), modules: affectedModules, symbols: affectedSymbols, interfaces: affectedInterfaces } };
}

function resolveCacheFile(projectPath, cacheFile = DEFAULT_CACHE_FILE) {
  return path.isAbsolute(cacheFile) ? cacheFile : path.join(path.resolve(projectPath), cacheFile);
}

export async function loadFactsCache(projectPath, { cacheFile = DEFAULT_CACHE_FILE } = {}) {
  try {
    const cache = JSON.parse(await readFile(resolveCacheFile(projectPath, cacheFile), 'utf8'));
    return cache?.version === FACTS_CACHE_VERSION ? cache : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveFactsCache(projectPath, cache, { cacheFile = DEFAULT_CACHE_FILE } = {}) {
  const file = resolveCacheFile(projectPath, cacheFile);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
  return cache;
}

export async function updateFactsCache(projectPath, facts, { cacheFile = DEFAULT_CACHE_FILE, incremental = false, analyzedFiles = facts?.analyzed_files || [], persist = true } = {}) {
  const previous = await loadFactsCache(projectPath, { cacheFile });
  const mergedFacts = incremental && previous ? mergeIncrementalFacts(previous.facts, facts || {}, analyzedFiles) : facts || {};
  const cache = await buildFactsCache(projectPath, mergedFacts);
  const invalidation = diffFactsCache(previous, cache);
  if (persist) await saveFactsCache(projectPath, cache, { cacheFile });
  return { cache, previous, invalidation };
}
