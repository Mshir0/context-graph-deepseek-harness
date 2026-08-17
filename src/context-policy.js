import { createHash } from 'node:crypto';

export const CONTEXT_POLICY_VERSION = 1;

export const DEFAULT_CONTEXT_POLICY = Object.freeze({
  conversation: { enabled: false },
  rawLogs: { enabled: false },
  functionalDependencies: { depth: 2 },
  interfaces: { depth: 2 },
  implementation: { depth: 1, maxFiles: 3, maxRatio: 0.55 },
  tests: { depth: 1, maxRatio: 0.15 },
  documentation: { maxRatio: 0.1 },
  history: { maxRatio: 0.05 },
  maxItemRatio: 0.7,
});

const POLICY_ORDER = Object.freeze({ hard: 0, soft: 1, optional: 2 });
const PRIORITY_SCORE = Object.freeze({ critical: 1, high: 0.9, normal: 0.68, low: 0.42 });
const HARD_TYPES = new Set(['requirement', 'constraint', 'project_rule']);
const OPTIONAL_TYPES = new Set(['conversation', 'note', 'documentation']);
const CONVERSATION_SCOPES = new Set(['conversation', 'raw']);
const RAW_LOG_SCOPES = new Set(['raw_log', 'logs']);
const TERMINAL_STATUSES = new Set(['resolved', 'deprecated', 'superseded', 'archived']);
const INACTIVE_STATUSES = new Set(['resolved', 'deprecated', 'superseded', 'archived', 'stale']);

export function estimateContextTokens(value) {
  return Math.ceil([...String(value || '')].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : 0.25), 0));
}

export function contextContentHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

export function resolveContextPolicy(value = {}) {
  return {
    ...DEFAULT_CONTEXT_POLICY,
    ...value,
    conversation: { ...DEFAULT_CONTEXT_POLICY.conversation, ...(value.conversation || {}) },
    rawLogs: { ...DEFAULT_CONTEXT_POLICY.rawLogs, ...(value.rawLogs || {}) },
    functionalDependencies: { ...DEFAULT_CONTEXT_POLICY.functionalDependencies, ...(value.functionalDependencies || {}) },
    interfaces: { ...DEFAULT_CONTEXT_POLICY.interfaces, ...(value.interfaces || {}) },
    implementation: { ...DEFAULT_CONTEXT_POLICY.implementation, ...(value.implementation || {}) },
    tests: { ...DEFAULT_CONTEXT_POLICY.tests, ...(value.tests || {}) },
    documentation: { ...DEFAULT_CONTEXT_POLICY.documentation, ...(value.documentation || {}) },
    history: { ...DEFAULT_CONTEXT_POLICY.history, ...(value.history || {}) },
  };
}

export function classifyContextCandidate(candidate) {
  const type = candidate.nodeType || candidate.type || '';
  const scope = candidate.scope || '';
  if (candidate.forceInclude || candidate.required || scope === 'task' || scope === 'project') return 'hard';
  const requiredState = !TERMINAL_STATUSES.has(candidate.status);
  if (HARD_TYPES.has(type) && requiredState) return 'hard';
  if ((type === 'interface' || scope === 'interface' || scope === 'contract') && requiredState) return 'hard';
  if (type === 'decision' && requiredState && (candidate.priorityName === 'critical' || candidate.priority >= 900)) return 'hard';
  if (OPTIONAL_TYPES.has(type) || CONVERSATION_SCOPES.has(scope) || RAW_LOG_SCOPES.has(scope) || scope === 'history') return 'optional';
  return 'soft';
}

export function scoreContextCandidate(candidate) {
  const explicit = candidate.forceInclude ? 1 : candidate.required ? 0.96 : 0;
  const priority = Number.isFinite(candidate.priority)
    ? Math.max(0, Math.min(1, candidate.priority / 1000))
    : PRIORITY_SCORE[candidate.priorityName] || PRIORITY_SCORE.normal;
  const depth = Number.isFinite(candidate.depth) ? Math.max(0, candidate.depth) : 1;
  const distance = 1 / (depth + 1);
  const target = candidate.reason === 'context entry' || candidate.reason === 'current request' ? 1 : 0;
  const score = Math.max(explicit, 0.46 * priority + 0.3 * distance + 0.24 * target);
  return Number(score.toFixed(4));
}

function publicItem(item) {
  const { content, ...publicValue } = item;
  return publicValue;
}

function exclusion(item, reason, extra = {}) {
  return publicItem({ ...item, reason, ...extra });
}

function rawKind(item) {
  if (RAW_LOG_SCOPES.has(item.scope) || item.rawKind === 'log' || item.nodeType === 'raw_log') return 'log';
  if (item.raw === true || item.nodeType === 'conversation' || CONVERSATION_SCOPES.has(item.scope)) return 'conversation';
  return null;
}

