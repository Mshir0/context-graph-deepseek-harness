import { isAgentLoopRequest as isDshAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  compileContext,
  ensureMemory,
  gitSummary,
  loadGraph,
  reconcileGraphs,
  saveGraph,
} from './core.js';
import { registerContextGraphRoutes } from './dsh-routes.js';
import { inferTarget, inferTurnExclusions, latestUserText, preview } from './dsh-context.js';
import {
  auditFinalRequest,
  ContextFirewallError,
  createContextAudit,
  createContextSnapshot,
  filterNewTurnMessages,
  inspectRawContext,
  messageFingerprints,
  placeContextSnapshot,
  validateCompiledContext,
} from './context-firewall.js';
import { contextRequest } from './context-provider.js';
import { analyzeContextProject, applyContextInvalidation } from './project-analysis.js';
import { resolveSessionContextSettings, updateSessionContextSettings } from './session-context.js';
import { applyExtraction, detectContextConflicts, extractContext } from './context-extraction.js';
import { applyFunctionalInference, inferFunctionalModules, mergeFunctionalNodes, splitFunctionalNode } from './semantic-functional.js';
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
export const inject = ['agents', 'sessions', 'tools', 'systemPrompt', 'llm'];

const DEFAULTS = {
  tokenBudget: 6000,
  requestTokenBudget: 64000,
  outputReserveTokens: 6000,
  tokenSafetyRatio: 1.15,
  allowedInstructionPlugins: [],
  autoScan: true,
  autoInject: true,
  webUi: true,
  firewallMode: 'enforce',
};

