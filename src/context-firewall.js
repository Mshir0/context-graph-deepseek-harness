import { createHash } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { estimateContextTokens } from './context-policy.js';

const IMAGE_TOKEN_PLACEHOLDER = 'x'.repeat(4096);

export class ContextFirewallError extends Error {
  constructor(message, code = 'CONTEXT_FIREWALL_BLOCKED', { actionRequired = [] } = {}) {
    super(message);
    this.name = 'ContextFirewallError';
    this.code = code;
    this.actionRequired = actionRequired;
  }
}

function asMessages(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function validationMessages(value, fallback) {
  return asMessages(value).map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item.message === 'string') return item.message;
    if (item && typeof item.reason === 'string') return item.reason;
    return fallback;
  });
}

function mergeValidation(target, value) {
  if (value === false) { target.errors.push('Compiled context validation failed'); return; }
  if (!value || value === true || typeof value !== 'object') return;
  if (value.valid === false && !value.errors?.length) target.errors.push('Compiled context validation failed');
  target.details.push(...asMessages(value.errors).filter(item => item && typeof item === 'object'));
  target.errors.push(...validationMessages(value.errors, 'Compiled context validation failed'));
  target.warnings.push(...validationMessages(value.warnings, 'Compiled context validation warning'));
  target.actionRequired.push(...asMessages(value.actionRequired).filter(item => item && typeof item === 'object'));
}

function itemId(item) {
  return item?.node || item?.module || item?.id || null;
}

export async function validateCompiledContext(result, options = {}) {
  const validation = { valid: true, errors: [], warnings: [], details: [], actionRequired: [] };
  if (!result || typeof result !== 'object') {
    validation.errors.push('Context Compiler returned no result');
    validation.valid = false;
    return validation;
  }
  if (typeof result.context !== 'string') validation.errors.push('Compiled context text is missing');
  if (!Number.isFinite(result.estimatedTokens) || result.estimatedTokens < 0) validation.errors.push('Compiled token estimate is invalid');
  if (!Number.isInteger(result.tokenBudget) || result.tokenBudget < 1) validation.errors.push('Context token budget is invalid');
  if (result.overBudget === true || (Number.isFinite(result.estimatedTokens) && result.estimatedTokens > result.tokenBudget)) validation.errors.push('Compiled context exceeds the token budget');

  const forceExclude = new Set((options.forceExclude || []).filter(value => typeof value === 'string'));
  if (options.target && forceExclude.has(options.target)) {
    const message = `Current target is force-excluded: ${options.target}. Confirm whether to remove the exclusion and retry, or keep it and cancel this task.`;
    validation.errors.push(message);
    validation.details.push({ code: 'FORCE_EXCLUDE_TARGET_CONFLICT', node: options.target, message });
    validation.actionRequired.push({
      type: 'resolve_force_exclude_target_conflict',
      nodes: [options.target],
      message,
      options: [
        { id: 'remove_exclusion_and_retry', label: 'Remove Force Exclude and retry' },
        { id: 'keep_exclusion_and_cancel', label: 'Keep Force Exclude and cancel this task' },
      ],
    });
  }
  const included = Array.isArray(result.included) ? result.included : [];
  for (const item of included) {
    const id = itemId(item);
    if (id && forceExclude.has(id)) validation.errors.push(`Force-excluded context was selected: ${id}`);
    if ((item?.nodeType === 'conversation' || item?.raw === true) && options.allowRawConversation !== true && item?.forceInclude !== true) validation.errors.push(`Raw conversation was selected: ${id || 'unknown'}`);
  }
  const keys = included.map(item => `${itemId(item) || ''}\0${item?.scope || ''}\0${item?.label || ''}`);
  if (new Set(keys).size !== keys.length) validation.errors.push('Compiled context contains duplicate entries');

  mergeValidation(validation, result.validation);
  if (typeof options.validate === 'function') {
    try { mergeValidation(validation, await options.validate(result, options)); }
    catch (error) { validation.errors.push(`Context validation failed: ${error.message || String(error)}`); }
  }
  validation.errors = [...new Set(validation.errors)];
  validation.warnings = [...new Set(validation.warnings)];
  validation.details = [...new Map(validation.details.map(item => [`${item.code || ''}\0${item.node || ''}\0${(item.nodes || []).join('\0')}\0${item.message || ''}`, item])).values()];
  validation.actionRequired = [...new Map(validation.actionRequired.map(item => [`${item.type || ''}\0${(item.nodes || []).join('\0')}\0${item.message || ''}`, item])).values()];
  validation.valid = validation.errors.length === 0;
  return validation;
}