function rawAllowed(item, policy) {
  if (item.forceInclude) return true;
  const kind = rawKind(item);
  if (kind === 'log') return policy.rawLogs.enabled === true;
  if (kind === 'conversation') return policy.conversation.enabled === true;
  return true;
}

function budgetCategory(item) {
  if (item.scope === 'code' || String(item.nodeType || '').startsWith('implementation_') || item.nodeType === 'code_module') return 'implementation';
  if (item.nodeType === 'test' || item.scope === 'test' || item.scope === 'tests') return 'tests';
  if (item.nodeType === 'documentation') return 'documentation';
  if (item.scope === 'history' || item.nodeType === 'conversation') return 'history';
  return null;
}

function normalizeCandidate(candidate, index) {
  const content = String(candidate.content || '').trim();
  const tokens = Number.isFinite(candidate.tokens)
    ? candidate.tokens
    : estimateContextTokens(content) + estimateContextTokens(candidate.label) + 10;
  const normalized = {
    ...candidate,
    candidateIndex: index,
    content,
    tokens,
    source: candidate.source || 'unknown',
    contentHash: candidate.contentHash || contextContentHash(content),
  };
  normalized.policyClass = candidate.policyClass || classifyContextCandidate(normalized);
  normalized.score = Number.isFinite(candidate.score) ? candidate.score : scoreContextCandidate(normalized);
  return normalized;
}

export function allocateContextBudget(candidates, {
  tokenBudget,
  policy = DEFAULT_CONTEXT_POLICY,
  preExcluded = [],
} = {}) {
  const resolvedPolicy = resolveContextPolicy(policy);
  const normalized = candidates.map(normalizeCandidate);
  const excluded = preExcluded.map((item, index) => publicItem(normalizeCandidate(item, -preExcluded.length + index)));
  const allowed = [];
  const seenContent = new Map();

  for (const item of normalized) {
    if (!item.content) continue;
    if (!rawAllowed(item, resolvedPolicy)) {
      excluded.push(exclusion(item, rawKind(item) === 'log' ? 'raw logs disabled by policy' : 'raw context disabled by policy'));
      continue;
    }
    if (INACTIVE_STATUSES.has(item.status) && !item.forceInclude && !item.required) {
      excluded.push(exclusion(item, `${item.status} context disabled by policy`));
      continue;
    }
    const duplicate = seenContent.get(item.contentHash);
    if (duplicate) {
      excluded.push(exclusion(item, `duplicate of ${duplicate.node || duplicate.label}`));
      continue;
    }
    seenContent.set(item.contentHash, item);
    allowed.push(item);
  }

  allowed.sort((left, right) => POLICY_ORDER[left.policyClass] - POLICY_ORDER[right.policyClass]
    || right.score - left.score
    || right.priority - left.priority
    || left.candidateIndex - right.candidateIndex);

  const included = [];
  let used = 0;
  const categoryUse = new Map();
  for (const item of allowed) {
    if (item.policyClass === 'hard') {
      included.push(item);
      used += item.tokens;
      continue;
    }
    if (item.tokens > tokenBudget * resolvedPolicy.maxItemRatio) {
      excluded.push(exclusion(item, 'single item exceeds policy size limit'));
      continue;
    }
    const category = budgetCategory(item);
    const categoryRatio = category && resolvedPolicy[category]?.maxRatio;
    if (Number.isFinite(categoryRatio) && (categoryUse.get(category) || 0) + item.tokens > Math.floor(tokenBudget * categoryRatio)) {
      excluded.push(exclusion(item, `${category} category budget`));
      continue;
    }
    if (used + item.tokens <= tokenBudget) {
      included.push(item);
      used += item.tokens;
      if (category) categoryUse.set(category, (categoryUse.get(category) || 0) + item.tokens);
    } else {
      excluded.push(exclusion(item, 'token budget'));
    }
  }

  return {
    candidates: normalized,
    included,
    excluded,
    candidateTokens: normalized.reduce((sum, item) => sum + item.tokens, 0),
    selectedTokens: used,
    excludedTokens: excluded.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0),
    overBudget: used > tokenBudget,
    policy: resolvedPolicy,
  };
}

