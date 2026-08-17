import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { implementationForFunctional } from './semantic-functional.js';
import { materializeImplementationIndex } from './implementation-index.js';
import {
  allocateContextBudget,
  buildContextManifest,
  classifyContextCandidate,
  estimateContextTokens,
} from './context-policy.js';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTEXT_NODE_TYPES = ['functional', 'code_module', 'implementation_file', 'implementation_class', 'implementation_function', 'implementation_package', 'implementation_symbol', 'requirement', 'task', 'constraint', 'decision', 'interface', 'documentation', 'conversation', 'artifact', 'test', 'issue', 'note', 'project_rule'];
export const RELATION_TYPES = ['dependency', 'reference', 'interface', 'data', 'optional', 'force_include', 'force_exclude', 'depends_on', 'calls', 'references', 'affects', 'constrains', 'implements', 'implemented_by', 'derived_from', 'conflicts_with', 'supersedes', 'related_to', 'contains', 'uses', 'provides', 'consumes', 'produces', 'feeds', 'transforms', 'triggers', 'tests', 'documents', 'targets', 'requires', 'constrained_by', 'applies_to'];
export const MODES = ['AUTO', 'MANUAL', 'FORCE_INCLUDE', 'FORCE_EXCLUDE'];
export const SCOPES = ['code', 'context', 'interface', 'contract', 'state', 'decisions', 'history', 'content'];
const PRIORITIES = ['critical', 'high', 'normal', 'low'];
const STATUSES = ['active', 'resolved', 'deprecated', 'superseded', 'archived', 'stale'];

export function emptyGraph(projectPath) {
  return { version: 1, projectPath: path.resolve(projectPath), nodes: [], edges: [], mappings: [], overrides: { include: [], exclude: [], deleted: [] }, policy: {}, cache: { revision: '', invalidated: [] } };
}

function canonicalMode(value = 'AUTO') {
  const mode = String(value).toUpperCase();
  return mode === 'MANUAL' ? 'MANUAL' : mode === 'AUTO' ? 'AUTO' : mode;
}

export function normalizeGraph(graph, projectPath = graph?.projectPath || process.cwd()) {
  const base = { ...emptyGraph(projectPath), ...(graph || {}) };
  const now = new Date().toISOString();
  return {
    ...base,
    projectPath: path.resolve(projectPath),
    overrides: { include: [...(base.overrides?.include || [])], exclude: [...(base.overrides?.exclude || [])], deleted: [...(base.overrides?.deleted || [])] },
    mappings: (base.mappings || []).map(mapping => ({ ...mapping, implementation: (mapping.implementation || []).map(item => typeof item === 'string' ? { id: item } : { ...item }), confidence: Number.isFinite(mapping.confidence) ? mapping.confidence : 1, created_by: mapping.created_by || 'user', mode: canonicalMode(mapping.mode || 'MANUAL') })),
    nodes: (base.nodes || []).map(node => ({
      ...node,
      type: CONTEXT_NODE_TYPES.includes(node.type) ? node.type : 'code_module',
      title: node.title || node.label || node.id,
      label: node.label || node.title || node.id,
      content: typeof node.content === 'string' ? node.content : typeof node.description === 'string' ? node.description : '',
      description: typeof node.description === 'string' ? node.description : typeof node.content === 'string' ? node.content : '',
      source: node.source || ((node.type || 'code_module').startsWith('implementation_') || (node.type || 'code_module') === 'code_module' ? 'code' : 'user'),
      created_by: node.created_by || (node.source === 'assistant' ? 'ai' : node.source === 'code' || (node.type || 'code_module').startsWith('implementation_') || (node.type || 'code_module') === 'code_module' ? 'analyzer' : node.source === 'derived' ? 'auto' : node.source === 'system' ? 'plugin' : 'user'),
      confidence: Number.isFinite(node.confidence) ? Math.max(0, Math.min(1, node.confidence)) : Number.isFinite(node.metadata?.confidence) ? Math.max(0, Math.min(1, node.metadata.confidence)) : 1,
      derived_from: Array.isArray(node.derived_from) ? [...new Set(node.derived_from.filter(value => typeof value === 'string'))] : node.metadata?.source_message ? [node.metadata.source_message] : [],
      last_verified: node.last_verified || node.updated_at || node.created_at || now,
      priority: PRIORITIES.includes(node.priority) ? node.priority : 'normal',
      status: STATUSES.includes(node.status) ? node.status : 'active',
      mode: canonicalMode(node.mode || 'AUTO'),
      created_at: node.created_at || now,
      updated_at: node.updated_at || node.created_at || now,
      metadata: node.metadata && typeof node.metadata === 'object' ? node.metadata : {},
    })),
    edges: (base.edges || []).map(edge => ({ ...edge, type: edge.type || 'related_to', mode: canonicalMode(edge.mode || (edge.type === 'force_include' ? 'FORCE_INCLUDE' : edge.type === 'force_exclude' ? 'FORCE_EXCLUDE' : 'AUTO')), scope: edge.scope || [] })),
  };
}