export function contextWithoutCurrentTask(context, task = '') {
  const value = String(context || '');
  const currentTask = String(task || '').trim();
  if (currentTask) {
    const renderedTask = `## User task\n\n${currentTask}`;
    const index = value.indexOf(renderedTask);
    if (index >= 0) {
      const before = value.slice(0, index).replace(/\s+$/, '');
      const after = value.slice(index + renderedTask.length).replace(/^\s+/, '');
      return [before, after].filter(Boolean).join('\n\n');
    }
  }
  return value
    .split(/\n\n(?=## )/)
    .filter(section => !/^## User task(?:\s|$)/.test(section))
    .join('\n\n')
    .trim();
}

export function filterNewTurnMessages(messages, { allowedInstructionPlugins = [] } = {}) {
  const trustedInstructionPlugins = new Set(allowedInstructionPlugins);
  const sourceMessages = messages || [];
  let latestOrdinaryUser = -1;
  for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
    const message = sourceMessages[index];
    if (message?.role !== 'user') continue;
    const kind = message?.source?.kind;
    if (kind !== 'plugin' && kind !== 'tool' && kind !== 'client-input') {
      latestOrdinaryUser = index;
      break;
    }
  }
  return sourceMessages.filter((message, index) => {
    if (message?.source?.form === 'instructions') {
      return message?.source?.kind !== 'plugin' || trustedInstructionPlugins.has(message.source.plugin);
    }
    if (message?.role !== 'user') return false;
    const kind = message?.source?.kind;
    // MessageSource is merge-extensible. Keep user-role messages from new
    // Harness producers; only explicit plugin messages are dynamic context
    // and must be denied unless their instruction producer is trusted.
    if (kind === 'plugin') return false;
    if (kind === 'tool' || kind === 'client-input') return true;
    return index === latestOrdinaryUser;
  });
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value).sort().filter(key => value[key] !== undefined);
    return `{${entries.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'bigint') return JSON.stringify(String(value));
  return JSON.stringify(value) ?? 'null';
}

export function messageFingerprint(message) {
  // Harness may add ids/timestamps while projecting a message into the final
  // LLM payload. Fingerprint semantic payload fields only, so projection
  // metadata cannot make a valid long user turn fail integrity validation.
  const stable = {
    role: message?.role,
    content: message?.content,
    source: message?.source ? {
      kind: message.source.kind,
      plugin: message.source.plugin,
      form: message.source.form,
      callId: message.source.callId,
    } : undefined,
  };
  return createHash('sha256').update(canonicalJson(stable)).digest('hex');
}

export function messageFingerprints(messages = []) {
  return asMessages(messages).map(messageFingerprint);
}

function messageListFingerprint(fingerprints) {
  return createHash('sha256').update(canonicalJson(fingerprints)).digest('hex');
}

function blockText(block) {
  if (!block || typeof block !== 'object') return String(block || '');
  if (block.type === 'text') return String(block.text || '');
  if (block.type === 'image') return IMAGE_TOKEN_PLACEHOLDER;
  try { return JSON.stringify(block); } catch { return String(block.type || 'content'); }
}

export function estimateMessagesTokens(messages = []) {
  return asMessages(messages).reduce((sum, message) => {
    const content = Array.isArray(message?.content) ? message.content.map(blockText).join('\n') : String(message?.content || '');
    return sum + estimateContextTokens(content) + 6;
  }, 0);
}

export function inspectRawContext(session, stepMessages = []) {
  let surfaceMessages = [];
  try {
    const derived = session?.deriveMessages?.();
    if (Array.isArray(derived)) surfaceMessages = derived;
  } catch { /* An unreadable Surface remains visible as an audit warning. */ }
  return {
    surfaceMessages: surfaceMessages.length,
    surfaceRawTokens: estimateMessagesTokens(surfaceMessages),
    stepMessages: asMessages(stepMessages).length,
    stepRawTokens: estimateMessagesTokens(stepMessages),
    surfaceReadable: typeof session?.deriveMessages === 'function',
  };
}

function isContextSnapshot(message) {
  if (message?.source?.kind !== 'plugin' || message.source.plugin !== 'context-graph') return false;
  const content = Array.isArray(message.content) ? message.content : [];
  return content.some(block => block?.type === 'text' && /^<context-graph(?:\s|>)/.test(String(block.text || '')));
}

function contextSnapshotText(message) {
  if (!isContextSnapshot(message)) return null;
  const block = message.content.find(item => item?.type === 'text' && /^<context-graph(?:\s|>)/.test(String(item.text || '')));
  return String(block?.text || '');
}

export function contextSnapshotFingerprint(message) {
  if (contextSnapshotText(message) === null) return null;
  return createHash('sha256').update(JSON.stringify(message.content || [])).digest('hex');
}

export function inspectFinalRequest(options = {}) {
  const messages = Array.isArray(options.messages) ? options.messages : [];
  const tools = Array.isArray(options.tools) ? options.tools : [];
  const system = String(options.system || '');
  const snapshots = messages.filter(isContextSnapshot);
  const fingerprints = messageFingerprints(messages);
  const unauthorizedPlugins = messages.filter(message => message?.source?.kind === 'plugin' && !isContextSnapshot(message) && message.source?.form !== 'instructions');
  const messageTokens = estimateMessagesTokens(messages);
  const systemTokens = estimateContextTokens(system);
  const toolTokens = estimateContextTokens(tools.length ? JSON.stringify(tools) : '');
  const systemFingerprint = createHash('sha256').update(system).digest('hex');
  const toolsFingerprint = createHash('sha256').update(canonicalJson(tools)).digest('hex');
  return {
    messageCount: messages.length,
    messageFingerprints: fingerprints,
    messagesFingerprint: messageListFingerprint(fingerprints),
    snapshotCount: snapshots.length,
    snapshotFingerprints: snapshots.map(contextSnapshotFingerprint),
    unauthorizedPluginCount: unauthorizedPlugins.length,
    messageTokens,
    systemTokens,
    toolTokens,
    finalTokens: messageTokens + systemTokens + toolTokens,
    systemFingerprint,
    toolsFingerprint,
    payloadFingerprint: createHash('sha256').update(canonicalJson({
      provider: options.provider,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stop: options.stop,
      systemFingerprint,
      messageFingerprints: fingerprints,
      toolsFingerprint,
    })).digest('hex'),
    tokenEstimate: 'heuristic',
  };
}

export function auditFinalRequest(previous, options = {}, {
  enforce = true,
  allowContextFree = false,
  requestTokenBudget = previous?.requestTokenBudget ?? null,
  outputReserveTokens = previous?.outputReserveTokens ?? 0,
  tokenSafetyRatio = previous?.tokenSafetyRatio ?? 1,
  authorizedRequestHeader = null,
} = {}) {
  const final = inspectFinalRequest(options);
  const authorized = authorizedRequestHeader && typeof authorizedRequestHeader === 'object'
    ? inspectFinalRequest({ system: authorizedRequestHeader.system, tools: authorizedRequestHeader.tools })
    : null;
  const errors = [];
  if (!allowContextFree && final.snapshotCount !== 1) errors.push(`Final request must contain exactly one Context Graph snapshot; found ${final.snapshotCount}`);
  if (final.snapshotCount === 1 && !previous?.snapshotFingerprint) errors.push('Context Firewall has no compiled snapshot fingerprint for this request');
  if (final.snapshotCount === 1 && previous?.snapshotFingerprint && final.snapshotFingerprints[0] !== previous.snapshotFingerprint) errors.push('Final Context Graph snapshot does not match the context compiled for this turn');
  if (!Array.isArray(previous?.expectedMessageFingerprints)) {
    errors.push('Context Firewall has no expected message list for this request');
  } else if (previous.expectedMessageFingerprints.length !== final.messageFingerprints.length
    || previous.expectedMessageFingerprints.some((fingerprint, index) => fingerprint !== final.messageFingerprints[index])) {
    errors.push('Final request message list does not match the messages authorized for this turn');
  }
  if (final.unauthorizedPluginCount > 0) errors.push(`Final request contains ${final.unauthorizedPluginCount} unauthorized dynamic plugin message(s)`);
  if (!authorized) {
    errors.push('Context Firewall has no authorized request-header baseline for system prompt and tool schemas');
  } else {
    if (final.systemFingerprint !== authorized.systemFingerprint) errors.push('Final system prompt does not match the authorized DSH request header');
    if (final.toolsFingerprint !== authorized.toolsFingerprint) errors.push('Final tool schemas do not match the authorized DSH request header');
  }
  const safetyRatio = Number.isFinite(tokenSafetyRatio) && tokenSafetyRatio >= 1 ? tokenSafetyRatio : 1;
  const configuredReserve = Number.isInteger(outputReserveTokens) && outputReserveTokens >= 0 ? outputReserveTokens : 0;
  const requestOutputLimit = Number.isInteger(options.maxTokens) && options.maxTokens > 0 ? options.maxTokens : 0;
  const outputReserve = Math.max(configuredReserve, requestOutputLimit);
  const guardedInputTokens = Math.ceil(final.finalTokens * safetyRatio);
  const finalEstimatedTotalTokens = guardedInputTokens + outputReserve;
  if (requestTokenBudget !== null && (!Number.isInteger(requestTokenBudget) || requestTokenBudget < 1)) {
    errors.push('Final request token budget is invalid');
  } else if (requestTokenBudget !== null && finalEstimatedTotalTokens > requestTokenBudget) {
    errors.push(`Final request estimate uses ${guardedInputTokens} input tokens plus ${outputReserve} reserved output tokens, above the ${requestTokenBudget} token budget`);
  }
  const priorValidation = previous?.validation || { valid: true, errors: [], warnings: [] };
  const validation = {
    ...priorValidation,
    errors: [...new Set([...(priorValidation.errors || []), ...errors])],
    warnings: [...new Set(priorValidation.warnings || [])],
  };
  validation.valid = validation.errors.length === 0;
  return {
    ...previous,
    status: enforce && errors.length ? 'blocked' : previous?.status,
    finalTokens: final.finalTokens,
    finalTokenScope: 'heuristic input estimate of llm/stream system + messages + tool schemas',
    requestTokenBudget,
    outputReserveTokens: outputReserve,
    tokenSafetyRatio: safetyRatio,
    guardedInputTokens,
    finalEstimatedTotalTokens,
    requestBudgetExceeded: requestTokenBudget !== null && finalEstimatedTotalTokens > requestTokenBudget,
    finalMessageCount: final.messageCount,
    expectedMessageCount: Array.isArray(previous?.expectedMessageFingerprints) ? previous.expectedMessageFingerprints.length : null,
    expectedMessagesFingerprint: previous?.expectedMessagesFingerprint || null,
    finalMessagesFingerprint: final.messagesFingerprint,
    finalSnapshotCount: final.snapshotCount,
    finalSnapshotFingerprint: final.snapshotFingerprints.length === 1 ? final.snapshotFingerprints[0] : null,
    finalUnauthorizedPluginCount: final.unauthorizedPluginCount,
    finalSystemTokens: final.systemTokens,
    finalMessageTokens: final.messageTokens,
    finalToolTokens: final.toolTokens,
    finalSystemFingerprint: final.systemFingerprint,
    finalToolsFingerprint: final.toolsFingerprint,
    expectedSystemFingerprint: authorized?.systemFingerprint ?? null,
    expectedToolsFingerprint: authorized?.toolsFingerprint ?? null,
    finalPayloadFingerprint: final.payloadFingerprint,
    finalTokenEstimate: final.tokenEstimate,
    validation,
    auditedAt: new Date().toISOString(),
    ...(errors.length ? { error: errors.join('; ') } : {}),
  };
}

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

export function createContextSnapshot(result, target, { mode = 'enforce' } = {}) {
  const context = contextWithoutCurrentTask(result.context, result.task);
  const firewall = mode === 'enforce' ? 'enforced' : 'audit';
  const text = `<context-graph target="${escapeAttribute(target)}" estimated-tokens="${estimateContextTokens(context)}" firewall="${firewall}">\n${context}\n</context-graph>`;
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'context-graph', form: 'recall' },
  });
}

function knownEmptyHistory(session) {
  try {
    if (typeof session?.deriveMessages === 'function') {
      const messages = session.deriveMessages();
      if (Array.isArray(messages)) {
        if (messages.length === 0) return true;
        // Harness may expose runtime/plugin instructions before the first
        // user turn. They are not conversational history and do not require
        // a Surface replacement for the first Context snapshot.
        return !messages.some(message => (
          message?.role === 'assistant'
          || message?.role === 'tool'
          || (message?.role === 'user' && (
            message?.source?.kind !== 'plugin'
            || message?.source?.plugin === 'context-graph'
          ))
        ));
      }
    }
  } catch { /* Treat an unreadable projection as unknown. */ }
  return Array.isArray(session?.events) && session.events.length === 0;
}

export function inspectSessionSurface(session) {
  const source = session?.surface?.nodes;
  if (source && typeof source[Symbol.iterator] === 'function') {
    return { known: true, nodes: [...source], canReplace: typeof session.append === 'function' };
  }
  if (knownEmptyHistory(session)) return { known: true, nodes: [], canReplace: false };
  return { known: false, nodes: [], canReplace: false };
}

export function placeContextSnapshot(session, snapshot, { mode = 'enforce' } = {}) {
  const surface = inspectSessionSurface(session);
  if (mode === 'audit') {
    return {
      action: 'audit-prepend',
      surfaceNodesBefore: surface.known ? surface.nodes.length : null,
      warning: 'Audit mode leaves the existing Session Surface unchanged',
    };
  }
  if (surface.known && surface.nodes.length === 0) return { action: 'prepend', surfaceNodesBefore: 0 };
  if (surface.known && surface.nodes.length > 0 && surface.canReplace) {
    const sourceEventSeqs = [...surface.nodes];
    const event = session.append('user/message', snapshot, {
      surfaceOp: { op: 'replace', start: sourceEventSeqs[0], end: sourceEventSeqs.at(-1) },
      sourceEventSeqs,
    });
    return { action: 'surface-replace', surfaceNodesBefore: sourceEventSeqs.length, replacementSeq: event?.seq };
  }
  throw new ContextFirewallError('Session Surface replacement API is unavailable for existing or unknown history', 'CONTEXT_SURFACE_UNAVAILABLE');
}

export function createContextAudit({ status, mode, turn, step, task, target, result, validation, placement, raw, stepMessages = 0, allowedStepMessages = stepMessages, expectedMessages, expectedMessageFingerprints, requestTokenBudget = null, outputReserveTokens = null, tokenSafetyRatio = null, error }) {
  const included = Array.isArray(result?.included) ? result.included : [];
  const excluded = Array.isArray(result?.excluded) ? result.excluded : [];
  const fingerprint = result && typeof result.context === 'string'
    ? createHash('sha256').update(`${target || ''}\0${result.context}`).digest('hex')
    : null;
  const snapshotFingerprint = result && typeof result.context === 'string'
    ? contextSnapshotFingerprint(createContextSnapshot(result, target, { mode }))
    : null;
  const expectedFingerprints = Array.isArray(expectedMessageFingerprints)
    ? [...expectedMessageFingerprints]
    : Array.isArray(expectedMessages) ? messageFingerprints(expectedMessages) : null;
  return {
    version: 1,
    status,
    mode,
    turn: Number.isInteger(turn) ? turn : null,
    step: Number.isInteger(step) ? step : null,
    task,
    target,
    budget: result?.tokenBudget ?? null,
    budgetScope: 'selected Context Graph entries only; excludes system prompt, current-step messages, and tool schemas',
    requestTokenBudget,
    outputReserveTokens,
    tokenSafetyRatio,
    graphRawTokens: raw?.graphRawTokens ?? result?.rawTokens ?? result?.manifest?.rawTokens ?? 0,
    surfaceRawTokens: raw?.surfaceRawTokens ?? 0,
    stepRawTokens: raw?.stepRawTokens ?? 0,
    rawTokens: (raw?.graphRawTokens ?? result?.rawTokens ?? result?.manifest?.rawTokens ?? 0) + (raw?.surfaceRawTokens ?? 0) + (raw?.stepRawTokens ?? 0),
    rawTokenScope: 'graph raw nodes + pre-replacement Session Surface + current pre-step messages; components may overlap',
    candidateTokens: result?.candidateTokens ?? result?.manifest?.candidateTokens ?? null,
    selectedTokens: result?.estimatedTokens ?? null,
    excludedTokens: result?.excludedTokens ?? result?.manifest?.excludedTokens ?? null,
    finalTokens: null,
    finalTokenScope: 'pending llm/stream payload audit',
    included,
    excluded,
    includedCount: included.length,
    excludedCount: excluded.length,
    stepMessages,
    allowedStepMessages,
    blockedStepMessages: Math.max(0, stepMessages - allowedStepMessages),
    expectedMessageCount: expectedFingerprints?.length ?? null,
    expectedMessagesFingerprint: expectedFingerprints ? messageListFingerprint(expectedFingerprints) : null,
    ...(expectedFingerprints ? { expectedMessageFingerprints: expectedFingerprints } : {}),
    surfaceNodesBefore: placement?.surfaceNodesBefore ?? null,
    surfaceMessagesBefore: raw?.surfaceMessages ?? null,
    surfaceReadable: raw?.surfaceReadable ?? null,
    action: placement?.action || 'blocked',
    contextReused: placement?.reused === true,
    replacementSeq: placement?.replacementSeq ?? null,
    reusableContextFingerprint: result?.reusableContextFingerprint || null,
    compiledFingerprint: fingerprint,
    snapshotFingerprint,
    graphRevision: result?.manifest?.graphRevision || null,
    validation: validation || { valid: false, errors: [error || 'Context Firewall failed'], warnings: [] },
    ...(placement?.warning ? { warning: placement.warning } : {}),
    ...(error ? { error } : {}),
    createdAt: new Date().toISOString(),
  };
}
