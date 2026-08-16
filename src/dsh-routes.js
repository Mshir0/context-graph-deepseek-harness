import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProject, compileContext, ensureMemory, gitSummary, loadGraph, reconcileGraphs, saveGraph } from './core.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PREFIX = '/context-graph';
const BODY_CAP = 2 * 1024 * 1024;

export function registerContextGraphRoutes(ctx, config) {
  return ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: (req, res) => handle(ctx, config, req, res) });
}

async function handle(ctx, config, req, res) {
  try {
    const url = new URL(req.url || '/', 'http://dsh.local');
    if (url.pathname.startsWith(`${PREFIX}/api/`)) return await api(ctx, config, req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, 405, 'text/plain', 'Method not allowed');
    return await staticFile(req, res, url.pathname);
  } catch (error) {
    ctx.logger.warn(`context-graph route failed: ${String(error)}`);
    return json(res, error.code === 'ENOENT' ? 404 : 500, { error: error.message || String(error) });
  }
}

async function api(ctx, config, req, res, url) {
  if (req.method === 'GET' && url.pathname === `${PREFIX}/api/config`) {
    const workspaces = ctx.workspaceRegistry.list().map(item => item.path);
    return json(res, 200, { projectPath: workspaces[0] || '', workspaces, tokenBudget: config.tokenBudget });
  }
  const input = req.method === 'POST' ? await bodyJson(req) : {};
  const requested = req.method === 'GET' ? url.searchParams.get('project') : input.projectPath;
  const projectPath = await allowedWorkspace(ctx, requested);
  if (projectPath === null) return json(res, 403, { error: 'Project is not a registered DeepSeek Harness workspace' });
  if (req.method === 'GET' && url.pathname === `${PREFIX}/api/graph`) return json(res, 200, await loadGraph(projectPath));
  if (req.method === 'GET' && url.pathname === `${PREFIX}/api/git`) return json(res, 200, await gitSummary(projectPath));
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return json(res, 415, { error: 'application/json required' });
  if (url.pathname === `${PREFIX}/api/scan`) {
    const result = reconcileGraphs(await analyzeProject(projectPath), await loadGraph(projectPath));
    await ensureMemory(projectPath, result.graph);
    await saveGraph(projectPath, result.graph);
    return json(res, 200, result);
  }
  if (url.pathname === `${PREFIX}/api/graph`) {
    const graph = await saveGraph(projectPath, input.graph);
    await ensureMemory(projectPath, graph);
    return json(res, 200, graph);
  }
  if (url.pathname === `${PREFIX}/api/compile`) return json(res, 200, await compileContext({ ...input, projectPath, graph: input.graph || await loadGraph(projectPath) }));
  return json(res, 404, { error: 'Not found' });
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

async function staticFile(req, res, pathname) {
  let relative = pathname.slice(PREFIX.length).replace(/^\/+/, '');
  if (relative === '') relative = 'index.html';
  const file = path.resolve(PUBLIC, decodeURIComponent(relative));
  if (!file.startsWith(`${PUBLIC}${path.sep}`)) return end(res, 403, 'text/plain', 'Forbidden');
  const info = await stat(file);
  if (!info.isFile()) return end(res, 404, 'text/plain', 'Not found');
  const data = await readFile(file);
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': data.length });
  if (req.method === 'HEAD') return res.end();
  res.end(data);
}

function json(res, status, value) { return end(res, status, 'application/json; charset=utf-8', JSON.stringify(value)); }
function end(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