export function apply(ctx, input = {}) {
  const config = resolveConfig(input);
  const sessionState = new Map();
  const runtimeContextSuppressed = config.firewallMode === 'enforce' && typeof ctx.systemPrompt.suppressRuntimeContext === 'function';
  if (config.firewallMode === 'enforce' && !runtimeContextSuppressed) {
    throw new Error('context-graph enforce mode requires the DSH runtime Context suppression API');
  }
  if (runtimeContextSuppressed) ctx.systemPrompt.suppressRuntimeContext();

  registerTools(ctx, config, sessionState);

  ctx.systemPrompt.section({
    name: 'context-graph:policy',
    order: 99,
    text: 'Treat the Semantic Functional Graph as WHAT the system does and the Implementation Graph as HOW code realizes it. Use context_graph_scan for implementation changes and functional_infer only for reviewed Functional proposals. Never expose imports or calls as Functional edges. Use context_extract for durable structured knowledge. Compile from Task or Functional entries, resolve only relevant implementation mappings, and preserve MANUAL, FORCE_INCLUDE, and FORCE_EXCLUDE choices.',
  });

  ctx.on('agent/session-start', ({ agent }) => {
    const key = String(agent.session.id);
    sessionState.set(key, { ...(sessionState.get(key) || {}), agent, projectPath: agent.session.header?.cwd || '' });
    agent.ctx.effect(() => () => sessionState.delete(key), 'contextGraph.disposeSession()');
  });

  ctx.on('agent/pre-step', async ({ agent, signal, turn, step }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || signal.aborted) return decision;
    const key = String(agent.session.id);
    const state = sessionState.get(key) || {};
    const settings = resolveSessionContextSettings(state, config);
    if (config.firewallMode === 'off') return decision;
    if (!settings.autoInject) {
      if (config.firewallMode !== 'enforce') {
        sessionState.set(key, { ...state, firewallTurnKey: null, lastCompilation: null, lastAudit: { version: 1, status: 'disabled', mode: config.firewallMode, reason: 'Automatic Context Graph injection is disabled for this session.', runtimeContextSuppressed, stepMessages: decision.messages.length, allowedStepMessages: decision.messages.length, createdAt: new Date().toISOString() } });
        return decision;
      }
      const messages = filterNewTurnMessages(decision.messages, { allowedInstructionPlugins: config.allowedInstructionPlugins });
      const turnKey = firewallTurnKey(turn, decision.messages);
      const rawContext = inspectRawContext(agent.session, decision.messages);
      if (turnKey && state.firewallTurnKey === turnKey && state.lastCompilation?.graphInjection === 'disabled') {
        const previous = state.lastCompilation;
        const audit = { ...createContextAudit({ status: 'allowed', mode: config.firewallMode, turn, step, task: previous.task, target: previous.target, result: previous.result, validation: previous.validation, placement: { action: 'surface-reuse', surfaceNodesBefore: state.lastAudit?.surfaceNodesBefore }, raw: rawContext, stepMessages: decision.messages.length, allowedStepMessages: messages.length, expectedMessageFingerprints: expectedStepMessageFingerprints(agent.session, state.lastAudit, messages, { turn, step }) }), graphInjection: 'disabled', reason: 'Automatic Context Graph injection is disabled; the enforced snapshot contains no project graph context.' };
        sessionState.set(key, { ...state, lastAudit: audit });
        return { kind: 'enter', messages };
      }
      const task = latestUserText(messages);
      if (!task) {
        const error = 'No ordinary user task is available for the context-free Firewall snapshot';
        const audit = createContextAudit({ status: 'blocked', mode: config.firewallMode, turn, step, task: '', target: null, raw: rawContext, stepMessages: decision.messages.length, allowedStepMessages: messages.length, error });
        sessionState.set(key, { ...state, lastAudit: audit });
        return { kind: 'reject' };
      }
      const target = 'context.none';
      const result = contextFreeResult(task, settings.tokenBudget);
      const validation = { valid: true, errors: [], warnings: [] };
      const snapshot = createContextSnapshot(result, target, { mode: config.firewallMode });
      try {
        const placement = placeContextSnapshot(agent.session, snapshot, { mode: config.firewallMode });
        const audit = { ...createContextAudit({ status: 'allowed', mode: config.firewallMode, turn, step, task, target, result, validation, placement, raw: rawContext, stepMessages: decision.messages.length, allowedStepMessages: messages.length, expectedMessages: [snapshot, ...messages] }), graphInjection: 'disabled', reason: 'Automatic Context Graph injection is disabled; the enforced snapshot contains no project graph context.' };
        sessionState.set(key, { ...state, firewallTurnKey: turnKey, lastCompilation: { task, target, result, validation, graphInjection: 'disabled' }, lastAudit: audit });
        if (placement.action === 'prepend') return { kind: 'enter', messages: [snapshot, ...messages] };
        return { kind: 'enter', messages };
      } catch (error) {
        const audit = createContextAudit({ status: 'blocked', mode: config.firewallMode, turn, step, task, target, result, validation, raw: rawContext, stepMessages: decision.messages.length, allowedStepMessages: messages.length, error: error.message || String(error) });
        sessionState.set(key, { ...state, lastAudit: audit });
        ctx.logger.warn(`context-graph: context-free request blocked by Context Firewall: ${error.message || String(error)}`);
        return { kind: 'reject' };
      }
    }
    const turnKey = firewallTurnKey(turn, decision.messages);
    const allowedMessages = filterNewTurnMessages(decision.messages, { allowedInstructionPlugins: config.allowedInstructionPlugins });
    const rawContext = inspectRawContext(agent.session, decision.messages);
    if (turnKey && state.firewallTurnKey === turnKey) {
      if (config.firewallMode !== 'enforce') return decision;
      if (!state.lastCompilation || state.lastAudit?.status !== 'allowed') {
        const error = 'Context Firewall has no validated snapshot for this tool step';
        const audit = createContextAudit({ status: 'blocked', mode: config.firewallMode, turn, step, task: state.lastCompilation?.task || '', target: state.lastCompilation?.target || null, result: state.lastCompilation?.result, validation: state.lastCompilation?.validation, raw: { ...rawContext, graphRawTokens: state.lastCompilation?.result?.rawTokens || 0 }, stepMessages: decision.messages.length, allowedStepMessages: allowedMessages.length, error });
        sessionState.set(key, { ...state, lastAudit: audit });
        ctx.logger.warn(`context-graph: request blocked by Context Firewall: ${error}`);
        return { kind: 'reject' };
      }
      const previous = state.lastCompilation;
      const audit = createContextAudit({ status: 'allowed', mode: config.firewallMode, turn, step, task: previous.task, target: previous.target, result: previous.result, validation: previous.validation, placement: { action: 'surface-reuse', surfaceNodesBefore: state.lastAudit?.surfaceNodesBefore }, raw: { ...rawContext, graphRawTokens: previous.result.rawTokens || 0 }, stepMessages: decision.messages.length, allowedStepMessages: allowedMessages.length, expectedMessageFingerprints: expectedStepMessageFingerprints(agent.session, state.lastAudit, allowedMessages, { turn, step }) });
      sessionState.set(key, { ...state, lastAudit: audit });
      return { kind: 'enter', messages: allowedMessages };
    }
    const task = latestUserText(allowedMessages);
    let compiled;
    let validation;
    try {
      if (!task) throw new ContextFirewallError('No ordinary user task is available after Context Firewall filtering', 'CONTEXT_TASK_REQUIRED');
      compiled = await compileStepContext(agent, task, config, settings, signal);
      validation = await validateCompiledContext(compiled.result, {
        target: compiled.target,
        task,
        forceExclude: compiled.forceExclude,
        allowRawConversation: config.contextPolicy?.conversation?.enabled === true,
        validate: typeof config.validateContext === 'function' ? config.validateContext : undefined,
      });
      if (!validation.valid) throw new ContextFirewallError(validation.errors.join('; '), 'CONTEXT_VALIDATION_FAILED', { actionRequired: validation.actionRequired });
      if (signal.aborted) return decision;
      const reusableFingerprint = `${compiled.target}\0${compiled.result.reusableContextFingerprint || ''}`;
      const contextReused = settings.reuseContext === true
        && state.reusableFingerprint === reusableFingerprint
        && state.lastCompilation?.snapshot;
      const snapshot = contextReused
        ? state.lastCompilation.snapshot
        : createContextSnapshot(compiled.result, compiled.target, { mode: config.firewallMode });
      const placement = {
        ...placeContextSnapshot(agent.session, snapshot, { mode: config.firewallMode }),
        reused: Boolean(contextReused),
      };
      const outputMessages = config.firewallMode === 'enforce' ? allowedMessages : decision.messages;
      const audit = createContextAudit({ status: 'allowed', mode: config.firewallMode, turn, step, task, target: compiled.target, result: compiled.result, validation, placement, raw: { ...rawContext, graphRawTokens: compiled.result.rawTokens || 0 }, stepMessages: decision.messages.length, allowedStepMessages: outputMessages.length, expectedMessages: [snapshot, ...outputMessages] });
      sessionState.set(key, {
        ...state,
        target: compiled.target,
        firewallTurnKey: turnKey,
        fingerprint: audit.compiledFingerprint,
        reusableFingerprint,
        lastCompilation: { task, target: compiled.target, result: compiled.result, validation, snapshot },
        lastAudit: audit,
      });
      if (placement.action === 'prepend' || placement.action === 'audit-prepend') return { kind: 'enter', messages: [snapshot, ...outputMessages] };
      return { kind: 'enter', messages: outputMessages };
    } catch (error) {
      const blockedValidation = validation || {
        valid: false,
        errors: [error.message || String(error)],
        warnings: [],
        details: [{ code: error.code || 'CONTEXT_FIREWALL_BLOCKED', message: error.message || String(error) }],
        actionRequired: Array.isArray(error.actionRequired) ? error.actionRequired : [],
      };
      const audit = createContextAudit({ status: 'blocked', mode: config.firewallMode, turn, step, task, target: compiled?.target || null, result: compiled?.result, validation: blockedValidation, raw: { ...rawContext, graphRawTokens: compiled?.result?.rawTokens || 0 }, stepMessages: decision.messages.length, allowedStepMessages: allowedMessages.length, error: error.message || String(error) });
      sessionState.set(key, { ...state, lastAudit: audit });
      ctx.logger.warn(`context-graph: request blocked by Context Firewall: ${error.message || String(error)}`);
      return config.firewallMode === 'enforce' ? { kind: 'reject' } : decision;
    }
  }, { prepend: true });

  ctx.on('llm/stream', (options, next) => {
    if (!isAgentLoopRequest(options) || config.firewallMode === 'off') return next();
    const key = String(options.sessionId);
    const state = sessionState.get(key);
    const previousAudit = state?.lastAudit || createContextAudit({
      status: 'blocked',
      mode: config.firewallMode,
      error: 'Context Firewall has no pre-step audit for this Agent request',
    });
    const audit = auditFinalRequest(previousAudit, options, {
      enforce: config.firewallMode === 'enforce',
      requestTokenBudget: config.requestTokenBudget,
      outputReserveTokens: config.outputReserveTokens,
      tokenSafetyRatio: config.tokenSafetyRatio,
      authorizedRequestHeader: requestHeaderOf(state?.agent?.session),
    });
    sessionState.set(key, { ...(state || {}), lastAudit: audit });
    if (config.firewallMode === 'enforce' && !audit.validation.valid) {
      ctx.logger.warn(`context-graph: final LLM request blocked by Context Firewall: ${audit.error}`);
      throw new ContextFirewallError(audit.error, 'CONTEXT_FINAL_PAYLOAD_BLOCKED');
    }
    return next();
  }, { global: true, prepend: true });

  if (config.webUi) {
    ctx.inject(['webServer', 'workspaceRegistry'], webCtx => {
      webCtx.effect(() => registerContextGraphRoutes(webCtx, config, sessionState), 'context-graph: Harness web routes');
    });
  }
}