export function validateCompiledContext({
  tokenBudget,
  included = [],
  excluded = [],
  forceExclude = [],
  policy = DEFAULT_CONTEXT_POLICY,
} = {}) {
  const resolvedPolicy = resolveContextPolicy(policy);
  const errors = [];
  const warnings = [];
  const forced = new Set(forceExclude);
  const ids = new Set();
  const hashes = new Set();
  const selectedTokens = included.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);

  if (!Number.isInteger(tokenBudget) || tokenBudget <= 0) errors.push({ code: 'INVALID_BUDGET', message: 'Token budget must be a positive integer.' });
  if (selectedTokens > tokenBudget) errors.push({ code: 'BUDGET_EXCEEDED', message: `Selected context uses ${selectedTokens} tokens, above the ${tokenBudget} token budget.` });

  for (const item of included) {
    const id = item.node || item.module;
    if (id && forced.has(id)) errors.push({ code: 'FORCE_EXCLUDE_LEAK', node: id, message: `${id} is FORCE_EXCLUDE but appears in selected context.` });
    if (item.policyClass === 'hard' && INACTIVE_STATUSES.has(item.status) && !item.forceInclude) errors.push({ code: 'STALE_HARD_CONTEXT', node: id, message: `${id} is ${item.status} but selected as Hard Context.` });
    if (!rawAllowed(item, resolvedPolicy)) errors.push({ code: rawKind(item) === 'log' ? 'RAW_LOG_LEAK' : 'RAW_CONTEXT_LEAK', node: id, message: `${id || item.label} is raw ${rawKind(item) === 'log' ? 'log' : 'conversation'} context disabled by policy.` });
    if (id && ids.has(id) && item.scope === included.find(value => (value.node || value.module) === id)?.scope) warnings.push({ code: 'DUPLICATE_NODE_SCOPE', node: id, message: `${id} appears more than once for the same scope.` });
    if (id) ids.add(id);
    if (item.contentHash && hashes.has(item.contentHash)) errors.push({ code: 'DUPLICATE_CONTENT', node: id, message: `${id || item.label} duplicates selected content.` });
    if (item.contentHash) hashes.add(item.contentHash);
  }

  const forceExcludedHard = excluded.filter(item => item.policyClass === 'hard' && item.reason === 'FORCE_EXCLUDE');
  if (forceExcludedHard.length) errors.push({ code: 'FORCE_EXCLUDE_HARD_CONFLICT', nodes: forceExcludedHard.map(item => item.node || item.module).filter(Boolean), message: 'Force Exclude conflicts with required Hard Context.' });
  const omittedHard = excluded.filter(item => item.policyClass === 'hard' && item.reason !== 'FORCE_EXCLUDE');
  if (omittedHard.length) errors.push({ code: 'MISSING_HARD_CONTEXT', nodes: omittedHard.map(item => item.node || item.module).filter(Boolean), message: 'One or more Hard Context items were omitted.' });

  return { valid: errors.length === 0, errors, warnings, selectedTokens, checkedAt: new Date().toISOString() };
}

export function buildContextManifest({
  task = '',
  target,
  tokenBudget,
  allocation,
  forceExclude = [],
  rawTokens = 0,
  graphRevision = '',
} = {}) {
  const included = allocation.included.map(publicItem);
  const excluded = allocation.excluded.map(item => ({ ...item }));
  const validation = validateCompiledContext({ tokenBudget, included, excluded, forceExclude, policy: allocation.policy });
  return {
    version: CONTEXT_POLICY_VERSION,
    task,
    target,
    budget: tokenBudget,
    policy: allocation.policy,
    graphRevision,
    generatedAt: new Date().toISOString(),
    rawTokens,
    candidateTokens: allocation.candidateTokens,
    selectedTokens: allocation.selectedTokens,
    excludedTokens: allocation.excludedTokens,
    finalTokens: null,
    finalTokenScope: 'pending final llm/stream payload audit',
    included,
    excluded,
    reasons: Object.fromEntries([...included, ...excluded].filter(item => item.node || item.module).map(item => [item.node || item.module, item.reason])),
    validation,
  };
}

export function createContextAudit(manifest, values = {}) {
  const rawTokens = Number(values.rawTokens ?? manifest.rawTokens) || 0;
  const candidateTokens = Number(values.candidateTokens ?? manifest.candidateTokens) || 0;
  const selectedTokens = Number(values.selectedTokens ?? manifest.selectedTokens) || 0;
  const finalTokens = Number(values.finalTokens ?? manifest.finalTokens) || 0;
  return {
    generatedAt: new Date().toISOString(),
    rawTokens,
    candidateTokens,
    selectedTokens,
    excludedTokens: Math.max(0, Number(values.excludedTokens ?? manifest.excludedTokens) || candidateTokens - selectedTokens),
    finalTokens,
    budget: manifest.budget,
    target: manifest.target,
    included: manifest.included,
    excluded: manifest.excluded,
    validation: values.validation || manifest.validation,
    surface: values.surface || null,
  };
}
