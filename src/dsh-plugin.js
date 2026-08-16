import { createHash } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  analyzeProject,
  compileContext,
  ensureMemory,
  gitSummary,
  loadGraph,
  reconcileGraphs,
  saveGraph,
} from './core.js';
import { registerContextGraphRoutes } from './dsh-routes.js';
import { escapeAttribute, inferTarget, latestUserText, preview } from './dsh-context.js';

export const name = 'context-graph';
export const inject = ['agents', 'sessions', 'tools', 'systemPrompt'];

const DEFAULTS = { tokenBudget: 16000, autoScan: true, autoInject: true, webUi: true };

export function apply(ctx, input = {}) {
  const config = resolveConfig(input);
  const sessionState = new Map();

  registerTools(ctx, config, sessionState);

  ctx.systemPrompt.section({
    name: 'context-graph:policy',
    order: 99,
    text: 'Use context_graph_scan when project structure changes. Before modifying a module, use context_select or context_compile when the target is ambiguous. Treat Code Graph dependencies as evidence, not automatic Context Graph policy; preserve explicit FORCE_INCLUDE and FORCE_EXCLUDE choices.',
  });

  ctx.on('agent/session-start', ({ agent }) => {
    const key = String(agent.session.id);
    agent.ctx.effect(() => () => sessionState.delete(key), 'contextGraph.disposeSession()');
  });

  if (config.autoInject) {
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next();
      if (decision.kind !== 'enter' || signal.aborted) return decision;
      try {
        const message = await compileStepMessage(agent, decision.messages, config, sessionState, signal);
        if (message === null || signal.aborted) return decision;
        return { kind: 'enter', messages: [...decision.messages, message] };
      } catch (error) {
        ctx.logger.warn(`context-graph: automatic context injection skipped: ${String(error)}`);
        return decision;
      }
    }, { prepend: true });
  }

  if (config.webUi) {
    ctx.inject(['webServer', 'workspaceRegistry'], webCtx => {
      webCtx.effect(() => registerContextGraphRoutes(webCtx, config), 'context-graph: Harness web routes');
    });
  }
}

function resolveConfig(input) {
  const config = { ...DEFAULTS, ...input };
  if (!Number.isInteger(config.tokenBudget) || config.tokenBudget < 1000) throw new Error('context-graph tokenBudget must be an integer >= 1000');
  for (const key of ['autoScan', 'autoInject', 'webUi']) if (typeof config[key] !== 'boolean') throw new Error(`context-graph ${key} must be boolean`);
  return config;
}