export function isAgentLoopRequest(options) {
  return isDshAgentLoopRequest(options);
}

function resolveConfig(input) {
  const config = { ...DEFAULTS, ...input };
  if (!Number.isInteger(config.tokenBudget) || config.tokenBudget < 1000) throw new Error('context-graph tokenBudget must be an integer >= 1000');
  if (!Number.isInteger(config.requestTokenBudget) || config.requestTokenBudget < 1000) throw new Error('context-graph requestTokenBudget must be an integer >= 1000');
  if (!Number.isInteger(config.outputReserveTokens) || config.outputReserveTokens < 0) throw new Error('context-graph outputReserveTokens must be an integer >= 0');
  if (!Number.isFinite(config.tokenSafetyRatio) || config.tokenSafetyRatio < 1 || config.tokenSafetyRatio > 2) throw new Error('context-graph tokenSafetyRatio must be from 1 to 2');
  if (config.tokenBudget + config.outputReserveTokens > config.requestTokenBudget) throw new Error('context-graph requestTokenBudget must cover tokenBudget plus outputReserveTokens');
  if (!Array.isArray(config.allowedInstructionPlugins) || config.allowedInstructionPlugins.some(value => typeof value !== 'string' || !value)) throw new Error('context-graph allowedInstructionPlugins must be an array of plugin ids');
  for (const key of ['autoScan', 'autoInject', 'webUi']) if (typeof config[key] !== 'boolean') throw new Error(`context-graph ${key} must be boolean`);
  if (!['enforce', 'audit', 'off'].includes(config.firewallMode)) throw new Error('context-graph firewallMode must be enforce, audit, or off');
  return config;
}