export function validateGraph(graph) {
  const errors = [];
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) errors.push('Graph must have version 1, nodes, and edges');
  const ids = new Set((graph?.nodes || []).map((node) => node.id));
  if (ids.size !== (graph?.nodes || []).length) errors.push('Node ids must be unique');
  for (const node of graph?.nodes || []) {
    if (typeof node.id !== 'string' || node.id.length === 0) errors.push('Context node id must be a non-empty string');
    if (node.type && !CONTEXT_NODE_TYPES.includes(node.type)) errors.push(`Unsupported context node type: ${node.type}`);
    if (node.priority && !PRIORITIES.includes(node.priority)) errors.push(`Unsupported priority: ${node.priority}`);
    if (node.status && !STATUSES.includes(node.status)) errors.push(`Unsupported status: ${node.status}`);
    if (node.confidence !== undefined && (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1)) errors.push(`Unsupported confidence: ${node.confidence}`);
  }
  for (const edge of graph?.edges || []) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`Unknown endpoint on ${edge.source} -> ${edge.target}`);
    if (!RELATION_TYPES.includes(edge.type)) errors.push(`Unsupported relationship: ${edge.type}`);
    if (!MODES.includes(canonicalMode(edge.mode || 'AUTO'))) errors.push(`Unsupported mode: ${edge.mode}`);
    for (const scope of edge.scope || []) if (!SCOPES.includes(scope)) errors.push(`Unsupported scope: ${scope}`);
  }
  for (const mapping of graph?.mappings || []) {
    if (!ids.has(mapping.functional) || graph.nodes.find(node => node.id === mapping.functional)?.type !== 'functional') errors.push(`Unknown functional mapping source: ${mapping.functional}`);
    for (const item of mapping.implementation || []) if (!ids.has(typeof item === 'string' ? item : item.id)) errors.push(`Unknown implementation mapping target: ${typeof item === 'string' ? item : item.id}`);
  }
  return errors;
}

export async function loadGraph(projectPath) {
  const file = path.join(path.resolve(projectPath), '.context', 'graph.json');
  try { return normalizeGraph(JSON.parse(await readFile(file, 'utf8')), projectPath); } catch (error) {
    if (error.code === 'ENOENT') return emptyGraph(projectPath);
    throw error;
  }
}

