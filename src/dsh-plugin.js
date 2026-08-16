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
import { applyExtraction, detectContextConflicts, extractContext } from './context-extraction.js';
import {
  analyzeDependencies,
  analyzeModule,
  analyzeModuleDependencies,
  checkConsistency,
  detectGraphChanges,
  discoverModules,
  extractInterface,
  findCallees,
  findCallers,
  findRelatedModules,
  proposeContextEdges,
  validateRelationship,
} from './dependency-skill.js';

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
    text: 'Use context_graph_scan when project structure changes. Use context_extract to propose durable Task, Requirement, Constraint, or Decision nodes from important conversation content; do not apply uncertain proposals. Before modifying a module, use context_select or context_compile when the entry is ambiguous. Treat raw conversation and Code Graph dependencies as evidence, not automatic context policy; preserve MANUAL, FORCE_INCLUDE, and FORCE_EXCLUDE choices.',
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
    name: 'context_extract',
    description: 'Conservatively extract traceable structured Context Nodes from one user or assistant message. Returns a proposal unless apply=true.',
    parameters: {
      text: { type: 'string', required: true, description: 'One raw user or assistant message.' },
      source: { type: 'string', description: 'user or assistant.' },
      conversation_id: { type: 'string', description: 'Stable raw conversation source id.' },
      message_id: { type: 'string', description: 'Optional stable raw message id.' },
      apply: { type: 'boolean', description: 'Persist the proposed nodes and edges after review.' },
    },
    async execute(args, exec) {
      const root = workspaceOf(exec); const graph = await loadGraph(root);
      const extraction = extractContext(args.text, { source: args.source || 'user', conversationId: args.conversation_id || `conversation-${sessionKey(exec)}`, messageId: args.message_id, graph });
      if (args.apply === true) { const saved = await saveGraph(root, applyExtraction(graph, extraction)); return JSON.stringify({ applied: true, extraction, graph: saved }, null, 2); }
      return JSON.stringify({ applied: false, extraction }, null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_detect_conflicts', description: 'Detect potential conflicts among active structured requirements, constraints, and decisions without changing the graph.', parameters: {},
    async execute(_args, exec) { return JSON.stringify(detectContextConflicts(await loadGraph(workspaceOf(exec))), null, 2); },
  }));

  ctx.tools.register(textTool({
    name: 'context_graph_add_node', description: 'Validate and persist one explicitly approved Context Node.', parameters: { node_json: { type: 'string', required: true, description: 'ContextNode JSON.' } },
    async execute(args, exec) { const root = workspaceOf(exec); const graph = await loadGraph(root); const node = JSON.parse(args.node_json); if (graph.nodes.some(item => item.id === node.id)) throw new Error(`Duplicate context node: ${node.id}`); const index = graph.nodes.length; graph.nodes.push({ x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180, mode: 'MANUAL', ...node }); return JSON.stringify(await saveGraph(root, graph), null, 2); },
  }));

  ctx.tools.register(textTool({
    name: 'context_graph_add_edge', description: 'Validate and persist one explicitly approved Context Edge. Use MANUAL for a user-created relationship.', parameters: { edge_json: { type: 'string', required: true, description: 'ContextEdge JSON with source, target, type, scope, and mode.' } },
    async execute(args, exec) { const root = workspaceOf(exec); const graph = await loadGraph(root); graph.edges.push({ mode: 'MANUAL', ...JSON.parse(args.edge_json) }); return JSON.stringify(await saveGraph(root, graph), null, 2); },
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
      entry: { type: 'string', description: 'Context entry node id: Task, CodeModule, Requirement, Issue, Test, or another structured node.' },
      target: { type: 'string', description: 'Backward-compatible target module id.' },
      task: { type: 'string', required: true, description: 'Current coding task.' },
      token_budget: { type: 'integer', description: 'Override the plugin token budget for this preview.' },
      include: { type: 'array', items: { type: 'string' }, description: 'Additional force-included modules.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Force-excluded modules.' },
      include_content: { type: 'boolean', description: 'Include the compiled context text in the result.' },
    },
    async execute(args, exec) {
      const root = workspaceOf(exec);
      const entry = args.entry || args.target; if (!entry) throw new Error('context_compile requires entry or target');
      const result = await compileContext({ projectPath: root, graph: await loadGraph(root), entry, target: args.target || entry, task: args.task, tokenBudget: args.token_budget || config.tokenBudget, include: args.include || [], exclude: args.exclude || [] });
      return JSON.stringify(preview(result, args.include_content === true), null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_git_summary',
    description: 'Read concise Git status and recent relevant history from the current DSH workspace.',
    parameters: { target_path: { type: 'string', description: 'Optional module-relative file path.' } },
    async execute(args, exec) { return JSON.stringify(await gitSummary(workspaceOf(exec), args.target_path || ''), null, 2); },
  }));

  registerDependencyTools(ctx);

}

