import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { implementationForFunctional } from './semantic-functional.js';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTEXT_NODE_TYPES = ['functional', 'code_module', 'implementation_file', 'implementation_class', 'implementation_function', 'implementation_package', 'implementation_symbol', 'requirement', 'task', 'constraint', 'decision', 'interface', 'documentation', 'conversation', 'artifact', 'test', 'issue', 'note', 'project_rule'];
export const RELATION_TYPES = ['dependency', 'reference', 'interface', 'data', 'optional', 'force_include', 'force_exclude', 'depends_on', 'calls', 'references', 'affects', 'constrains', 'implements', 'implemented_by', 'derived_from', 'conflicts_with', 'supersedes', 'related_to', 'contains', 'uses', 'provides', 'consumes', 'produces', 'feeds', 'transforms', 'triggers', 'tests', 'documents', 'targets', 'requires', 'constrained_by', 'applies_to'];
export const MODES = ['AUTO', 'MANUAL', 'FORCE_INCLUDE', 'FORCE_EXCLUDE'];
export const SCOPES = ['code', 'context', 'interface', 'contract', 'state', 'decisions', 'history', 'content'];
const PRIORITIES = ['critical', 'high', 'normal', 'low'];
const STATUSES = ['active', 'resolved', 'deprecated', 'superseded', 'archived'];

