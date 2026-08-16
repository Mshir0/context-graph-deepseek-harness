import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RELATION_TYPES = ['dependency', 'reference', 'interface', 'data', 'optional', 'force_include', 'force_exclude'];
export const MODES = ['AUTO', 'FORCE_INCLUDE', 'FORCE_EXCLUDE'];
export const SCOPES = ['code', 'context', 'interface', 'state', 'decisions', 'history'];

export function emptyGraph(projectPath) {
  return { version: 1, projectPath: path.resolve(projectPath), nodes: [], edges: [], overrides: { include: [], exclude: [] } };
}

export function validateGraph(graph) {
  const errors = [];
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) errors.push('Graph must have version 1, nodes, and edges');
  const ids = new Set((graph?.nodes || []).map((node) => node.id));
  if (ids.size !== (graph?.nodes || []).length) errors.push('Node ids must be unique');
  for (const edge of graph?.edges || []) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`Unknown endpoint on ${edge.source} -> ${edge.target}`);
    if (!RELATION_TYPES.includes(edge.type)) errors.push(`Unsupported relationship: ${edge.type}`);
    if (!MODES.includes(edge.mode || 'AUTO')) errors.push(`Unsupported mode: ${edge.mode}`);
    for (const scope of edge.scope || []) if (!SCOPES.includes(scope)) errors.push(`Unsupported scope: ${scope}`);
  }
  return errors;
}

export async function loadGraph(projectPath) {
  const file = path.join(path.resolve(projectPath), '.context', 'graph.json');
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return emptyGraph(projectPath);
    throw error;
  }
}

export async function saveGraph(projectPath, graph) {
  const errors = validateGraph(graph);
  if (errors.length) throw new Error(errors.join('; '));
  const contextDir = path.join(path.resolve(projectPath), '.context');
  await mkdir(contextDir, { recursive: true });
  const clean = { ...graph, projectPath: path.resolve(projectPath) };
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

export function reconcileGraphs(codeGraph, contextGraph) {
  const graph = structuredClone(contextGraph);
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
      graph.nodes.push({ id: module.id, label: module.id, path: module.path, mode: 'AUTO', ...nextNodePosition(graph.nodes) });
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
  for (const edge of graph.edges) if (['dependency', 'interface'].includes(edge.type) && !codeEdges.has(edgeKey(edge.source, edge.target))) {
    suggestions.push({ kind: 'stale', source: edge.source, target: edge.target, reason: `${edge.target} is no longer imported by ${edge.source}` });
  }
  return { graph, codeGraph, suggestions };
}

export async function ensureMemory(projectPath, graph) {
  const root = path.resolve(projectPath);
  await mkdir(path.join(root, '.context', 'modules'), { recursive: true });
  const projectFile = path.join(root, '.context', 'project.md');
  try { await stat(projectFile); } catch { await writeFile(projectFile, `# Project Context\n\nProject: ${path.basename(root)}\n\n## Rules\n\n- Keep module interfaces and decisions current.\n`, 'utf8'); }
  for (const node of graph.nodes) {
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

export async function compileContext({ projectPath, graph, target, task, tokenBudget = 16000, include = [], exclude = [] }) {
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
  return { target, task, tokenBudget, estimatedTokens: used, overBudget: used > tokenBudget, included: included.map(({ content, ...item }) => item), excluded, context: text };
}

export async function listProjects(parentPath) {
  const entries = await readdir(path.resolve(parentPath), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => ({ name: entry.name, path: path.join(path.resolve(parentPath), entry.name) }));
}