function registerDependencyTools(ctx) {
  const factsFor = async (exec, files = []) => analyzeDependencies(workspaceOf(exec), { files });
  const moduleTool = (name, description, execute) => ctx.tools.register(textTool({ name, description, parameters: {
    module: { type: 'string', required: true, description: 'Python module id from dependency_discover_modules.' },
  }, execute }));

  ctx.tools.register(textTool({
    name: 'dependency_discover_modules',
    description: 'Read Python modules and symbols using the Dependency Skill. This does not modify code or Context Graph.',
    parameters: { files: { type: 'array', items: { type: 'string' }, description: 'Optional changed project-relative Python files for incremental analysis.' } },
    async execute(args, exec) { const facts = await factsFor(exec, args.files || []); return JSON.stringify({ modules: discoverModules(facts), errors: facts.errors, analyzed_files: facts.analyzed_files }, null, 2); },
  }));
  moduleTool('dependency_analyze_module', 'Read a module, its code relationships, and its extracted interfaces.', async (args, exec) => JSON.stringify(analyzeModule(await factsFor(exec), args.module), null, 2));
  moduleTool('dependency_analyze_dependencies', 'Read outgoing dependency facts for a module, including evidence and confidence.', async (args, exec) => JSON.stringify(analyzeModuleDependencies(await factsFor(exec), args.module), null, 2));
  moduleTool('dependency_find_related_modules', 'Find direct callers and callees at module level without deciding context selection.', async (args, exec) => JSON.stringify(findRelatedModules(await factsFor(exec), args.module), null, 2));
  moduleTool('dependency_extract_interface', 'Extract public Python function and class contracts for a module.', async (args, exec) => JSON.stringify(extractInterface(await factsFor(exec), args.module), null, 2));
  moduleTool('dependency_propose_context_edges', 'Produce non-binding Context Graph edge proposals from internal dependency facts. Does not save anything.', async (args, exec) => JSON.stringify(proposeContextEdges(await factsFor(exec), args.module), null, 2));

  ctx.tools.register(textTool({
    name: 'dependency_find_callers', description: 'Find AST-confirmed callers of a symbol.', parameters: { symbol: { type: 'string', required: true, description: 'Qualified or suffix symbol name.' } },
    async execute(args, exec) { return JSON.stringify(findCallers(await factsFor(exec), args.symbol), null, 2); },
  }));
  ctx.tools.register(textTool({
    name: 'dependency_find_callees', description: 'Find AST-confirmed calls made by a function or method.', parameters: { symbol: { type: 'string', required: true, description: 'Qualified or suffix caller symbol name.' } },
    async execute(args, exec) { return JSON.stringify(findCallees(await factsFor(exec), args.symbol), null, 2); },
  }));
  ctx.tools.register(textTool({
    name: 'dependency_validate_relationship', description: 'Validate one Context Graph edge against current code facts; returns evidence and confidence only.', parameters: { source: { type: 'string', required: true }, target: { type: 'string', required: true } },
    async execute(args, exec) { return JSON.stringify(validateRelationship(await factsFor(exec), args), null, 2); },
  }));
  ctx.tools.register(textTool({
    name: 'dependency_check_consistency', description: 'Report missing, stale, protected, and force-exclude conflict edges. Never changes Context Graph.', parameters: {},
    async execute(_args, exec) { const root = workspaceOf(exec); return JSON.stringify(checkConsistency(await factsFor(exec), await loadGraph(root)), null, 2); },
  }));
  ctx.tools.register(textTool({
    name: 'dependency_detect_changes', description: 'Compare a previous Dependency Skill JSON result with current facts and return added/removed relationships.', parameters: { previous_facts_json: { type: 'string', required: true, description: 'Earlier complete Dependency Skill JSON result.' }, files: { type: 'array', items: { type: 'string' }, description: 'Optional changed files for incremental current analysis.' } },
    async execute(args, exec) { return JSON.stringify(detectGraphChanges(JSON.parse(args.previous_facts_json), await factsFor(exec, args.files || []), { files: args.files || [] }), null, 2); },
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
  const result = await compileContext({ projectPath: root, graph, entry: target, target, task, tokenBudget: config.tokenBudget, include: selected.include || [], exclude: selected.exclude || [] });
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
