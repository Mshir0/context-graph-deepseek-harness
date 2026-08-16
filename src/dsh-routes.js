import { realpath } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { analyzeProject, compileContext, createTaskNode, ensureMemory, gitSummary, loadGraph, reconcileGraphs, saveGraph } from './core.js';
import { analyzeDependencies } from './dependency-skill.js';
import { inferTarget } from './dsh-context.js';
import { applyFunctionalInference, inferFunctionalModules } from './semantic-functional.js';
import { resolveSessionContextSettings, updateSessionContextSettings } from './session-context.js';

const PREFIX = '/context-graph';
const BODY_CAP = 2 * 1024 * 1024;

export function registerContextGraphRoutes(ctx, config, sessionState = new Map()) {
  return ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: (req, res) => handle(ctx, config, sessionState, req, res) });
}

async function handle(ctx, config, sessionState, req, res) {
  try {
    const url = new URL(req.url || '/', 'http://dsh.local');
    if (url.pathname.startsWith(`${PREFIX}/api/`)) return await api(ctx, config, sessionState, req, res, url);
    return json(res, 404, { error: 'Context Graph is available in the DeepSeek Harness details panel' });
  } catch (error) {
    ctx.logger.warn(`context-graph route failed: ${String(error)}`);
    return json(res, error.code === 'ENOENT' ? 404 : 500, { error: error.message || String(error) });
  }
}

