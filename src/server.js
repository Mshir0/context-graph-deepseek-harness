#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProject, compileContext, ensureMemory, gitSummary, loadGraph, reconcileGraphs, saveGraph, streamDeepSeek } from './core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', 'public');
const port = Number(process.env.PORT || process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] || 4317);
const defaultProject = path.resolve(process.env.CONTEXT_GRAPH_PROJECT || process.cwd());

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function bodyJson(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 2 * 1024 * 1024) throw new Error('Request body is too large');
    parts.push(part);
  }
  return parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {};
}

function safeProject(value) { return path.resolve(value || defaultProject); }

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, { projectPath: defaultProject });
  if (req.method === 'GET' && url.pathname === '/api/graph') return sendJson(res, 200, await loadGraph(safeProject(url.searchParams.get('project'))));
  if (req.method === 'GET' && url.pathname === '/api/git') return sendJson(res, 200, await gitSummary(safeProject(url.searchParams.get('project'))));
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const input = await bodyJson(req);
  const projectPath = safeProject(input.projectPath);
  if (url.pathname === '/api/scan') {
    const current = await loadGraph(projectPath);
    const result = reconcileGraphs(await analyzeProject(projectPath), current);
    await ensureMemory(projectPath, result.graph);
    await saveGraph(projectPath, result.graph);
    return sendJson(res, 200, result);
  }
  if (url.pathname === '/api/graph') return sendJson(res, 200, await saveGraph(projectPath, input.graph));
  if (url.pathname === '/api/compile') return sendJson(res, 200, await compileContext({ ...input, projectPath, graph: input.graph || await loadGraph(projectPath) }));
  if (url.pathname === '/api/chat') {
    const compiled = await compileContext({ ...input, projectPath, graph: input.graph || await loadGraph(projectPath) });
    const stream = await streamDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL, model: process.env.DEEPSEEK_MODEL, context: compiled.context, task: input.task });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    for await (const chunk of stream) res.write(chunk);
    return res.end();
  }
  return sendJson(res, 404, { error: 'Not found' });
}

async function staticFile(req, res, url) {
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(`${PUBLIC}${path.sep}`) && file !== path.join(PUBLIC, 'index.html')) return sendJson(res, 403, { error: 'Forbidden' });
  const info = await stat(file);
  if (!info.isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
  const data = await readFile(file);
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-length': data.length });
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await staticFile(req, res, url);
  } catch (error) {
    sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Context Graph running at http://127.0.0.1:${port} for ${defaultProject}`));