export function emptyGraph(projectPath) {
  return { version: 1, projectPath: path.resolve(projectPath), nodes: [], edges: [], mappings: [], overrides: { include: [], exclude: [] } };
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
    overrides: { include: [...(base.overrides?.include || [])], exclude: [...(base.overrides?.exclude || [])] },
    mappings: (base.mappings || []).map(mapping => ({ ...mapping, implementation: (mapping.implementation || []).map(item => typeof item === 'string' ? { id: item } : { ...item }), confidence: Number.isFinite(mapping.confidence) ? mapping.confidence : 1, created_by: mapping.created_by || 'user', mode: canonicalMode(mapping.mode || 'MANUAL') })),
    nodes: (base.nodes || []).map(node => ({
      ...node,
      type: CONTEXT_NODE_TYPES.includes(node.type) ? node.type : 'code_module',
      title: node.title || node.label || node.id,
      label: node.label || node.title || node.id,
      content: typeof node.content === 'string' ? node.content : typeof node.description === 'string' ? node.description : '',
      description: typeof node.description === 'string' ? node.description : typeof node.content === 'string' ? node.content : '',
      source: node.source || ((node.type || 'code_module').startsWith('implementation_') || (node.type || 'code_module') === 'code_module' ? 'code' : 'user'),
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

function edgeKey(source, target) { return `${source}\0${target}`; }

export async function analyzeProject(projectPath) {
  const executables = process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'];
  let lastError;
  for (const executable of executables) {
    try {
      const { stdout } = await execFileAsync(executable, [path.join(HERE, 'analyze_python.py'), path.resolve(projectPath)], { maxBuffer: 16 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) { lastError = error; }
  }
  // Keep the editor usable on minimal hosts; Linux installations still use the
  // richer AST analyzer above whenever Python 3 is present.
  return analyzePythonFallback(projectPath, lastError);
}

async function analyzePythonFallback(projectPath, lastError) {
  const root = path.resolve(projectPath);
  const modules = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (['.git', '.context', 'node_modules', '.venv', 'venv', '__pycache__'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && ['.py', '.c', '.cc', '.cpp', '.cxx'].includes(path.extname(entry.name).toLowerCase())) {
        const rel = path.relative(root, file).replaceAll(path.sep, '/');
        const extension = path.extname(rel).toLowerCase();
        const id = rel.replace(/\.(?:py|c|cc|cpp|cxx)$/i, '').replace(/\/__init__$/, '').replaceAll('/', '.');
        const source = await optionalRead(file);
        const isPython = extension === '.py';
        modules.push({
          id: id || path.basename(root),
          path: rel,
          language: isPython ? 'python' : extension === '.c' ? 'c' : 'cpp',
          imports: isPython
            ? [...source.matchAll(/^\s*(?:from|import)\s+([\w.]+)/gm)].map((match) => match[1])
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
  return [...moduleIds].sort((a, b) => b.length - a.length).find((id) => normalized === id || normalized.startsWith(`${id}.`) || id.endsWith(`.${normalized}`));
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
  const scannedIds = new Set((codeGraph.modules || []).map(module => module.id));
  const removed = new Set(prune ? graph.nodes.filter(node => {
    const implementation = node.type === 'code_module' || node.type?.startsWith('implementation_');
    return implementation && node.source === 'code' && !scannedIds.has(node.id);
  }).map(node => node.id) : []);
  if (removed.size) {
    graph.nodes = graph.nodes.filter(node => !removed.has(node.id));
    graph.edges = graph.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target));
    graph.mappings = graph.mappings.map(mapping => ({ ...mapping, implementation: (mapping.implementation || []).filter(item => !removed.has(typeof item === 'string' ? item : item.id)) })).filter(mapping => mapping.implementation.length > 0);
  }
  const positioned = [];
  for (const node of graph.nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || positioned.some(previous => positionsOverlap(node, previous))) {
      Object.assign(node, nextNodePosition(positioned));
    }
    positioned.push(node);
  }
  const existing = new Set(graph.nodes.map((node) => node.id));
  for (const module of codeGraph.modules) {
    if (!existing.has(module.id)) {
      graph.nodes.push({ id: module.id, title: module.id, label: module.id, type: 'code_module', source: 'code', path: module.path, mode: 'AUTO', metadata: { layer: 'implementation', language: module.language }, ...nextNodePosition(graph.nodes) });
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
  return { graph, codeGraph, suggestions, removed: [...removed] };
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
function estimateTokens(text) { return Math.ceil([...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : 0.25), 0)); }
function reusableContextFingerprint(items) {
  const reusable = items.filter(item => item.scope !== 'task').map(item => `${item.label}\0${item.content}`).join('\x1e');
  return createHash('sha256').update(reusable).digest('hex');
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
  forcedExclude.delete(target);
  const candidates = [];
  const add = (priority, label, content, module, scope, required = false) => { if (content.trim()) candidates.push({ priority, label, content: content.trim(), module, scope, required }); };
  add(1000, 'User task', task, target, 'task', true);
  add(950, 'Project rules', await optionalRead(path.join(root, '.context', 'project.md')), null, 'project', true);
  const targetNode = nodeMap.get(target);
  if (targetNode.path) add(920, `${target} source`, await optionalRead(path.join(root, targetNode.path)), target, 'code', true);
  for (const [scope, priority] of [['context', 900], ['interface', 890], ['state', 850], ['decisions', 820]]) {
    add(priority, `${target} ${scope}`, await optionalRead(path.join(root, '.context', 'modules', encodeURIComponent(target), `${scope}.md`)), target, scope, true);
  }
  const selected = new Map();
  for (const edge of graph.edges.filter((item) => item.source === target)) {
    if (edge.mode === 'FORCE_EXCLUDE' || edge.type === 'force_exclude') forcedExclude.add(edge.target);
    else selected.set(edge.target, edge);
  }
  for (const id of forcedInclude) if (nodeMap.has(id) && id !== target) selected.set(id, { target: id, scope: ['interface', 'state', 'decisions'], type: 'force_include', mode: 'FORCE_INCLUDE' });
  const excluded = [];
  for (const [id, edge] of selected) {
    if (forcedExclude.has(id)) { excluded.push({ module: id, reason: 'FORCE_EXCLUDE' }); continue; }
    const scopes = edge.scope?.length ? edge.scope : edge.type === 'interface' ? ['interface'] : ['interface', 'state'];
    for (const scope of scopes) {
      const priority = edge.mode === 'FORCE_INCLUDE' || edge.type === 'force_include' ? 780 : edge.type === 'optional' ? 300 : 650;
      const file = scope === 'code' ? nodeMap.get(id)?.path : path.join('.context', 'modules', encodeURIComponent(id), `${scope}.md`);
      if (file) add(priority, `${id} ${scope}`, await optionalRead(path.join(root, file)), id, scope, false);
    }
  }
  const history = await gitSummary(root, targetNode.path);
  add(400, `${target} relevant git history`, history.history.join('\n'), target, 'history');
  candidates.sort((a, b) => b.priority - a.priority);
  const included = [];
  let used = 0;
  for (const item of candidates) {
    const tokens = estimateTokens(item.content) + estimateTokens(item.label) + 10;
    if (used + tokens <= tokenBudget || item.required) { included.push({ ...item, tokens }); used += tokens; }
    else excluded.push({ module: item.module, scope: item.scope, reason: 'token budget', tokens });
  }
  const text = included.map((item) => `## ${item.label}\n\n${item.content}`).join('\n\n');
  return { target, task, tokenBudget, estimatedTokens: used, overBudget: used > tokenBudget, reusableContextFingerprint: reusableContextFingerprint(included), included: included.map(({ content, ...item }) => item), excluded, context: text };
}

export async function compileModularContext({ projectPath, graph, entry, task = '', tokenBudget = 16000, include = [], exclude = [], maxImplementationFiles = 3, semanticDepth = 3 }) {
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
    for (const edge of graph.edges) {
      if (edge.type === 'derived_from') continue; // Raw messages remain trace-only by default.
      if (['dependency', 'reference', 'calls'].includes(edge.type) && nodeMap.get(current)?.type === 'functional') continue;
      const next = edge.source === current ? edge.target : edge.target === current ? edge.source : null;
      if (!next || !nodeMap.has(next) || forceExclude.has(next)) continue;
      if (nodeMap.get(current)?.type === 'functional' && (nodeMap.get(next)?.type === 'code_module' || nodeMap.get(next)?.type?.startsWith('implementation_'))) continue;
      if (edge.mode === 'FORCE_EXCLUDE' || edge.type === 'force_exclude') { forceExclude.add(next); continue; }
      if (!selected.has(next)) { selected.set(next, { depth: currentInfo.depth + 1, reason: `${edge.type} ${edge.source === current ? 'from' : 'to'} ${current}`, scope: edge.scope || [] }); queue.push(next); }
    }
  }
  // A Functional Node is the semantic boundary. Resolve only its relevant
  // implementation mapping after semantic traversal; never expand file calls.
  for (const [id] of [...selected]) if (nodeMap.get(id)?.type === 'functional') {
    for (const implementation of implementationForFunctional(graph, id, task, implementationLimit)) {
      if (nodeMap.has(implementation.id) && !forceExclude.has(implementation.id) && !selected.has(implementation.id)) {
        selected.set(implementation.id, { depth: 2, reason: `implemented_by ${id}`, scope: ['code', 'interface'] });
      }
    }
  }
  for (const id of forceInclude) if (nodeMap.has(id)) selected.set(id, { depth: 0, reason: 'FORCE_INCLUDE', scope: ['content', 'interface', 'contract', 'state', 'decisions'] });
  forceExclude.delete(entry);
  const candidates = [];
  const excluded = [...forceExclude].filter(id => nodeMap.has(id) && id !== entry).map(id => ({ node: id, module: id, reason: 'FORCE_EXCLUDE' }));
  const add = (priority, label, content, node, scope, reason, required = false) => { if (content?.trim()) candidates.push({ priority, label, content: content.trim(), module: node.id, node: node.id, nodeType: node.type, scope, reason, required }); };
  if (task.trim()) add(1000, 'User task', task, nodeMap.get(entry), 'task', 'current request', true);
  add(950, 'Project rules', await optionalRead(path.join(root, '.context', 'project.md')), nodeMap.get(entry), 'project', 'project rule', true);
  for (const [id, selection] of selected) {
    const node = nodeMap.get(id);
    if (forceExclude.has(id)) continue;
    if (node.status !== 'active' && id !== entry) { excluded.push({ node: id, module: id, reason: node.status }); continue; }
    if (node.type === 'conversation' || node.metadata?.raw === true) { excluded.push({ node: id, module: id, reason: 'raw source is trace-only' }); continue; }
    const priority = node.priority === 'critical' ? 940 : node.priority === 'high' ? 900 : selection.depth === 0 ? 880 : 680 - selection.depth * 40;
    if (node.content && node.type !== 'functional') add(priority, `${node.title} (${node.type})`, node.content, node, 'content', selection.reason, id === entry && node.type !== 'code_module');
    if (node.type === 'functional') {
      const detail = [node.description || node.content, node.provides?.length ? `Provides: ${node.provides.join(', ')}` : '', node.consumes?.length ? `Consumes: ${node.consumes.join(', ')}` : '', node.inputs?.length ? `Input: ${node.inputs.join(', ')}` : '', node.outputs?.length ? `Output: ${node.outputs.join(', ')}` : ''].filter(Boolean).join('\n');
      if (detail) add(priority, `${node.title} (functional)`, detail, node, 'content', selection.reason, id === entry);
    }
    if (node.type === 'code_module' || node.type?.startsWith('implementation_')) {
      const scopes = selection.scope.length ? selection.scope : id === entry ? ['code', 'context', 'interface', 'state', 'decisions'] : ['interface', 'contract'];
      for (const scope of scopes) {
        if (scope === 'content' || scope === 'contract') continue;
        const file = scope === 'code' ? node.path : path.join('.context', 'modules', encodeURIComponent(id), `${scope}.md`);
        if (file) add(priority + (scope === 'code' && id === entry ? 30 : 0), `${node.title} ${scope}`, await optionalRead(path.join(root, file)), node, scope, selection.reason, id === entry && scope === 'code');
      }
    }
  }
  candidates.sort((left, right) => right.priority - left.priority);
  const included = []; let used = 0;
  for (const item of candidates) {
    const tokens = estimateTokens(item.content) + estimateTokens(item.label) + 10;
    if (used + tokens <= tokenBudget || item.required) { included.push({ ...item, tokens }); used += tokens; }
    else excluded.push({ node: item.node, module: item.module, scope: item.scope, reason: 'token budget', tokens });
  }
  return { entry, target: entry, task, tokenBudget, estimatedTokens: used, overBudget: used > tokenBudget, reusableContextFingerprint: reusableContextFingerprint(included), included: included.map(({ content, ...item }) => item), excluded, context: included.map(item => `## ${item.label}\n\n${item.content}`).join('\n\n') };
}

export async function listProjects(parentPath) {
  const entries = await readdir(path.resolve(parentPath), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => ({ name: entry.name, path: path.join(path.resolve(parentPath), entry.name) }));
}