async function api(ctx, config, sessionState, req, res, url) {
  if (req.method === 'GET' && url.pathname === `${PREFIX}/api/config`) {
    const workspaces = ctx.workspaceRegistry.list().map(item => item.path);
    return json(res, 200, { projectPath: workspaces[0] || '', workspaces, tokenBudget: config.tokenBudget, autoInject: config.autoInject !== false });
  }
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return json(res, 415, { error: 'application/json required' });
  const input = req.method === 'POST' ? await bodyJson(req) : {};
  const requested = req.method === 'GET' ? url.searchParams.get('project') : input.projectPath;
  const projectPath = await allowedWorkspace(ctx, requested);
  if (projectPath === null) return json(res, 403, { error: 'Project is not a registered DeepSeek Harness workspace' });
  if (url.pathname === `${PREFIX}/api/session-settings`) {
    const sessionId = String(req.method === 'GET' ? url.searchParams.get('sessionId') || '' : input.sessionId || '');
    const session = sessionState.get(sessionId);
    if (!sessionId || !session || !session.projectPath || resolvePath(session.projectPath) !== resolvePath(projectPath)) return json(res, 404, { error: 'DSH session is not active for this workspace' });
    if (req.method === 'GET') return json(res, 200, resolveSessionContextSettings(session, config));
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const patch = {};
    if (input.autoInject !== undefined) patch.autoInject = input.autoInject;
    if (input.tokenBudget !== undefined) patch.tokenBudget = input.tokenBudget;
    if (input.reuseContext !== undefined) patch.reuseContext = input.reuseContext;
    if (input.maxImplementationFiles !== undefined) patch.maxImplementationFiles = input.maxImplementationFiles;
    if (input.semanticDepth !== undefined) patch.semanticDepth = input.semanticDepth;
    if (input.include !== undefined) patch.include = input.include;
    if (input.exclude !== undefined) patch.exclude = input.exclude;
    return json(res, 200, updateSessionContextSettings(sessionState, sessionId, patch, config));
  }
  if (req.method === 'GET' && url.pathname === `${PREFIX}/api/graph`) return json(res, 200, await loadGraph(projectPath));
  if (req.method === 'GET' && url.pathname === `${PREFIX}/api/git`) return json(res, 200, await gitSummary(projectPath));
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (url.pathname === `${PREFIX}/api/tasks`) {
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!content) return json(res, 400, { error: 'Task content is required' });
    if (input.target !== undefined && input.target !== null && typeof input.target !== 'string') return json(res, 400, { error: 'Task target must be a node id' });
    const requestedTarget = typeof input.target === 'string' ? input.target.trim() : '';
    if (typeof input.target === 'string' && input.target && !requestedTarget) return json(res, 400, { error: 'Task target must be a node id' });
    if (input.sessionId !== undefined && input.sessionId !== null && (typeof input.sessionId !== 'string' || !input.sessionId.trim())) return json(res, 400, { error: 'DSH session id must be a non-empty string' });
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    const session = sessionId ? sessionState.get(sessionId) : null;
    if (sessionId && (!session || !session.projectPath || resolvePath(session.projectPath) !== resolvePath(projectPath))) return json(res, 404, { error: 'DSH session is not active for this workspace' });

    const graph = await loadGraph(projectPath);
    let target = requestedTarget || null;
    if (target && !graph.nodes.some(node => node.id === target)) return json(res, 400, { error: `Unknown task target: ${target}` });
    if (!target) target = inferTaskTarget(content, graph.nodes);
    const created = createTaskNode(graph, {
      content,
      title: typeof input.title === 'string' ? input.title : '',
      taskType: typeof input.taskType === 'string' && input.taskType.trim() ? input.taskType.trim() : 'develop',
      target,
    });
    const saved = await saveGraph(projectPath, created.graph);
    await ensureMemory(projectPath, saved);
    const task = saved.nodes.find(node => node.id === created.task.id);
    const sessionSettings = sessionId ? updateSessionContextSettings(sessionState, sessionId, { target: task.id }, config) : null;
    return json(res, 200, { graph: saved, task, target, sessionSettings });
  }
  if (url.pathname === `${PREFIX}/api/scan`) {
    const result = reconcileGraphs(await analyzeProject(projectPath), await loadGraph(projectPath));
    await ensureMemory(projectPath, result.graph);
    await saveGraph(projectPath, result.graph);
    return json(res, 200, result);
  }
  if (url.pathname === `${PREFIX}/api/functional-infer`) {
    const graph = await loadGraph(projectPath); const facts = await analyzeDependencies(projectPath); const implementationGraph = reconcileGraphs({ modules: facts.modules.map(module => ({ ...module, imports: [] })) }, graph, { prune: false }).graph; const proposal = inferFunctionalModules(implementationGraph, facts);
    if (input.apply === true) return json(res, 200, { applied: true, proposal, graph: await saveGraph(projectPath, applyFunctionalInference(implementationGraph, proposal)) });
    return json(res, 200, { applied: false, proposal });
  }
  if (url.pathname === `${PREFIX}/api/graph`) {
    const graph = await saveGraph(projectPath, input.graph);
    await ensureMemory(projectPath, graph);
    return json(res, 200, graph);
  }
  if (url.pathname === `${PREFIX}/api/compile`) return json(res, 200, await compileContext({ ...input, tokenBudget: input.tokenBudget ?? config.tokenBudget, projectPath, graph: input.graph || await loadGraph(projectPath) }));
  return json(res, 404, { error: 'Not found' });
}

function inferTaskTarget(content, nodes) {
  const functional = nodes.filter(node => node.type === 'functional');
  const functionalTarget = inferTarget(content, functional);
  if (functionalTarget) return functionalTarget;
  const implementation = nodes.filter(node => node.type === 'code_module' || node.type?.startsWith('implementation_'));
  const implementationTarget = inferTarget(content, implementation);
  if (implementationTarget) return implementationTarget;
  return inferTarget(content, nodes.filter(node => node.type !== 'conversation' && node.metadata?.raw !== true && node.type !== 'task'));
}

async function allowedWorkspace(ctx, requested) {
  if (typeof requested !== 'string' || requested.length === 0) return null;
  let candidate;
  try { candidate = await realpath(requested); } catch { return null; }
  for (const workspace of ctx.workspaceRegistry.list()) {
    try { if (await realpath(workspace.path) === candidate) return candidate; } catch { /* Ignore stale registrations. */ }
  }
  return null;
}

async function bodyJson(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > BODY_CAP) throw new Error('Request body is too large');
    parts.push(part);
  }
  if (parts.length === 0) return {};
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

function json(res, status, value) { return end(res, status, 'application/json; charset=utf-8', JSON.stringify(value)); }
function end(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
