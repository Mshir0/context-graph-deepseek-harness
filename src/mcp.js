#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { analyzeProject, compileContext, ensureMemory, gitSummary, loadGraph, reconcileGraphs, saveGraph } from './core.js';

const toolSchemas = [
  { name: 'context_graph_scan', description: 'Analyze Python code, initialize context memory, and return graph drift suggestions.', inputSchema: { type: 'object', required: ['projectPath'], properties: { projectPath: { type: 'string' } } } },
  { name: 'context_graph_get', description: 'Load the project Context Graph.', inputSchema: { type: 'object', required: ['projectPath'], properties: { projectPath: { type: 'string' } } } },
  { name: 'context_graph_save', description: 'Validate and save a Context Graph after user-approved changes.', inputSchema: { type: 'object', required: ['projectPath', 'graph'], properties: { projectPath: { type: 'string' }, graph: { type: 'object' } } } },
  { name: 'context_compile', description: 'Compile minimal, prioritized context for a target module and task.', inputSchema: { type: 'object', required: ['projectPath', 'target', 'task'], properties: { projectPath: { type: 'string' }, target: { type: 'string' }, task: { type: 'string' }, tokenBudget: { type: 'integer', default: 16000 }, include: { type: 'array', items: { type: 'string' } }, exclude: { type: 'array', items: { type: 'string' } } } } },
  { name: 'context_git_summary', description: 'Get concise Git status and recent file/module history.', inputSchema: { type: 'object', required: ['projectPath'], properties: { projectPath: { type: 'string' }, targetPath: { type: 'string' } } } },
];

function output(value, isError = false) { return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError }; }

async function callTool(name, args) {
  if (name === 'context_graph_get') return loadGraph(args.projectPath);
  if (name === 'context_graph_save') return saveGraph(args.projectPath, args.graph);
  if (name === 'context_graph_scan') {
    const result = reconcileGraphs(await analyzeProject(args.projectPath), await loadGraph(args.projectPath));
    await ensureMemory(args.projectPath, result.graph); await saveGraph(args.projectPath, result.graph); return result;
  }
  if (name === 'context_compile') return compileContext({ ...args, graph: await loadGraph(args.projectPath) });
  if (name === 'context_git_summary') return gitSummary(args.projectPath, args.targetPath);
  throw new Error(`Unknown tool: ${name}`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (!('id' in message)) return;
  const response = { jsonrpc: '2.0', id: message.id };
  try {
    if (message.method === 'initialize') response.result = { protocolVersion: message.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'context-graph', version: '0.1.0' } };
    else if (message.method === 'tools/list') response.result = { tools: toolSchemas };
    else if (message.method === 'tools/call') response.result = output(await callTool(message.params.name, message.params.arguments || {}));
    else if (message.method === 'ping') response.result = {};
    else throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 });
  } catch (error) { response.error = { code: error.code || -32000, message: error.message }; }
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