function registerTools(ctx, config, sessionState) {
  ctx.tools.register(textTool({
    name: 'context_graph_scan',
    description: 'Analyze the current DSH workspace, initialize .context memory, and report Code Graph versus Context Graph drift. Suggestions are not applied automatically.',
    parameters: {},
    async execute(_args, exec) {
      const root = workspaceOf(exec);
      const result = reconcileGraphs(await analyzeProject(root), await loadGraph(root));
      await ensureMemory(root, result.graph);
      await saveGraph(root, result.graph);
      return JSON.stringify({ modules: result.codeGraph.modules.length, analyzerErrors: result.codeGraph.errors, suggestions: result.suggestions }, null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_graph_get',
    description: 'Read the current workspace Context Graph, including nodes, typed edges, scopes, and manual overrides.',
    parameters: {},
    async execute(_args, exec) { return JSON.stringify(await loadGraph(workspaceOf(exec)), null, 2); },
  }));

  ctx.tools.register(textTool({
    name: 'context_graph_save',
    description: 'Validate and save a complete Context Graph JSON document after proposed relationship changes have been accepted.',
    parameters: { graph_json: { type: 'string', required: true, description: 'Complete graph JSON with version, nodes, edges, and overrides.' } },
    async execute(args, exec) {
      const graph = JSON.parse(args.graph_json);
      const root = workspaceOf(exec);
      await saveGraph(root, graph);
      await ensureMemory(root, graph);
      return `Saved ${graph.nodes.length} modules and ${graph.edges.length} relationships.`;
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_select',
    description: 'Set the target module and manual include/exclude overrides for automatic context injection in this DSH session.',
    parameters: {
      target: { type: 'string', required: true, description: 'Target module id from context_graph_get.' },
      include: { type: 'array', items: { type: 'string' }, description: 'Module ids to force include.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Module ids to force exclude.' },
    },
    async execute(args, exec) {
      const graph = await loadGraph(workspaceOf(exec));
      if (!graph.nodes.some(node => node.id === args.target)) throw new Error(`Unknown target module: ${args.target}`);
      const selected = { target: args.target, include: args.include || [], exclude: args.exclude || [] };
      sessionState.set(sessionKey(exec), { ...sessionState.get(sessionKey(exec)), ...selected, fingerprint: undefined });
      return JSON.stringify(selected, null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_compile',
    description: 'Compile and preview prioritized context for a task in the current DSH workspace without invoking a model.',
    parameters: {
      target: { type: 'string', required: true, description: 'Target module id.' },
      task: { type: 'string', required: true, description: 'Current coding task.' },
      token_budget: { type: 'integer', description: 'Override the plugin token budget for this preview.' },
      include: { type: 'array', items: { type: 'string' }, description: 'Additional force-included modules.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Force-excluded modules.' },
      include_content: { type: 'boolean', description: 'Include the compiled context text in the result.' },
    },
    async execute(args, exec) {
      const root = workspaceOf(exec);
      const result = await compileContext({ projectPath: root, graph: await loadGraph(root), target: args.target, task: args.task, tokenBudget: args.token_budget || config.tokenBudget, include: args.include || [], exclude: args.exclude || [] });
      return JSON.stringify(preview(result, args.include_content === true), null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_git_summary',
    description: 'Read concise Git status and recent relevant history from the current DSH workspace.',
    parameters: { target_path: { type: 'string', description: 'Optional module-relative file path.' } },
    async execute(args, exec) { return JSON.stringify(await gitSummary(workspaceOf(exec), args.target_path || ''), null, 2); },
  }));

  ctx.tools.register(textTool({
    name: 'context_graph_ui',
    description: 'Return the Context Graph editor path hosted inside the current DeepSeek Harness web application.',
    parameters: {},
    async execute() { return '/context-graph/'; },
  }));
}

function textTool(definition) {
  return defineTool({
    ...definition,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    presentCall: args => ({ card: 'generic', kind: 'read', title: definition.name.replaceAll('_', ' '), rawInput: args }),
  });
}

async function compileStepMessage(agent, messages, config, sessionState, signal) {
  const root = agent.session.header?.cwd || process.cwd();
  let graph = await loadGraph(root);
  if (graph.nodes.length === 0 && config.autoScan) {
    const result = reconcileGraphs(await analyzeProject(root), graph);
    graph = result.graph;
    await ensureMemory(root, graph);
    await saveGraph(root, graph);
  }
  if (signal.aborted || graph.nodes.length === 0) return null;
  const task = latestUserText(messages);
  if (task.length === 0) return null;
  const key = String(agent.session.id);
  const selected = sessionState.get(key) || {};
  const target = selected.target && graph.nodes.some(node => node.id === selected.target) ? selected.target : inferTarget(task, graph.nodes);
  if (target === null) return null;
  const result = await compileContext({ projectPath: root, graph, target, task, tokenBudget: config.tokenBudget, include: selected.include || [], exclude: selected.exclude || [] });
  const fingerprint = createHash('sha256').update(`${task}\0${target}\0${result.context}`).digest('hex');
  if (selected.fingerprint === fingerprint) return null;
  sessionState.set(key, { ...selected, target, fingerprint });
  return createUserMessage({
    content: [{ type: 'text', text: `<context-graph target="${escapeAttribute(target)}" estimated-tokens="${result.estimatedTokens}">\n${result.context}\n</context-graph>` }],
    source: { kind: 'plugin', plugin: 'context-graph', form: 'recall' },
  });
}

function workspaceOf(exec) {
  const cwd = exec.agent?.session?.header?.cwd;
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('Context Graph requires a DSH session workspace');
  return cwd;
}
function sessionKey(exec) {
  if (!exec.agent?.session?.id) throw new Error('Context Graph requires a calling DSH agent');
  return String(exec.agent.session.id);
}