function registerTools(ctx, config, sessionState) {
  ctx.tools.register(textTool({
    name: 'context_graph_scan',
    description: 'Analyze the current DSH workspace, initialize .context memory, and report Code Graph versus Context Graph drift. Suggestions are not applied automatically.',
    parameters: {},
    async execute(_args, exec) {
      const root = workspaceOf(exec);
      const analysis = await analyzeContextProject(root);
      const result = reconcileGraphs(analysis.facts, await loadGraph(root));
      if (analysis.previousCache) result.graph = applyContextInvalidation(result.graph, analysis.invalidation);
      await ensureMemory(root, result.graph);
      await saveGraph(root, result.graph);
      return JSON.stringify({ modules: result.codeGraph.modules.length, removed: result.removed, stale: result.stale, invalidation: analysis.invalidation, analyzerErrors: result.codeGraph.errors, suggestions: result.suggestions }, null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'functional_infer',
    description: 'Infer non-binding Functional Node and Functional-to-Implementation mapping proposals from implementation dependency facts. Code calls are never directly exposed as semantic edges.',
    parameters: { apply: { type: 'boolean', description: 'Persist inferred functional nodes, mappings, and semantic edge proposals after review.' } },
    async execute(args, exec) {
      const root = workspaceOf(exec); const graph = await loadGraph(root); const analysis = await analyzeContextProject(root, { persistCache: args.apply === true }); const facts = analysis.dependencyFacts; let implementationGraph = reconcileGraphs(analysis.facts, graph, { prune: false }).graph;
      if (analysis.previousCache) implementationGraph = applyContextInvalidation(implementationGraph, analysis.invalidation);
      const proposal = inferFunctionalModules(implementationGraph, facts);
      if (args.apply === true) { const saved = await saveGraph(root, applyFunctionalInference(implementationGraph, proposal)); return JSON.stringify({ applied: true, proposal, graph: saved }, null, 2); }
      return JSON.stringify({ applied: false, proposal }, null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'functional_map_implementation', description: 'Save one approved many-to-many Functional to Implementation mapping. This changes graph metadata only, never source code.', parameters: { functional: { type: 'string', required: true }, implementation_ids: { type: 'array', items: { type: 'string' }, required: true }, mode: { type: 'string', description: 'MANUAL by default.' } },
    async execute(args, exec) { const root = workspaceOf(exec); const graph = await loadGraph(root); if (!graph.nodes.some(node => node.id === args.functional && node.type === 'functional')) throw new Error(`Unknown functional node: ${args.functional}`); for (const id of args.implementation_ids) if (!graph.nodes.some(node => node.id === id)) throw new Error(`Unknown implementation node: ${id}`); graph.mappings.push({ functional: args.functional, implementation: args.implementation_ids.map(id => { const node = graph.nodes.find(item => item.id === id); return { id, path: node.path || '' }; }), confidence: 1, created_by: 'user', mode: args.mode || 'MANUAL' }); return JSON.stringify(await saveGraph(root, graph), null, 2); },
  }));

  ctx.tools.register(textTool({
    name: 'functional_merge', description: 'Merge approved Functional Nodes and their implementation mappings without modifying source code.', parameters: { source_ids: { type: 'array', items: { type: 'string' }, required: true }, merged_node_json: { type: 'string', required: true } },
    async execute(args, exec) { const root = workspaceOf(exec); return JSON.stringify(await saveGraph(root, mergeFunctionalNodes(await loadGraph(root), args.source_ids, JSON.parse(args.merged_node_json))), null, 2); },
  }));

  ctx.tools.register(textTool({
    name: 'functional_split', description: 'Split one approved Functional Node into semantic nodes with selected implementation mappings without modifying source code.', parameters: { source_id: { type: 'string', required: true }, splits_json: { type: 'string', required: true, description: 'Array of Functional Nodes with implementation id arrays.' } },
    async execute(args, exec) { const root = workspaceOf(exec); return JSON.stringify(await saveGraph(root, splitFunctionalNode(await loadGraph(root), args.source_id, JSON.parse(args.splits_json))), null, 2); },
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
      const patch = { target: args.target };
      if (args.include !== undefined) patch.include = args.include;
      if (args.exclude !== undefined) patch.exclude = args.exclude;
      return JSON.stringify(updateSessionContextSettings(sessionState, sessionKey(exec), patch, config), null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_session_config',
    description: 'Configure automatic Context Graph injection only for the current DSH session. This does not modify the project graph or source code.',
    parameters: {
      auto_inject: { type: 'boolean', description: 'Enable or disable automatic context injection for this session.' },
      token_budget: { type: 'integer', description: 'Per-injection token budget, at least 1000.' },
      reuse_context: { type: 'boolean', description: 'Reuse unchanged compiled context across consecutive tasks in the same target.' },
      max_implementation_files: { type: 'integer', description: 'Limit mapped implementation files included for each Functional Node, from 1 to 5.' },
      semantic_depth: { type: 'integer', description: 'Limit semantic graph traversal depth, from 1 to 3.' },
      include: { type: 'array', items: { type: 'string' }, description: 'Temporary force-included node ids for this session.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Temporary force-excluded node ids for this session.' },
    },
    async execute(args, exec) {
      const patch = {};
      if (args.auto_inject !== undefined) patch.autoInject = args.auto_inject;
      if (args.token_budget !== undefined) patch.tokenBudget = args.token_budget;
      if (args.reuse_context !== undefined) patch.reuseContext = args.reuse_context;
      if (args.max_implementation_files !== undefined) patch.maxImplementationFiles = args.max_implementation_files;
      if (args.semantic_depth !== undefined) patch.semanticDepth = args.semantic_depth;
      if (args.include !== undefined) patch.include = args.include;
      if (args.exclude !== undefined) patch.exclude = args.exclude;
      return JSON.stringify(updateSessionContextSettings(sessionState, sessionKey(exec), patch, config), null, 2);
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
      max_implementation_files: { type: 'integer', description: 'Override the mapped implementation file limit for this preview.' },
      semantic_depth: { type: 'integer', description: 'Override semantic traversal depth for this preview.' },
      include: { type: 'array', items: { type: 'string' }, description: 'Additional force-included modules.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Force-excluded modules.' },
      include_content: { type: 'boolean', description: 'Include the compiled context text in the result.' },
    },
    async execute(args, exec) {
      const root = workspaceOf(exec);
      const entry = args.entry || args.target; if (!entry) throw new Error('context_compile requires entry or target');
      const selected = resolveSessionContextSettings(sessionState.get(sessionKey(exec)), config);
      const result = await compileContext({ projectPath: root, graph: await loadGraph(root), entry, target: args.target || entry, task: args.task, tokenBudget: args.token_budget ?? selected.tokenBudget, maxImplementationFiles: args.max_implementation_files ?? selected.maxImplementationFiles, semanticDepth: args.semantic_depth ?? selected.semanticDepth, include: args.include ?? selected.include, exclude: args.exclude ?? selected.exclude, policy: config.contextPolicy });
      return JSON.stringify(preview(result, args.include_content === true), null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_request',
    description: 'Load additional bounded context for one Functional or Implementation target only when the current task needs it. Does not traverse unrelated implementation dependencies.',
    parameters: {
      target: { type: 'string', required: true, description: 'Functional node, implementation module, or qualified symbol id.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'Requested scopes such as interface, implementation, symbol, test, or documentation.' },
      reason: { type: 'string', required: true, description: 'Why the current task needs this additional context.' },
      max_tokens: { type: 'integer', description: 'Hard response budget. Defaults to 3000 tokens.' },
    },
    async execute(args, exec) {
      const root = workspaceOf(exec);
      const graph = await loadGraph(root);
      const analysis = await analyzeContextProject(root, { persistCache: false });
      const selected = resolveSessionContextSettings(sessionState.get(sessionKey(exec)), config);
      const forceExclude = [...new Set([...(graph.overrides?.exclude || []), ...selected.exclude, ...graph.nodes.filter(node => node.mode === 'FORCE_EXCLUDE').map(node => node.id)])];
      const response = await contextRequest({ target: args.target, scope: args.scope, reason: args.reason, maxTokens: args.max_tokens }, { projectPath: root, graph, facts: analysis.facts, forceExclude });
      return JSON.stringify(response, null, 2);
    },
  }));

  ctx.tools.register(textTool({
    name: 'context_audit',
    description: 'Read the latest Context Firewall decision and compiled-context audit for this DSH session.',
    parameters: {},
    async execute(_args, exec) {
      const audit = sessionState.get(sessionKey(exec))?.lastAudit;
      return JSON.stringify(audit || { status: 'unavailable', reason: 'No Context Firewall turn has been audited yet.' }, null, 2);
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

function contextFreeResult(task, tokenBudget) {
  return {
    target: 'context.none',
    task,
    tokenBudget,
    estimatedTokens: 0,
    overBudget: false,
    valid: true,
    included: [],
    excluded: [],
    context: '',
    rawTokens: 0,
    candidateTokens: 0,
    excludedTokens: 0,
    reusableContextFingerprint: 'context-free',
  };
}

async function compileStepContext(agent, task, config, selected, signal) {
  const root = agent.session.header?.cwd || process.cwd();
  let graph = await loadGraph(root);
  if (graph.nodes.length === 0 && config.autoScan) {
    const analysis = await analyzeContextProject(root);
    const result = reconcileGraphs(analysis.facts, graph);
    if (analysis.previousCache) result.graph = applyContextInvalidation(result.graph, analysis.invalidation);
    graph = result.graph;
    await ensureMemory(root, graph);
    await saveGraph(root, graph);
  }
  if (signal.aborted) throw new ContextFirewallError('Context compilation was aborted', 'CONTEXT_ABORTED');
  if (graph.nodes.length === 0) throw new ContextFirewallError('Context Graph has no nodes', 'CONTEXT_GRAPH_EMPTY');
  const turnExclusions = inferTurnExclusions(task, graph.nodes);
  if (turnExclusions.ambiguous.length) {
    const candidates = [...new Set(turnExclusions.ambiguous.flatMap(item => item.candidates))];
    const aliases = turnExclusions.ambiguous.map(item => item.alias);
    const message = `Force Exclude is ambiguous for ${aliases.join(', ')}. Select an exact Context Graph node before retrying.`;
    throw new ContextFirewallError(message, 'CONTEXT_FORCE_EXCLUDE_AMBIGUOUS', {
      actionRequired: [{
        type: 'clarify_force_exclude_target',
        aliases,
        candidates,
        message,
        options: candidates.map(id => ({ id, label: `Exclude ${id}` })),
      }],
    });
  }
  const effectiveExclude = [...new Set([...selected.exclude, ...turnExclusions.exclude])];
  const target = selected.target && graph.nodes.some(node => node.id === selected.target)
    ? selected.target
    : inferTarget(task, graph.nodes, { exclude: effectiveExclude });
  if (target === null) throw new ContextFirewallError('Unable to infer a Context Graph target; select a task target before retrying', 'CONTEXT_TARGET_REQUIRED');
  const result = await compileContext({ projectPath: root, graph, entry: target, target, task, tokenBudget: selected.tokenBudget, maxImplementationFiles: selected.maxImplementationFiles, semanticDepth: selected.semanticDepth, include: selected.include, exclude: effectiveExclude, policy: config.contextPolicy });
  const forceExclude = [...new Set([
    ...(graph.overrides?.exclude || []),
    ...effectiveExclude,
    ...graph.nodes.filter(node => node.mode === 'FORCE_EXCLUDE').map(node => node.id),
  ])];
  return { result, target, forceExclude, turnExclusions: turnExclusions.exclude };
}

function firewallTurnKey(turn, messages) {
  if (Number.isInteger(turn) || typeof turn === 'string') return `turn:${turn}`;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || ['plugin', 'tool'].includes(message?.source?.kind)) continue;
    if (message.id) return `message:${message.id}`;
    const text = latestUserText([message]);
    if (text) return `task:${text}`;
  }
  return null;
}

function projectedSurfaceEvents(session) {
  const nodes = session?.surface?.nodes;
  if (!nodes || typeof nodes[Symbol.iterator] !== 'function' || !Array.isArray(session?.events)) return null;
  const events = new Map(session.events.map(event => [event.seq, event]));
  const projected = [];
  for (const seq of nodes) {
    const event = events.get(seq);
    if (!event) return null;
    let message = null;
    if (event.type === 'user/message') message = event.data;
    else if (event.type === 'assistant/message' && event.data?.message?.content?.length) message = event.data.message;
    else if (event.type === 'tool/result') message = event.data?.message;
    if (message) projected.push({ event, message });
  }
  return { events, projected };
}

function isTrustedAgentStepTail(event, events, turn, step) {
  if (!Number.isInteger(turn) || !Number.isInteger(step) || event?.surfaceOp !== 'append') return false;
  if (event.data?.turn !== turn || !Number.isInteger(event.data?.step) || event.data.step >= step) return false;
  if (event.type === 'assistant/message') {
    return event.data.message?.role === 'assistant'
      && event.data.message?.source?.kind === 'model'
      && Array.isArray(event.sourceEventSeqs);
  }
  if (event.type !== 'tool/result' || event.data.message?.source?.kind !== 'tool') return false;
  if (!Array.isArray(event.sourceEventSeqs) || event.sourceEventSeqs.length !== 1) return false;
  const call = events.get(event.sourceEventSeqs[0]);
  return call?.type === 'tool/call'
    && call.data?.turn === turn
    && call.data?.step === event.data.step
    && call.data?.callId === event.data.message.source.callId;
}

function expectedStepMessageFingerprints(session, previousAudit, messages, { turn, step } = {}) {
  const previous = Array.isArray(previousAudit?.expectedMessageFingerprints) ? previousAudit.expectedMessageFingerprints : [];
  const surface = projectedSurfaceEvents(session);
  const visible = surface?.projected.map(item => item.message) || [];
  const visibleFingerprints = messageFingerprints(visible);
  const extendsPrevious = visibleFingerprints.length >= previous.length
    && previous.every((fingerprint, index) => visibleFingerprints[index] === fingerprint);
  const tailIsCurrentAgentOutput = extendsPrevious && surface !== null
    && surface.projected.slice(previous.length).every(item => isTrustedAgentStepTail(item.event, surface.events, turn, step));
  return [...(tailIsCurrentAgentOutput ? visibleFingerprints : previous), ...messageFingerprints(messages)];
}

function workspaceOf(exec) {
  const cwd = exec.agent?.session?.header?.cwd;
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('Context Graph requires a DSH session workspace');
  return cwd;
}

function requestHeaderOf(session) {
  try { return typeof session?.requestHeader === 'function' ? session.requestHeader() : null; }
  catch { return null; }
}
function sessionKey(exec) {
  if (!exec.agent?.session?.id) throw new Error('Context Graph requires a calling DSH agent');
  return String(exec.agent.session.id);
}