export async function saveGraph(projectPath, graph) {
  const clean = normalizeGraph(graph, projectPath);
  const errors = validateGraph(clean);
  if (errors.length) throw new Error(errors.join('; '));
  const contextDir = path.join(path.resolve(projectPath), '.context');
  await mkdir(contextDir, { recursive: true });
  await writeFile(path.join(contextDir, 'graph.json'), `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  return clean;
}

export function createTaskNode(graph, { content, title = '', taskType = 'develop', target = null } = {}) {
  const text = String(content || '').trim();
  if (!text) throw new Error('Task content is required');
  const next = structuredClone(graph);
  const ids = new Set(next.nodes.map(node => node.id));
  const baseId = `task-${Date.now().toString(36)}`;
  let id = baseId; let suffix = 2;
  while (ids.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
  const label = String(title || text.split(/\r?\n/)[0]).replace(/\s+/g, ' ').slice(0, 72) || '新建任务';
  const node = { id, type: 'task', title: label, label, content: text, description: text, source: 'user', priority: 'normal', status: 'active', mode: 'MANUAL', metadata: { layer: 'structured', taskType, createdVia: 'conversation' }, ...nextNodePosition(next.nodes) };
  next.nodes.push(node);
  if (target) next.edges.push({ source: id, target, type: 'targets', scope: ['code', 'context'], mode: 'MANUAL' });
  return { graph: next, task: node };
}

function edgeKey(source, target) { return `${source}\0${target}`; }

export async function analyzeProject(projectPath, { files = [] } = {}) {
  const executables = [process.env.DEPENDENCY_SKILL_PYTHON, ...(process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'])].filter(Boolean);
  let lastError;
  for (const executable of executables) {
    try {
      const { stdout } = await execFileAsync(executable, [path.join(HERE, 'analyze_python.py'), path.resolve(projectPath), ...files], { maxBuffer: 16 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) { lastError = error; }
  }
  // Keep the editor usable on minimal hosts; Linux installations still use the
  // richer AST analyzer above whenever Python 3 is present.
  return analyzePythonFallback(projectPath, lastError, files);
}

async function analyzePythonFallback(projectPath, lastError, files = []) {
  const root = path.resolve(projectPath);
  const modules = [];
  const requested = new Set(files.map(file => String(file).replaceAll('\\', '/')));
  const fallbackModuleId = relative => {
    const id = relative.replace(/\.(?:py|c|cc|cpp|cxx)$/i, '').replace(/(?:^|\/)__init__$/, '').replaceAll('/', '.');
    return id || path.basename(root);
  };
  const relativePythonImports = (source, relative, id) => {
    const imports = [...source.matchAll(/^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/gm)].map(match => match[1]);
    const packageId = relative.endsWith('/__init__.py') || relative === '__init__.py'
      ? (id === path.basename(root) ? '' : id)
      : id.split('.').slice(0, -1).join('.');
    for (const match of source.matchAll(/^\s*from\s+([.]*)\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?\s+import(?:\s+([A-Za-z_]\w*|\*))?/gm)) {
      const dots = match[1] || '';
      const importedModule = match[2] || '';
      const level = dots.length;
      let base = importedModule;
      if (level > 0) {
        const parts = packageId ? packageId.split('.') : [];
        const parent = parts.slice(0, Math.max(0, parts.length - level + 1));
        base = [...parent, ...(importedModule ? importedModule.split('.') : [])].join('.');
      }
      const name = match[3];
      const imported = !name || name === '*' ? base : base ? `${base}.${name}` : name;
      if (imported) imports.push(imported);
    }
    return imports;
  };
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (['.git', '.context', 'node_modules', '.venv', 'venv', '__pycache__'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && ['.py', '.c', '.cc', '.cpp', '.cxx'].includes(path.extname(entry.name).toLowerCase())) {
        const rel = path.relative(root, file).replaceAll(path.sep, '/');
        if (requested.size && !requested.has(rel)) continue;
        const extension = path.extname(rel).toLowerCase();
        const id = fallbackModuleId(rel);
        const source = await optionalRead(file);
        const isPython = extension === '.py';
        modules.push({
          id: id || path.basename(root),
          path: rel,
          language: isPython ? 'python' : extension === '.c' ? 'c' : 'cpp',
          imports: isPython
            ? relativePythonImports(source, rel, id)
            : [...source.matchAll(/^\s*#\s*include\s*[<"]([^">]+)[">]/gm)].map((match) => match[1]),
          calls: [...source.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1]),
          references: [],
          inheritance: [],
          symbols: isPython
            ? [...source.matchAll(/^\s*(?:async\s+)?def\s+(\w+)/gm)].map((match) => ({ name: match[1], kind: 'function' }))
            : [...source.matchAll(/^\s*(?:[A-Za-z_]\w*\s+)*[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/gm)].map((match) => ({ name: match[1], kind: 'function' })),
        });
      }
    }
  }
  await walk(root);
  return { version: 1, root, modules, errors: lastError ? [{ error: 'Python 3 unavailable; used lightweight fallback' }] : [] };
}

function importTarget(importName, moduleIds) {
  const normalized = importName.replace(/^\.+/, '').replaceAll('/', '.').replace(/\.(?:h|hh|hpp|hxx|c|cc|cpp|cxx)$/i, '');
  const direct = [...moduleIds].filter(id => normalized === id || normalized.startsWith(`${id}.`)).sort((a, b) => b.length - a.length);
  if (direct.length) return direct[0];
  const parts = normalized.split('.');
  for (let end = parts.length; end > 0; end -= 1) {
    const alias = parts.slice(0, end).join('.');
    const matches = [...moduleIds].filter(id => id.endsWith(`.${alias}`)).sort();
    if (matches.length) return matches.length === 1 ? matches[0] : undefined;
  }
  return undefined;
}

function positionsOverlap(left, right) {
  return Number.isFinite(left.x) && Number.isFinite(left.y) && Number.isFinite(right.x) && Number.isFinite(right.y)
    && Math.abs(left.x - right.x) < 220 && Math.abs(left.y - right.y) < 140;
}

function nextNodePosition(nodes) {
  // Match the editor's card footprint with a little clearance.
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = { x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180 };
    if (nodes.every(node => !positionsOverlap(candidate, node))) return candidate;
  }
  // The guard is unreachable for normal projects, but keeps reconciliation total.
  return { x: 80, y: 80 + nodes.length * 180 };
}

export function reconcileGraphs(codeGraph, contextGraph, { prune = true } = {}) {
  const graph = structuredClone(contextGraph);
  graph.mappings ||= [];
  graph.overrides ||= { include: [], exclude: [], deleted: [] };
  graph.overrides.deleted ||= [];
  const tombstones = new Set(graph.overrides.deleted);
  const implementationIndex = materializeImplementationIndex(codeGraph);
  let tombstoneChanged = true;
  while (tombstoneChanged) {
    tombstoneChanged = false;
    for (const edge of implementationIndex.edges) if (edge.type === 'contains' && tombstones.has(edge.source) && !tombstones.has(edge.target)) {
      tombstones.add(edge.target);
      tombstoneChanged = true;
    }
  }
  graph.overrides.deleted = [...tombstones];
  if (tombstones.size) {
    graph.nodes = graph.nodes.filter(node => !tombstones.has(node.id));
    graph.edges = graph.edges.filter(edge => !tombstones.has(edge.source) && !tombstones.has(edge.target));
    graph.mappings = graph.mappings.map(mapping => ({ ...mapping, implementation: (mapping.implementation || []).filter(item => !tombstones.has(typeof item === 'string' ? item : item.id)) })).filter(mapping => mapping.implementation.length > 0);
  }
  const scannedIds = new Set(implementationIndex.nodes.map(node => node.id));
  const now = new Date().toISOString();
  const stale = [];
  if (prune) for (const node of graph.nodes) {
    const implementation = node.type === 'code_module' || node.type?.startsWith('implementation_');
    if (implementation && node.source === 'code' && !scannedIds.has(node.id)) {
      node.status = 'stale';
      node.metadata = { ...(node.metadata || {}), invalidated: 'source_deleted' };
      node.updated_at = now;
      stale.push(node.id);
    }
  }
  const positioned = [];
  for (const node of graph.nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || positioned.some(previous => positionsOverlap(node, previous))) {
      Object.assign(node, nextNodePosition(positioned));
    }
    positioned.push(node);
  }
  const existing = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const discovered of implementationIndex.nodes) {
    if (tombstones.has(discovered.id)) continue;
    const current = existing.get(discovered.id);
    if (current) {
      current.path = discovered.path || current.path;
      current.status = current.metadata?.invalidated === 'source_deleted' || current.status === 'stale' ? 'active' : current.status;
      current.last_verified = now;
      current.metadata = { ...(current.metadata || {}), ...(discovered.metadata || {}) };
      delete current.metadata.invalidated;
      continue;
    }
    const node = { ...discovered, type: discovered.type === 'implementation_file' ? 'code_module' : discovered.type, created_by: 'analyzer', confidence: 1, derived_from: [], last_verified: now, ...nextNodePosition(graph.nodes) };
    graph.nodes.push(node);
    existing.set(node.id, node);
  }
  const discoveredEdgeKeys = new Set(implementationIndex.edges.filter(edge => !tombstones.has(edge.source) && !tombstones.has(edge.target)).map(edge => `${edge.source}\0${edge.target}\0${edge.type}`));
  graph.edges = graph.edges.filter(edge => edge.mode === 'MANUAL' || edge.mode === 'FORCE_INCLUDE' || edge.mode === 'FORCE_EXCLUDE' || edge.metadata?.source !== 'implementation-analyzer' || discoveredEdgeKeys.has(`${edge.source}\0${edge.target}\0${edge.type}`));
  const graphEdgeKeys = new Set(graph.edges.map(edge => `${edge.source}\0${edge.target}\0${edge.type}`));
  for (const edge of implementationIndex.edges) {
    if (tombstones.has(edge.source) || tombstones.has(edge.target) || !existing.has(edge.source) || !existing.has(edge.target)) continue;
    const key = `${edge.source}\0${edge.target}\0${edge.type}`;
    if (!graphEdgeKeys.has(key)) {
      graph.edges.push({ ...edge, metadata: { ...(edge.metadata || {}), source: 'implementation-analyzer' } });
      graphEdgeKeys.add(key);
    }
  }
  const ids = new Set(codeGraph.modules.map((module) => module.id));
  const codeEdges = new Set();
  for (const module of codeGraph.modules) for (const imported of module.imports) {
    const target = importTarget(imported, ids);
    if (target && target !== module.id) codeEdges.add(edgeKey(module.id, target));
  }
  const contextEdges = new Set(graph.edges.map((edge) => edgeKey(edge.source, edge.target)));
  const suggestions = [];
  for (const key of codeEdges) if (!contextEdges.has(key)) {
    const [source, target] = key.split('\0');
    suggestions.push({ kind: 'missing', source, target, reason: `${source} imports ${target}`, proposal: { source, target, type: 'interface', scope: ['interface'], mode: 'AUTO' } });
  }
  for (const edge of graph.edges) if (ids.has(edge.source) && ids.has(edge.target) && (edge.mode || 'AUTO') === 'AUTO' && ['dependency', 'interface', 'depends_on'].includes(edge.type) && !codeEdges.has(edgeKey(edge.source, edge.target))) {
    suggestions.push({ kind: 'stale', source: edge.source, target: edge.target, reason: `${edge.target} is no longer imported by ${edge.source}` });
  }
  graph.cache = {
    ...(graph.cache || {}),
    revision: createHash('sha256').update(JSON.stringify({ modules: codeGraph.modules, edges: implementationIndex.edges })).digest('hex'),
    invalidated: stale,
    updated_at: now,
  };
  return { graph, codeGraph: { ...codeGraph, implementationIndex }, suggestions, removed: [], stale };
}

export async function ensureMemory(projectPath, graph) {
  const root = path.resolve(projectPath);
  await mkdir(path.join(root, '.context', 'modules'), { recursive: true });
  const projectFile = path.join(root, '.context', 'project.md');
  try { await stat(projectFile); } catch { await writeFile(projectFile, `# Project Context\n\nProject: ${path.basename(root)}\n\n## Rules\n\n- Keep module interfaces and decisions current.\n`, 'utf8'); }
  for (const node of graph.nodes) {
    if (node.type && node.type !== 'code_module') continue;
    const dir = path.join(root, '.context', 'modules', encodeURIComponent(node.id));
    await mkdir(dir, { recursive: true });
    const templates = {
      'context.md': `# ${node.label || node.id}\n\n## Responsibility\n\nDescribe this module's purpose and boundaries.\n`,
      'interface.md': `# ${node.label || node.id} Interface\n\nDocument public APIs, inputs, outputs, and contracts.\n`,
      'state.md': `# ${node.label || node.id} State\n\n## Current implementation\n\n- Source: ${node.path || 'unknown'}\n`,
      'decisions.md': `# ${node.label || node.id} Decisions\n\nRecord durable architectural decisions here.\n`,
    };
    for (const [name, content] of Object.entries(templates)) {
      try { await stat(path.join(dir, name)); } catch { await writeFile(path.join(dir, name), content, 'utf8'); }
    }
  }
}

async function optionalRead(file) { try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } }
function projectFile(root, relativePath) {
  const project = path.resolve(root);
  const file = path.resolve(project, relativePath);
  const relation = path.relative(project, file);
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`Context file is outside project: ${relativePath}`);
  return file;
}
const estimateTokens = estimateContextTokens;
function taskTextIncludes(task, content) {
  const request = String(task || '').trim().replace(/\s+/g, ' ');
  const saved = String(content || '').trim().replace(/\s+/g, ' ');
  return request.length > 0 && saved.length > 0 && request.includes(saved);
}
function taskTerms(task) {
  return String(task || '').toLowerCase().match(/[a-z_][a-z0-9_.:-]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
}
function implementationSymbolScore(node, terms) {
  const text = `${node.id} ${node.title || ''} ${node.label || ''} ${node.metadata?.signature || ''}`.toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}
async function implementationContent(root, node) {
  if (!node.path) return '';
  const content = await optionalRead(projectFile(root, node.path));
  const start = Number(node.metadata?.start_line);
  const end = Number(node.metadata?.end_line);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return content;
  return content.split(/\r?\n/).slice(start - 1, end).join('\n');
}
function reusableContextFingerprint(items) {
  const reusable = items.filter(item => item.scope !== 'task').map(item => `${item.label}\0${item.content}`).join('\x1e');
  return createHash('sha256').update(reusable).digest('hex');
}

function contextGraphRevision(graph) {
  const stable = {
    nodes: graph.nodes.map(node => ({ id: node.id, type: node.type, status: node.status, mode: node.mode, content: node.content, path: node.path, updated_at: node.updated_at, metadata: node.metadata })),
    edges: graph.edges,
    mappings: graph.mappings,
    overrides: graph.overrides,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function contextSource(node, scope) {
  if (scope === 'project') return '.context/project.md';
  if (scope === 'task') return 'current request';
  if (scope === 'code' && node.path) return node.path;
  return node.source || node.path || 'context graph';
}

function rawContextTokens(graph) {
  return graph.nodes
    .filter(node => node.type === 'conversation' || node.metadata?.raw === true)
    .reduce((sum, node) => sum + estimateTokens(node.content || ''), 0);
}

function finalizeCompilation({ graph, entry, task, tokenBudget, candidates, excluded, forceExclude, policy }) {
  const allocation = allocateContextBudget(candidates, { tokenBudget, policy, preExcluded: excluded });
  const manifest = buildContextManifest({
    task,
    target: entry,
    tokenBudget,
    allocation,
    forceExclude: [...forceExclude],
    rawTokens: rawContextTokens(graph),
    graphRevision: contextGraphRevision(graph),
  });
  const context = allocation.included.map(item => `## ${item.label}\n\n${item.content}`).join('\n\n');
  const compiledFingerprint = createHash('sha256').update(`${entry || ''}\0${context}`).digest('hex');
  return {
    entry,
    target: entry,
    task,
    tokenBudget,
    estimatedTokens: allocation.selectedTokens,
    candidateTokens: allocation.candidateTokens,
    excludedTokens: allocation.excludedTokens,
    rawTokens: manifest.rawTokens,
    overBudget: allocation.overBudget,
    valid: manifest.validation.valid,
    validation: manifest.validation,
    compiledFingerprint,
    reusableContextFingerprint: reusableContextFingerprint(allocation.included),
    included: manifest.included,
    excluded: manifest.excluded,
    manifest,
    context,
  };
}

async function git(projectPath, args) {
  try { return (await execFileAsync('git', ['-C', path.resolve(projectPath), ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
  catch { return ''; }
}

export async function gitSummary(projectPath, targetPath = '') {
  const status = await git(projectPath, ['status', '--short']);
  const logArgs = ['log', '-n', '8', '--date=short', '--pretty=format:%h %ad %s'];
  if (targetPath) logArgs.push('--', targetPath);
  return { status: status ? status.split('\n') : [], history: (await git(projectPath, logArgs)).split('\n').filter(Boolean) };
}

export async function compileContext(input) {
  const graph = normalizeGraph(input.graph, input.projectPath);
  const entry = input.entry || input.target;
  if (input.entry || graph.nodes.some(node => node.type !== 'code_module')) return compileModularContext({ ...input, graph, entry });
  const { projectPath, target, task, tokenBudget = 16000, include = [], exclude = [] } = input;
  const root = path.resolve(projectPath);
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodeMap.has(target)) throw new Error(`Unknown target module: ${target}`);
  const forcedInclude = new Set([...(graph.overrides?.include || []), ...include]);
  const forcedExclude = new Set([...(graph.overrides?.exclude || []), ...exclude]);
  for (const node of graph.nodes) {
    if (node.mode === 'FORCE_INCLUDE') forcedInclude.add(node.id);
    if (node.mode === 'FORCE_EXCLUDE') forcedExclude.add(node.id);
  }
  const candidates = [];
  const add = (priority, label, content, module, scope, required = false, reason = 'legacy module context') => {
    const node = nodeMap.get(module) || { id: module, type: scope === 'project' ? 'project_rule' : 'note', source: scope === 'project' ? 'project' : 'user' };
    if (content.trim()) candidates.push({ priority, priorityName: node.priority, label, content: content.trim(), module, node: module, nodeType: node.type, status: node.status, scope, required, forceInclude: forcedInclude.has(module), reason, source: contextSource(node, scope), depth: module === target ? 0 : 1 });
  };
  add(1000, 'User task', task, target, 'task', true);
  add(950, 'Project rules', await optionalRead(path.join(root, '.context', 'project.md')), null, 'project', true);
  const targetNode = nodeMap.get(target);
  if (targetNode.path) add(920, `${target} source`, await optionalRead(projectFile(root, targetNode.path)), target, 'code', false, 'current target implementation');
  for (const [scope, priority] of [['context', 900], ['interface', 890], ['state', 850], ['decisions', 820]]) {
    add(priority, `${target} ${scope}`, await optionalRead(path.join(root, '.context', 'modules', encodeURIComponent(target), `${scope}.md`)), target, scope, true);
  }
  const selected = new Map();
  for (const edge of graph.edges.filter((item) => item.source === target)) {
    if (edge.mode === 'FORCE_EXCLUDE' || edge.type === 'force_exclude') forcedExclude.add(edge.target);
    else {
      if (edge.mode === 'FORCE_INCLUDE' || edge.type === 'force_include') forcedInclude.add(edge.target);
      selected.set(edge.target, edge);
    }
  }
  for (const id of forcedInclude) if (nodeMap.has(id) && id !== target) selected.set(id, { target: id, scope: ['interface', 'state', 'decisions'], type: 'force_include', mode: 'FORCE_INCLUDE' });
  const excluded = [];
  for (const [id, edge] of selected) {
    if (forcedExclude.has(id)) { excluded.push({ module: id, reason: 'FORCE_EXCLUDE' }); continue; }
    const scopes = edge.scope?.length ? edge.scope : edge.type === 'interface' ? ['interface'] : ['interface', 'state'];
    for (const scope of scopes) {
      const priority = edge.mode === 'FORCE_INCLUDE' || edge.type === 'force_include' ? 780 : edge.type === 'optional' ? 300 : 650;
      const file = scope === 'code' ? nodeMap.get(id)?.path : path.join('.context', 'modules', encodeURIComponent(id), `${scope}.md`);
      if (file) add(priority, `${id} ${scope}`, await optionalRead(scope === 'code' ? projectFile(root, file) : path.join(root, file)), id, scope, false, edge.mode === 'FORCE_INCLUDE' || edge.type === 'force_include' ? 'FORCE_INCLUDE' : `${edge.type} from ${target}`);
    }
  }
  const history = await gitSummary(root, targetNode.path);
  add(400, `${target} relevant git history`, history.history.join('\n'), target, 'history');
  return finalizeCompilation({ graph, entry: target, task, tokenBudget, candidates, excluded, forceExclude: forcedExclude, policy: { ...(graph.policy || {}), ...(input.policy || {}) } });
}

export async function compileModularContext({ projectPath, graph, entry, task = '', tokenBudget = 16000, include = [], exclude = [], maxImplementationFiles = 3, semanticDepth = 3, policy }) {
  const root = path.resolve(projectPath);
  const implementationLimit = Number.isInteger(maxImplementationFiles) ? Math.max(1, Math.min(5, maxImplementationFiles)) : 3;
  const semanticLimit = Number.isInteger(semanticDepth) ? Math.max(1, Math.min(3, semanticDepth)) : 3;
  const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
  if (!nodeMap.has(entry)) throw new Error(`Unknown context entry: ${entry}`);
  const forceInclude = new Set([...(graph.overrides?.include || []), ...include]);
  const forceExclude = new Set([...(graph.overrides?.exclude || []), ...exclude]);
  for (const node of graph.nodes) {
    if (node.mode === 'FORCE_INCLUDE') forceInclude.add(node.id);
    if (node.mode === 'FORCE_EXCLUDE') forceExclude.add(node.id);
  }
  const selected = new Map([[entry, { depth: 0, reason: 'context entry', scope: ['content', 'code', 'context', 'interface', 'contract'] }]]);
  const queue = [entry];
  while (queue.length) {
    const current = queue.shift(); const currentInfo = selected.get(current);
    if (forceExclude.has(current)) continue;
    if (currentInfo.depth >= semanticLimit) continue;
    const currentNode = nodeMap.get(current);
    for (const edge of graph.edges) {
      if (edge.type === 'derived_from') continue; // Raw messages remain trace-only by default.
      const forward = edge.source === current;
      const backward = edge.target === current;
      if (!forward && !backward) continue;
      // Traverse capability dependencies in their declared direction. Context
      // leaves (requirements, interfaces, tests) may be collected in either
      // direction, but are never used as hubs to reach sibling modules.
      if (edge.type === 'targets' && !forward) continue;
      if (['depends_on', 'requires', 'uses', 'consumes', 'produces', 'feeds', 'transforms', 'triggers'].includes(edge.type) && !forward) continue;
      if (['dependency', 'reference', 'calls'].includes(edge.type) && currentNode?.type === 'functional') continue;
      const next = forward ? edge.target : edge.source;
      if (!next || !nodeMap.has(next) || forceExclude.has(next)) continue;
      // Tasks are entry points. Do not pull old tasks back in through a shared target.
      if (nodeMap.get(next)?.type === 'task' && next !== entry) continue;
      // Explicit edge overrides are directional and outrank semantic traversal
      // rules, including the Functional -> Implementation boundary below.
      if (forward && (edge.mode === 'FORCE_EXCLUDE' || edge.type === 'force_exclude')) {
        forceExclude.add(next);
        forceInclude.delete(next);
        selected.delete(next);
        continue;
      }
      if (forward && (edge.mode === 'FORCE_INCLUDE' || edge.type === 'force_include')) {
        forceInclude.add(next);
        continue;
      }
      if (!['task', 'functional', 'code_module'].includes(currentNode?.type) && !currentNode?.type?.startsWith('implementation_')) continue;
      if (edge.type === 'targets' && currentNode?.type === 'task' && (nodeMap.get(next)?.type === 'code_module' || nodeMap.get(next)?.type?.startsWith('implementation_'))) {
        const functionalTargets = (graph.mappings || []).filter(mapping => (mapping.implementation || []).some(item => (typeof item === 'string' ? item : item.id) === next)).map(mapping => mapping.functional).filter(id => nodeMap.get(id)?.type === 'functional' && !forceExclude.has(id));
        if (functionalTargets.length) {
          for (const functional of functionalTargets) if (!selected.has(functional)) {
            selected.set(functional, { depth: currentInfo.depth + 1, reason: `functional mapping for task target ${next}`, scope: ['content', 'interface', 'contract'] });
            queue.push(functional);
          }
          continue;
        }
      }
      if (currentNode?.type === 'functional' && (nodeMap.get(next)?.type === 'code_module' || nodeMap.get(next)?.type?.startsWith('implementation_'))) continue;
      if (!selected.has(next)) {
        const nextNode = nodeMap.get(next);
        selected.set(next, { depth: currentInfo.depth + 1, reason: `${edge.type} ${forward ? 'from' : 'to'} ${current}`, scope: edge.scope || [] });
        const expandable = nextNode.type === 'functional'
          || nextNode.type === 'task'
          || (edge.type === 'targets' && (nextNode.type === 'code_module' || nextNode.type?.startsWith('implementation_')));
        if (expandable) queue.push(next);
      }
    }
  }
  // A Functional Node is the semantic boundary. Resolve mapping overrides
  // before relevance ranking so FORCE_EXCLUDE always wins and FORCE_INCLUDE
  // is not constrained by the normal implementation limit.
  const selectedFunctions = [...selected].filter(([id, selection]) => nodeMap.get(id)?.type === 'functional'
    && (id === entry
      || selection.scope.includes('code')
      || selection.reason.startsWith('targets ')
      || selection.reason.startsWith('functional mapping for task target ')));
  for (const [id] of selectedFunctions) {
    const mappings = (graph.mappings || []).filter(mapping => mapping.functional === id);
    for (const mapping of mappings.filter(item => item.mode === 'FORCE_EXCLUDE')) {
      for (const implementation of mapping.implementation || []) {
        const implementationId = typeof implementation === 'string' ? implementation : implementation.id;
        if (!implementationId) continue;
        forceExclude.add(implementationId);
        forceInclude.delete(implementationId);
        selected.delete(implementationId);
      }
    }
    for (const mapping of mappings.filter(item => item.mode === 'FORCE_INCLUDE')) {
      for (const implementation of mapping.implementation || []) {
        const implementationId = typeof implementation === 'string' ? implementation : implementation.id;
        if (implementationId && !forceExclude.has(implementationId)) forceInclude.add(implementationId);
      }
    }
  }
  // Resolve only task-relevant implementation after semantic traversal;
  // never expand file calls through the implementation graph.
  for (const [id] of selectedFunctions) {
    for (const implementation of implementationForFunctional(graph, id, task, implementationLimit)) {
      if (nodeMap.has(implementation.id) && !forceExclude.has(implementation.id) && !selected.has(implementation.id)) {
        selected.set(implementation.id, { depth: 2, reason: `implemented_by ${id}`, scope: ['code', 'interface'] });
      }
    }
  }
  // When the scanned implementation graph has symbol boundaries, narrow a
  // mapped file to task-matching symbols. Whole-file loading remains the
  // fallback when no symbol can be identified.
  const terms = taskTerms(task);
  for (const [id, selection] of [...selected]) {
    const node = nodeMap.get(id);
    if (!node || (node.type !== 'code_module' && node.type !== 'implementation_file') || !selection.scope.includes('code')) continue;
    const descendants = [];
    const pending = [id];
    const seen = new Set(pending);
    while (pending.length) {
      const parent = pending.shift();
      for (const edge of graph.edges) if (edge.type === 'contains' && edge.source === parent && !seen.has(edge.target) && nodeMap.has(edge.target)) {
        seen.add(edge.target);
        pending.push(edge.target);
        descendants.push(nodeMap.get(edge.target));
      }
    }
    const matching = descendants.map(symbol => ({ symbol, score: implementationSymbolScore(symbol, terms) })).filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.symbol.id.localeCompare(right.symbol.id)).slice(0, 3);
    if (!matching.length) continue;
    selection.scope = selection.scope.filter(scope => scope !== 'code');
    for (const { symbol } of matching) if (!forceExclude.has(symbol.id)) selected.set(symbol.id, { depth: selection.depth + 1, reason: `task-relevant symbol in ${id}`, scope: ['code', 'interface'] });
  }
  for (const id of forceInclude) if (nodeMap.has(id)) {
    const node = nodeMap.get(id);
    const implementation = node.type === 'code_module' || node.type?.startsWith('implementation_');
    selected.set(id, {
      depth: 0,
      reason: 'FORCE_INCLUDE',
      scope: implementation
        ? ['content', 'code', 'interface', 'contract', 'state', 'decisions']
        : ['content', 'interface', 'contract', 'state', 'decisions'],
    });
  }
  const candidates = [];
  const excluded = [...forceExclude].filter(id => nodeMap.has(id)).map(id => {
    const node = nodeMap.get(id);
    return { node: id, module: id, nodeType: node.type, status: node.status, source: contextSource(node, 'content'), policyClass: node.mode === 'FORCE_INCLUDE' ? 'hard' : undefined, reason: 'FORCE_EXCLUDE', tokens: estimateTokens(node.content || '') };
  });
  const add = (priority, label, content, node, scope, reason, required = false, depth = 1) => {
    if (content?.trim()) candidates.push({ priority, priorityName: node.priority, label, content: content.trim(), module: node.id, node: node.id, nodeType: node.type, status: node.status, scope, reason, required, forceInclude: node.mode === 'FORCE_INCLUDE' || reason === 'FORCE_INCLUDE', source: contextSource(node, scope), depth });
  };
  if (task.trim()) add(1000, 'User task', task, nodeMap.get(entry), 'task', 'current request', true);
  add(950, 'Project rules', await optionalRead(path.join(root, '.context', 'project.md')), nodeMap.get(entry), 'project', 'project rule', true);
  for (const [id, selection] of selected) {
    const node = nodeMap.get(id);
    const currentFunctionalTarget = node.type === 'functional'
      && (id === entry || selection.reason.startsWith('targets ') || selection.reason.startsWith('functional mapping for task target '));
    if (forceExclude.has(id)) continue;
    if (node.status !== 'active' && !forceInclude.has(id)) {
      const omitted = { node: id, module: id, nodeType: node.type, status: node.status, scope: 'content', source: contextSource(node, 'content'), reason: node.status, required: currentFunctionalTarget, tokens: estimateTokens(node.content || '') };
      omitted.policyClass = classifyContextCandidate(omitted);
      excluded.push(omitted);
      continue;
    }
    if ((node.type === 'conversation' || node.metadata?.raw === true) && !forceInclude.has(id)) {
      excluded.push({ node: id, module: id, nodeType: node.type, status: node.status, source: contextSource(node, 'content'), reason: 'raw source is trace-only', tokens: estimateTokens(node.content || '') });
      continue;
    }
    const priority = node.priority === 'critical' ? 940 : node.priority === 'high' ? 900 : selection.depth === 0 ? 880 : 680 - selection.depth * 40;
    const duplicatedCurrentTask = id === entry && node.type === 'task' && taskTextIncludes(task, node.content);
    if (node.content && node.type !== 'functional' && !duplicatedCurrentTask) add(priority, `${node.title} (${node.type})`, node.content, node, 'content', selection.reason, id === entry && node.type !== 'code_module', selection.depth);
    if (node.type === 'functional') {
      const detail = [node.description || node.content, node.provides?.length ? `Provides: ${node.provides.join(', ')}` : '', node.consumes?.length ? `Consumes: ${node.consumes.join(', ')}` : '', node.inputs?.length ? `Input: ${node.inputs.join(', ')}` : '', node.outputs?.length ? `Output: ${node.outputs.join(', ')}` : ''].filter(Boolean).join('\n');
      if (detail) add(priority, `${node.title} (functional)`, detail, node, 'content', selection.reason, currentFunctionalTarget, selection.depth);
    }
    if (node.type === 'code_module' || node.type?.startsWith('implementation_')) {
      const scopes = selection.scope.length ? selection.scope : id === entry ? ['code', 'context', 'interface', 'state', 'decisions'] : ['interface', 'contract'];
      for (const scope of scopes) {
        if (scope === 'content' || scope === 'contract') continue;
        const file = scope === 'code' ? node.path : path.join('.context', 'modules', encodeURIComponent(id), `${scope}.md`);
        const content = scope === 'code' ? await implementationContent(root, node) : file ? await optionalRead(path.join(root, file)) : '';
        if (file) add(priority + (scope === 'code' && id === entry ? 30 : 0), `${node.title} ${scope}`, content, node, scope, selection.reason, false, selection.depth);
      }
    }
  }
  for (const node of graph.nodes) {
    if (selected.has(node.id) || forceExclude.has(node.id)) continue;
    excluded.push({ node: node.id, module: node.id, nodeType: node.type, status: node.status, source: contextSource(node, 'content'), score: 0, tokens: estimateTokens(node.content || ''), reason: node.type === 'conversation' || node.metadata?.raw === true ? 'raw context disabled by policy' : 'not selected by semantic traversal' });
  }
  return finalizeCompilation({ graph, entry, task, tokenBudget, candidates, excluded, forceExclude, policy: { ...(graph.policy || {}), ...(policy || {}) } });
}

export async function listProjects(parentPath) {
  const entries = await readdir(path.resolve(parentPath), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => ({ name: entry.name, path: path.join(path.resolve(parentPath), entry.name) }));
}
